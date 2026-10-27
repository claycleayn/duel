'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cardDefs, resolveRound } = require('../engine.js');

const cards = cardDefs();
const pick = (...actions) => ({ actions, target: 1 });
const aimed = (target, ...actions) => ({ actions, target });
const state = (extra = {}) => ({
  hp: [10, 10],
  en: [0, 0],
  shield: [false, false],
  damageBonus: [0, 0],
  ...extra,
});

test('card catalog: tiers, costs and unique keys', () => {
  const keys = Object.keys(cards);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of ['charge', 'attack', 'defend']) assert.equal(cards[key].tier, 'basic');
  assert.equal(cards.slash.tier, 'rare');
  assert.equal(cards.strength.tier, 'rare');
  assert.equal(cards.dark.tier, 'epic');
  assert.equal(cards.execute.tier, 'epic');
  assert.ok(cards.execute.cost >= cards.slash.cost);
  for (const def of Object.values(cards)) {
    assert.equal(typeof def.cost, 'number');
    assert.ok(Array.isArray(def.effects) && def.effects.length > 0);
  }
});

test('cards: damage from both cards stacks on the same target', () => {
  const result = resolveRound(2, [pick('attack', 'slash'), null], cards, state());
  assert.equal(result.incoming[1], 3);
  assert.equal(result.hpLoss[1], 3);
});

test('cards: energy gain and cost from both cards net out', () => {
  const result = resolveRound(2, [pick('charge', 'focus'), null], cards, state());
  assert.equal(result.energyDelta[0], 2);
});

test('cards: block from one card covers the whole round', () => {
  const result = resolveRound(
    2,
    [{ actions: ['defend'], target: null }, aimed(0, 'slash')],
    cards,
    state(),
  );
  assert.equal(result.incoming[0], 2);
  assert.equal(result.blocked[0], 2);
  assert.equal(result.hpLoss[0], 0);
});

test('cards: mutual attacks cancel point by point before block', () => {
  const result = resolveRound(
    2,
    [pick('attack', 'slash'), aimed(0, 'attack')],
    cards,
    state(),
  );
  assert.equal(result.canceledPairs[0].amount, 1);
  assert.equal(result.hpLoss[1], 2);
  assert.equal(result.hpLoss[0], 0);
});

test('cards: strength applies this round and is reported for persistence', () => {
  const result = resolveRound(
    2,
    [pick('strength', 'attack'), null],
    cards,
    state(),
  );
  assert.equal(result.bonusAdded[0], 1);
  assert.equal(result.incoming[1], 2);
});

test('cards: stored strength adds to later damage', () => {
  const result = resolveRound(
    2,
    [pick('execute'), null],
    cards,
    state({ damageBonus: [2, 0] }),
  );
  assert.equal(result.incoming[1], 5);
  assert.equal(result.bonusAdded[0], 0);
});

test('cards: light refunds to 1 energy when nothing is transferred', () => {
  const result = resolveRound(2, [pick('light'), null], cards, state());
  assert.equal(result.energyDelta[0], -1);
  assert.equal(result.transferred.length, 0);
});

test('cards: dark moves the incoming damage to the chosen target', () => {
  const result = resolveRound(
    2,
    [aimed(1, 'dark'), aimed(0, 'attack')],
    cards,
    state(),
  );
  assert.equal(result.hpLoss[0], 0);
  assert.equal(result.hpLoss[1], 1);
  assert.equal(result.energyDelta[0], -5);
});

test('cards: unknown card in a pick throws', () => {
  assert.throws(
    () => resolveRound(2, [pick('attack', 'nope'), null], cards, state()),
    /Unknown action/,
  );
});
