(() => {
  'use strict';

  const { actionDefs, attackTotal } = window.DuelEngine;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const DEFAULTS = {
    hp: 1,
    startEnergy: 0,
    attackCost: 1,
    attackDmg: 1,
    ultCost: 5,
    ultDmg: 2,
    defendReduce: 1,
  };

  const ICONS = {
    charge: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
    defend: '<path d="M12 3 5 6v5c0 4.2 2.8 7.6 7 9 4.2-1.4 7-4.8 7-9V6l-7-3Z"/>',
    attack: '<path d="M5 19 19 5M13 5h6v6"/>',
    ult: '<path d="M12 2.5 14.7 9l6.8.6-5.2 4.5 1.6 6.6L12 17.2 6.1 20.7l1.6-6.6L2.5 9.6 9.3 9 12 2.5Z"/>',
    double: '<path d="M4 16 15 5M9 20 20 9"/>',
    water: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>',
    escape: '<path d="M5 7l5 5-5 5M12 7l5 5-5 5"/>',
  };

  const view = {
    online: false,
    you: null,
    host: false,
    mode: 'pvp',
    ruleset: 'minimal',
    teamMode: 'ffa',
    teams: null,
    bots: [false, false, false, false],
    playerCount: 2,
    cfg: { ...DEFAULTS },
    hp: [1, 1],
    en: [0, 0],
    shield: [false, false],
    round: 1,
    phase: 'pick',
    winner: null,
    locked: [false, false],
    connected: [false, false],
    yourPick: null,
    target: null,
    log: [],
    reveal: null,
  };

  const params = new URLSearchParams(window.location.search);
  const seatRaw = params.get('seat');
  const preferredSeat = ['0', '1', '2', '3'].includes(seatRaw) ? Number(seatRaw) : null;
  const room = params.get('room') || '';
  const cpuParam = params.get('cpu');
  const rulesParam = params.get('rules');
  const playersParam = params.get('players');
  const botsParam = params.get('bots');
  const teamsParam = params.get('teams');
  const FILE_MODE = window.location.protocol === 'file:';
  let token = '';

  let selected = null;
  let busy = false;
  let soundOn = true;
  let audioCtx = null;
  let lastRevealId = -1;
  let lastCfgKey = '';
  let lastRound = 0;

  function getToken(seat) {
    let base = '';
    try {
      base = sessionStorage.getItem('duel-token') || '';
      if (!base) {
        base = 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        sessionStorage.setItem('duel-token', base);
      }
    } catch (error) {
      base = 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    }
    return seat === null ? base : `${base}s${seat}`;
  }

  function beep(freq, dur = 0.07, type = 'sine', gain = 0.035, delay = 0) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t0 = audioCtx.currentTime + delay;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    } catch (error) {
      /* audio is optional */
    }
  }

  async function post(url, body) {
    try {
      const target = room ? `${url}${url.includes('?') ? '&' : '?'}room=${encodeURIComponent(room)}` : url;
      const response = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, room }),
      });
      const data = await response.json().catch(() => ({ ok: response.ok }));
      return { ok: response.ok && data.ok !== false, data };
    } catch (error) {
      return { ok: false };
    }
  }

  function currentDefs() {
    return actionDefs(view.cfg, view.ruleset);
  }

  function playerName(index) {
    if (view.bots && view.bots[index]) {
      const botCount = view.bots.slice(0, view.playerCount).filter(Boolean).length;
      return botCount > 1 ? `电脑 ${index + 1}` : '电脑';
    }
    return `玩家 ${index + 1}`;
  }

  function alivePlayers() {
    const alive = [];
    for (let i = 0; i < view.playerCount; i += 1) {
      if (view.hp[i] > 0) alive.push(i);
    }
    return alive;
  }

  function allAliveConnected() {
    const alive = alivePlayers();
    return alive.length > 0 && alive.every((i) => view.connected[i]);
  }

  function needsTarget(def) {
    return !!def && (def.effects ?? []).some((effect) => (
      (effect.kind === 'damage' || effect.kind === 'transfer') && effect.target === 'chosen'
    ));
  }

  function targetOptions() {
    const alive = alivePlayers().filter((i) => i !== view.you);
    if (!view.teams) return alive;
    const enemies = alive.filter((i) => view.teams[i] !== view.teams[view.you]);
    return enemies.length ? enemies.concat(alive.filter((i) => !enemies.includes(i))) : alive;
  }

  function defaultTarget() {
    const options = targetOptions();
    return options.length ? options[0] : null;
  }

  function isMyTurn() {
    return (
      view.online &&
      typeof view.you === 'number' &&
      view.phase === 'pick' &&
      view.hp[view.you] > 0 &&
      !view.locked[view.you] &&
      allAliveConnected() &&
      !busy
    );
  }

  function buildPips(el, total, filled, cls) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < total; i += 1) {
      const p = document.createElement('span');
      p.className = `pip ${cls}${i < filled ? ' on' : ''}`;
      frag.appendChild(p);
    }
    el.replaceChildren(frag);
  }

  function renderHeader() {
    $('roundNum').textContent = String(view.round).padStart(2, '0');
    $('app').dataset.turn = String(typeof view.you === 'number' ? view.you : 0);

    const pill = $('seatPill');
    pill.className = 'seat-pill';
    if (FILE_MODE) {
      pill.textContent = '本地文件';
    } else if (!view.online) {
      pill.textContent = '连接中…';
    } else if (typeof view.you === 'number') {
      pill.textContent = playerName(view.you);
      pill.classList.add(`p${view.you + 1}`);
    } else {
      pill.textContent = '观众';
    }

    for (let i = 0; i < 4; i += 1) {
      $('you' + i).hidden = view.you !== i;
      $('name' + i).textContent = playerName(i);
    }
  }

  function renderModeBar() {
    const host = view.host;
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      const isCount = btn.dataset.count != null;
      const isRules = btn.dataset.rules != null;
      const isBot = btn.dataset.bot != null;
      const isTeam = btn.dataset.team != null;
      let active = false;
      let disabled = !view.online || !host;
      if (isCount) {
        active = view.playerCount === Number(btn.dataset.count);
      } else if (isRules) {
        active = view.ruleset === btn.dataset.rules;
      } else if (isBot) {
        const seat = Number(btn.dataset.bot);
        active = !!view.bots[seat];
        if (seat >= view.playerCount) disabled = true;
        btn.textContent = `${seat + 1} ${active ? '机' : '人'}`;
      } else if (isTeam) {
        active = view.teamMode === btn.dataset.team;
        if (view.playerCount !== 4) disabled = true;
      }
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
      btn.disabled = disabled;
    });
    const note = $('modeNote');
    if (!view.online) note.textContent = '';
    else note.textContent = host ? '点击座位切换电脑/玩家;切换会重开' : '只有房主可以切换';
  }

  function renderCards() {
    const arena = document.querySelector('.arena');
    if (arena) arena.dataset.players = String(view.playerCount);
    const defs = currentDefs();
    const targeting = isMyTurn() && selected && needsTarget(defs[selected]);
    for (let i = 0; i < 4; i += 1) {
      const side = $('side' + i);
      side.hidden = i >= view.playerCount;
      if (i >= view.playerCount) continue;
      const dead = view.hp[i] <= 0;
      const active = isMyTurn() && view.you === i;
      const locked = !dead && (view.phase === 'reveal' || (view.phase === 'pick' && view.locked[i]));
      const offline = view.online && !view.connected[i];

      side.classList.toggle('active', active);
      side.classList.toggle('locked', locked);
      side.classList.toggle('offline', offline);
      side.classList.toggle('dead', dead);

      let tag = '';
      if (view.online && view.phase === 'pick') {
        if (dead) tag = '倒下';
        else if (!view.connected[i]) tag = '未连接';
        else if (view.locked[i]) tag = '已锁定';
        else if (view.you === i) tag = '轮到你';
        else tag = '选择中';
      } else if (view.phase === 'reveal') {
        tag = dead ? '倒下' : '已锁定';
      } else if (dead) {
        tag = '倒下';
      }
      $('tag' + i).textContent = tag;

      buildPips($('hp' + i), view.cfg.hp, view.hp[i], 'hp');
      const enSlots = Math.max(5, view.cfg.ultCost);
      buildPips($('en' + i), enSlots, Math.min(view.en[i], enSlots), 'en');
      $('hpNum' + i).textContent = view.hp[i];
      $('enNum' + i).textContent = view.en[i];
      $('shield' + i).hidden = !view.shield[i];
      const team = view.teams ? view.teams[i] : null;
      const teamMark = $('team' + i);
      teamMark.hidden = team == null;
      if (team != null) {
        teamMark.textContent = team === 0 ? '队伍 A' : '队伍 B';
        teamMark.className = `team-mark ${team === 0 ? 'team-a' : 'team-b'}`;
      }
      const isTarget = targeting && view.target === i;
      side.classList.toggle('target', isTarget);
      $('target' + i).hidden = !isTarget;
    }
  }

  function renderControls() {
    const pickable = isMyTurn();
    const energy = typeof view.you === 'number' ? view.en[view.you] : 0;
    const defs = currentDefs();

    document.querySelectorAll('.action').forEach((btn) => {
      const action = defs[btn.dataset.action];
      if (!action) return;
      btn.disabled = !pickable || energy < action.cost;
      btn.classList.toggle('selected', selected === action.key);
      btn.setAttribute('aria-pressed', String(selected === action.key));
      btn.querySelector('.action-cost').textContent = action.tag;
    });

    const sel = selected ? defs[selected] : null;
    const targetNeeded = sel ? needsTarget(sel) : false;
    const targeting = pickable && targetNeeded;
    if (targeting) {
      const options = targetOptions();
      if (!options.includes(view.target)) view.target = options[0] ?? null;
    }
    const arena = document.querySelector('.arena');
    if (arena) arena.classList.toggle('targeting', targeting);

    let desc = '';
    if (FILE_MODE) desc = '请先运行 node server.js,再打开 http://localhost:3000';
    else if (!view.online) desc = '正在连接服务器…';
    else if (view.phase === 'reveal') desc = '结算中…';
    else if (view.phase === 'over') desc = '本局结束。';
    else if (typeof view.you !== 'number') desc = '观众模式。';
    else if (view.hp[view.you] <= 0) desc = '你已倒下,观战中。';
    else if (!allAliveConnected()) desc = '等待其他玩家加入…';
    else if (view.locked[view.you]) {
      const pick = view.yourPick;
      if (pick && defs[pick.action]) {
        const targetText = needsTarget(defs[pick.action]) && pick.target != null ? ` → ${playerName(pick.target)}` : '';
        desc = `已锁定:${defs[pick.action].name}${targetText} · 等待其他玩家…`;
      } else {
        desc = '已锁定,等待其他玩家…';
      }
    } else if (sel) {
      desc = sel.desc + (targetNeeded ? ' 点击上方玩家卡片选择目标。' : '');
    } else {
      desc = '选择一项行动。';
    }
    $('actionDesc').textContent = desc;

    const lock = $('lockBtn');
    lock.disabled = !pickable || !selected || (targetNeeded && view.target == null);
    lock.textContent = '锁定行动';
  }

  function renderLog() {
    const box = $('log');
    if (!view.log.length) {
      box.innerHTML = '<li class="log-empty">还没有回合记录。</li>';
    } else {
      box.innerHTML = view.log.map((entry) => {
        const chips = (entry.players || []).map((p, i) => (
          `<span class="chip p${i + 1}">${p.name}${p.delta ? ` <b>${p.delta}</b>` : ''}</span>`
        )).join('<span class="l-x">·</span>');
        return `
          <li class="log-item">
            <span class="l-round">R${entry.round}</span>
            <span class="l-chips">${chips}</span>
            <span class="l-result">${entry.text}</span>
          </li>
        `;
      }).join('');
    }
    $('logCount').textContent = view.log.length;
  }

  function renderStage() {
    if (view.phase !== 'pick') return;
    let hint = FILE_MODE ? '请先运行 node server.js,再打开 http://localhost:3000' : '正在连接服务器…';
    if (view.online) {
      if (typeof view.you !== 'number') hint = '观众模式 · 等待玩家行动';
      else if (view.hp[view.you] <= 0) hint = '你已倒下 · 观战中';
      else if (!allAliveConnected()) hint = '等待其他玩家加入…';
      else if (view.locked[view.you]) hint = '已锁定,等待其他玩家…';
      else hint = '轮到你选择';
    }
    $('stageContent').innerHTML = `<div class="vs"><span class="v1">V</span><span class="v2">S</span></div><div class="hint">${hint}</div>`;
  }

  function renderRules() {
    if (view.ruleset === 'full') {
      $('rulesBody').innerHTML = `
        <dt>蓄力</dt><dd>获得 1 点能量;不刷新护盾。</dd>
        <dt>攻击</dt><dd>消耗 ${view.cfg.attackCost} 点能量,造成 ${view.cfg.attackDmg} 点伤害。</dd>
        <dt>防御</dt><dd>本回合受到的伤害减免 ${view.cfg.defendReduce} 点(一次)。</dd>
        <dt>双斩</dt><dd>消耗 4 点能量,造成 2 点伤害。</dd>
        <dt>水枪</dt><dd>消耗 3 点能量,造成 1 点穿透伤害;穿透只无视光明/黑暗与逃脱。</dd>
        <dt>光明</dt><dd>转移受到的普通伤害给攻击者;成功转移耗 4 点,没有转移任何伤害只耗 1 点。</dd>
        <dt>黑暗</dt><dd>转移受到的普通伤害给指定目标;成功转移耗 5 点,没有转移任何伤害只耗 1 点。</dd>
        <dt>逃脱</dt><dd>消耗 1 点能量,免疫本回合所有普通伤害;穿透伤害仍然命中。</dd>
      `;
      $('rulesNotes').innerHTML = `
        <li>每人开局 1 层特殊护盾;第一次会掉血时消耗,免疫该回合剩余伤害。</li>
        <li>所有人秘密选招、同时结算;互相攻击的伤害逐点抵消,再汇总受击值减防御。</li>
        <li>水枪的穿透无视光明/黑暗与逃脱;防御和特殊护盾仍然有效。</li>
        <li>光明/黑暗只转移普通伤害;没有转移任何伤害时只消耗 1 点能量;转移来的伤害不会再次转移。</li>
        <li>血量归零即败;攻击/黑暗点其他玩家卡片选目标(2 人局自动是对手)。</li>
        <li>座位可交给电脑;电脑之间会互相攻击。4 人可选 2v2:可以打队友,但只有消灭所有敌人才获胜。</li>
      `;
      return;
    }

    $('rulesBody').innerHTML = `
      <dt>蓄力</dt><dd>获得 1 点能量。</dd>
      <dt>攻击</dt><dd>消耗 ${view.cfg.attackCost} 点能量,造成 ${view.cfg.attackDmg} 点伤害。</dd>
      <dt>防御</dt><dd>本回合受到的伤害减免 ${view.cfg.defendReduce} 点(一次)。</dd>
      <dt>大招</dt><dd>消耗 ${view.cfg.ultCost} 点能量,造成 ${view.cfg.ultDmg} 点伤害。</dd>
    `;
    $('rulesNotes').innerHTML = `
      <li>所有人选好行动后同时结算,不是逐人行动。</li>
      <li>先汇总每个玩家受到的伤害;同时攻击同一目标的伤害叠加。</li>
      <li>互相攻击的两名玩家,伤害逐点抵消,只发生在双方之间。</li>
      <li>每个玩家用受击值减去自己的防御值,得到最终扣血值。</li>
      <li>能量无上限;血量降到 0 即败;攻击/大招点其他玩家卡片选目标。</li>
      <li>座位可交给电脑;电脑之间会互相攻击。4 人可选 2v2:可以打队友,但只有消灭所有敌人才获胜。</li>
    `;
  }

  function syncConfigInputs() {
    $('cfgHp').value = view.cfg.hp;
    $('cfgEnergy').value = view.cfg.startEnergy;
    $('cfgUltCost').value = view.cfg.ultCost;
    $('cfgUltDmg').value = view.cfg.ultDmg;
    const full = view.ruleset === 'full';
    $('cfgUltCostField').hidden = full;
    $('cfgUltDmgField').hidden = full;
  }

  function renderAll() {
    renderHeader();
    renderModeBar();
    renderCards();
    renderControls();
    renderLog();
    if (view.phase === 'pick') renderStage();
    if (view.phase === 'over') showOverlay();
    else $('overlay').hidden = true;
  }

  function stageRevealStart(picks) {
    const defs = currentDefs();
    if (view.playerCount === 2 && picks[0] && picks[1]) {
      const A = defs[picks[0].action];
      const B = defs[picks[1].action];
      const dmgA = attackTotal(A);
      const dmgB = attackTotal(B);
      $('stageContent').innerHTML = `
        <div class="clash">
          <div class="clash-side p1">
            <span class="clash-action">${A.name}</span>
            <span class="clash-dmg${dmgA ? '' : ' ghost'}">${dmgA}</span>
          </div>
          <div class="clash-mid">×</div>
          <div class="clash-side p2">
            <span class="clash-action">${B.name}</span>
            <span class="clash-dmg${dmgB ? '' : ' ghost'}">${dmgB}</span>
          </div>
        </div>
      `;
      return;
    }

    const rows = picks.map((pick, i) => {
      if (!pick) {
        return `<div class="clash-row p${i + 1}"><span class="clash-name">${playerName(i)}</span><span class="clash-action">—</span></div>`;
      }
      const def = defs[pick.action];
      const dmg = attackTotal(def);
      const targetText = needsTarget(def) && pick.target != null ? ` → ${playerName(pick.target)}` : '';
      return `<div class="clash-row p${i + 1}"><span class="clash-name">${playerName(i)}</span><span class="clash-action">${def.name}${targetText}</span><span class="clash-dmg${dmg ? '' : ' ghost'}">${dmg}</span></div>`;
    }).join('');
    $('stageContent').innerHTML = `<div class="clash-list">${rows}</div>`;
  }

  function stageRevealResult(result, text) {
    const stage = $('stageContent');
    const el = document.createElement('div');
    el.className = 'clash-result';
    el.innerHTML = text;
    stage.appendChild(el);
    if (result.canceledPairs.length) {
      const mid = stage.querySelector('.clash-mid');
      if (mid) mid.classList.add('canceled');
    }
  }

  function flashSide(index, amount) {
    const side = $('side' + index);
    side.classList.remove('hurt');
    void side.offsetWidth;
    side.classList.add('hurt');
    const float = document.createElement('span');
    float.className = 'float-dmg';
    float.textContent = `−${amount}`;
    side.appendChild(float);
    setTimeout(() => {
      side.classList.remove('hurt');
      float.remove();
    }, 950);
  }

  function flashGuard(index) {
    const side = $('side' + index);
    side.classList.add('guard');
    setTimeout(() => side.classList.remove('guard'), 650);
  }

  async function runReveal(reveal, msg) {
    const id = reveal.id;
    await sleep(480);
    if (view.phase !== 'reveal' || !view.reveal || view.reveal.id !== id) return;

    view.hp = msg.hp.slice();
    view.en = msg.en.slice();
    view.shield = msg.shield || view.shield;
    renderCards();
    renderControls();
    renderLog();
    stageRevealResult(reveal.result, reveal.text);

    const result = reveal.result;
    if (result.canceledPairs.length) beep(200, 0.08, 'sawtooth', 0.02);
    let guarded = false;
    let shielded = false;
    let escaped = false;
    let damaged = false;
    for (let i = 0; i < view.playerCount; i += 1) {
      if (result.blocked[i]) { flashGuard(i); guarded = true; }
      if (result.shieldUsed[i]) { flashGuard(i); shielded = true; }
      if (result.escaped[i]) { flashGuard(i); escaped = true; }
      if (result.hpLoss[i]) { flashSide(i, result.hpLoss[i]); damaged = true; }
    }
    if (guarded) beep(420, 0.07, 'triangle', 0.025);
    if (shielded) beep(500, 0.09, 'triangle', 0.03);
    if (escaped) beep(620, 0.08, 'triangle', 0.03);
    if (damaged) beep(90, 0.18, 'sine', 0.06);
  }

  function showOverlay() {
    const teamWin = view.winner === 'team0' || view.winner === 'team1';
    const valid = view.winner === 'draw'
      || teamWin
      || (typeof view.winner === 'number' && view.winner >= 0 && view.winner < view.playerCount);
    if (!valid) {
      $('overlay').hidden = true;
      return;
    }

    const wasHidden = $('overlay').hidden;
    const card = $('resultCard');
    card.classList.remove('p1', 'p2', 'p3', 'p4', 'draw');

    if (view.winner === 'draw') {
      card.classList.add('draw');
      $('overKicker').textContent = 'Draw';
      $('overTitle').textContent = '平局';
      $('overSub').textContent = `第 ${view.round} 回合 · 平局`;
    } else if (teamWin) {
      const team = view.winner === 'team0' ? 0 : 1;
      card.classList.add(team === 0 ? 'p1' : 'p2');
      $('overKicker').textContent = 'Winner';
      $('overTitle').textContent = team === 0 ? '队伍 A 获胜' : '队伍 B 获胜';
      $('overSub').textContent = `第 ${view.round} 回合 · 消灭所有敌人`;
    } else {
      const winner = view.winner;
      card.classList.add(`p${winner + 1}`);
      $('overKicker').textContent = 'Winner';
      const label = winner === view.you ? '你' : playerName(winner);
      $('overTitle').textContent = winner === view.you ? '你获胜' : `${label} 获胜`;
      $('overSub').textContent = `第 ${view.round} 回合 · 最后存活`;
    }

    $('overlay').hidden = false;
    if (wasHidden) {
      beep(523.25, 0.1, 'triangle', 0.04);
      beep(659.25, 0.1, 'triangle', 0.04, 0.11);
      beep(783.99, 0.22, 'triangle', 0.04, 0.22);
    }
  }

  function buildActions() {
    const grid = $('actionGrid');
    grid.replaceChildren(...Object.values(currentDefs()).map((action) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action';
      btn.dataset.action = action.key;
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = `
        <span class="action-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[action.key] ?? ''}</svg>
        </span>
        <span class="action-name">${action.name}</span>
        <span class="action-cost">${action.tag}</span>
      `;
      return btn;
    }));
  }

  function selectAction(key) {
    if (!isMyTurn()) return;
    const action = currentDefs()[key];
    if (!action || view.en[view.you] < action.cost) return;
    selected = key;
    if (needsTarget(action)) {
      const options = targetOptions();
      if (!options.includes(view.target)) view.target = options[0] ?? null;
    } else {
      view.target = null;
    }
    beep(view.you === 0 ? 520 : 600, 0.05, 'triangle', 0.03);
    renderCards();
    renderControls();
  }

  function selectTarget(index) {
    const def = selected ? currentDefs()[selected] : null;
    if (!def || !needsTarget(def) || !isMyTurn()) return;
    if (!Number.isInteger(index) || index === view.you || index < 0 || index >= view.playerCount) return;
    if (view.hp[index] <= 0) return;
    if (view.target === index) return;
    view.target = index;
    beep(520, 0.04, 'triangle', 0.025);
    renderCards();
    renderControls();
  }

  async function switchRuleset(ruleset) {
    if (!view.host || view.ruleset === ruleset) return;
    const result = await post('/ruleset', { token, ruleset });
    if (!result.ok) {
      $('modeNote').textContent = '切换失败,请重试';
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('rules', ruleset);
    window.history.replaceState(null, '', url);
    beep(440, 0.06, 'triangle', 0.03);
  }

  async function switchSeatBot(seat) {
    if (!view.host || seat >= view.playerCount) return;
    const bots = [];
    for (let i = 0; i < view.playerCount; i += 1) bots.push(!!view.bots[i]);
    bots[seat] = !bots[seat];
    const result = await post('/bots', { token, bots });
    if (!result.ok) {
      $('modeNote').textContent = '切换失败,请重试';
      return;
    }
    const enabled = bots.map((isBot, i) => (isBot ? i : null)).filter((i) => i !== null).join(',');
    const url = new URL(window.location.href);
    if (enabled) url.searchParams.set('bots', enabled);
    else url.searchParams.delete('bots');
    url.searchParams.delete('cpu');
    window.history.replaceState(null, '', url);
    beep(440, 0.06, 'triangle', 0.03);
  }

  async function switchTeams(teamMode) {
    if (!view.host || view.playerCount !== 4 || view.teamMode === teamMode) return;
    const result = await post('/teams', { token, teamMode });
    if (!result.ok) {
      $('modeNote').textContent = '切换失败,请重试';
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('teams', teamMode);
    window.history.replaceState(null, '', url);
    beep(440, 0.06, 'triangle', 0.03);
  }

  async function switchPlayerCount(count) {
    if (!view.host || view.playerCount === count) return;
    const result = await post('/playercount', { token, playerCount: count });
    if (!result.ok) {
      $('modeNote').textContent = '切换失败,请重试';
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('players', String(count));
    const bots = view.bots.slice(0, count).map((isBot, i) => (isBot ? i : null)).filter((i) => i !== null).join(',');
    if (bots) url.searchParams.set('bots', bots);
    else url.searchParams.delete('bots');
    if (count !== 4) url.searchParams.delete('teams');
    window.history.replaceState(null, '', url);
    beep(440, 0.06, 'triangle', 0.03);
  }

  async function lockPick() {
    if (!isMyTurn() || !selected) return;
    const action = selected;
    const target = view.target;
    const def = currentDefs()[action];
    if (needsTarget(def) && target == null) return;
    selected = null;
    view.target = null;
    busy = true;
    renderControls();

    const result = await post('/pick', { token, action, target });
    if (!result.ok) {
      busy = false;
      const locked = typeof view.you === 'number' && view.locked[view.you];
      if (!locked) $('actionDesc').textContent = '提交失败,请重试。';
      renderControls();
    }
  }

  function handleState(msg) {
    view.online = true;
    view.you = msg.you;
    view.host = !!msg.host;
    view.mode = msg.mode || 'pvp';
    view.ruleset = msg.ruleset || 'minimal';
    view.teamMode = msg.teamMode || 'ffa';
    view.teams = msg.teams || null;
    view.bots = msg.bots || [false, false, false, false];
    view.playerCount = msg.playerCount || 2;
    view.connected = msg.connected;
    view.locked = msg.locked;
    view.yourPick = msg.yourPick;
    view.log = msg.log;
    view.winner = msg.winner;
    view.round = msg.round;

    const cfgKey = JSON.stringify({
      cfg: msg.cfg,
      ruleset: msg.ruleset,
      mode: msg.mode,
      playerCount: msg.playerCount,
    });
    if (cfgKey !== lastCfgKey) {
      lastCfgKey = cfgKey;
      view.cfg = msg.cfg;
      selected = null;
      view.target = null;
      buildActions();
      renderRules();
      syncConfigInputs();
    }

    if (msg.phase === 'reveal' && msg.reveal) {
      const isNew = msg.reveal.id !== lastRevealId;
      view.phase = 'reveal';
      view.reveal = msg.reveal;
      selected = null;
      busy = false;

      if (isNew) {
        lastRevealId = msg.reveal.id;
        view.hp = msg.reveal.before.hp.slice();
        view.en = msg.reveal.before.en.slice();
        view.shield = msg.reveal.before.shield ? msg.reveal.before.shield.slice() : view.shield;
        renderHeader();
        renderCards();
        renderControls();
        stageRevealStart(msg.reveal.picks);
        runReveal(msg.reveal, msg);
      } else {
        renderHeader();
        renderCards();
        renderControls();
      }
      return;
    }

    const roundChanged = msg.round !== lastRound;
    view.phase = msg.phase;
    view.hp = msg.hp.slice();
    view.en = msg.en.slice();
    view.shield = msg.shield || [];
    view.reveal = msg.reveal;

    if (roundChanged || msg.phase !== 'pick') selected = null;
    if (typeof view.you === 'number' && (view.locked[view.you] || view.hp[view.you] <= 0)) selected = null;
    if (!selected) view.target = null;
    if (msg.phase !== 'pick' || roundChanged || (typeof view.you === 'number' && view.locked[view.you])) {
      busy = false;
    }

    lastRound = msg.round;
    renderAll();
  }

  function bindEvents() {
    $('actionGrid').addEventListener('click', (event) => {
      const btn = event.target.closest('button.action');
      if (!btn || btn.disabled) return;
      selectAction(btn.dataset.action);
    });

    $('lockBtn').addEventListener('click', lockPick);

    $('againBtn').addEventListener('click', () => {
      post('/restart', { token });
      beep(440, 0.06, 'triangle', 0.03);
    });

    $('cfgForm').addEventListener('submit', (event) => {
      event.preventDefault();
      post('/config', {
        token,
        hp: $('cfgHp').value,
        startEnergy: $('cfgEnergy').value,
        ultCost: $('cfgUltCost').value,
        ultDmg: $('cfgUltDmg').value,
      });
      beep(440, 0.06, 'triangle', 0.03);
    });

    $('soundBtn').addEventListener('click', () => {
      soundOn = !soundOn;
      const btn = $('soundBtn');
      btn.setAttribute('aria-pressed', String(soundOn));
      btn.setAttribute('aria-label', soundOn ? '关闭声音' : '开启声音');
      if (soundOn) beep(660, 0.06, 'triangle', 0.03);
    });

    $('botOptions').addEventListener('click', (event) => {
      const btn = event.target.closest('button.mode-btn');
      if (!btn || btn.disabled) return;
      switchSeatBot(Number(btn.dataset.bot));
    });

    $('teamOptions').addEventListener('click', (event) => {
      const btn = event.target.closest('button.mode-btn');
      if (!btn || btn.disabled) return;
      switchTeams(btn.dataset.team);
    });

    $('rulesOptions').addEventListener('click', (event) => {
      const btn = event.target.closest('button.mode-btn');
      if (!btn || btn.disabled) return;
      switchRuleset(btn.dataset.rules);
    });

    $('countOptions').addEventListener('click', (event) => {
      const btn = event.target.closest('button.mode-btn');
      if (!btn || btn.disabled) return;
      switchPlayerCount(Number(btn.dataset.count));
    });

    document.querySelector('.arena').addEventListener('click', (event) => {
      const side = event.target.closest('.side');
      if (!side) return;
      const index = Number(side.id.replace('side', ''));
      if (Number.isInteger(index)) selectTarget(index);
    });

    document.addEventListener('keydown', (event) => {
      if (event.target.closest && event.target.closest('input, textarea, select')) return;
      if (event.key === 'Enter' && !$('lockBtn').disabled) {
        lockPick();
        return;
      }
      const index = ['1', '2', '3', '4', '5', '6', '7', '8'].indexOf(event.key);
      if (index >= 0) {
        const key = Object.keys(currentDefs())[index];
        if (key) selectAction(key);
      }
    });
  }

  token = getToken(preferredSeat);

  buildActions();
  renderRules();
  syncConfigInputs();
  bindEvents();
  renderAll();

  if (!FILE_MODE) {
    const cpuQuery = cpuParam === null ? '' : `&cpu=${encodeURIComponent(cpuParam)}`;
    const rulesQuery = rulesParam === null ? '' : `&rules=${encodeURIComponent(rulesParam)}`;
    const playersQuery = playersParam === null ? '' : `&players=${encodeURIComponent(playersParam)}`;
    const botsQuery = botsParam === null ? '' : `&bots=${encodeURIComponent(botsParam)}`;
    const teamsQuery = teamsParam === null ? '' : `&teams=${encodeURIComponent(teamsParam)}`;
    const eventsUrl = `/events?token=${encodeURIComponent(token)}&room=${encodeURIComponent(room)}${cpuQuery}${rulesQuery}${playersQuery}${botsQuery}${teamsQuery}${preferredSeat === null ? '' : `&seat=${preferredSeat}`}`;
    const source = new EventSource(eventsUrl);

    source.onopen = () => {
      view.online = true;
    };

    source.onerror = () => {
      view.online = false;
      renderAll();
    };

    source.onmessage = (event) => {
      try {
        handleState(JSON.parse(event.data));
      } catch (error) {
        /* ignore malformed messages */
      }
    };
  }
})();
