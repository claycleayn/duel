'use strict';

/*
 * CPU 对手策略。只读取公开状态(血量/能量/历史行动),不偷看人类本回合的选择。
 * 返回 { action, target };random 可注入,方便测试。
 */
function chooseBotPick(state, defs, random = Math.random) {
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

module.exports = { chooseBotPick };
