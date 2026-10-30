import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteCss, rewriteHtml } from '../src/util/rewrite.js';

test('css url() and @import are rewritten, data: and unknown urls are kept', () => {
  const map = { 'https://s.test/img/a.png': '../img/a.png', 'https://s.test/css/b.css': 'b.css' };
  const out = rewriteCss(`@import "b.css"; a{background:url('../img/a.png')} b{background:url(data:image/png;base64,AAA)} c{background:url(/nope.png)}`, 'https://s.test/css/main.css', (abs) => map[abs] || null);
  assert.match(out, /@import "b\.css"/);
  assert.match(out, /url\(\.\.\/img\/a\.png\)/);
  assert.match(out, /url\(data:image\/png;base64,AAA\)/);
  assert.match(out, /url\("https:\/\/s\.test\/nope\.png"\)/);
});

test('html: links, srcset, lazy attrs, style, fragment, scripts stripped, integrity removed', () => {
  const resolve = (abs) => ({ 'https://s.test/about': 'about/index.html', 'https://s.test/i.png': 'i.png', 'https://s.test/i2.png': 'i2.png', 'https://s.test/l.png': 'l.png' })[abs] || null;
  const html = `<html><head><base href="/x/"><script src="/a.js" integrity="sha"></script><script type="application/ld+json">{}</script><link rel="stylesheet" href="/s.css" integrity="x" crossorigin></head>
  <body><a href="/about#team">a</a><a href="mailto:x@y.z">m</a><img src="/i.png" srcset="/i.png 1x, /i2.png 2x" data-src="/l.png"><div style="background:url(/i.png)"></div></body></html>`;
  const out = rewriteHtml(html, 'https://s.test/', { resolve, scripts: 'strip' });
  assert.match(out, /href="about\/index\.html#team"/);
  assert.match(out, /href="mailto:x@y\.z"/);
  assert.match(out, /srcset="i\.png 1x, i2\.png 2x"/);
  assert.match(out, /data-src="l\.png"/);
  assert.match(out, /url\(i\.png\)/);
  assert.doesNotMatch(out, /<base/);
  assert.doesNotMatch(out, /src="\/a\.js"/);
  assert.match(out, /application\/ld\+json/);
  assert.doesNotMatch(out, /integrity/);
  assert.match(out, /<meta charset="utf-8">/);
});
