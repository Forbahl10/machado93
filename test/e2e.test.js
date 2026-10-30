import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cloneWithBrowser } from '../src/engines/browser.js';
import { buildReport } from '../src/report.js';
import { createServer } from '../src/serve.js';
import { findBrowser } from '../src/util/browser.js';
import { startFixture } from './fixture.js';

const skip = findBrowser() ? false : 'no Chromium-based browser available';

test('clones a JS-rendered site, rewrites everything, obeys robots.txt with --respect-robots, and the copy works offline', { skip, timeout: 120000 }, async () => {
  const fixture = await startFixture();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-e2e-'));
  try {
    const manifest = await cloneWithBrowser({ url: `http://127.0.0.1:${fixture.port}/`, outDir, delayMs: 0, maxDepth: 3, noSandbox: true, respectRobots: true }, () => {});
    const site = path.join(outDir, 'site');
    const read = (p) => fs.readFileSync(path.join(site, p), 'utf8');

    assert.deepEqual(manifest.pages.map((p) => p.local).sort(), ['about/index.html', 'blog/index.html', 'blog/post-1/index.html', 'index.html']);
    assert.equal(fixture.requested.includes('/private-area'), false, 'robots.txt must be obeyed');

    const home = read('index.html');
    assert.match(home, /Rendered by JavaScript/);       // DOM captured after JS ran
    assert.doesNotMatch(home, /<script src/);           // scripts stripped by default
    assert.match(home, /href="about\/index\.html"/);
    assert.match(home, /href="blog\/index\.html"/);
    assert.match(home, /href="http:\/\/127\.0\.0\.1:\d+\/private-area"/); // never crawled: points at the original, not at a 404 on the clone
    assert.match(home, /href="https:\/\/example\.org\/ext"/);
    assert.match(home, /data-src="img\/lazy\.png"/);
    assert.match(home, /srcset="img\/hero\.png 1x, img\/hero2\.png 2x"/);
    assert.match(home, /href="files\/doc\.txt"/);

    const css = read('css/main.css');
    assert.match(css, /url\(\.\.\/img\/bg\.png\)/);
    assert.match(css, /url\(\.\.\/fonts\/fx\.woff2\)/);
    assert.match(css, /@import url\(extra\.css\)/);
    assert.match(read('css/extra.css'), /url\(\.\.\/img\/extra\.png\)/);
    assert.match(read('blog/post-1/index.html'), /url\(\.\.\/\.\.\/img\/bg\.png\)/);
    assert.match(read('blog/index.html'), /href="\.\.\/about\/index\.html#team"/);

    for (const f of ['img/hero.png', 'img/hero2.png', 'img/lazy.png', 'img/bg.png', 'img/extra.png', 'fonts/fx.woff2', 'files/doc.txt']) {
      assert.equal(fs.existsSync(path.join(site, f)), true, `${f} should be saved`);
    }

    // The copy must be fully self-contained: serve it and fetch the page + a rewritten asset.
    const server = createServer({ dir: outDir });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      assert.equal((await fetch(`${base}/css/main.css`)).status, 200);
      assert.equal((await fetch(`${base}/blog/`)).status, 200);
    } finally {
      server.close();
    }

    const { summary } = await buildReport(outDir);
    assert.equal(summary.pages, 4);
  } finally {
    await fixture.close();
  }
});

test('robots.txt is not enforced by default', { skip, timeout: 120000 }, async () => {
  const fixture = await startFixture();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-e2e-open-'));
  try {
    const manifest = await cloneWithBrowser({ url: `http://127.0.0.1:${fixture.port}/`, outDir, delayMs: 0, maxDepth: 2, noSandbox: true }, () => {});
    assert.equal(fixture.requested.includes('/private-area'), true);
    assert.equal(manifest.pages.some((p) => p.local === 'private-area/index.html'), true);
  } finally {
    await fixture.close();
  }
});
