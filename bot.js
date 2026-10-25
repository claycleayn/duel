'use strict';

/*
 * CPU 对手策略。只读取公开状态(血量/能量/护盾/历史行动),不偷看人类本回合的选择。
 * 返回 { action, target };random 可注入,方便测试。
 */
function chooseBotPick(state, defs, random = Math.random) {
  return defs.ult
    ? chooseMinimalPick(state, defs, random)
    : chooseFullPick(state, defs, random);
}

function chooseMinimalPick(state, defs, random) {
  const HUMAN = 0;
  const BOT = 1;
  const en = state.en[BOT];
  const humanEn = state.en[HUMAN];
  const ultCost = defs.ult.cost;
  const attackCost = defs.attack.cost;

  const history = (state.log || [])
    .slice(0, 12)
    .map((entry) => entry.a && entry.a.key)
    .filter(Boolean);

  const counts = { attack: 0, charge: 0, defend: 0, ult: 0 };
  for (const key of history) {
    if (counts[key] != null) counts[key] += 1;
  }
  const total = history.length || 1;

  const pick = (action) => ({ action, target: HUMAN });

  // 5 能量的大招对非大招行动全胜;双方同时大招则抵消。到 5 就直接放。
  if (en >= ultCost) return pick('ult');

  // 自己没能量:只能蓄力或防御。人类历史上攻击越多,越偏向防御。
  if (en < attackCost) {
    const attackRate = counts.attack / total;
    return pick(random() < 0.3 + attackRate * 0.5 ? 'defend' : 'charge');
  }

  // 人类没能量:他只能蓄力或防御。攻击打蓄力,蓄力吃防御。
  if (humanEn < attackCost) {
    const chargeRate = counts.charge / total;
    const defendRate = counts.defend / total;
    const attackChance = (chargeRate + 0.2) / (chargeRate + defendRate + 0.4);
    return pick(random() < attackChance ? 'attack' : 'charge');
  }

  // 双方都能攻击:按人类历史做猜拳克制,留 35% 随机避免被读死。
  const ranked = [
    ['attack', counts.attack],
    ['charge', counts.charge],
    ['defend', counts.defend],
  ].sort((left, right) => right[1] - left[1]);
  const most = ranked[0][0];
  const best = most === 'attack' ? 'defend' : most === 'charge' ? 'attack' : 'charge';

  if (random() < 0.65) return pick(best);
  const options = ['attack', 'defend', 'charge'];
  return pick(options[Math.floor(random() * options.length) % options.length]);
}

function chooseFullPick(state, defs, random) {
  const HUMAN = 0;
  const BOT = 1;
  const en = state.en[BOT];
  const humanEn = state.en[HUMAN];
  const humanShield = !!(state.shield && state.shield[HUMAN]);

  const history = (state.log || [])
    .slice(0, 12)
    .map((entry) => entry.a && entry.a.key)
    .filter(Boolean);

  const counts = {};
  for (const key of history) counts[key] = (counts[key] || 0) + 1;
  const total = history.length || 1;

  const pick = (action) => ({ action, target: HUMAN });
  const afford = (key) => !!defs[key] && en >= defs[key].cost;

  // 人类护盾还在:先用最便宜的伤害把盾打掉,别把 4/5 费技能喂给盾。
  if (humanShield) {
    if (afford('attack')) return pick(random() < 0.8 ? 'attack' : 'charge');
    if (afford('water')) return pick('water');
    return pick(random() < 0.3 ? 'defend' : 'charge');
  }

  const attackRate = (counts.attack || 0) / total;
  const waterRate = (counts.water || 0) / total;
  const transferRate = ((counts.light || 0) + (counts.dark || 0)) / total;

  // 人类历史上爱攻击、又不太用水枪时,光明转移一次很赚。
  if (afford('light') && humanEn >= defs.attack.cost && attackRate > 0.35 && waterRate < 0.2) {
    if (random() < 0.25) return pick('light');
  }

  // 人类爱用光明/黑暗时,水枪的穿透反过来克制。
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
