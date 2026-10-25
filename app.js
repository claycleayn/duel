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
  };

  const view = {
    online: false,
    you: null,
    mode: 'pvp',
    cfg: { ...DEFAULTS },
    hp: [1, 1],
    en: [0, 0],
    round: 1,
    phase: 'pick',
    winner: null,
    locked: [false, false],
    connected: [false, false],
    yourPick: null,
    log: [],
    reveal: null,
  };

  const params = new URLSearchParams(window.location.search);
  const preferredSeat = params.get('seat') === '0' ? 0 : params.get('seat') === '1' ? 1 : null;
  const room = params.get('room') || '';
  const cpuParam = params.get('cpu');
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
      const response = await fetch(url, {
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
    return actionDefs(view.cfg);
  }

  function isMyTurn() {
    return (
      view.online &&
      typeof view.you === 'number' &&
      view.phase === 'pick' &&
      !view.locked[view.you] &&
      view.connected[0] &&
      view.connected[1] &&
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
    $('app').dataset.turn = String(view.you === 1 ? 1 : 0);

    const pill = $('seatPill');
    pill.className = 'seat-pill';
    if (FILE_MODE) {
      pill.textContent = '本地文件';
    } else if (!view.online) {
      pill.textContent = '连接中…';
    } else if (view.you === 0) {
      pill.textContent = '玩家 1';
      pill.classList.add('p1');
    } else if (view.you === 1) {
      pill.textContent = '玩家 2';
      pill.classList.add('p2');
    } else {
      pill.textContent = '观众';
    }

    $('you0').hidden = view.you !== 0;
    $('you1').hidden = view.you !== 1;
    $('name0').textContent = '玩家 1';
    $('name1').textContent = view.mode === 'cpu' ? '电脑' : '玩家 2';
  }

  function renderModeBar() {
    const host = view.you === 0;
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      const active = view.mode === btn.dataset.mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
      btn.disabled = !view.online || !host;
    });
    const note = $('modeNote');
    if (!view.online) note.textContent = '';
    else note.textContent = host ? '切换会重开当前局' : '只有玩家 1 可以切换';
  }

  function renderCards() {
    for (let i = 0; i < 2; i += 1) {
      const side = $('side' + i);
      const active = isMyTurn() && view.you === i;
      const locked = view.phase === 'reveal' || (view.phase === 'pick' && view.locked[i]);
      const offline = view.online && !view.connected[i];

      side.classList.toggle('active', active);
      side.classList.toggle('locked', locked);
      side.classList.toggle('offline', offline);

      let tag = '';
      if (view.online && view.phase === 'pick') {
        if (!view.connected[i]) tag = '未连接';
        else if (view.locked[i]) tag = '已锁定';
        else if (view.you === i) tag = '轮到你';
        else tag = '选择中';
      } else if (view.phase === 'reveal') {
        tag = '已锁定';
      }
      $('tag' + i).textContent = tag;

      buildPips($('hp' + i), view.cfg.hp, view.hp[i], 'hp');
      const enSlots = Math.max(5, view.cfg.ultCost);
      buildPips($('en' + i), enSlots, Math.min(view.en[i], enSlots), 'en');
      $('hpNum' + i).textContent = view.hp[i];
      $('enNum' + i).textContent = view.en[i];
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
    let desc = '';
    if (FILE_MODE) desc = '请先运行 node server.js,再打开 http://localhost:3000';
    else if (!view.online) desc = '正在连接服务器…';
    else if (view.phase === 'reveal') desc = '结算中…';
    else if (view.phase === 'over') desc = '本局结束。';
    else if (typeof view.you !== 'number') desc = '观众模式。';
    else if (!view.connected[0] || !view.connected[1]) desc = '等待另一位玩家加入…';
    else if (view.locked[view.you]) {
      desc = view.yourPick && defs[view.yourPick]
        ? `已锁定:${defs[view.yourPick].name} · 等待对手…`
        : '已锁定,等待对手…';
    } else if (sel) {
      desc = sel.desc;
    } else {
      desc = '选择一项行动。';
    }
    $('actionDesc').textContent = desc;

    const lock = $('lockBtn');
    lock.disabled = !pickable || !selected;
    lock.textContent = '锁定行动';
  }

  function renderLog() {
    const box = $('log');
    if (!view.log.length) {
      box.innerHTML = '<li class="log-empty">还没有回合记录。</li>';
    } else {
      box.innerHTML = view.log.map((entry) => `
        <li class="log-item">
          <span class="l-round">R${entry.round}</span>
          <span class="l-chips">
            <span class="chip p1">${entry.a.name}${entry.a.delta ? ` <b>${entry.a.delta}</b>` : ''}</span>
            <span class="l-x">×</span>
            <span class="chip p2">${entry.b.name}${entry.b.delta ? ` <b>${entry.b.delta}</b>` : ''}</span>
          </span>
          <span class="l-result">${entry.text}</span>
        </li>
      `).join('');
    }
    $('logCount').textContent = view.log.length;
  }

  function renderStage() {
    if (view.phase !== 'pick') return;
    let hint = FILE_MODE ? '请先运行 node server.js,再打开 http://localhost:3000' : '正在连接服务器…';
    if (view.online) {
      if (typeof view.you !== 'number') hint = '观众模式 · 等待玩家行动';
      else if (!view.connected[0] || !view.connected[1]) hint = '等待另一位玩家加入…';
      else if (view.locked[view.you]) hint = '已锁定,等待对手…';
      else hint = '轮到你选择';
    }
    $('stageContent').innerHTML = `<div class="vs"><span class="v1">V</span><span class="v2">S</span></div><div class="hint">${hint}</div>`;
  }

  function renderRules() {
    $('rulesBody').innerHTML = `
      <dt>蓄力</dt><dd>获得 1 点能量。</dd>
      <dt>防御</dt><dd>本回合受到的伤害减免 ${view.cfg.defendReduce} 点(一次)。</dd>
      <dt>攻击</dt><dd>消耗 ${view.cfg.attackCost} 点能量,造成 ${view.cfg.attackDmg} 点伤害。</dd>
      <dt>大招</dt><dd>消耗 ${view.cfg.ultCost} 点能量,造成 ${view.cfg.ultDmg} 点伤害。</dd>
    `;
  }

  function syncConfigInputs() {
    $('cfgHp').value = view.cfg.hp;
    $('cfgEnergy').value = view.cfg.startEnergy;
    $('cfgUltCost').value = view.cfg.ultCost;
    $('cfgUltDmg').value = view.cfg.ultDmg;
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
    renderCards();
    renderControls();
    renderLog();
    stageRevealResult(reveal.result, reveal.text);

    const result = reveal.result;
    if (result.canceledPairs.length) beep(200, 0.08, 'sawtooth', 0.02);
    if (result.blocked[0]) flashGuard(0);
    if (result.blocked[1]) flashGuard(1);
    if (result.blocked[0] || result.blocked[1]) beep(420, 0.07, 'triangle', 0.025);
    if (result.hpLoss[0]) flashSide(0, result.hpLoss[0]);
    if (result.hpLoss[1]) flashSide(1, result.hpLoss[1]);
    if (result.hpLoss[0] || result.hpLoss[1]) beep(90, 0.18, 'sine', 0.06);
  }

  function showOverlay() {
    if (view.winner !== 'draw' && view.winner !== 0 && view.winner !== 1) {
      $('overlay').hidden = true;
      return;
    }

    const wasHidden = $('overlay').hidden;
    const card = $('resultCard');
    card.classList.remove('p1', 'p2', 'draw');

    if (view.winner === 'draw') {
      card.classList.add('draw');
      $('overKicker').textContent = 'Draw';
      $('overTitle').textContent = '平局';
      $('overSub').textContent = `第 ${view.round} 回合 · 平局`;
    } else {
      const winner = view.winner;
      card.classList.add(winner === 0 ? 'p1' : 'p2');
      $('overKicker').textContent = 'Winner';
      if (view.mode === 'cpu') {
        const humanWin = view.you === 0 ? '你获胜' : '玩家 1 获胜';
        const humanLose = view.you === 0 ? '你倒下' : '玩家 1 倒下';
        $('overTitle').textContent = winner === 0 ? humanWin : '电脑获胜';
        $('overSub').textContent = `第 ${view.round} 回合 · ${winner === 0 ? '电脑倒下' : humanLose}`;
      } else {
        $('overTitle').textContent = `玩家 ${winner + 1} 获胜`;
        $('overSub').textContent = `第 ${view.round} 回合 · 玩家 ${2 - winner} 倒下`;
      }
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
    beep(view.you === 0 ? 520 : 600, 0.05, 'triangle', 0.03);
    renderControls();
  }

  async function switchMode(mode) {
    if (view.you !== 0 || view.mode === mode) return;
    const result = await post('/mode', { token, mode });
    if (!result.ok) {
      $('modeNote').textContent = '切换失败,请重试';
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('cpu', mode === 'cpu' ? '1' : '0');
    url.searchParams.set('seat', '0');
    window.history.replaceState(null, '', url);
    beep(440, 0.06, 'triangle', 0.03);
  }

  async function lockPick() {
    if (!isMyTurn() || !selected) return;
    const action = selected;
    selected = null;
    busy = true;
    renderControls();

    const result = await post('/pick', { token, action, target: 1 - view.you });
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
    view.mode = msg.mode || 'pvp';
    view.connected = msg.connected;
    view.locked = msg.locked;
    view.yourPick = msg.yourPick;
    view.log = msg.log;
    view.winner = msg.winner;
    view.round = msg.round;

    const cfgKey = JSON.stringify(msg.cfg);
    if (cfgKey !== lastCfgKey) {
      lastCfgKey = cfgKey;
      view.cfg = msg.cfg;
      selected = null;
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
    view.reveal = msg.reveal;

    if (roundChanged || msg.phase !== 'pick') selected = null;
    if (typeof view.you === 'number' && view.locked[view.you]) selected = null;
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

    $('modeOptions').addEventListener('click', (event) => {
      const btn = event.target.closest('button.mode-btn');
      if (!btn || btn.disabled) return;
      switchMode(btn.dataset.mode);
    });

    document.addEventListener('keydown', (event) => {
      if (event.target.closest && event.target.closest('input, textarea, select')) return;
      if (event.key === 'Enter' && !$('lockBtn').disabled) {
        lockPick();
        return;
      }
      const index = ['1', '2', '3', '4'].indexOf(event.key);
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
    const eventsUrl = `/events?token=${encodeURIComponent(token)}&room=${encodeURIComponent(room)}${cpuQuery}${preferredSeat === null ? '' : `&seat=${preferredSeat}`}`;
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
