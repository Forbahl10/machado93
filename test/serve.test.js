import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, startServer } from '../src/serve.js';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-serve-'));
  fs.mkdirSync(path.join(dir, 'site', 'about'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'site', 'index.html'), '<h1>hi</h1>');
  fs.writeFileSync(path.join(dir, 'site', 'about', 'index.html'), 'about');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'top secret');
  return dir;
}
async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
}

test('serves files, index.html, noindex header, blocks traversal and writes', async () => {
  const server = createServer({ dir: setup() });
  const base = await listen(server);
  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.equal(await home.text(), '<h1>hi</h1>');
    assert.match(home.headers.get('x-robots-tag'), /noindex/);
    assert.equal((await fetch(`${base}/about/`)).status, 200);
    assert.equal((await fetch(`${base}/about`, { redirect: 'manual' })).status, 301);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    const traversal = await fetch(`${base}/..%2fsecret.txt`);
    assert.notEqual(await traversal.text(), 'top secret');
    assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
  } finally {
    server.close();
  }
});

test('basic auth is enforced', async () => {
  const server = createServer({ dir: setup(), auth: 'jota:pw123' });
  const base = await listen(server);
  try {
    assert.equal((await fetch(`${base}/`)).status, 401);
    const bad = 'Basic ' + Buffer.from('jota:wrong').toString('base64');
    assert.equal((await fetch(`${base}/`, { headers: { authorization: bad } })).status, 401);
    const ok = 'Basic ' + Buffer.from('jota:pw123').toString('base64');
    assert.equal((await fetch(`${base}/`, { headers: { authorization: ok } })).status, 200);
  } finally {
    server.close();
  }
});

test('refuses a public bind without auth', () => {
  assert.throws(() => startServer({ dir: setup(), host: '0.0.0.0' }), /without --auth/);
});
