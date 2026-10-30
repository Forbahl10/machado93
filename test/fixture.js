import http from 'node:http';

// 1x1 transparent PNG
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const pages = {
  '/': `<!doctype html><html><head><title>Home</title><link rel="stylesheet" href="/css/main.css"><script src="/js/app.js" defer></script></head>
<body><h1>Home</h1><div id="app"></div><img data-src="/img/lazy.png" src="/img/hero.png" srcset="/img/hero.png 1x, /img/hero2.png 2x">
<a href="/about">About</a> <a href="/blog/">Blog</a> <a href="/files/doc.txt">Doc</a> <a href="/private-area">Hidden</a> <a href="https://example.org/ext">External</a></body></html>`,
  '/about': `<!doctype html><html><head><title>About</title><link rel="stylesheet" href="/css/main.css"></head><body><h1>About</h1><a href="/">Home</a><a href="/blog/post-1">Post</a></body></html>`,
  '/blog/': `<!doctype html><html><head><title>Blog</title><link rel="stylesheet" href="../css/main.css"></head><body><h1>Blog</h1><a href="post-1">Post 1</a><a href="/about#team">Team</a></body></html>`,
  '/blog/post-1': `<!doctype html><html><head><title>Post 1</title></head><body><h1>Post 1</h1><p style="background:url('/img/bg.png')">Hello</p></body></html>`,
  '/private-area': `<!doctype html><html><head><title>Private</title></head><body>should never be crawled</body></html>`
};

export function startFixture() {
  const requested = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x').pathname;
    requested.push(url);
    const send = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };
    if (pages[url]) return send(200, 'text/html; charset=utf-8', pages[url]);
    if (url === '/robots.txt') return send(200, 'text/plain', 'User-agent: *\nDisallow: /private-area\n');
    if (url === '/css/main.css') return send(200, 'text/css', "@import url('/css/extra.css');\nbody{font-family:'Fx',sans-serif;background:url(../img/bg.png)}\n@font-face{font-family:'Fx';src:url('/fonts/fx.woff2') format('woff2')}");
    if (url === '/css/extra.css') return send(200, 'text/css', '.extra{background:url("/img/extra.png")}');
    if (url === '/js/app.js') return send(200, 'text/javascript', "document.getElementById('app').textContent='Rendered by JavaScript';document.title='Home (js)';");
    if (url.startsWith('/img/') && url.endsWith('.png')) return send(200, 'image/png', PNG);
    if (url === '/fonts/fx.woff2') return send(200, 'font/woff2', Buffer.from('wOF2fake'));
    if (url === '/files/doc.txt') return send(200, 'text/plain', 'a linked file');
    send(404, 'text/plain', 'nope');
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, requested, close: () => new Promise((r) => server.close(r)) }))
  );
}
