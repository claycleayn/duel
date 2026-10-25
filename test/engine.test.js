'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { actionDefs, resolveRound } = require('../engine.js');

const cfg = {
  hp: 1,
  startEnergy: 0,
  attackCost: 1,
  attackDmg: 1,
  ultCost: 5,
  ultDmg: 2,
  defendReduce: 1,
};
const defs = actionDefs(cfg);
const p2 = (a, b) => [
  { action: a, target: 1 },
  { action: b, target: 0 },
];

test('2P: cancel, block, damage, energy', () => {
  const cases = [
    ['attack', 'attack', { energyDelta: [-1, -1], canceledPairs: [{ i: 0, j: 1, amount: 1 }], incoming: [0, 0], hpLoss: [0, 0] }],
    ['attack', 'charge', { energyDelta: [-1, 1], canceledPairs: [], incoming: [0, 1], hpLoss: [0, 1] }],
    ['attack', 'defend', { energyDelta: [-1, 0], incoming: [0, 1], blocked: [0, 1], hpLoss: [0, 0] }],
    ['ult', 'attack', { energyDelta: [-5, -1], canceledPairs: [{ i: 0, j: 1, amount: 1 }], incoming: [0, 1], hpLoss: [0, 1] }],
    ['ult', 'defend', { energyDelta: [-5, 0], incoming: [0, 2], blocked: [0, 1], hpLoss: [0, 1] }],
    ['defend', 'ult', { energyDelta: [0, -5], incoming: [2, 0], blocked: [1, 0], hpLoss: [1, 0] }],
    ['ult', 'ult', { energyDelta: [-5, -5], canceledPairs: [{ i: 0, j: 1, amount: 2 }], incoming: [0, 0], hpLoss: [0, 0] }],
    ['charge', 'defend', { energyDelta: [1, 0], incoming: [0, 0], hpLoss: [0, 0] }],
    ['ult', 'charge', { energyDelta: [-5, 1], incoming: [0, 2], hpLoss: [0, 2] }],
    ['defend', 'attack', { energyDelta: [0, -1], incoming: [1, 0], blocked: [1, 0], hpLoss: [0, 0] }],
  ];

  for (const [a, b, expected] of cases) {
    const result = resolveRound(2, p2(a, b), defs);
    for (const [key, value] of Object.entries(expected)) {
      assert.deepStrictEqual(result[key], value, `${a} vs ${b}: ${key}`);
    }
  }
});

test('3P: damage stacks, mutual pairs cancel, defense subtracts once', () => {
  const stack = resolveRound(3, [
    { action: 'attack', target: 2 },
    { action: 'attack', target: 2 },
    { action: 'charge', target: 0 },
  ], defs);
  assert.deepStrictEqual(stack.hpLoss, [0, 0, 2]);
  assert.deepStrictEqual(stack.energyDelta, [-1, -1, 1]);

  const mutual = resolveRound(3, [
    { action: 'ult', target: 1 },
    { action: 'attack', target: 0 },
    { action: 'attack', target: 1 },
  ], defs);
  assert.deepStrictEqual(mutual.canceledPairs, [{ i: 0, j: 1, amount: 1 }]);
  assert.deepStrictEqual(mutual.incoming, [0, 2, 0]);
  assert.deepStrictEqual(mutual.hpLoss, [0, 2, 0]);

  const guard = resolveRound(3, [
    { action: 'attack', target: 2 },
    { action: 'attack', target: 2 },
    { action: 'defend', target: 0 },
  ], defs);
  assert.deepStrictEqual(guard.incoming, [0, 0, 2]);
  assert.deepStrictEqual(guard.blocked, [0, 0, 1]);
  assert.deepStrictEqual(guard.hpLoss, [0, 0, 1]);

  const cycle = resolveRound(3, [
    { action: 'attack', target: 1 },
    { action: 'attack', target: 2 },
    { action: 'attack', target: 0 },
  ], defs);
  assert.deepStrictEqual(cycle.canceledPairs, []);
  assert.deepStrictEqual(cycle.hpLoss, [1, 1, 1]);
});

test('custom effects need no resolver changes', () => {
  const custom = {
    nova: { name: '新星', cost: 2, effects: [{ kind: 'damage', amount: 1, target: 'all' }] },
    guard: { name: '护盾', cost: 0, effects: [{ kind: 'defense', amount: 2 }] },
    hit: { name: '重击', cost: 1, effects: [{ kind: 'damage', amount: 2, target: 'chosen' }] },
  };
  const result = resolveRound(3, [
    { action: 'nova' },
    { action: 'guard' },
    { action: 'hit', target: 0 },
  ], custom);
  assert.deepStrictEqual(result.energyDelta, [-2, 0, -1]);
  assert.deepStrictEqual(result.incoming, [1, 1, 0]);
  assert.deepStrictEqual(result.blocked, [0, 1, 0]);
  assert.deepStrictEqual(result.hpLoss, [1, 0, 0]);
});
