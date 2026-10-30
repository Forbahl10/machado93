import { parseArgs } from 'node:util';
import path from 'node:path';
import { cloneWithBrowser, DEFAULTS } from './engines/browser.js';
import { cloneWithBrowsertrix, cloneWithHttrack, cloneWithSingleFile } from './engines/external.js';
import { buildReport } from './report.js';
import { resolveSiteDir, startServer } from './serve.js';
import { findBrowser, findTool } from './util/browser.js';

const HELP = `machado93 - clone every page of a website, then host the copy locally.

Usage
  machado93 clone <url> [options]     crawl + save a site
  machado93 serve <dir> [options]     host a clone (password protected, not indexed)
  machado93 report <dir>              write REPORT.md for a clone
  machado93 doctor                    check browser and optional engines

clone options
  --out <dir>             output folder (default: ./clones/<host>-<timestamp>)
  --engines <list>        browser,httrack,singlefile,browsertrix (default: browser)
  --max-pages <n>         default ${DEFAULTS.maxPages}
  --max-depth <n>         default ${DEFAULTS.maxDepth}
  --concurrency <n>       parallel pages, default ${DEFAULTS.concurrency}
  --delay <ms>            pause between pages, default ${DEFAULTS.delayMs}
  --scripts <strip|keep>  strip = static snapshot of the rendered page (default); keep = keep the site's JS
  --include-subdomains    also crawl subdomains of the site
  --include <regex>       only crawl matching URLs (repeatable)
  --exclude <regex>       skip matching URLs (repeatable)
  --screenshots           save a full-page screenshot of every page
  --browser <path>        Chromium/Brave/Chrome executable (or set MACHADO93_BROWSER)
  --respect-robots        obey robots.txt (off by default)
  --allow-private         allow requests to private/loopback addresses (auto-enabled if the target is private)

serve options
  --port <n>              default 8080
  --host <addr>           default 127.0.0.1
  --auth <user:password>  HTTP basic auth (required when --host is not loopback)
  --allow-public          allow a public bind without auth (not recommended)
`;

const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);

export async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') return console.log(HELP);

  if (command === 'clone') {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        out: { type: 'string' }, engines: { type: 'string', default: 'browser' },
        'max-pages': { type: 'string' }, 'max-depth': { type: 'string' }, concurrency: { type: 'string' },
        delay: { type: 'string' }, scripts: { type: 'string' }, 'include-subdomains': { type: 'boolean' },
        include: { type: 'string', multiple: true }, exclude: { type: 'string', multiple: true },
        screenshots: { type: 'boolean' }, browser: { type: 'string' }, 'respect-robots': { type: 'boolean' }, 'ignore-robots': { type: 'boolean' },
        'allow-private': { type: 'boolean' }, 'no-sandbox': { type: 'boolean' }
      }
    });
    const url = positionals[0];
    if (!url) throw new Error('Missing URL. Example: machado93 clone https://example.com');
    if (values.scripts && !['strip', 'keep'].includes(values.scripts)) throw new Error('--scripts must be strip or keep');
    const host = new URL(url).hostname.replace(/[^A-Za-z0-9.-]/g, '_');
    const base = path.resolve(values.out || path.join('clones', `${host}-${new Date().toISOString().replace(/[:.]/g, '-')}`));
    const num = (v, d) => (v === undefined ? d : Number(v));
    const options = {
      url,
      browserPath: values.browser,
      maxPages: num(values['max-pages'], DEFAULTS.maxPages),
      maxDepth: num(values['max-depth'], DEFAULTS.maxDepth),
      concurrency: num(values.concurrency, DEFAULTS.concurrency),
      delayMs: num(values.delay, DEFAULTS.delayMs),
      scripts: values.scripts || DEFAULTS.scripts,
      includeSubdomains: !!values['include-subdomains'],
      include: arr(values.include),
      exclude: arr(values.exclude),
      screenshots: !!values.screenshots,
      respectRobots: !!values['respect-robots'] && !values['ignore-robots'],
      allowPrivate: !!values['allow-private'],
      noSandbox: !!values['no-sandbox']
    };
    const engines = values.engines.split(',').map((e) => e.trim()).filter(Boolean);
    const runners = { browser: cloneWithBrowser, httrack: cloneWithHttrack, singlefile: cloneWithSingleFile, browsertrix: cloneWithBrowsertrix };
    let failed = 0;
    for (const engine of engines) {
      if (!runners[engine]) throw new Error(`Unknown engine "${engine}". Use: ${Object.keys(runners).join(', ')}`);
      console.log(`\n== engine: ${engine} ==`);
      try {
        await runners[engine]({ ...options, outDir: path.join(base, engine) }, console.log);
      } catch (error) {
        failed += 1;
        console.error(`Engine ${engine} failed: ${error.message}`);
      }
    }
    console.log(`\nOutput: ${base}`);
    console.log(`View it:  machado93 serve ${JSON.stringify(base)}`);
    if (failed === engines.length) process.exitCode = 1;
    return;
  }

  if (command === 'serve') {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { port: { type: 'string' }, host: { type: 'string' }, auth: { type: 'string' }, 'allow-public': { type: 'boolean' } }
    });
    if (!positionals[0]) throw new Error('Missing directory. Example: machado93 serve ./clones/example.com-...');
    if (values.auth && !values.auth.includes(':')) throw new Error('--auth must look like user:password');
    const host = values.host || '127.0.0.1';
    const port = Number(values.port || 8080);
    await startServer({ dir: positionals[0], port, host, auth: values.auth || null, allowPublic: !!values['allow-public'] });
    console.log(`Serving ${resolveSiteDir(positionals[0])}\n  http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/${values.auth ? '  (basic auth enabled)' : ''}`);
    return;
  }

  if (command === 'report') {
    if (!rest[0]) throw new Error('Missing directory.');
    const { out, summary } = await buildReport(rest[0]);
    console.log(`Report: ${out}\n${JSON.stringify(summary)}`);
    return;
  }

  if (command === 'doctor') {
    const show = (name, value, hint) => console.log(`${value ? 'ok     ' : 'missing'} ${name}${value ? `  ${value}` : `  -> ${hint}`}`);
    console.log(`node    ${process.version}`);
    show('browser (required for engine "browser")', findBrowser(), 'install Brave/Chrome/Chromium or set MACHADO93_BROWSER');
    show('httrack (optional)', findTool('httrack'), 'https://www.httrack.com/');
    show('single-file (optional)', findTool('single-file'), 'npm install -g single-file-cli');
    show('docker (optional, for browsertrix)', findTool('docker'), 'https://docs.docker.com/get-docker/');
    return;
  }

  throw new Error(`Unknown command "${command}". Run: machado93 help`);
}
