/* Shared rules engine: browser (window.DuelEngine) and Node (require). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DuelEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function actionDefs(cfg, ruleset = 'minimal') {
    const c = {
      attackCost: 1,
      attackDmg: 1,
      ultCost: 5,
      ultDmg: 2,
      defendReduce: 1,
      ...cfg,
    };

    const charge = {
      key: 'charge', name: '蓄力', cost: 0, tag: '+1 EN',
      desc: '获得 1 点能量。',
      effects: [{ kind: 'energy', amount: 1 }],
    };
    const defend = {
      key: 'defend', name: '防御', cost: 0, tag: '免费',
      desc: `本回合受到的伤害减免 ${c.defendReduce} 点(一次)。`,
      effects: [{ kind: 'defense', amount: c.defendReduce }],
    };
    const attack = {
      key: 'attack', name: '攻击', cost: c.attackCost, tag: `${c.attackCost} EN`,
      desc: `消耗 ${c.attackCost} 点能量,造成 ${c.attackDmg} 点伤害。`,
      effects: [{ kind: 'damage', amount: c.attackDmg, target: 'chosen' }],
    };

    if (ruleset === 'full') {
      return {
        charge,
        attack,
        defend,
        double: {
          key: 'double', name: '双斩', cost: 4, tag: '4 EN',
          desc: '消耗 4 点能量,造成 2 点伤害。',
          effects: [{ kind: 'damage', amount: 2, target: 'chosen' }],
        },
        water: {
          key: 'water', name: '水枪', cost: 3, tag: '3 EN',
          desc: '消耗 3 点能量,造成 1 点穿透伤害;穿透无视光明/黑暗,防御和护盾仍然有效。',
          effects: [{ kind: 'damage', amount: 1, target: 'chosen', piercing: true }],
        },
        light: {
          key: 'light', name: '光明', cost: 4, tag: '4 EN',
          desc: '转移受到的普通伤害给攻击者;成功转移耗 4 点,没有转移任何伤害只耗 1 点。对穿透伤害无效。',
          effects: [{ kind: 'transfer', mode: 'source' }],
        },
        dark: {
          key: 'dark', name: '黑暗', cost: 5, tag: '5 EN',
          desc: '转移受到的普通伤害给指定目标;成功转移耗 5 点,没有转移任何伤害只耗 1 点。对穿透伤害无效。',
          effects: [{ kind: 'transfer', mode: 'target', target: 'chosen' }],
        },
        escape: {
          key: 'escape', name: '逃脱', cost: 1, tag: '1 EN',
          desc: '免疫本回合所有普通伤害;穿透伤害仍然命中。',
          effects: [{ kind: 'immunity' }],
        },
      };
    }

    return {
      charge,
      attack,
      defend,
      ult: {
        key: 'ult', name: '大招', cost: c.ultCost, tag: `${c.ultCost} EN`,
        desc: `消耗 ${c.ultCost} 点能量,造成 ${c.ultDmg} 点伤害。`,
        effects: [{ kind: 'damage', amount: c.ultDmg, target: 'chosen' }],
      },
    };
  }

  /*
   * 卡牌模式:每个玩家每回合打 1 张基础 + 1 张稀有,或者单独 1 张史诗。
   * 费用与能量图标一致;tier 只用于出牌规则,结算仍走同一条管线。
   */
  function cardDefs() {
    return {
      charge: {
        key: 'charge', name: '蓄力', tier: 'basic', cost: 0,
        desc: '获得 1 点能量。',
        effects: [{ kind: 'energy', amount: 1 }],
      },
      attack: {
        key: 'attack', name: '攻击', tier: 'basic', cost: 1,
        desc: '造成 1 点伤害。',
        effects: [{ kind: 'damage', amount: 1, target: 'chosen' }],
      },
      defend: {
        key: 'defend', name: '防御', tier: 'basic', cost: 1,
        desc: '本回合获得 3 点格挡。',
        effects: [{ kind: 'defense', amount: 3 }],
      },
      slash: {
        key: 'slash', name: '连斩', tier: 'rare', cost: 2,
        desc: '造成 2 点伤害。',
        effects: [{ kind: 'damage', amount: 2, target: 'chosen' }],
      },
      water: {
        key: 'water', name: '水枪', tier: 'rare', cost: 3,
        desc: '造成 1 点穿透伤害;防御仍然有效。',
        effects: [{ kind: 'damage', amount: 1, target: 'chosen', piercing: true }],
      },
      focus: {
        key: 'focus', name: '聚能', tier: 'rare', cost: 1,
        desc: '获得 2 点能量。',
        effects: [{ kind: 'energy', amount: 2 }],
      },
      strength: {
        key: 'strength', name: '力量', tier: 'rare', cost: 2,
        desc: '永久:你的伤害牌 +1 伤害。',
        effects: [{ kind: 'power', amount: 1 }],
      },
      dark: {
        key: 'dark', name: '黑暗', tier: 'epic', cost: 5,
        desc: '把受到的普通伤害转移给指定目标;没有转移任何伤害只耗 1 点。',
        effects: [{ kind: 'transfer', mode: 'target', target: 'chosen' }],
      },
      light: {
        key: 'light', name: '光明', tier: 'epic', cost: 4,
        desc: '把受到的普通伤害转移给攻击者;没有转移任何伤害只耗 1 点。',
        effects: [{ kind: 'transfer', mode: 'source' }],
      },
      escape: {
        key: 'escape', name: '逃脱', tier: 'epic', cost: 1,
        desc: '免疫本回合所有普通伤害;穿透伤害仍然命中。',
        effects: [{ kind: 'immunity' }],
      },
      execute: {
        key: 'execute', name: '处决', tier: 'epic', cost: 5,
        desc: '造成 3 点伤害。',
        effects: [{ kind: 'damage', amount: 3, target: 'chosen' }],
      },
    };
  }

  function pickDefs(pick, defs) {
    const keys = Array.isArray(pick.actions) && pick.actions.length
      ? pick.actions
      : pick.action ? [pick.action] : [];
    if (!keys.length) throw new Error('Empty pick');
    return keys.map((key) => {
      const def = defs[key];
      if (!def) throw new Error(`Unknown action: ${key}`);
      return def;
    });
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
    return [resolveChosen(pick, from, playerCount)];
  }

  function resolveChosen(pick, from, playerCount) {
    const target = pick.target;
    if (Number.isInteger(target) && target >= 0 && target < playerCount && target !== from) return target;
    return (from + 1) % playerCount;
  }

  function takeDamage(normal, piercing, from, to, amount) {
    let need = amount;
    const fromNormal = Math.min(normal[from][to], need);
    normal[from][to] -= fromNormal;
    need -= fromNormal;
    if (need > 0) {
      piercing[from][to] -= Math.min(piercing[from][to], need);
    }
  }

  /*
   * 通用结算管线:
   *   1. 行动产生 damage(normal / piercing)、defense、energy、transfer
   *   2. 互相攻击按无序对逐点抵消(先普通、后穿透)
   *   3. 光明/黑暗转移普通伤害;穿透伤害留在原目标
   *   4. 汇总受击值,减去防御
   *   5. 特殊护盾:第一次会掉血时消耗并免疫该回合剩余伤害
   */
  function resolveRound(playerCount, picks, defs, state = {}) {
    const energyDelta = Array(playerCount).fill(0);
    const defense = Array(playerCount).fill(0);
    const transfers = Array(playerCount).fill(null);
    const immunity = Array(playerCount).fill(false);
    const normal = Array.from({ length: playerCount }, () => Array(playerCount).fill(0));
    const piercing = Array.from({ length: playerCount }, () => Array(playerCount).fill(0));

    const bonusAdded = Array(playerCount).fill(0);

    for (let from = 0; from < playerCount; from += 1) {
      const pick = picks[from];
      if (!pick) continue;
      const list = pickDefs(pick, defs);

      // 力量这类永久增益先结算,同一回合的伤害牌也能吃到。
      for (const def of list) {
        for (const effect of def.effects ?? []) {
          if (effect.kind === 'power') bonusAdded[from] += effect.amount;
        }
      }
      const bonus = (state.damageBonus?.[from] ?? 0) + bonusAdded[from];

      for (const def of list) {
        energyDelta[from] -= def.cost ?? 0;
        for (const effect of def.effects ?? []) {
          if (effect.kind === 'energy') {
            energyDelta[from] += effect.amount;
          } else if (effect.kind === 'defense') {
            defense[from] += effect.amount;
          } else if (effect.kind === 'damage') {
            const amount = effect.amount + bonus;
            for (const to of resolveTargets(effect, pick, from, playerCount)) {
              if (effect.piercing) piercing[from][to] += amount;
              else normal[from][to] += amount;
            }
          } else if (effect.kind === 'transfer') {
            transfers[from] = {
              mode: effect.mode,
              target: effect.mode === 'target' ? resolveChosen(pick, from, playerCount) : null,
              cost: def.cost ?? 0,
            };
          } else if (effect.kind === 'immunity') {
            immunity[from] = true;
          }
        }
      }
    }

    // 相互攻击逐点抵消。按无序对遍历,人数增加时复杂度是 O(n²),不是组合爆炸。
    const canceledPairs = [];
    for (let i = 0; i < playerCount; i += 1) {
      for (let j = i + 1; j < playerCount; j += 1) {
        const amount = Math.min(
          normal[i][j] + piercing[i][j],
          normal[j][i] + piercing[j][i],
        );
        if (amount > 0) {
          takeDamage(normal, piercing, i, j, amount);
          takeDamage(normal, piercing, j, i, amount);
          canceledPairs.push({ i, j, amount });
        }
      }
    }

    // 光明/黑暗只转移普通伤害;穿透伤害留在原目标。
    // 转移进来的伤害不会再次被转移,避免循环。
    const transferredIn = Array(playerCount).fill(0);
    const transferred = [];
    for (let i = 0; i < playerCount; i += 1) {
      const transfer = transfers[i];
      if (!transfer) continue;

      if (transfer.mode === 'source') {
        for (let from = 0; from < playerCount; from += 1) {
          const amount = normal[from][i];
          if (amount <= 0) continue;
          normal[from][i] = 0;
          transferredIn[from] += amount;
          transferred.push({ from: i, to: from, amount, via: 'light' });
        }
      } else if (transfer.mode === 'target') {
        let amount = 0;
        for (let from = 0; from < playerCount; from += 1) {
          amount += normal[from][i];
          normal[from][i] = 0;
        }
        if (amount > 0 && transfer.target != null && transfer.target !== i) {
          transferredIn[transfer.target] += amount;
          transferred.push({ from: i, to: transfer.target, amount, via: 'dark' });
        } else if (amount > 0) {
          transferredIn[i] += amount;
          transferred.push({ from: i, to: i, amount, via: 'dark' });
        }
      }
    }

    // 光明/黑暗:成功转移才付全额,没有转移任何伤害只付 1 费。
    for (let i = 0; i < playerCount; i += 1) {
      const transfer = transfers[i];
      if (!transfer) continue;
      const fired = transferred.some((move) => move.from === i);
      if (!fired) energyDelta[i] += transfer.cost - 1;
    }

    // 逃脱:免疫普通伤害;穿透伤害保留。
    for (let i = 0; i < playerCount; i += 1) {
      if (!immunity[i]) continue;
      for (let from = 0; from < playerCount; from += 1) normal[from][i] = 0;
      transferredIn[i] = 0;
    }

    const incoming = Array.from({ length: playerCount }, (_, to) => {
      let total = transferredIn[to];
      for (let from = 0; from < playerCount; from += 1) {
        total += normal[from][to] + piercing[from][to];
      }
      return total;
    });

    const blocked = incoming.map((amount, index) => Math.min(amount, defense[index]));
    const hpLoss = incoming.map((amount, index) => Math.max(0, amount - defense[index]));

    // 特殊护盾:第一次会掉血时消耗,免疫该回合剩余伤害。
    const shieldAfter = state.shield ? state.shield.slice() : Array(playerCount).fill(false);
    const shieldUsed = Array(playerCount).fill(false);
    const shieldBlocked = Array(playerCount).fill(0);
    for (let i = 0; i < playerCount; i += 1) {
      if (shieldAfter[i] && hpLoss[i] > 0) {
        shieldUsed[i] = true;
        shieldBlocked[i] = hpLoss[i];
        hpLoss[i] = 0;
        shieldAfter[i] = false;
      }
    }

    return {
      energyDelta,
      bonusAdded,
      defense,
      normal,
      piercing,
      canceledPairs,
      transferred,
      escaped: immunity,
      incoming,
      blocked,
      hpLoss,
      shieldUsed,
      shieldBlocked,
      shieldAfter,
    };
  }

  return { actionDefs, cardDefs, attackTotal, resolveRound };
});
