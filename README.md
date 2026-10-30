# machado93

Clone every page of a website **you own or are authorized to copy**, then host the copy on your own machine or VPS to see how it looks.

*Português: veja [README.pt-BR.md](README.pt-BR.md).*

Most cloners do one thing well. `machado93` combines the useful ideas of the best ones in a single command:

| You need | Engine | Inspired by |
|---|---|---|
| A **hostable folder** of a modern, JavaScript-rendered site (default) | `browser` (built in) | website-scraper-puppeteer, Browsertrix |
| A fast mirror of a classic server-rendered site | `httrack` (optional) | [HTTrack](https://github.com/xroche/httrack) |
| One **self-contained .html** per page | `singlefile` (optional) | [SingleFile](https://github.com/gildas-lormeau/SingleFile) |
| A **WARC/WACZ web archive** for preservation | `browsertrix` (optional, Docker) | [Browsertrix Crawler](https://github.com/webrecorder/browsertrix-crawler) |

Run one or several in the same pass, then `serve` the result behind a password.

> **robots.txt:** the built-in `browser` engine and `httrack` (`-s2`) obey it. The `singlefile` engine does **not** read `robots.txt`, and Browsertrix has its own scope rules, so use those two only on sites you own or have permission to copy.

## Quick start

```bash
npm install                      # Node >= 20; needs Brave, Chrome or Chromium installed
node bin/machado93.js doctor    # checks your browser and optional engines

node bin/machado93.js clone https://your-site.example --max-pages 100
node bin/machado93.js serve clones/your-site.example-...   # http://127.0.0.1:8080
node bin/machado93.js report clones/your-site.example-...  # REPORT.md
```

Install globally with `npm link` to get the `machado93` command.

### Several engines at once

```bash
machado93 clone https://your-site.example --engines browser,httrack,singlefile
```

Each engine writes to its own folder (`browser/`, `httrack/`, `singlefile/`) so you can compare results.

## What the built-in `browser` engine does

1. Resolves redirects (http→https, apex→www) and reads `robots.txt` and `sitemap.xml`.
2. Opens each page in a headless browser, **runs the JavaScript**, auto-scrolls to trigger lazy loading, and records every network response (CSS, JS, images, fonts, ...).
3. Crawls same-site links breadth-first, in parallel, with a politeness delay.
4. Fetches anything the browser did not hand over (CSS `url()` / `@import` chains, lazy images, linked files).
5. Rewrites HTML, `srcset`, lazy `data-*` attributes, inline styles and CSS so that the copy works from any static web server or even `file://`.
   Links to pages that were **not** copied point back to the original site instead of a 404.
6. Writes `manifest.json` (pages, assets, failures, skipped) and an optional `REPORT.md` / screenshots.

### Options

```
--max-pages 200   --max-depth 5   --concurrency 3   --delay 250
--scripts strip|keep       strip (default) = static snapshot of the rendered page; keep = keep the site's JS
--include-subdomains       --include <regex>   --exclude <regex>
--screenshots              --browser <path>    --ignore-robots (only for your own sites)
```

### Known limitations (v0.1)

- Pages behind a login, and sites that need cookies or headers, are not supported yet.
- With `--scripts keep`, JavaScript that calls the original site's APIs will still call them; with the default `strip`, interactive widgets (menus, carousels) are frozen in their rendered state.
- URLs written inside JavaScript files are not rewritten. Content in `<iframe>` documents is saved but its inner links are not rewritten.
- Very large sites: use `--max-pages` and `--include` to bound the crawl.

## Hosting on a VPS

```bash
# on the VPS
node bin/machado93.js serve /srv/clones/current --host 127.0.0.1 --port 8080 --auth jota:strong-password
```

Put Caddy or nginx in front for HTTPS: see [`deploy/`](deploy) (`Caddyfile.example`, `nginx.conf.example`, `machado93-serve.service`).
The server refuses a public bind without `--auth`, blocks path traversal, and sends `X-Robots-Tag: noindex`.
Basic auth is not encrypted on its own, so use HTTPS for anything beyond localhost.

## Responsible use

Only clone sites you own or have permission to copy, respect `robots.txt` (default) and each site's terms, and never use a clone to impersonate another site or collect credentials. See [SECURITY.md](SECURITY.md).

## Development

```bash
npm test      # unit tests + an end-to-end test against a local JS-rendered fixture site
```

## License

MIT. Credits and third-party licenses: [NOTICE.md](NOTICE.md).
