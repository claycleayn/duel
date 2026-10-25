/* Shared rules engine: browser (window.DuelEngine) and Node (require). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DuelEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function actionDefs(cfg) {
    const c = {
      attackCost: 1,
      attackDmg: 1,
      ultCost: 5,
      ultDmg: 2,
      defendReduce: 1,
      ...cfg,
    };

    return {
      charge: {
        key: 'charge', name: '蓄力', cost: 0, tag: '+1 EN',
        desc: '获得 1 点能量。',
        effects: [{ kind: 'energy', amount: 1 }],
      },
      defend: {
        key: 'defend', name: '防御', cost: 0, tag: '免费',
        desc: `本回合受到的伤害减免 ${c.defendReduce} 点(一次)。`,
        effects: [{ kind: 'defense', amount: c.defendReduce }],
      },
      attack: {
        key: 'attack', name: '攻击', cost: c.attackCost, tag: `${c.attackCost} EN`,
        desc: `消耗 ${c.attackCost} 点能量,造成 ${c.attackDmg} 点伤害。`,
        effects: [{ kind: 'damage', amount: c.attackDmg, target: 'chosen' }],
      },
      ult: {
        key: 'ult', name: '大招', cost: c.ultCost, tag: `${c.ultCost} EN`,
        desc: `消耗 ${c.ultCost} 点能量,造成 ${c.ultDmg} 点伤害。`,
        effects: [{ kind: 'damage', amount: c.ultDmg, target: 'chosen' }],
      },
    };
  }

  function attackTotal(def) {
    return (def.effects ?? [])
      .filter((effect) => effect.kind === 'damage')
      .reduce((sum, effect) => sum + effect.amount, 0);
  }

  function resolveTargets(effect, pick, from, playerCount) {
    if (effect.target === 'self') return [from];
    if (effect.target === 'all') {
      return Array.from({ length: playerCount }, (_, i) => i).filter((i) => i !== from);
    }
    const target = pick.target;
    if (Number.isInteger(target) && target >= 0 && target < playerCount) return [target];
    return [(from + 1) % playerCount];
  }

  /*
   * 通用结算管线,不枚举招式组合:
   *   1. 每个行动产生效果(伤害/防御/能量),伤害落到指定目标
   *   2. 互相攻击的无序对逐点抵消
   *   3. 汇总每个玩家的受击值
   *   4. 减去各自防御值,得到扣血值
   * 新增技能 = 往 actionDefs() 里加效果,结算函数不用改。
   */
  function resolveRound(playerCount, picks, defs) {
    const energyDelta = Array(playerCount).fill(0);
    const defense = Array(playerCount).fill(0);
    const damage = Array.from({ length: playerCount }, () => Array(playerCount).fill(0));

    for (let from = 0; from < playerCount; from += 1) {
      const pick = picks[from];
      const def = defs[pick.action];
      if (!def) throw new Error(`Unknown action: ${pick.action}`);

      energyDelta[from] -= def.cost ?? 0;
      for (const effect of def.effects ?? []) {
        if (effect.kind === 'energy') {
          energyDelta[from] += effect.amount;
        } else if (effect.kind === 'defense') {
          defense[from] += effect.amount;
        } else if (effect.kind === 'damage') {
          for (const to of resolveTargets(effect, pick, from, playerCount)) {
            damage[from][to] += effect.amount;
          }
        }
      }
    }

    // 相互攻击逐点抵消。按无序对遍历,人数增加时复杂度是 O(n²),不是组合爆炸。
    const canceledPairs = [];
    for (let i = 0; i < playerCount; i += 1) {
      for (let j = i + 1; j < playerCount; j += 1) {
        const amount = Math.min(damage[i][j], damage[j][i]);
        if (amount > 0) {
          damage[i][j] -= amount;
          damage[j][i] -= amount;
          canceledPairs.push({ i, j, amount });
        }
      }
    }

    // 依次汇总每个玩家的受击值
    const incoming = Array.from({ length: playerCount }, (_, to) => {
      let total = 0;
      for (let from = 0; from < playerCount; from += 1) total += damage[from][to];
      return total;
    });

    // 受击值减去防御值,得到最终扣血值
    const blocked = incoming.map((amount, index) => Math.min(amount, defense[index]));
    const hpLoss = incoming.map((amount, index) => Math.max(0, amount - defense[index]));

    return { energyDelta, defense, damage, canceledPairs, incoming, blocked, hpLoss };
  }

  return { actionDefs, attackTotal, resolveRound };
});
