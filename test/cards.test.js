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
  attackBuff: [0, 0],
  ...extra,
});

test('card catalog: tiers, costs and effects', () => {
  const keys = Object.keys(cards);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of ['charge', 'attack', 'defend']) assert.equal(cards[key].tier, 'basic');
  assert.equal(cards.charge.cost, 10);
  assert.equal(cards.charge.effects[0].amount, 30);
  assert.equal(cards.defend.effects[0].amount, 20);
  assert.equal(cards.slash.cost, 40);
  assert.equal(cards.slash.effects.filter((effect) => effect.kind === 'damage').length, 2);
  assert.equal(cards.water.cost, 20);
  assert.equal(cards.strength.effects[0].kind, 'buff');
  assert.equal(cards.heal.tier, 'rare');
  assert.equal(cards.focus.tier, 'epic');
  assert.equal(cards.focus.cost, 50);
  assert.equal(cards.focus.effects[0].amount, 80);
  for (const def of Object.values(cards)) {
    assert.equal(typeof def.cost, 'number');
    assert.ok(Array.isArray(def.effects) && def.effects.length > 0);
  }
});

test('cards: damage from both cards stacks on the same target', () => {
  const result = resolveRound(2, [pick('attack', 'water'), null], cards, state());
  assert.equal(result.incoming[1], 20);
  assert.equal(result.hpLoss[1], 20);
});

test('cards: charge pays now and pays out next round', () => {
  const result = resolveRound(2, [pick('charge'), null], cards, state());
  assert.equal(result.energyDelta[0], -10);
  assert.equal(result.energyNext[0], 30);
});

test('cards: focus pays out 8 energy next round', () => {
  const result = resolveRound(2, [pick('focus'), null], cards, state());
  assert.equal(result.energyDelta[0], -50);
  assert.equal(result.energyNext[0], 80);
});

test('cards: strength adds +20 to every hit of the next attack card', () => {
  const result = resolveRound(2, [pick('strength', 'slash'), null], cards, state());
  assert.equal(result.incoming[1], 60);
  assert.equal(result.buffAdded[0], 0);
});

test('cards: strength only buffs the first attack card played', () => {
  const result = resolveRound(2, [pick('strength', 'attack', 'slash'), null], cards, state());
  assert.equal(result.incoming[1], 50);
});

test('cards: strength waits when no attack card is played', () => {
  const result = resolveRound(2, [pick('strength'), null], cards, state());
  assert.equal(result.buffAdded[0], 20);
  assert.equal(result.buffUsed[0], 0);
  assert.equal(result.incoming[1], 0);
});

test('cards: a stored buff is consumed by the next attack', () => {
  const result = resolveRound(2, [pick('attack'), null], cards, state({ attackBuff: [20, 0] }));
  assert.equal(result.incoming[1], 30);
  assert.equal(result.buffUsed[0], 20);
  assert.equal(result.buffAdded[0], 0);
});

test('cards: heal returns health and adds 1 block', () => {
  const result = resolveRound(
    2,
    [pick('heal'), aimed(0, 'attack')],
    cards,
    state(),
  );
  assert.equal(result.blocked[0], 10);
  assert.equal(result.hpLoss[0], 0);
  assert.equal(result.heal[0], 10);
});

test('cards: two 1-damage hits are covered by 2 block', () => {
  const result = resolveRound(
    2,
    [pick('defend'), aimed(0, 'slash')],
    cards,
    state(),
  );
  assert.equal(result.incoming[0], 20);
  assert.equal(result.blocked[0], 20);
  assert.equal(result.hpLoss[0], 0);
});

test('cards: mutual attacks cancel point by point before block', () => {
  const result = resolveRound(
    2,
    [pick('attack', 'water'), aimed(0, 'attack')],
    cards,
    state(),
  );
  assert.equal(result.canceledPairs[0].amount, 10);
  assert.equal(result.hpLoss[1], 10);
  assert.equal(result.hpLoss[0], 0);
});

test('cards: light costs 10 when nothing is transferred', () => {
  const result = resolveRound(2, [pick('light'), null], cards, state());
  assert.equal(result.energyDelta[0], -10);
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
  assert.equal(result.hpLoss[1], 10);
  assert.equal(result.energyDelta[0], -50);
});

test('cards: unknown card in a pick throws', () => {
  assert.throws(
    () => resolveRound(2, [pick('attack', 'nope'), null], cards, state()),
    /Unknown action/,
  );
});

test('cards: an empty pick is a legal pass', () => {
  const result = resolveRound(2, [{ actions: [], target: null }, pick('attack')], cards, state());
  assert.equal(result.energyDelta[0], 0);
  assert.equal(result.incoming[0], 10);
  assert.equal(result.hpLoss[0], 10);
});

test('cards: execute adds half of the target missing health', () => {
  const full = resolveRound(2, [aimed(1, 'execute'), null], cards, state({ hp: [100, 100], maxHp: 100 }));
  assert.equal(full.incoming[1], 10);
  const hurt = resolveRound(2, [aimed(1, 'execute'), null], cards, state({ hp: [100, 70], maxHp: 100 }));
  assert.equal(hurt.incoming[1], 25);
});
