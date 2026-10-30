import fs from 'node:fs/promises';
import path from 'node:path';

const fmt = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);

/** Reads manifest.json (in dir, dir/browser, ...) and writes a Markdown report next to it. */
export async function buildReport(dir) {
  let manifestPath = null;
  for (const candidate of [path.join(dir, 'manifest.json'), path.join(dir, 'browser', 'manifest.json')]) {
    try {
      await fs.access(candidate);
      manifestPath = candidate;
      break;
    } catch {
      /* try next */
    }
  }
  if (!manifestPath) throw new Error(`manifest.json not found under ${dir}`);
  const m = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

  const totalBytes = m.assets.reduce((sum, a) => sum + a.size, 0) + m.pages.reduce((sum, p) => sum + p.bytes, 0);
  const byType = {};
  for (const a of m.assets) byType[a.contentType || 'unknown'] = (byType[a.contentType || 'unknown'] || 0) + 1;

  const lines = [
    `# Clone report: ${m.rootUrl}`,
    '',
    `- Started: ${m.startedAt}`,
    `- Finished: ${m.finishedAt}`,
    `- Pages: **${m.pages.length}** | Assets: **${m.assets.length}** | Size: **${fmt(totalBytes)}**`,
    `- Failures: **${m.failures.length}** | Skipped: **${m.skipped.length}**`,
    `- JavaScript in copy: \`${m.options.scripts}\``,
    '',
    '## Pages',
    '',
    '| Depth | URL | Local file | Title |',
    '|---|---|---|---|',
    ...m.pages.map((p) => `| ${p.depth} | ${p.url} | \`${p.local}\` | ${(p.title || '').replace(/\|/g, '\\|')} |`),
    '',
    '## Assets by type',
    '',
    ...Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([type, n]) => `- ${type}: ${n}`),
    '',
    '## Failures',
    '',
    ...(m.failures.length ? m.failures.map((f) => `- ${f.url} — ${f.reason}`) : ['None.']),
    '',
    '## Skipped (not copied)',
    '',
    ...(m.skipped.length ? m.skipped.map((s) => `- ${s.url} — ${s.reason}`) : ['None.']),
    ''
  ];
  const out = path.join(path.dirname(manifestPath), 'REPORT.md');
  await fs.writeFile(out, lines.join('\n'));
  return { out, summary: { pages: m.pages.length, assets: m.assets.length, failures: m.failures.length, skipped: m.skipped.length, bytes: totalBytes } };
}
