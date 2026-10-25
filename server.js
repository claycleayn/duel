'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { actionDefs, resolveRound } = require('./engine.js');

const PORT = Number(process.env.PORT) || 3000;
const ACCESS_TOKEN = (process.env.ACCESS_TOKEN || '').trim();
const ROOT = __dirname;
const REVEAL_MS = 2400;
const MAX_ROUNDS = 200;
const MAX_LOG = 100;

const DEFAULTS = {
  hp: 1,
  startEnergy: 0,
  attackCost: 1,
  attackDmg: 1,
  ultCost: 5,
  ultDmg: 2,
  defendReduce: 1,
};

const game = {
  cfg: { ...DEFAULTS },
  hp: [1, 1],
  en: [0, 0],
  round: 1,
  phase: 'pick', // pick | reveal | over
  picks: [null, null],
  winner: null,
  log: [],
  reveal: null,
  revealId: 0,
  timer: null,
};

const seats = [null, null];
const connections = new Map(); // token -> { token, seat, res, heartbeat }

function resetGame() {
  clearTimeout(game.timer);
  game.timer = null;
  game.hp = [game.cfg.hp, game.cfg.hp];
  game.en = [game.cfg.startEnergy, game.cfg.startEnergy];
  game.round = 1;
  game.phase = 'pick';
  game.picks = [null, null];
  game.winner = null;
  game.log = [];
  game.reveal = null;
}

function isLive(conn) {
  return !!conn && !conn.res.writableEnded && !conn.res.destroyed;
}

function seatConnected(index) {
  const token = seats[index];
  return !!token && isLive(connections.get(token));
}

function seatOfToken(token) {
  return seats.indexOf(token);
}

function seatAvailable(index) {
  return seats[index] == null || !seatConnected(index);
}

function claimSeat(index, token) {
  if (seats[index] != null && seats[index] !== token) game.picks[index] = null;
  seats[index] = token;
}

function assignSeat(token, preferred) {
  const existing = seatOfToken(token);
  if (existing !== -1) return existing;
  if (preferred === 0 || preferred === 1) {
    if (seatAvailable(preferred)) {
      claimSeat(preferred, token);
      return preferred;
    }
  }
  for (let i = 0; i < 2; i += 1) {
    if (seatAvailable(i)) {
      claimSeat(i, token);
      return i;
    }
  }
  return 'spectator';
}

function stateFor(conn) {
  const seat = conn.seat;
  return {
    type: 'state',
    you: seat,
    cfg: game.cfg,
    hp: game.hp,
    en: game.en,
    round: game.round,
    phase: game.phase,
    winner: game.winner,
    locked: game.picks.map((pick) => pick != null),
    yourPick: typeof seat === 'number' && game.picks[seat] ? game.picks[seat].action : null,
    connected: [seatConnected(0), seatConnected(1)],
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
  const bits = [];
  const canceledTotal = result.canceledPairs.reduce((sum, pair) => sum + pair.amount, 0);
  if (canceledTotal) bits.push(`抵消 <b>${canceledTotal}</b>`);
  for (let i = 0; i < 2; i += 1) {
    if (result.blocked[i]) bits.push(`玩家 ${i + 1} 防御 −<b>${result.blocked[i]}</b>`);
  }
  for (let i = 0; i < 2; i += 1) {
    if (result.hpLoss[i]) bits.push(`玩家 ${i + 1} 受到 <b class="hurt">${result.hpLoss[i]}</b> 点伤害`);
  }
  const text = bits.length ? bits.join(' · ') : '无人受伤';
  const chip = (index) => {
    const delta = result.energyDelta[index];
    return {
      name: defs[picks[index].action].name,
      delta: delta ? `${delta > 0 ? '+' : '−'}${Math.abs(delta)}` : '',
    };
  };
  return { round, a: chip(0), b: chip(1), text };
}

function resolvePicks() {
  const defs = actionDefs(game.cfg);
  const picks = game.picks.slice();
  const result = resolveRound(2, picks, defs);
  const before = { hp: game.hp.slice(), en: game.en.slice() };

  for (let i = 0; i < 2; i += 1) {
    game.en[i] += result.energyDelta[i];
    game.hp[i] = Math.max(0, game.hp[i] - result.hpLoss[i]);
  }

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

  const dead0 = game.hp[0] <= 0;
  const dead1 = game.hp[1] <= 0;
  const finished = dead0 || dead1;
  if (finished) game.winner = dead0 && dead1 ? 'draw' : dead0 ? 1 : 0;

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
      game.picks = [null, null];
      game.phase = 'pick';
      game.reveal = null;
    }
    broadcast();
  }, REVEAL_MS);

  broadcast();
  const plain = entry.text.replace(/<[^>]+>/g, '');
  console.log(`[round ${game.round}] P1 ${picks[0].action} vs P2 ${picks[1].action} · ${plain}`);
}

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

function roomOk(url) {
  return !ACCESS_TOKEN || url.searchParams.get('room') === ACCESS_TOKEN;
}

function roomOkBody(body) {
  return !ACCESS_TOKEN || body.room === ACCESS_TOKEN;
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

function handleEvents(req, res, url) {
  if (!roomOk(url)) {
    notFound(res);
    return;
  }

  const token = cleanToken(url.searchParams.get('token'));
  if (!token) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('missing token');
    return;
  }

  const seatParam = url.searchParams.get('seat');
  const preferred = seatParam === '0' ? 0 : seatParam === '1' ? 1 : null;

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
      console.log(`[conn] ${token.slice(0, 10)} 断开`);
      broadcast();
    }
  });

  console.log(`[conn] ${token.slice(0, 10)} → ${seat === 'spectator' ? '观众' : `P${seat + 1}`}`);
  broadcast();
}

function handlePick(req, res) {
  readBody(req, res, (body) => {
    if (!roomOkBody(body)) {
      respond(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
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
    if (game.picks[seat]) {
      respond(res, 409, { ok: false, error: 'already locked' });
      return;
    }

    const defs = actionDefs(game.cfg);
    if (typeof body.action !== 'string' || !Object.prototype.hasOwnProperty.call(defs, body.action)) {
      respond(res, 400, { ok: false, error: 'unknown action' });
      return;
    }
    const def = defs[body.action];
    if (game.en[seat] < def.cost) {
      respond(res, 400, { ok: false, error: 'not enough energy' });
      return;
    }

    let target = Number.isInteger(body.target) ? body.target : 1 - seat;
    if (target === seat || target < 0 || target > 1) target = 1 - seat;

    game.picks[seat] = { action: body.action, target };
    if (game.picks[0] && game.picks[1]) resolvePicks();
    else broadcast();
    respond(res, 200, { ok: true });
  });
}

function handleRestart(req, res) {
  readBody(req, res, (body) => {
    if (!roomOkBody(body)) {
      respond(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
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
    broadcast();
    console.log('[game] restart');
    respond(res, 200, { ok: true });
  });
}

function handleConfig(req, res) {
  readBody(req, res, (body) => {
    if (!roomOkBody(body)) {
      respond(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
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
    broadcast();
    console.log('[config]', game.cfg);
    respond(res, 200, { ok: true, cfg: game.cfg });
  });
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    if (!roomOk(url)) {
      notFound(res);
      return;
    }
    serveStatic(res, 'index.html', 'text/html; charset=utf-8');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/events') {
    handleEvents(req, res, url);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/pick') {
    handlePick(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/restart') {
    handleRestart(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/config') {
    handleConfig(req, res);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    if (!roomOk(url)) {
      notFound(res);
      return;
    }
    respond(res, 200, { ok: true, phase: game.phase, round: game.round, seats: game.picks.map(Boolean) });
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

function gameLink(host, seat) {
  const query = ACCESS_TOKEN
    ? `?room=${encodeURIComponent(ACCESS_TOKEN)}&seat=${seat}`
    : `?seat=${seat}`;
  return `http://${host}:${PORT}/${query}`;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('极简决斗 server');
  console.log(`本机:   ${gameLink('localhost', 0)}   ${gameLink('localhost', 1)}`);
  for (const address of lanAddresses()) {
    console.log(`局域网: ${gameLink(address, 0)}   ${gameLink(address, 1)}`);
  }
  if (ACCESS_TOKEN) console.log('房间令牌已启用:链接里带密钥,不要公开分享。');
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
