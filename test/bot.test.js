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

const fullDefs = actionDefs({
  hp: 1,
  startEnergy: 0,
  attackCost: 1,
  attackDmg: 1,
  ultCost: 5,
  ultDmg: 2,
  defendReduce: 1,
}, 'full');
const fullState = (botEn, humanEn, shield, log = []) => ({
  hp: [1, 1],
  en: [humanEn, botEn],
  shield,
  log,
  round: 1,
});

test('full bot strips the starting shield with a cheap attack', () => {
  assert.equal(chooseBotPick(fullState(1, 0, [true, false]), fullDefs, fixed(0)).action, 'attack');
  assert.equal(chooseBotPick(fullState(1, 0, [true, false]), fullDefs, fixed(0.99)).action, 'charge');
});

test('full bot uses double/water when the human shield is down', () => {
  assert.equal(chooseBotPick(fullState(4, 1, [false, false]), fullDefs, fixed(0.5)).action, 'double');
  assert.equal(chooseBotPick(fullState(3, 1, [false, false]), fullDefs, fixed(0)).action, 'water');
});

test('full bot uses light vs an attacker and water vs a transfer user', () => {
  const attackLog = [{ a: { key: 'attack' }, b: { key: 'charge' } }];
  assert.equal(chooseBotPick(fullState(4, 1, [false, false], attackLog), fullDefs, fixed(0)).action, 'light');
  const transferLog = [{ a: { key: 'light' }, b: { key: 'charge' } }];
  assert.equal(chooseBotPick(fullState(4, 1, [false, false], transferLog), fullDefs, fixed(0)).action, 'water');
});

test('full bot choices stay affordable for random states', () => {
  const actions = Object.keys(fullDefs);
  for (let i = 0; i < 500; i += 1) {
    const botEn = Math.floor(Math.random() * 8);
    const humanEn = Math.floor(Math.random() * 8);
    const shield = [Math.random() < 0.5, Math.random() < 0.5];
    const log = Array.from({ length: Math.floor(Math.random() * 8) }, () => ({
      a: { key: actions[Math.floor(Math.random() * actions.length)] },
      b: { key: 'charge' },
    }));
    const pick = chooseBotPick(fullState(botEn, humanEn, shield, log), fullDefs);
    assert.ok(fullDefs[pick.action], pick.action);
    assert.ok(fullDefs[pick.action].cost <= botEn, `${pick.action} costs ${fullDefs[pick.action].cost}, en ${botEn}`);
    assert.equal(pick.target, 0);
  }
});
