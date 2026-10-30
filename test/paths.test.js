import test from 'node:test';
import assert from 'node:assert/strict';
import { isPageLike, isPrivateHost, normalizeUrl, relativeLink, urlToLocal } from '../src/util/paths.js';

const root = 'https://site.test';

test('pages map to index.html files', () => {
  assert.equal(urlToLocal('https://site.test/', { rootOrigin: root, page: true }), 'index.html');
  assert.equal(urlToLocal('https://site.test/about', { rootOrigin: root, page: true }), 'about/index.html');
  assert.equal(urlToLocal('https://site.test/blog/', { rootOrigin: root, page: true }), 'blog/index.html');
  assert.equal(urlToLocal('https://site.test/a/b.html', { rootOrigin: root, page: true }), 'a/b.html');
  assert.equal(urlToLocal('https://site.test/p.php?id=2', { rootOrigin: root, page: true }).startsWith('p~q'), true);
});

test('assets keep extension, get one from content-type, and external hosts are namespaced', () => {
  assert.equal(urlToLocal('https://site.test/css/a.css', { rootOrigin: root }), 'css/a.css');
  assert.equal(urlToLocal('https://site.test/img', { rootOrigin: root, contentType: 'image/png' }), 'img.png');
  assert.equal(urlToLocal('https://cdn.test/x/y.js', { rootOrigin: root }), '_external/cdn.test/x/y.js');
  assert.notEqual(urlToLocal('https://site.test/a.js?v=1', { rootOrigin: root }), urlToLocal('https://site.test/a.js?v=2', { rootOrigin: root }));
});

test('hostile paths can never escape the site folder', () => {
  const local = urlToLocal('https://site.test/..%2F..%2Fetc/passwd/../..', { rootOrigin: root, page: true });
  assert.equal(local.split('/').includes('..'), false);
  assert.equal(local.startsWith('/'), false);
});

test('relative links', () => {
  assert.equal(relativeLink('blog/post/index.html', 'css/a.css'), '../../css/a.css');
  assert.equal(relativeLink('index.html', 'about/index.html'), 'about/index.html');
});

test('helpers', () => {
  assert.equal(normalizeUrl('/x#y', 'https://site.test/a'), 'https://site.test/x');
  assert.equal(normalizeUrl('mailto:a@b.c'), null);
  assert.equal(isPageLike('https://site.test/doc.pdf'), false);
  assert.equal(isPageLike('https://site.test/about'), true);
  for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.2', '169.254.169.254', '172.20.0.1', '[::1]']) assert.equal(isPrivateHost(h), true, h);
  for (const h of ['example.com', '8.8.8.8', '172.32.0.1']) assert.equal(isPrivateHost(h), false, h);
});
