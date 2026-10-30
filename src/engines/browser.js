import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import robotsParser from 'robots-parser';
import { isPageLike, isPrivateHost, normalizeUrl, relativeLink, shortHash, urlToLocal } from '../util/paths.js';
import { rewriteCss, rewriteHtml } from '../util/rewrite.js';
import { findBrowser } from '../util/browser.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DEFAULT_UA = 'Mozilla/5.0 (compatible; sitecloner/0.1; +https://github.com/Forbahl10/sitecloner)';

export const DEFAULTS = {
  maxPages: 200,
  maxDepth: 5,
  concurrency: 3,
  delayMs: 250,
  timeoutMs: 30000,
  waitMs: 500,
  maxAssetBytes: 25 * 1024 * 1024,
  scripts: 'strip',
  includeSubdomains: false,
  respectRobots: true,
  screenshots: false,
  allowPrivate: false,
  include: [],
  exclude: []
};

/**
 * Crawl with a real (headless) browser so JavaScript-rendered pages are captured, save every
 * network response, then rewrite HTML and CSS so the copy works from any static web server.
 */
export async function cloneWithBrowser(userOptions, log = console.log) {
  const opts = { ...DEFAULTS, ...userOptions };
  const siteDir = path.join(opts.outDir, 'site');
  const workDir = path.join(opts.outDir, '.work');
  await fs.rm(opts.outDir, { recursive: true, force: true });
  await fs.mkdir(siteDir, { recursive: true });
  await fs.mkdir(path.join(workDir, 'raw'), { recursive: true });

  const startedAt = new Date().toISOString();
  const ua = opts.userAgent || DEFAULT_UA;
  const startUrl = normalizeUrl(opts.url);
  if (!startUrl) throw new Error(`Invalid URL: ${opts.url}`);

  // Resolve redirects up front (http->https, apex->www) so the "root" is the real site.
  let root = new URL(startUrl);
  try {
    const probe = await fetch(startUrl, { redirect: 'follow', headers: { 'user-agent': ua }, signal: AbortSignal.timeout(20000) });
    root = new URL(probe.url);
    await probe.body?.cancel();
  } catch (error) {
    throw new Error(`Cannot reach ${startUrl}: ${error.message}`);
  }
  const rootUrl = normalizeUrl(root.href);
  const rootOrigin = root.origin;
  const bare = (host) => host.replace(/^www\./i, '').toLowerCase();
  const rootHost = bare(root.hostname);
  const allowPrivate = opts.allowPrivate || isPrivateHost(root.hostname);

  const state = {
    assets: new Map(), // url -> { url, local, contentType, size }
    pages: new Map(), // final url -> { url, local, depth, title, status }
    pageLocal: new Map(), // any known URL (incl. redirects) -> local path
    owners: new Map(), // local path -> url
    failures: [],
    skipped: [],
    inflight: new Set()
  };

  const inScope = (url) => {
    const u = new URL(url);
    const host = bare(u.hostname);
    if (host === rootHost) return true;
    return opts.includeSubdomains && host.endsWith(`.${rootHost}`);
  };
  const blocked = (url) => {
    try {
      return !allowPrivate && isPrivateHost(new URL(url).hostname);
    } catch {
      return true;
    }
  };
  const passesFilters = (url) => {
    if (opts.include.length && !opts.include.some((re) => new RegExp(re).test(url))) return false;
    return !opts.exclude.some((re) => new RegExp(re).test(url));
  };
  const claim = (url, local) => {
    let candidate = local;
    const owner = state.owners.get(candidate);
    if (owner && owner !== url) {
      const ext = path.posix.extname(local);
      candidate = `${local.slice(0, local.length - ext.length)}~${shortHash(url)}${ext}`;
    }
    state.owners.set(candidate, url);
    return candidate;
  };
  const writeLocal = async (local, data) => {
    const target = path.resolve(siteDir, local);
    if (!target.startsWith(path.resolve(siteDir) + path.sep)) throw new Error(`Refusing path outside site dir: ${local}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  };
  const addAsset = async (url, contentType, body) => {
    const local = claim(url, urlToLocal(url, { rootOrigin, contentType, page: false }));
    await writeLocal(local, body);
    state.assets.set(url, { url, local, contentType, size: body.length });
  };

  // robots.txt
  let robots = null;
  if (opts.respectRobots) {
    try {
      const res = await fetch(`${rootOrigin}/robots.txt`, { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(15000) });
      if (res.ok) robots = robotsParser(`${rootOrigin}/robots.txt`, await res.text());
    } catch {
      /* no robots.txt */
    }
  }
  const robotsAllows = (url) => !robots || robots.isAllowed(url, ua) !== false;
  const crawlDelay = Math.max(opts.delayMs, (robots?.getCrawlDelay(ua) || 0) * 1000);
  if (!robotsAllows(rootUrl)) {
    throw new Error(`robots.txt disallows ${rootUrl}. Re-run with --ignore-robots only if you own the site or have permission.`);
  }

  // Queue, seeded with the start URL and any sitemap entries.
  const seen = new Set([rootUrl]);
  const queue = [{ url: rootUrl, depth: 0 }];
  const fileLinks = new Set();
  const enqueue = (url, depth) => {
    if (!url || seen.has(url) || !inScope(url) || blocked(url) || depth > opts.maxDepth) return;
    if (!isPageLike(url)) {
      fileLinks.add(url);
      return;
    }
    if (!passesFilters(url)) return state.skipped.push({ url, reason: 'filtered' });
    if (!robotsAllows(url)) return state.skipped.push({ url, reason: 'robots.txt' });
    if (seen.size >= opts.maxPages) return state.skipped.push({ url, reason: 'max-pages' });
    seen.add(url);
    queue.push({ url, depth });
  };
  const sitemaps = new Set([`${rootOrigin}/sitemap.xml`, ...(robots?.getSitemaps() || [])]);
  let sitemapBudget = 20;
  for (const sitemap of sitemaps) {
    if (sitemapBudget-- <= 0) break;
    try {
      const res = await fetch(sitemap, { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      for (const [, loc] of (await res.text()).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        const url = normalizeUrl(loc.replace(/&amp;/g, '&'));
        if (!url) continue;
        if (/\.xml(\.gz)?$/i.test(url)) sitemaps.add(url);
        else enqueue(url, 1);
      }
    } catch {
      /* ignore broken sitemap */
    }
  }

  const executablePath = findBrowser(opts.browserPath);
  if (!executablePath) throw new Error('No Chromium-based browser found. Install Brave/Chrome/Chromium or set SITECLONER_BROWSER.');
  const args = ['--disable-dev-shm-usage', '--mute-audio'];
  if (process.getuid?.() === 0 || opts.noSandbox) args.push('--no-sandbox');
  const browser = await puppeteer.launch({ executablePath, headless: true, args });
  log(`Browser: ${executablePath}`);
  log(`Cloning ${rootUrl} (max ${opts.maxPages} pages, depth ${opts.maxDepth}, ${opts.concurrency} parallel)`);

  async function crawlOne({ url, depth }) {
    const page = await browser.newPage();
    const pending = [];
    try {
      await page.setUserAgent(ua);
      await page.setViewport({ width: 1440, height: 900 });
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (blocked(request.url()) && /^https?:/.test(request.url())) request.abort('blockedbyclient').catch(() => {});
        else request.continue().catch(() => {});
      });
      page.on('response', (response) => pending.push(captureResponse(page, response)));

      let response = null;
      try {
        response = await page.goto(url, { waitUntil: 'networkidle2', timeout: opts.timeoutMs });
      } catch (error) {
        if (error.name !== 'TimeoutError') throw error;
        log(`  timeout (using partial render): ${url}`);
      }
      const status = response?.status() ?? 200;
      if (status >= 400) {
        state.failures.push({ url, reason: `HTTP ${status}` });
        return;
      }
      const type = (response?.headers()['content-type'] || 'text/html').toLowerCase();
      if (!type.includes('html')) {
        state.skipped.push({ url, reason: `not html (${type.split(';')[0]})` });
        fileLinks.add(url);
        return;
      }

      await page
        .evaluate(
          (limit) =>
            new Promise((resolve) => {
              const step = Math.max(300, window.innerHeight * 0.8);
              const started = Date.now();
              const timer = setInterval(() => {
                window.scrollBy(0, step);
                if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight || Date.now() - started > limit) {
                  clearInterval(timer);
                  window.scrollTo(0, 0);
                  resolve();
                }
              }, 150);
            }),
          8000
        )
        .catch(() => {});
      await sleep(opts.waitMs);
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
      await Promise.allSettled(pending);

      const finalUrl = normalizeUrl(page.url());
      if (!finalUrl || !inScope(finalUrl)) {
        state.skipped.push({ url, reason: `redirected outside scope (${page.url()})` });
        return;
      }
      const html = await page.content();
      const title = await page.title().catch(() => '');
      const links = await page.$$eval('a[href], area[href]', (els) => els.map((el) => el.href)).catch(() => []);

      let local = state.pageLocal.get(finalUrl);
      if (!local) {
        local = claim(finalUrl, urlToLocal(finalUrl, { rootOrigin, page: true }));
        state.pageLocal.set(finalUrl, local);
        await fs.writeFile(path.join(workDir, 'raw', `${shortHash(finalUrl)}.html`), html);
        state.pages.set(finalUrl, { url: finalUrl, local, depth, title, status, bytes: Buffer.byteLength(html) });
        if (opts.screenshots) {
          const shot = path.join(opts.outDir, 'screenshots', `${local.replace(/\//g, '__')}.png`);
          await fs.mkdir(path.dirname(shot), { recursive: true });
          await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        }
        log(`  [${state.pages.size}] ${finalUrl}`);
      }
      state.pageLocal.set(url, local);
      for (const hop of response?.request().redirectChain() ?? []) {
        const hopUrl = normalizeUrl(hop.url());
        if (hopUrl) state.pageLocal.set(hopUrl, local);
      }
      for (const href of links) enqueue(normalizeUrl(href), depth + 1);
    } catch (error) {
      state.failures.push({ url, reason: error.message });
      log(`  failed: ${url} (${error.message})`);
    } finally {
      await Promise.allSettled(pending);
      await page.close().catch(() => {});
    }
  }

  async function captureResponse(page, response) {
    const request = response.request();
    const url = normalizeUrl(response.url());
    if (!url || state.assets.has(url) || state.inflight.has(url)) return;
    const status = response.status();
    if (status >= 300 && status < 400) return;
    if (request.resourceType() === 'document' && request.frame() === page.mainFrame() && request.isNavigationRequest()) return;
    if (status >= 400) {
      state.failures.push({ url, reason: `HTTP ${status}` });
      return;
    }
    state.inflight.add(url);
    try {
      const body = await response.buffer();
      if (body.length > opts.maxAssetBytes) return state.skipped.push({ url, reason: 'larger than max-asset-bytes' });
      const contentType = (response.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
      await addAsset(url, contentType, body);
    } catch {
      /* body unavailable (e.g. cancelled); the second pass will try to fetch it directly */
    } finally {
      state.inflight.delete(url);
    }
  }

  // Parallel BFS.
  await new Promise((resolve) => {
    let active = 0;
    const pump = () => {
      while (active < opts.concurrency && queue.length) {
        const item = queue.shift();
        active += 1;
        crawlOne(item)
          .then(() => sleep(crawlDelay))
          .finally(() => {
            active -= 1;
            pump();
          });
      }
      if (!active && !queue.length) resolve();
    };
    pump();
  });
  await browser.close();

  // Second pass: fetch what the browser did not hand us (CSS url(), lazy images, linked files).
  const fetchAsset = async (url) => {
    if (state.assets.has(url) || blocked(url)) return;
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': ua, referer: `${rootOrigin}/`, accept: '*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) return state.failures.push({ url, reason: `HTTP ${res.status}` });
      if (blocked(res.url)) return state.skipped.push({ url, reason: 'redirected to a private address' });
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared > opts.maxAssetBytes) return state.skipped.push({ url, reason: 'larger than max-asset-bytes' });
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > opts.maxAssetBytes) return state.skipped.push({ url, reason: 'larger than max-asset-bytes' });
      await addAsset(url, (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), body);
    } catch (error) {
      state.failures.push({ url, reason: error.message });
    }
  };
  const fetchAll = async (urls) => {
    const list = [...urls].filter((u) => u && !state.assets.has(u));
    for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(fetchAsset));
  };

  const rawOf = (page) => path.join(workDir, 'raw', `${shortHash(page.url)}.html`);
  const wanted = new Set([...fileLinks].filter(inScope));
  for (const page of state.pages.values()) {
    const html = await fs.readFile(rawOf(page), 'utf8');
    rewriteHtml(html, page.url, {
      scripts: opts.scripts,
      resolve: (abs, kind) => {
        const known = state.pageLocal.get(abs) || state.assets.get(abs);
        if (!known && kind === 'asset') wanted.add(abs);
        return null;
      }
    });
  }
  await fetchAll(wanted);

  const scannedCss = new Set();
  for (let round = 0; round < 3; round += 1) {
    const more = new Set();
    for (const asset of [...state.assets.values()]) {
      if (scannedCss.has(asset.url) || !(asset.contentType === 'text/css' || asset.local.endsWith('.css'))) continue;
      scannedCss.add(asset.url);
      const css = await fs.readFile(path.join(siteDir, asset.local), 'utf8');
      rewriteCss(css, asset.url, (abs) => {
        if (!state.assets.has(abs)) more.add(abs);
        return null;
      });
    }
    if (!more.size) break;
    await fetchAll(more);
  }

  // Final rewrite.
  for (const asset of state.assets.values()) {
    if (!scannedCss.has(asset.url)) continue;
    const file = path.join(siteDir, asset.local);
    const css = await fs.readFile(file, 'utf8');
    await fs.writeFile(
      file,
      rewriteCss(css, asset.url, (abs) => {
        const target = state.assets.get(abs);
        return target ? relativeLink(asset.local, target.local) : null;
      })
    );
  }
  for (const page of state.pages.values()) {
    const html = await fs.readFile(rawOf(page), 'utf8');
    const out = rewriteHtml(html, page.url, {
      scripts: opts.scripts,
      resolve: (abs) => {
        const local = state.pageLocal.get(abs) || state.assets.get(abs)?.local;
        return local ? relativeLink(page.local, local) : null;
      }
    });
    await writeLocal(page.local, out);
  }
  await fs.rm(workDir, { recursive: true, force: true });

  const manifest = {
    tool: 'sitecloner',
    version: '0.1.0',
    startedAt,
    finishedAt: new Date().toISOString(),
    rootUrl,
    options: { ...opts, include: opts.include, exclude: opts.exclude },
    pages: [...state.pages.values()],
    assets: [...state.assets.values()].map(({ url, local, contentType, size }) => ({ url, local, contentType, size })),
    failures: dedupe(state.failures),
    skipped: dedupe(state.skipped)
  };
  await fs.writeFile(path.join(opts.outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log(`Done: ${manifest.pages.length} pages, ${manifest.assets.length} assets, ${manifest.failures.length} failures -> ${siteDir}`);
  return manifest;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((item) => {
    const key = `${item.url}|${item.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
