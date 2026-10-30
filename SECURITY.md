# Security notes

## Reporting
Open a private security advisory on GitHub (Security tab -> Report a vulnerability).

## Threat model
sitecloner drives a real browser against **untrusted websites**. Treat every crawl as running hostile code.

- Run crawls on a dedicated, unprivileged user, ideally in a container or throw-away VPS. Do not run as root
  (if you must, the tool adds `--no-sandbox`, which weakens browser isolation).
- Requests to loopback, private (RFC1918), link-local (cloud metadata `169.254.x.x`) and `*.local` hosts are **blocked by default**,
  both in the browser and in the asset downloader. This checks literal hostnames only; a public DNS name that resolves to a
  private address is not caught. Use network egress rules on the host for real isolation.
- `sitecloner serve` binds to `127.0.0.1`, refuses a public bind without `--auth`, uses a timing-safe credential check,
  blocks path traversal, only answers GET/HEAD and sends `X-Robots-Tag: noindex`. Basic auth is not encrypted:
  put it behind HTTPS (see `deploy/Caddyfile.example`).
- Default `--scripts strip` removes the site's JavaScript from the copy, which also removes most active content.
  With `--scripts keep`, the clone runs the original site's scripts: only host that on a private, authenticated address.
- Cloned pages can contain forms, trackers and third-party embeds. Review before sharing a clone with anyone.

## Responsible use
Only copy sites you own or have permission to copy, and obey `robots.txt` (default). Do not use clones to impersonate
another site or collect credentials.
