'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { actionDefs } = require('../engine.js');
const { chooseBotPick } = require('../bot.js');

const defs = actionDefs({
  hp: 1,
  startEnergy: 0,
  attackCost: 1,
  attackDmg: 1,
  ultCost: 5,
  ultDmg: 2,
  defendReduce: 1,
});

const state = (botEn, humanEn, log = []) => ({
  hp: [1, 1],
  en: [humanEn, botEn],
  log,
  round: 1,
});
const fixed = (value) => () => value;
const history = (...keys) => keys.map((key) => ({ a: { key }, b: { key: 'charge' } }));

test('bot uses the ultimate at 5 EN', () => {
  const pick = chooseBotPick(state(5, 1), defs, fixed(0.99));
  assert.equal(pick.action, 'ult');
  assert.equal(pick.target, 0);
});

test('bot with 0 EN only charges or defends', () => {
  for (const value of [0, 0.5, 0.99]) {
    const pick = chooseBotPick(state(0, 2), defs, fixed(value));
    assert.ok(['charge', 'defend'].includes(pick.action), pick.action);
    assert.equal(pick.target, 0);
  }
});

test('bot punishes a human who cannot attack', () => {
  assert.equal(chooseBotPick(state(1, 0), defs, fixed(0)).action, 'attack');
  assert.equal(chooseBotPick(state(1, 0), defs, fixed(0.99)).action, 'charge');
});

test('bot counters the human history', () => {
  assert.equal(chooseBotPick(state(1, 1, history('attack', 'attack')), defs, fixed(0)).action, 'defend');
  assert.equal(chooseBotPick(state(1, 1, history('charge', 'charge')), defs, fixed(0)).action, 'attack');
  assert.equal(chooseBotPick(state(1, 1, history('defend', 'defend')), defs, fixed(0)).action, 'charge');
});

test('bot choices stay affordable for random states', () => {
  const actions = ['attack', 'charge', 'defend', 'ult'];
  for (let i = 0; i < 500; i += 1) {
    const botEn = Math.floor(Math.random() * 8);
    const humanEn = Math.floor(Math.random() * 8);
    const log = Array.from({ length: Math.floor(Math.random() * 8) }, () => ({
      a: { key: actions[Math.floor(Math.random() * actions.length)] },
      b: { key: 'charge' },
    }));
    const pick = chooseBotPick(state(botEn, humanEn, log), defs);
    assert.ok(defs[pick.action], pick.action);
    assert.ok(defs[pick.action].cost <= botEn, `${pick.action} costs ${defs[pick.action].cost}, en ${botEn}`);
    assert.equal(pick.target, 0);
  }
});
