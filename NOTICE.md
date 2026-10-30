# Third-party tools and credits

machado93's own code is original and MIT-licensed. It does **not** copy source code from the projects
below. It borrows their ideas, and optionally runs them as separate programs that you install yourself.
Because they are executed as external processes (not linked or bundled), their licenses do not apply to this repository.

| Project | What machado93 takes from it | License | How it is used |
|---|---|---|---|
| [HTTrack](https://github.com/xroche/httrack) | Mirroring model: relative-link rewriting, robots handling, stay-on-site scope | GPL-3.0 | Optional engine `httrack` (external binary) |
| [SingleFile](https://github.com/gildas-lormeau/SingleFile) | Self-contained single-file pages; lazy-content handling | AGPL-3.0 | Optional engine `singlefile` (`single-file-cli`) |
| [Browsertrix Crawler](https://github.com/webrecorder/browsertrix-crawler) | Browser-based capture through CDP, auto-scroll, WACZ archives | AGPL-3.0 | Optional engine `browsertrix` (Docker image) |
| [website-scraper-puppeteer](https://github.com/website-scraper/website-scraper-puppeteer) | Idea of saving a JS-rendered DOM as a hostable folder | MIT | Inspiration only |
| [ArchiveBox](https://github.com/ArchiveBox/ArchiveBox) | Idea of several capture methods per URL plus a report | MIT | Inspiration only |

Runtime dependencies from npm: `puppeteer-core` (Apache-2.0), `cheerio` (MIT), `robots-parser` (MIT).
