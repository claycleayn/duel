'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startServer(env = {}) {
  const port = 33000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), REVEAL_MS: '120', ACCESS_TOKEN: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  return { port, child, log: () => log };
}

function request(port, route, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: route,
      method,
      headers: data
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        : {},
    }, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { out += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(out); } catch (error) { /* not json */ }
        resolve({ status: res.statusCode, json, text: out });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitReady(port, room = '') {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await request(port, `/health${room ? `?room=${room}` : ''}`);
      if (res.status === 200) return;
    } catch (error) {
      /* not up yet */
    }
    await delay(100);
  }
  throw new Error('server did not become ready');
}

function sse(port, query) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: `/events?${query}` }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`SSE status ${res.statusCode}`));
        return;
      }
      const client = { messages: [], waiters: [], req, res };
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const line = block.split('\n').find((item) => item.startsWith('data: '));
          if (!line) continue;
          let message;
          try { message = JSON.parse(line.slice(6)); } catch (error) { continue; }
          client.messages.push(message);
          client.waiters = client.waiters.filter((waiter) => {
            if (waiter.predicate(message)) {
              waiter.resolve(message);
              return false;
            }
            return true;
          });
        }
      });
      resolve(client);
    });
    req.on('error', reject);
  });
}

function waitFor(client, predicate, timeout = 4000) {
  const found = client.messages.find(predicate);
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for state')), timeout);
    client.waiters.push({
      predicate,
      resolve: (message) => {
        clearTimeout(timer);
        resolve(message);
      },
    });
  });
}

async function pick(port, token, action, target) {
  const res = await request(port, '/pick', 'POST', { token, action, target });
  assert.equal(res.status, 200, `pick ${action}: ${JSON.stringify(res)}`);
}

test('pvp: private picks, simultaneous reveal, cancellation', async (t) => {
  const srv = startServer();
  const clients = [];
  t.after(() => {
    for (const client of clients) client.req.destroy();
    srv.child.kill('SIGTERM');
  });
  await waitReady(srv.port);

  const a = await sse(srv.port, 'token=a&seat=0&cpu=0');
  const b = await sse(srv.port, 'token=b&seat=1&cpu=0');
  clients.push(a, b);

  const sa = await waitFor(a, (m) => m.you === 0 && m.connected[0] && m.connected[1]);
  assert.equal(sa.mode, 'pvp');
  await waitFor(b, (m) => m.you === 1 && m.connected[0] && m.connected[1]);

  await pick(srv.port, 'a', 'charge');
  const locked = await waitFor(a, (m) => m.locked[0] === true);
  assert.deepEqual(locked.locked, [true, false]);
  assert.equal(locked.reveal, null);

  await pick(srv.port, 'b', 'charge');
  const reveal = await waitFor(a, (m) => m.phase === 'reveal' && m.round === 1);
  assert.equal(reveal.reveal.picks[0].action, 'charge');
  assert.equal(reveal.reveal.picks[1].action, 'charge');
  assert.deepEqual(reveal.en, [1, 1]);
  assert.deepEqual(reveal.hp, [1, 1]);

  const round2 = await waitFor(a, (m) => m.phase === 'pick' && m.round === 2);
  assert.deepEqual(round2.locked, [false, false]);

  await pick(srv.port, 'a', 'attack', 1);
  await pick(srv.port, 'b', 'attack', 0);
  const cancel = await waitFor(a, (m) => m.phase === 'reveal' && m.round === 2);
  assert.equal(cancel.reveal.result.canceledPairs[0].amount, 1);
  assert.deepEqual(cancel.en, [0, 0]);
  assert.deepEqual(cancel.hp, [1, 1]);
});

test('cpu: bot locks privately, resolves, and re-picks each round', async (t) => {
  const srv = startServer();
  const clients = [];
  t.after(() => {
    for (const client of clients) client.req.destroy();
    srv.child.kill('SIGTERM');
  });
  await waitReady(srv.port);

  const h = await sse(srv.port, 'token=human&seat=0&cpu=1');
  clients.push(h);

  const initial = await waitFor(h, (m) => m.mode === 'cpu' && m.you === 0 && m.connected[0] && m.connected[1]);
  assert.deepEqual(initial.locked, [false, true]);
  assert.equal(initial.reveal, null);
  assert.equal(initial.yourPick, null);

  await pick(srv.port, 'human', 'charge');
  const reveal = await waitFor(h, (m) => m.phase === 'reveal' && m.round === 1);
  assert.equal(reveal.mode, 'cpu');
  assert.ok(['charge', 'defend'].includes(reveal.reveal.picks[1].action), reveal.reveal.picks[1].action);
  assert.deepEqual(reveal.hp, [1, 1]);

  const next = await waitFor(h, (m) => m.phase === 'pick' && m.round === 2);
  assert.deepEqual(next.locked, [false, true]);

  const x = await sse(srv.port, 'token=other&seat=1&cpu=1');
  clients.push(x);
  const spectator = await waitFor(x, (m) => m.mode === 'cpu' && m.you === 'spectator');
  assert.equal(spectator.you, 'spectator');

  const p = await sse(srv.port, 'token=pvp&seat=1&cpu=0');
  clients.push(p);
  const pvp = await waitFor(p, (m) => m.mode === 'pvp' && m.you === 1);
  assert.equal(pvp.mode, 'pvp');
  assert.equal(pvp.round, 1);
  assert.deepEqual(pvp.hp, [1, 1]);
});

test('room token gates page and api', async (t) => {
  const room = 'test-room';
  const srv = startServer({ ACCESS_TOKEN: room });
  t.after(() => srv.child.kill('SIGTERM'));
  await waitReady(srv.port, room);

  assert.equal((await request(srv.port, '/')).status, 404);
  assert.equal((await request(srv.port, `/?room=${room}`)).status, 200);
  assert.equal((await request(srv.port, '/health')).status, 404);
  assert.equal((await request(srv.port, `/health?room=${room}`)).status, 200);

  const denied = await request(srv.port, '/pick', 'POST', { token: 'x', action: 'charge' });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error, 'forbidden');

  const allowed = await request(srv.port, '/pick', 'POST', { room, token: 'x', action: 'charge' });
  assert.equal(allowed.status, 403);
  assert.equal(allowed.json.error, 'not seated');
});
