'use strict';

/*
 * CPU 对手策略。只读取公开状态(血量/能量/护盾/历史行动),不偷看本回合选择。
 * state: { seat, playerCount, teams, hp, en, shield, log, round }
 * 返回 { action, target };target 是存活的对手(2v2 时自动排除队友)。
 */
function chooseBotPick(state, defs, random = Math.random) {
  const seat = state.seat ?? 1;
  const count = state.playerCount ?? 2;
  const teams = state.teams || null;
  const hp = state.hp || [];
  const alive = [];
  for (let i = 0; i < count; i += 1) {
    if ((hp[i] ?? 1) > 0 && i !== seat) alive.push(i);
  }
  const opponents = alive.filter((i) => !teams || teams[i] !== teams[seat]);
  const targets = opponents.length ? opponents : alive;
  if (!targets.length) return null;

  const primary = choosePrimary(state, targets, random);
  return defs.ult
    ? chooseMinimal(state, defs, random, seat, targets, primary)
    : chooseFull(state, defs, random, seat, targets, primary);
}

function shuffle(items, random) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function choosePrimary(state, targets, random) {
  const shuffled = shuffle(targets, random);
  return shuffled.sort((a, b) => {
    const shieldA = state.shield && state.shield[a] ? 1 : 0;
    const shieldB = state.shield && state.shield[b] ? 1 : 0;
    if (shieldA !== shieldB) return shieldA - shieldB;
    const hpA = state.hp[a] ?? 1;
    const hpB = state.hp[b] ?? 1;
    if (hpA !== hpB) return hpA - hpB;
    const enA = state.en[a] ?? 0;
    const enB = state.en[b] ?? 0;
    if (enA !== enB) return enB - enA;
    return 0;
  })[0];
}

function historyOf(state, targets) {
  const entries = (state.log || []).slice(0, 12);
  const counts = {};
  let total = 0;
  for (const entry of entries) {
    for (const index of targets) {
      const key = entry.players && entry.players[index] && entry.players[index].key;
      if (!key) continue;
      counts[key] = (counts[key] || 0) + 1;
      total += 1;
    }
  }
  return { counts, total };
}

function targetHistory(state, index) {
  const entries = (state.log || []).slice(0, 12);
  const counts = {};
  let total = 0;
  for (const entry of entries) {
    const key = entry.players && entry.players[index] && entry.players[index].key;
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
    total += 1;
  }
  return { counts, total };
}

function rate(counts, total, key) {
  return total ? (counts[key] || 0) / total : 0;
}

function chooseMinimal(state, defs, random, seat, targets, primary) {
  const en = state.en[seat];
  const ultCost = defs.ult.cost;
  const attackCost = defs.attack.cost;
  const pick = (action) => ({ action, target: primary });

  if (en >= ultCost) return pick('ult');

  const { counts, total } = historyOf(state, targets);
  const attackRate = rate(counts, total, 'attack');

  if (en < attackCost) {
    return pick(random() < 0.3 + attackRate * 0.5 ? 'defend' : 'charge');
  }

  const allCanAttack = targets.every((i) => (state.en[i] ?? 0) >= attackCost);
  if (!allCanAttack) {
    const chargeRate = rate(counts, total, 'charge');
    const defendRate = rate(counts, total, 'defend');
    const attackChance = (chargeRate + 0.2) / (chargeRate + defendRate + 0.4);
    return pick(random() < attackChance ? 'attack' : 'charge');
  }

  const ranked = [
    ['attack', counts.attack || 0],
    ['charge', counts.charge || 0],
    ['defend', counts.defend || 0],
  ].sort((left, right) => right[1] - left[1]);
  const most = ranked[0][0];
  const best = most === 'attack' ? 'defend' : most === 'charge' ? 'attack' : 'charge';
  if (random() < 0.65) return pick(best);
  const options = ['attack', 'defend', 'charge'];
  return pick(options[Math.floor(random() * options.length) % options.length]);
}

function chooseFull(state, defs, random, seat, targets, primary) {
  const en = state.en[seat];
  const pick = (action) => ({ action, target: primary });
  const afford = (key) => !!defs[key] && en >= defs[key].cost;
  const primaryEn = state.en[primary] ?? 0;
  const primaryShield = !!(state.shield && state.shield[primary]);
  const primaryHistory = targetHistory(state, primary);
  const opponentHistory = historyOf(state, targets);
  const attackRate = rate(primaryHistory.counts, primaryHistory.total, 'attack');
  const waterRate = rate(primaryHistory.counts, primaryHistory.total, 'water');
  const transferRate = rate(opponentHistory.counts, opponentHistory.total, 'light')
    + rate(opponentHistory.counts, opponentHistory.total, 'dark');

  if (primaryShield) {
    if (afford('attack')) return pick(random() < 0.8 ? 'attack' : 'charge');
    if (afford('water')) return pick('water');
    return pick(random() < 0.3 ? 'defend' : 'charge');
  }

  if (afford('light') && primaryEn >= defs.attack.cost && attackRate > 0.35 && waterRate < 0.2) {
    if (random() < 0.25) return pick('light');
  }
  if (afford('double')) {
    if (transferRate > 0.35 && afford('water') && random() < 0.6) return pick('water');
    return pick(random() < 0.75 ? 'double' : afford('attack') ? 'attack' : 'double');
  }
  if (afford('water')) {
    return pick(random() < 0.55 ? 'water' : afford('attack') ? 'attack' : 'water');
  }
  if (afford('attack')) return pick('attack');
  return pick(random() < 0.3 ? 'defend' : 'charge');
}

module.exports = { chooseBotPick };
