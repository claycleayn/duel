'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { actionDefs, resolveRound } = require('./engine.js');
const { chooseBotPick } = require('./bot.js');

const PORT = Number(process.env.PORT) || 3000;
const ROOM_TOKENS = (process.env.ACCESS_TOKENS || process.env.ACCESS_TOKEN || '')
  .split(',')
  .map((token) => token.trim())
  .filter(Boolean);
if (ROOM_TOKENS.length === 0) ROOM_TOKENS.push('');
const ROOT = __dirname;
const REVEAL_MS = Math.max(100, Number(process.env.REVEAL_MS) || 2400);
const MAX_ROUNDS = 200;
const MAX_LOG = 100;
const MAX_PLAYERS = 4;
const BOT_TOKEN = '__cpu__!';

const DEFAULTS = {
  hp: 1,
  startEnergy: 0,
  attackCost: 1,
  attackDmg: 1,
  ultCost: 5,
  ultDmg: 2,
  defendReduce: 1,
};

function cleanToken(raw) {
  if (typeof raw !== 'string') return null;
  const token = raw.trim().slice(0, 128);
  return /^[A-Za-z0-9._:-]+$/.test(token) ? token : null;
}

function readBody(req, res, callback) {
  let body = '';
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > 16384) {
      req.destroy();
      return;
    }
    body += chunk;
  });
  req.on('end', () => {
    try {
      callback(JSON.parse(body || '{}'));
    } catch (error) {
      respond(res, 400, { ok: false, error: 'bad json' });
    }
  });
}

function respond(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

function createRoom(accessToken) {
  const tag = accessToken ? accessToken.slice(0, 6) : 'open';

  const game = {
  cfg: { ...DEFAULTS },
  mode: 'pvp', // pvp | cpu
  ruleset: 'full', // minimal | full
  playerCount: 2,
  hp: [1, 1, 0, 0],
  en: [0, 0, 0, 0],
  shield: [true, true, false, false],
  round: 1,
  phase: 'pick', // pick | reveal | over
  picks: [null, null, null, null],
  winner: null,
  log: [],
  reveal: null,
  revealId: 0,
  timer: null,
};

const seats = [null, null, null, null];
const connections = new Map(); // token -> { token, seat, res, heartbeat }

function resetGame() {
  clearTimeout(game.timer);
  game.timer = null;
  const count = game.playerCount;
  game.hp = [0, 0, 0, 0];
  game.en = [0, 0, 0, 0];
  game.shield = [false, false, false, false];
  for (let i = 0; i < count; i += 1) {
    game.hp[i] = game.cfg.hp;
    game.en[i] = game.cfg.startEnergy;
    game.shield[i] = game.ruleset === 'full';
  }
  game.round = 1;
  game.phase = 'pick';
  game.picks = [null, null, null, null];
  game.winner = null;
  game.log = [];
  game.reveal = null;
}

function isLive(conn) {
  return !!conn && !conn.res.writableEnded && !conn.res.destroyed;
}

function seatConnected(index) {
  const token = seats[index];
  if (token === BOT_TOKEN) return true;
  return !!token && isLive(connections.get(token));
}

function seatOfToken(token) {
  return seats.indexOf(token);
}

function seatAvailable(index) {
  if (index < 0 || index >= game.playerCount) return false;
  return seats[index] == null || !seatConnected(index);
}

function claimSeat(index, token) {
  if (seats[index] != null && seats[index] !== token) game.picks[index] = null;
  seats[index] = token;
}

function assignSeat(token, preferred) {
  const existing = seatOfToken(token);
  if (existing !== -1) return existing;
  if (Number.isInteger(preferred) && preferred >= 0 && preferred < game.playerCount) {
    if (seatAvailable(preferred)) {
      claimSeat(preferred, token);
      return preferred;
    }
  }
  for (let i = 0; i < game.playerCount; i += 1) {
    if (seatAvailable(i)) {
      claimSeat(i, token);
      return i;
    }
  }
  return 'spectator';
}

function refreshSeats() {
  for (const conn of connections.values()) {
    const index = seats.indexOf(conn.token);
    conn.seat = index === -1 ? 'spectator' : index;
  }
}

function botPick() {
  if (game.mode !== 'cpu' || game.phase !== 'pick' || game.picks[1]) return;
  const defs = actionDefs(game.cfg, game.ruleset);
  const pick = chooseBotPick({ hp: game.hp, en: game.en, shield: game.shield, log: game.log, round: game.round }, defs);
  if (!pick || !defs[pick.action] || game.en[1] < defs[pick.action].cost) {
    game.picks[1] = { action: 'charge', target: 0 };
    return;
  }
  game.picks[1] = { action: pick.action, target: 0 };
}

function setMode(mode) {
  if (mode !== 'cpu' && mode !== 'pvp') return;
  if (game.mode === mode) return;
  game.mode = mode;
  if (mode === 'cpu') {
    game.playerCount = 2;
    seats[1] = BOT_TOKEN;
    seats[2] = null;
    seats[3] = null;
  } else if (seats[1] === BOT_TOKEN) {
    seats[1] = null;
  }
  refreshSeats();
  resetGame();
  botPick();
}

function setPlayerCount(count) {
  if (count !== 2 && count !== 3 && count !== 4) return;
  if (game.playerCount === count) return;
  if (game.mode === 'cpu') setMode('pvp');
  game.playerCount = count;
  for (let i = count; i < MAX_PLAYERS; i += 1) seats[i] = null;
  refreshSeats();
  resetGame();
  botPick();
}

function setRuleset(ruleset) {
  if (ruleset !== 'minimal' && ruleset !== 'full') return;
  if (game.ruleset === ruleset) return;
  game.ruleset = ruleset;
  resetGame();
  botPick();
}

function stateFor(conn) {
  const seat = conn.seat;
  const count = game.playerCount;
  return {
    type: 'state',
    you: seat,
    mode: game.mode,
    ruleset: game.ruleset,
    playerCount: count,
    cfg: game.cfg,
    hp: game.hp.slice(0, count),
    en: game.en.slice(0, count),
    shield: game.shield.slice(0, count),
    round: game.round,
    phase: game.phase,
    winner: game.winner,
    locked: game.picks.slice(0, count).map((pick) => pick != null),
    yourPick: typeof seat === 'number' && game.picks[seat] ? game.picks[seat] : null,
    connected: Array.from({ length: count }, (_, i) => seatConnected(i)),
    log: game.log,
    reveal: game.reveal
      ? {
          id: game.reveal.id,
          picks: game.reveal.picks,
          result: game.reveal.result,
          text: game.reveal.text,
          before: game.reveal.before,
        }
      : null,
  };
}

function send(conn, payload) {
  if (!isLive(conn)) return;
  try {
    conn.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch (error) {
    /* the connection is going away */
  }
}

function broadcast() {
  for (const conn of connections.values()) send(conn, stateFor(conn));
}

function makeLogEntry(round, picks, result, defs) {
  const count = game.playerCount;
  const label = (index) => (game.mode === 'cpu' && index === 1 ? '电脑' : `玩家 ${index + 1}`);
  const bits = [];
  const canceledTotal = result.canceledPairs.reduce((sum, pair) => sum + pair.amount, 0);
  if (canceledTotal) bits.push(`抵消 <b>${canceledTotal}</b>`);
  for (let i = 0; i < count; i += 1) {
    if (result.blocked[i]) bits.push(`${label(i)} 防御 −<b>${result.blocked[i]}</b>`);
  }
  for (let i = 0; i < count; i += 1) {
    if (result.shieldBlocked[i]) bits.push(`${label(i)} 护盾抵挡 <b>${result.shieldBlocked[i]}</b>`);
  }
  for (const move of result.transferred || []) {
    bits.push(`${label(move.from)} ${move.via === 'light' ? '光明' : '黑暗'}转移 <b>${move.amount}</b>`);
  }
  for (let i = 0; i < count; i += 1) {
    if (result.escaped[i]) bits.push(`${label(i)} 逃脱`);
  }
  for (let i = 0; i < count; i += 1) {
    const pick = picks[i];
    if (!pick) continue;
    const key = pick.action;
    if ((key === 'light' || key === 'dark') && !result.transferred.some((move) => move.from === i)) {
      bits.push(`${label(i)} ${defs[key].name}未触发(只耗 1 EN)`);
    }
  }
  for (let i = 0; i < count; i += 1) {
    if (result.hpLoss[i]) bits.push(`${label(i)} 受到 <b class="hurt">${result.hpLoss[i]}</b> 点伤害`);
  }
  const text = bits.length ? bits.join(' · ') : '无人受伤';

  const players = [];
  for (let i = 0; i < count; i += 1) {
    const pick = picks[i];
    if (!pick) {
      players.push({ key: null, name: '—', delta: '', target: null });
      continue;
    }
    const delta = result.energyDelta[i];
    players.push({
      key: pick.action,
      name: defs[pick.action].name,
      delta: delta ? `${delta > 0 ? '+' : '−'}${Math.abs(delta)}` : '',
      target: pick.target,
    });
  }
  return { round, players, text };
}

function resolvePicks() {
  const count = game.playerCount;
  const defs = actionDefs(game.cfg, game.ruleset);
  const picks = game.picks.slice(0, count);
  const result = resolveRound(count, picks, defs, { shield: game.shield.slice(0, count) });
  const before = {
    hp: game.hp.slice(0, count),
    en: game.en.slice(0, count),
    shield: game.shield.slice(0, count),
  };

  for (let i = 0; i < count; i += 1) {
    game.en[i] += result.energyDelta[i];
    game.hp[i] = Math.max(0, game.hp[i] - result.hpLoss[i]);
  }
  game.shield = result.shieldAfter.concat(Array(MAX_PLAYERS - count).fill(false));

  const entry = makeLogEntry(game.round, picks, result, defs);
  game.log.unshift(entry);
  if (game.log.length > MAX_LOG) game.log.length = MAX_LOG;

  game.phase = 'reveal';
  game.reveal = {
    id: (game.revealId += 1),
    picks,
    result,
    text: entry.text,
    before,
  };

  const alive = [];
  for (let i = 0; i < count; i += 1) {
    if (game.hp[i] > 0) alive.push(i);
  }
  const finished = alive.length <= 1;
  if (finished) game.winner = alive.length === 1 ? alive[0] : 'draw';

  clearTimeout(game.timer);
  game.timer = setTimeout(() => {
    if (game.phase !== 'reveal') return;
    if (finished) {
      game.phase = 'over';
    } else if (game.round >= MAX_ROUNDS) {
      game.phase = 'over';
      game.winner = 'draw';
    } else {
      game.round += 1;
      game.picks = [null, null, null, null];
      game.phase = 'pick';
      game.reveal = null;
      botPick();
    }
    broadcast();
  }, REVEAL_MS);

  broadcast();
  const plain = entry.text.replace(/<[^>]+>/g, '');
  console.log(`[round ${tag} ${game.round}] ${picks.map((pick, i) => (pick ? `P${i + 1} ${pick.action}` : `P${i + 1} —`)).join(' vs ')} · ${plain}`);
}

function handleEvents(req, res, url) {
  const token = cleanToken(url.searchParams.get('token'));
  if (!token) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('missing token');
    return;
  }

  const seatParam = url.searchParams.get('seat');
  const preferred = ['0', '1', '2', '3'].includes(seatParam) ? Number(seatParam) : null;

  const cpuParam = url.searchParams.get('cpu');
  const rulesParam = url.searchParams.get('rules');
  const playersParam = url.searchParams.get('players');
  const isHost = preferred === 0 && (seatOfToken(token) === 0 || seatAvailable(0));
  if (isHost) {
    if (cpuParam === '1') setMode('cpu');
    else if (cpuParam === '0') setMode('pvp');
    if (playersParam === '2' || playersParam === '3' || playersParam === '4') {
      setPlayerCount(Number(playersParam));
    }
    if (rulesParam === 'full') setRuleset('full');
    else if (rulesParam === 'minimal') setRuleset('minimal');
  }

  const old = connections.get(token);
  if (old) {
    try {
      old.res.end();
    } catch (error) {
      /* already closed */
    }
  }

  const seat = assignSeat(token, preferred);
  const conn = { token, seat, res, heartbeat: null };
  connections.set(token, conn);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 1500\n\n');

  conn.heartbeat = setInterval(() => {
    if (!isLive(conn)) return;
    try {
      res.write(': ping\n\n');
    } catch (error) {
      /* ignore */
    }
  }, 15000);

  res.on('close', () => {
    clearInterval(conn.heartbeat);
    if (connections.get(token) === conn) {
      connections.delete(token);
      console.log(`[conn ${tag}] ${token.slice(0, 10)} 断开`);
      broadcast();
    }
  });

  console.log(`[conn ${tag}] ${token.slice(0, 10)} → ${seat === 'spectator' ? '观众' : `P${seat + 1}`}`);
  broadcast();
}

function handlePick(req, res) {
  readBody(req, res, (body) => {
    const token = cleanToken(body.token);
    const conn = token ? connections.get(token) : null;
    if (!conn || typeof conn.seat !== 'number') {
      respond(res, 403, { ok: false, error: 'not seated' });
      return;
    }
    const seat = conn.seat;
    if (game.phase !== 'pick') {
      respond(res, 409, { ok: false, error: 'not picking' });
      return;
    }
    if (game.hp[seat] <= 0) {
      respond(res, 409, { ok: false, error: 'dead' });
      return;
    }
    if (game.picks[seat]) {
      respond(res, 409, { ok: false, error: 'already locked' });
      return;
    }

    const defs = actionDefs(game.cfg, game.ruleset);
    if (typeof body.action !== 'string' || !Object.prototype.hasOwnProperty.call(defs, body.action)) {
      respond(res, 400, { ok: false, error: 'unknown action' });
      return;
    }
    const def = defs[body.action];
    if (game.en[seat] < def.cost) {
      respond(res, 400, { ok: false, error: 'not enough energy' });
      return;
    }

    const count = game.playerCount;
    const alive = [];
    for (let i = 0; i < count; i += 1) {
      if (game.hp[i] > 0) alive.push(i);
    }
    const needsTarget = (def.effects ?? []).some((effect) => (
      (effect.kind === 'damage' || effect.kind === 'transfer') && effect.target === 'chosen'
    ));
    let target = Number.isInteger(body.target) ? body.target : null;
    if (target == null || target === seat || target < 0 || target >= count || game.hp[target] <= 0) {
      target = alive.find((index) => index !== seat) ?? null;
    }
    if (needsTarget && target == null) {
      respond(res, 400, { ok: false, error: 'no target' });
      return;
    }

    game.picks[seat] = { action: body.action, target };
    if (game.mode === 'cpu' && !game.picks[1]) botPick();
    const allPicked = alive.every((index) => game.picks[index] != null);
    if (allPicked) resolvePicks();
    else broadcast();
    respond(res, 200, { ok: true });
  });
}

function handleRestart(req, res) {
  readBody(req, res, (body) => {
    const token = cleanToken(body.token);
    const conn = token ? connections.get(token) : null;
    if (!conn) {
      respond(res, 403, { ok: false, error: 'not connected' });
      return;
    }
    if (game.phase !== 'over') {
      respond(res, 409, { ok: false, error: 'game not over' });
      return;
    }
    resetGame();
    botPick();
    broadcast();
    console.log('[game] restart');
    respond(res, 200, { ok: true });
  });
}

function handleConfig(req, res) {
  readBody(req, res, (body) => {
    const token = cleanToken(body.token);
    const conn = token ? connections.get(token) : null;
    if (!conn) {
      respond(res, 403, { ok: false, error: 'not connected' });
      return;
    }

    const clamp = (value, min, max, fallback) => {
      const number = Math.round(Number(value));
      return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    };

    game.cfg.hp = clamp(body.hp, 1, 20, game.cfg.hp);
    game.cfg.startEnergy = clamp(body.startEnergy, 0, 20, game.cfg.startEnergy);
    game.cfg.ultCost = clamp(body.ultCost, 1, 20, game.cfg.ultCost);
    game.cfg.ultDmg = clamp(body.ultDmg, 1, 10, game.cfg.ultDmg);

    resetGame();
    botPick();
    broadcast();
    console.log('[config]', game.cfg);
    respond(res, 200, { ok: true, cfg: game.cfg });
  });
}

function handleMode(req, res) {
  readBody(req, res, (body) => {
    const token = cleanToken(body.token);
    const conn = token ? connections.get(token) : null;
    if (!conn || conn.seat !== 0) {
      respond(res, 403, { ok: false, error: 'host only' });
      return;
    }
    if (body.mode !== 'cpu' && body.mode !== 'pvp') {
      respond(res, 400, { ok: false, error: 'bad mode' });
      return;
    }
    setMode(body.mode);
    broadcast();
    console.log('[mode]', body.mode);
    respond(res, 200, { ok: true, mode: body.mode });
  });
}

function handleRuleset(req, res) {
  readBody(req, res, (body) => {
    const token = cleanToken(body.token);
    const conn = token ? connections.get(token) : null;
    if (!conn || conn.seat !== 0) {
      respond(res, 403, { ok: false, error: 'host only' });
      return;
    }
    if (body.ruleset !== 'minimal' && body.ruleset !== 'full') {
      respond(res, 400, { ok: false, error: 'bad ruleset' });
      return;
    }
    setRuleset(body.ruleset);
    broadcast();
    console.log('[ruleset]', body.ruleset);
    respond(res, 200, { ok: true, ruleset: body.ruleset });
  });
}

function handlePlayerCount(req, res) {
  readBody(req, res, (body) => {
    const token = cleanToken(body.token);
    const conn = token ? connections.get(token) : null;
    if (!conn || conn.seat !== 0) {
      respond(res, 403, { ok: false, error: 'host only' });
      return;
    }
    const count = Number(body.playerCount);
    if (count !== 2 && count !== 3 && count !== 4) {
      respond(res, 400, { ok: false, error: 'bad player count' });
      return;
    }
    setPlayerCount(count);
    broadcast();
    console.log('[players]', count);
    respond(res, 200, { ok: true, playerCount: count });
  });
}

  return {
    token: accessToken,
    handleEvents,
    handlePick,
    handleRestart,
    handleConfig,
    handleMode,
    handleRuleset,
    handlePlayerCount,
    health: () => ({
      ok: true,
      mode: game.mode,
      ruleset: game.ruleset,
      playerCount: game.playerCount,
      phase: game.phase,
      round: game.round,
      shield: game.shield,
      seats: game.picks.map(Boolean),
    }),
  };
}

const STATIC = {
  '/engine.js': ['engine.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/hotseat.html': ['hotseat.html', 'text/html; charset=utf-8'],
};

function serveStatic(res, file, type) {
  fs.readFile(path.join(ROOT, file), (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

const rooms = new Map();
for (const token of ROOM_TOKENS) rooms.set(token, createRoom(token));

function resolveRoom(url) {
  const key = url.searchParams.get('room');
  if (key !== null && rooms.has(key)) return rooms.get(key);
  if (rooms.has('') && (key === null || key === '')) return rooms.get('');
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const room = resolveRoom(url);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    if (!room) {
      notFound(res);
      return;
    }
    serveStatic(res, 'index.html', 'text/html; charset=utf-8');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/events') {
    if (!room) {
      notFound(res);
      return;
    }
    room.handleEvents(req, res, url);
    return;
  }
  if (req.method === 'POST') {
    if (!room) {
      respond(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
    if (url.pathname === '/pick') { room.handlePick(req, res); return; }
    if (url.pathname === '/restart') { room.handleRestart(req, res); return; }
    if (url.pathname === '/config') { room.handleConfig(req, res); return; }
    if (url.pathname === '/mode') { room.handleMode(req, res); return; }
    if (url.pathname === '/ruleset') { room.handleRuleset(req, res); return; }
    if (url.pathname === '/playercount') { room.handlePlayerCount(req, res); return; }
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    if (!room) {
      notFound(res);
      return;
    }
    respond(res, 200, room.health());
    return;
  }
  if (req.method === 'GET' && url.pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'GET' && STATIC[url.pathname]) {
    serveStatic(res, STATIC[url.pathname][0], STATIC[url.pathname][1]);
    return;
  }

  notFound(res);
});

function lanAddresses() {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
    }
  }
  return addresses;
}

function gameLink(host, roomToken, seat, cpu, rules) {
  const parts = [];
  if (roomToken) parts.push(`room=${encodeURIComponent(roomToken)}`);
  parts.push(`seat=${seat}`);
  if (cpu !== null && cpu !== undefined) parts.push(`cpu=${cpu ? 1 : 0}`);
  if (rules) parts.push(`rules=${rules}`);
  return `http://${host}:${PORT}/?${parts.join('&')}`;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('极简决斗 server');
  const hosts = ['localhost', ...lanAddresses()];
  ROOM_TOKENS.forEach((token, index) => {
    console.log(`\n房间 ${index + 1}${token ? ` (${token.slice(0, 6)}…)` : ' (开放)'}`);
    for (const host of hosts) {
      console.log(`  ${host}:`);
      console.log(`    P1  ${gameLink(host, token, 0, 0, 'full')}`);
      console.log(`    P2  ${gameLink(host, token, 1, null, null)}`);
      console.log(`    P3  ${gameLink(host, token, 2, null, null)}`);
      console.log(`    P4  ${gameLink(host, token, 3, null, null)}`);
      console.log(`    CPU ${gameLink(host, token, 0, 1, 'full')}`);
    }
  });
  if (ROOM_TOKENS.some(Boolean)) console.log('\n房间令牌已启用:链接里带密钥,不要公开分享。');
  console.log('手机与电脑需能互相访问这个端口。Ctrl+C 停止。');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用;换一个:PORT=3001 node server.js`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
