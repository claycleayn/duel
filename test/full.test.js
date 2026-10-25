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
const full = actionDefs(cfg, 'full');
const minimal = actionDefs(cfg);
const p2 = (a, b) => [
  { action: a, target: 1 },
  { action: b, target: 0 },
];
const shields = (left, right) => ({ shield: [left, right] });

test('full ruleset has 8 skills and no ultimate', () => {
  assert.deepStrictEqual(Object.keys(full), ['charge', 'attack', 'defend', 'double', 'water', 'light', 'dark', 'escape']);
  assert.equal(full.ult, undefined);
  assert.equal(full.double.cost, 4);
  assert.equal(full.water.cost, 3);
  assert.equal(full.water.effects[0].piercing, true);
  assert.equal(full.light.cost, 4);
  assert.equal(full.dark.cost, 5);
  assert.equal(full.escape.cost, 1);
  assert.equal(full.escape.effects[0].kind, 'immunity');
  assert.deepStrictEqual(Object.keys(minimal), ['charge', 'attack', 'defend', 'ult']);
});

test('special shield blocks the first damaging turn and is consumed', () => {
  const hit = resolveRound(2, p2('attack', 'charge'), full, shields(true, true));
  assert.deepStrictEqual(hit.incoming, [0, 1]);
  assert.deepStrictEqual(hit.hpLoss, [0, 0]);
  assert.deepStrictEqual(hit.shieldUsed, [false, true]);
  assert.deepStrictEqual(hit.shieldBlocked, [0, 1]);
  assert.deepStrictEqual(hit.shieldAfter, [true, false]);

  const canceled = resolveRound(2, p2('attack', 'attack'), full, shields(true, true));
  assert.deepStrictEqual(canceled.hpLoss, [0, 0]);
  assert.deepStrictEqual(canceled.shieldUsed, [false, false]);
  assert.deepStrictEqual(canceled.shieldAfter, [true, true]);

  const defended = resolveRound(2, p2('attack', 'defend'), full, shields(true, true));
  assert.deepStrictEqual(defended.hpLoss, [0, 0]);
  assert.deepStrictEqual(defended.shieldUsed, [false, false]);
  assert.deepStrictEqual(defended.shieldAfter, [true, true]);

  const throughDefense = resolveRound(2, p2('double', 'defend'), full, shields(true, true));
  assert.deepStrictEqual(throughDefense.incoming, [0, 2]);
  assert.deepStrictEqual(throughDefense.blocked, [0, 1]);
  assert.deepStrictEqual(throughDefense.hpLoss, [0, 0]);
  assert.deepStrictEqual(throughDefense.shieldUsed, [false, true]);
  assert.deepStrictEqual(throughDefense.shieldBlocked, [0, 1]);
});

test('light transfers normal damage back to the attacker', () => {
  const result = resolveRound(2, p2('light', 'attack'), full, shields(false, false));
  assert.deepStrictEqual(result.transferred, [{ from: 0, to: 1, amount: 1, via: 'light' }]);
  assert.deepStrictEqual(result.incoming, [0, 1]);
  assert.deepStrictEqual(result.hpLoss, [0, 1]);
  assert.deepStrictEqual(result.energyDelta, [-4, -1]);

  const shielded = resolveRound(2, p2('light', 'attack'), full, shields(true, true));
  assert.deepStrictEqual(shielded.hpLoss, [0, 0]);
  assert.deepStrictEqual(shielded.shieldUsed, [false, true]);
  assert.deepStrictEqual(shielded.shieldAfter, [true, false]);
});

test('dark transfers normal damage to the chosen target', () => {
  const result = resolveRound(2, p2('dark', 'double'), full, shields(false, false));
  assert.deepStrictEqual(result.transferred, [{ from: 0, to: 1, amount: 2, via: 'dark' }]);
  assert.deepStrictEqual(result.incoming, [0, 2]);
  assert.deepStrictEqual(result.hpLoss, [0, 2]);
  assert.deepStrictEqual(result.energyDelta, [-5, -4]);

  const shielded = resolveRound(2, p2('dark', 'double'), full, shields(true, true));
  assert.deepStrictEqual(shielded.hpLoss, [0, 0]);
  assert.deepStrictEqual(shielded.shieldUsed, [false, true]);
  assert.deepStrictEqual(shielded.shieldBlocked, [0, 2]);
});

test('piercing ignores light/dark but not defense or shield', () => {
  const light = resolveRound(2, p2('water', 'light'), full, shields(false, false));
  assert.deepStrictEqual(light.transferred, []);
  assert.deepStrictEqual(light.incoming, [0, 1]);
  assert.deepStrictEqual(light.hpLoss, [0, 1]);
  assert.deepStrictEqual(light.energyDelta, [-3, -1]);

  const shielded = resolveRound(2, p2('water', 'light'), full, shields(false, true));
  assert.deepStrictEqual(shielded.hpLoss, [0, 0]);
  assert.deepStrictEqual(shielded.shieldUsed, [false, true]);

  const defended = resolveRound(2, p2('water', 'defend'), full, shields(false, false));
  assert.deepStrictEqual(defended.incoming, [0, 1]);
  assert.deepStrictEqual(defended.blocked, [0, 1]);
  assert.deepStrictEqual(defended.hpLoss, [0, 0]);
});

test('mutual attack cancellation still uses total damage', () => {
  const result = resolveRound(2, p2('double', 'water'), full, shields(false, false));
  assert.deepStrictEqual(result.canceledPairs, [{ i: 0, j: 1, amount: 1 }]);
  assert.deepStrictEqual(result.incoming, [0, 1]);
  assert.deepStrictEqual(result.hpLoss, [0, 1]);
  assert.deepStrictEqual(result.energyDelta, [-4, -3]);
});

test('both light users waste the turn without damage', () => {
  const result = resolveRound(2, p2('light', 'light'), full, shields(true, true));
  assert.deepStrictEqual(result.transferred, []);
  assert.deepStrictEqual(result.hpLoss, [0, 0]);
  assert.deepStrictEqual(result.shieldUsed, [false, false]);
  assert.deepStrictEqual(result.energyDelta, [-1, -1]);
});

test('light and dark pay only 1 EN when nothing is transferred', () => {
  const light = resolveRound(2, p2('light', 'charge'), full, shields(false, false));
  assert.deepStrictEqual(light.transferred, []);
  assert.deepStrictEqual(light.energyDelta, [-1, 1]);
  assert.deepStrictEqual(light.hpLoss, [0, 0]);

  const dark = resolveRound(2, p2('dark', 'charge'), full, shields(false, false));
  assert.deepStrictEqual(dark.transferred, []);
  assert.deepStrictEqual(dark.energyDelta, [-1, 1]);
});

test('light and dark pay full cost when a transfer fires', () => {
  const light = resolveRound(2, p2('light', 'attack'), full, shields(false, false));
  assert.deepStrictEqual(light.transferred, [{ from: 0, to: 1, amount: 1, via: 'light' }]);
  assert.deepStrictEqual(light.energyDelta, [-4, -1]);

  const dark = resolveRound(2, p2('dark', 'double'), full, shields(false, false));
  assert.deepStrictEqual(dark.transferred, [{ from: 0, to: 1, amount: 2, via: 'dark' }]);
  assert.deepStrictEqual(dark.energyDelta, [-5, -4]);
});

test('escape negates normal damage but not piercing', () => {
  const normal = resolveRound(2, p2('escape', 'double'), full, shields(false, false));
  assert.deepStrictEqual(normal.escaped, [true, false]);
  assert.deepStrictEqual(normal.incoming, [0, 0]);
  assert.deepStrictEqual(normal.hpLoss, [0, 0]);
  assert.deepStrictEqual(normal.energyDelta, [-1, -4]);

  const piercing = resolveRound(2, p2('escape', 'water'), full, shields(false, false));
  assert.deepStrictEqual(piercing.escaped, [true, false]);
  assert.deepStrictEqual(piercing.incoming, [1, 0]);
  assert.deepStrictEqual(piercing.hpLoss, [1, 0]);
  assert.deepStrictEqual(piercing.energyDelta, [-1, -3]);

  const shielded = resolveRound(2, p2('escape', 'water'), full, shields(true, true));
  assert.deepStrictEqual(shielded.shieldUsed, [true, false]);
  assert.deepStrictEqual(shielded.shieldAfter, [false, true]);
  assert.deepStrictEqual(shielded.hpLoss, [0, 0]);
});

test('escape keeps the special shield against normal damage', () => {
  const result = resolveRound(2, p2('escape', 'double'), full, shields(true, true));
  assert.deepStrictEqual(result.escaped, [true, false]);
  assert.deepStrictEqual(result.shieldUsed, [false, false]);
  assert.deepStrictEqual(result.shieldAfter, [true, true]);
  assert.deepStrictEqual(result.hpLoss, [0, 0]);
});
