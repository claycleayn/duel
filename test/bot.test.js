'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { actionDefs } = require('../engine.js');
const { chooseBotPick } = require('../bot.js');

const cfg = {
  hp: 1,
  startEnergy: 0,
  attackCost: 1,
  attackDmg: 1,
  ultCost: 5,
  ultDmg: 2,
  defendReduce: 1,
};
const minimalDefs = actionDefs(cfg, 'minimal');
const fullDefs = actionDefs(cfg, 'full');
const fixed = (value) => () => value;

const state = (botEn, humanEn, log = [], extra = {}) => ({
  seat: 1,
  playerCount: 2,
  teams: null,
  hp: [1, 1],
  en: [humanEn, botEn],
  shield: [false, false],
  log,
  round: 1,
  ...extra,
});
const history = (...keys) => keys.map((key) => ({ players: [{ key }, { key: 'charge' }] }));

test('minimal: bot uses the ultimate at 5 EN', () => {
  const pick = chooseBotPick(state(5, 1), minimalDefs, fixed(0.99));
  assert.equal(pick.action, 'ult');
  assert.equal(pick.target, 0);
});

test('minimal: bot with 0 EN only charges or defends', () => {
  for (const value of [0, 0.5, 0.99]) {
    const pick = chooseBotPick(state(0, 2), minimalDefs, fixed(value));
    assert.ok(['charge', 'defend'].includes(pick.action), pick.action);
    assert.equal(pick.target, 0);
  }
});

test('minimal: bot punishes a target who cannot attack', () => {
  assert.equal(chooseBotPick(state(1, 0), minimalDefs, fixed(0)).action, 'attack');
  assert.equal(chooseBotPick(state(1, 0), minimalDefs, fixed(0.99)).action, 'charge');
});

test('minimal: bot counters the target history', () => {
  assert.equal(chooseBotPick(state(1, 1, history('attack', 'attack')), minimalDefs, fixed(0)).action, 'defend');
  assert.equal(chooseBotPick(state(1, 1, history('charge', 'charge')), minimalDefs, fixed(0)).action, 'attack');
  assert.equal(chooseBotPick(state(1, 1, history('defend', 'defend')), minimalDefs, fixed(0)).action, 'charge');
});

test('minimal: bot choices stay affordable for random states', () => {
  const actions = ['attack', 'charge', 'defend', 'ult'];
  for (let i = 0; i < 500; i += 1) {
    const botEn = Math.floor(Math.random() * 8);
    const humanEn = Math.floor(Math.random() * 8);
    const log = Array.from({ length: Math.floor(Math.random() * 8) }, () => ({
      players: [{ key: actions[Math.floor(Math.random() * actions.length)] }, { key: 'charge' }],
    }));
    const pick = chooseBotPick(state(botEn, humanEn, log), minimalDefs);
    assert.ok(minimalDefs[pick.action], pick.action);
    assert.ok(minimalDefs[pick.action].cost <= botEn, `${pick.action} costs ${minimalDefs[pick.action].cost}, en ${botEn}`);
    assert.equal(pick.target, 0);
  }
});

const fullState = (botEn, humanEn, shield, log = []) => ({
  seat: 1,
  playerCount: 2,
  teams: null,
  hp: [1, 1],
  en: [humanEn, botEn],
  shield,
  log,
  round: 1,
});

test('full: bot strips the starting shield with a cheap attack', () => {
  assert.equal(chooseBotPick(fullState(1, 0, [true, false]), fullDefs, fixed(0)).action, 'attack');
  assert.equal(chooseBotPick(fullState(1, 0, [true, false]), fullDefs, fixed(0.99)).action, 'charge');
});

test('full: bot uses double/water when the shield is down', () => {
  assert.equal(chooseBotPick(fullState(4, 1, [false, false]), fullDefs, fixed(0.5)).action, 'double');
  assert.equal(chooseBotPick(fullState(3, 1, [false, false]), fullDefs, fixed(0)).action, 'water');
});

test('full: bot uses light vs an attacker and water vs a transfer user', () => {
  const attackLog = [{ players: [{ key: 'attack' }, { key: 'charge' }] }];
  assert.equal(chooseBotPick(fullState(4, 1, [false, false], attackLog), fullDefs, fixed(0)).action, 'light');
  const transferLog = [{ players: [{ key: 'light' }, { key: 'charge' }] }];
  assert.equal(chooseBotPick(fullState(4, 1, [false, false], transferLog), fullDefs, fixed(0)).action, 'water');
});

test('full: bot choices stay affordable for random states', () => {
  const actions = Object.keys(fullDefs);
  for (let i = 0; i < 500; i += 1) {
    const botEn = Math.floor(Math.random() * 8);
    const humanEn = Math.floor(Math.random() * 8);
    const shield = [Math.random() < 0.5, Math.random() < 0.5];
    const log = Array.from({ length: Math.floor(Math.random() * 8) }, () => ({
      players: [{ key: actions[Math.floor(Math.random() * actions.length)] }, { key: 'charge' }],
    }));
    const pick = chooseBotPick(fullState(botEn, humanEn, shield, log), fullDefs);
    assert.ok(fullDefs[pick.action], pick.action);
    assert.ok(fullDefs[pick.action].cost <= botEn, `${pick.action} costs ${fullDefs[pick.action].cost}, en ${botEn}`);
    assert.equal(pick.target, 0);
  }
});

test('multiplayer: any seat can be a bot and targets stay in range', () => {
  const four = {
    seat: 2,
    playerCount: 4,
    teams: null,
    hp: [1, 1, 1, 1],
    en: [1, 1, 2, 1],
    shield: [false, false, false, false],
    log: [],
    round: 1,
  };
  for (const defs of [minimalDefs, fullDefs]) {
    for (let i = 0; i < 50; i += 1) {
      const pick = chooseBotPick(four, defs);
      assert.ok(pick);
      assert.notEqual(pick.target, 2);
      assert.ok([0, 1, 3].includes(pick.target), `target ${pick.target}`);
      assert.ok(defs[pick.action].cost <= four.en[2]);
    }
  }
});

test('2v2: bot never targets its teammate', () => {
  const team = {
    seat: 1,
    playerCount: 4,
    teams: [0, 0, 1, 1],
    hp: [1, 1, 1, 1],
    en: [0, 2, 1, 1],
    shield: [false, false, false, false],
    log: [],
    round: 1,
  };
  for (const defs of [minimalDefs, fullDefs]) {
    for (let i = 0; i < 50; i += 1) {
      const pick = chooseBotPick(team, defs);
      assert.ok(pick);
      assert.ok([2, 3].includes(pick.target), `target ${pick.target}`);
      assert.ok(defs[pick.action].cost <= team.en[1]);
    }
  }
});

test('primary target prefers unshielded and low-HP enemies', () => {
  const team = {
    seat: 1,
    playerCount: 4,
    teams: [0, 0, 1, 1],
    hp: [1, 1, 1, 1],
    en: [0, 1, 3, 2],
    shield: [false, false, true, false],
    log: [],
    round: 1,
  };
  const pick = chooseBotPick(team, minimalDefs, fixed(0.1));
  assert.equal(pick.target, 3);
});
