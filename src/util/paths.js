import { createHash } from 'node:crypto';
import path from 'node:path';

const HTML_EXT = new Set(['.html', '.htm']);
const PAGE_EXT = new Set(['.html', '.htm', '.shtml', '.php', '.asp', '.aspx', '.jsp', '.cfm']);

const MIME_EXT = {
  'text/html': '.html',
  'text/css': '.css',
  'text/javascript': '.js',
  'application/javascript': '.js',
  'application/x-javascript': '.js',
  'application/json': '.json',
  'application/manifest+json': '.webmanifest',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'text/plain': '.txt',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'font/woff': '.woff',
  'font/woff2': '.woff2',
  'font/ttf': '.ttf',
  'font/otf': '.otf',
  'application/font-woff': '.woff',
  'application/font-woff2': '.woff2',
  'application/vnd.ms-fontobject': '.eot',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'application/pdf': '.pdf'
};

export function shortHash(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 8);
}

/** Absolute http(s) URL without fragment, or null. */
export function normalizeUrl(raw, base) {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

/** True when the URL looks like an HTML document rather than a file (pdf, zip, png...). */
export function isPageLike(url) {
  const ext = path.posix.extname(new URL(url).pathname).toLowerCase();
  return ext === '' || PAGE_EXT.has(ext);
}

function safeSegment(segment) {
  let s;
  try {
    s = decodeURIComponent(segment);
  } catch {
    s = segment;
  }
  s = s.normalize('NFC').replace(/[^\p{L}\p{N}._~@+=-]/gu, '_');
  if (/^\.+$/.test(s)) s = '_';
  if (s.length > 100) s = `${s.slice(0, 80)}~${shortHash(s)}${path.extname(s).slice(0, 10)}`;
  return s;
}

function withSuffix(name, suffix) {
  if (!suffix) return name;
  const ext = path.posix.extname(name);
  return `${name.slice(0, name.length - ext.length)}${suffix}${ext}`;
}

/**
 * Deterministic URL -> relative POSIX file path inside the cloned site.
 * Same-origin URLs live at the root, everything else under _external/<host>/.
 * Pages become <path>/index.html so that extension-less links keep working.
 */
export function urlToLocal(rawUrl, { rootOrigin, contentType = '', page = false } = {}) {
  const u = new URL(rawUrl);
  const prefix = u.origin === rootOrigin ? [] : ['_external', u.host.replace(/[^A-Za-z0-9.-]/g, '_')];
  const segments = u.pathname.split('/').filter(Boolean).map(safeSegment);
  const trailing = u.pathname.endsWith('/') || segments.length === 0;
  const query = u.search ? `~q${shortHash(u.search)}` : '';

  let dirs;
  let name;
  if (page) {
    const last = segments[segments.length - 1] || '';
    const ext = path.posix.extname(last).toLowerCase();
    if (trailing) {
      dirs = segments;
      name = withSuffix('index.html', query);
    } else if (HTML_EXT.has(ext)) {
      dirs = segments.slice(0, -1);
      name = withSuffix(last, query);
    } else {
      dirs = [...segments.slice(0, -1), withSuffix(last, query)];
      name = 'index.html';
    }
  } else {
    const mimeExt = MIME_EXT[contentType.split(';')[0].trim().toLowerCase()] || '';
    dirs = trailing ? segments : segments.slice(0, -1);
    let last = trailing ? 'index' : segments[segments.length - 1];
    if (!path.posix.extname(last)) last += mimeExt || '.bin';
    name = withSuffix(last, query);
  }
  return [...prefix, ...dirs, name].join('/');
}

/** Relative URL (as written inside HTML/CSS) from one local file to another. */
export function relativeLink(fromLocal, toLocal) {
  const rel = path.posix.relative(path.posix.dirname(fromLocal), toLocal) || path.posix.basename(toLocal);
  return rel
    .split('/')
    .map((part) => (part === '..' || part === '.' ? part : encodeURIComponent(part)))
    .join('/');
}

const PRIVATE_V4 = [/^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./];

/** Literal-host check only (no DNS). Used to keep a crawl from reaching internal services. */
export function isPrivateHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (PRIVATE_V4.some((re) => re.test(h))) return true;
  return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
}
