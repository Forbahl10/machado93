import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { findBrowser, findTool } from '../util/browser.js';

function run(command, args, { log, cwd } = {}) {
  return new Promise((resolve, reject) => {
    log?.(`$ ${[command, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const keep = (chunk) => {
      tail = (tail + chunk.toString()).slice(-4000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(tail) : reject(new Error(`${path.basename(command)} exited with ${code}\n${tail}`))));
  });
}

/** HTTrack: fast, mature, great for classic server-rendered sites (does not run JavaScript). */
export async function cloneWithHttrack(opts, log = console.log) {
  const bin = findTool('httrack');
  if (!bin) throw new Error('httrack not found. Install it from https://www.httrack.com/ (macOS: HTTrack.app) and put `httrack` on PATH.');
  await fs.mkdir(opts.outDir, { recursive: true });
  const args = [opts.url, '-O', opts.outDir, `-r${opts.maxDepth ?? 5}`, `-c${opts.concurrency ?? 4}`, opts.respectRobots === false ? '-s0' : '-s2', '-a', '-q'];
  await run(bin, args, { log });
  return { engine: 'httrack', outDir: opts.outDir };
}

/** SingleFile: every page becomes one self-contained .html (assets inlined). Uses its own crawler. */
export async function cloneWithSingleFile(opts, log = console.log) {
  const bin = findTool('single-file');
  if (!bin) throw new Error('single-file not found. Run: npm install -g single-file-cli');
  const browser = findBrowser(opts.browserPath);
  if (!browser) throw new Error('No Chromium-based browser found for SingleFile.');
  await fs.mkdir(opts.outDir, { recursive: true });
  const browserArgs = ['--mute-audio'];
  if (process.getuid?.() === 0 || opts.noSandbox) browserArgs.push('--no-sandbox');
  const args = [
    opts.url,
    '--output-directory', opts.outDir,
    '--browser-executable-path', browser,
    '--browser-args', JSON.stringify(browserArgs),
    '--crawl-links', 'true',
    '--crawl-inner-links-only', 'true',
    '--crawl-max-depth', String(opts.maxDepth ?? 3),
    '--crawl-replace-urls', 'true',
    '--filename-template', '{url-pathname-flat}.{filename-extension}'
  ];
  await run(bin, args, { log });
  return { engine: 'singlefile', outDir: opts.outDir };
}

/** Browsertrix Crawler: WARC/WACZ web archive (needs Docker). Open the .wacz with https://replayweb.page */
export async function cloneWithBrowsertrix(opts, log = console.log) {
  const docker = findTool('docker');
  if (!docker) throw new Error('docker not found. Browsertrix Crawler runs only inside Docker: https://docs.docker.com/get-docker/');
  const crawls = path.resolve(opts.outDir);
  await fs.mkdir(crawls, { recursive: true });
  const args = [
    'run', '--rm', '-v', `${crawls}:/crawls`, 'webrecorder/browsertrix-crawler', 'crawl',
    '--url', opts.url, '--generateWACZ', '--collection', 'machado93',
    '--scopeType', opts.includeSubdomains ? 'domain' : 'prefix',
    '--limit', String(opts.maxPages ?? 200), '--workers', String(Math.min(opts.concurrency ?? 2, 4))
  ];
  await run(docker, args, { log });
  return { engine: 'browsertrix', outDir: opts.outDir };
}
