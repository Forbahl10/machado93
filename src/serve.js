import http from 'node:http';
import fs from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.pdf': 'application/pdf'
};

const digest = (value) => createHash('sha256').update(value).digest();

/** Picks the folder to serve: <dir>/site, <dir>/browser/site, or <dir> itself. */
export function resolveSiteDir(dir) {
  for (const candidate of [path.join(dir, 'site'), path.join(dir, 'browser', 'site'), dir]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return path.resolve(candidate);
  }
  throw new Error(`Directory not found: ${dir}`);
}

export function createServer({ dir, auth = null }) {
  const root = resolveSiteDir(dir);
  const expected = auth ? digest(auth) : null;

  return http.createServer((req, res) => {
    const headers = {
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-cache'
    };
    const send = (status, body, extra = {}) => {
      res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8', ...extra });
      res.end(body);
    };

    if (expected) {
      const header = req.headers.authorization || '';
      const given = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString('utf8') : '';
      if (!timingSafeEqual(digest(given), expected)) {
        return send(401, 'Authentication required', { 'WWW-Authenticate': 'Basic realm="sitecloner", charset="UTF-8"' });
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed', { Allow: 'GET, HEAD' });

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return send(400, 'Bad request');
    }
    if (pathname.includes('\0')) return send(400, 'Bad request');

    let target = path.resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(root + path.sep)) return send(403, 'Forbidden');
    try {
      if (fs.statSync(target).isDirectory()) {
        if (!pathname.endsWith('/')) return send(301, '', { Location: `${pathname}/` });
        target = path.join(target, 'index.html');
      }
      const stat = fs.statSync(target);
      res.writeHead(200, {
        ...headers,
        'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(target).pipe(res);
    } catch {
      send(404, 'Not found');
    }
  });
}

export function startServer({ dir, port = 8080, host = '127.0.0.1', auth = null, allowPublic = false }) {
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (!loopback && !auth && !allowPublic) {
    throw new Error('Refusing to listen on a public address without --auth user:password (or --allow-public).');
  }
  const server = createServer({ dir, auth });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
