import * as cheerio from 'cheerio';
import { isPageLike, normalizeUrl } from './paths.js';

const SKIP = /^(#|javascript:|mailto:|tel:|data:|blob:|about:|sms:|\{\{)/i;

// [selector tag, attribute]
const URL_ATTRS = [
  ['a', 'href'], ['area', 'href'], ['link', 'href'], ['script', 'src'], ['img', 'src'],
  ['source', 'src'], ['video', 'src'], ['video', 'poster'], ['audio', 'src'], ['track', 'src'],
  ['embed', 'src'], ['object', 'data'], ['input', 'src'], ['iframe', 'src'], ['frame', 'src'],
  ['image', 'href'], ['image', 'xlink:href'], ['use', 'href'], ['use', 'xlink:href']
];
const LAZY_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-bg', 'data-background-image', 'data-poster'];
const SRCSET_ATTRS = ['srcset', 'data-srcset'];
const LINK_RELS_TO_LEAVE = /(canonical|alternate|next|prev|author|preconnect|dns-prefetch|prefetch|search|me|pingback)/i;

/** Rewrites url(...) and @import in CSS. `resolve(absUrl)` returns a replacement or null to keep it. */
export function rewriteCss(css, baseUrl, resolve) {
  return css.replace(
    /@import\s+(["'])([^"']+)\1|url\(\s*(["']?)([^"')]*?)\3\s*\)/gi,
    (match, importQuote, importUrl, urlQuote, urlValue) => {
      const raw = (importUrl ?? urlValue ?? '').trim();
      if (!raw || SKIP.test(raw)) return match;
      const abs = normalizeUrl(raw, baseUrl);
      if (!abs) return match;
      // Not copied locally? Point at the original absolute URL so it never resolves against the clone host.
      const replacement = resolve(abs) || abs;
      if (importUrl !== undefined) return `@import "${replacement}"`;
      return /^[\w.~\/%@+=-]+$/.test(replacement) ? `url(${replacement})` : `url("${replacement}")`;
    }
  );
}

function splitSrcset(value) {
  return value
    .split(/,\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url, ...descriptor] = part.split(/\s+/);
      return { url, descriptor: descriptor.join(' ') };
    });
}

/**
 * Rewrites a rendered HTML document so it works from the local copy.
 * `resolve(absUrl, kind)` returns a relative URL or null (keep original). kind: 'page' | 'asset'.
 */
export function rewriteHtml(html, pageUrl, { resolve, scripts = 'strip' } = {}) {
  const $ = cheerio.load(html);

  $('base').remove();
  $('meta[http-equiv="Content-Security-Policy" i]').remove();
  $('[integrity]').removeAttr('integrity');
  $('[crossorigin]').removeAttr('crossorigin');
  $('[nonce]').removeAttr('nonce');

  if (scripts === 'strip') {
    $('script').each((_, el) => {
      const type = ($(el).attr('type') || '').toLowerCase();
      if (!type.includes('json')) $(el).remove();
    });
    $('link[rel="modulepreload" i], link[rel="preload" i][as="script" i]').remove();
  }

  const mapValue = (raw, kind) => {
    const value = (raw || '').trim();
    if (!value || SKIP.test(value)) return null;
    const hashIndex = value.indexOf('#');
    const abs = normalizeUrl(hashIndex >= 0 ? value.slice(0, hashIndex) : value, pageUrl);
    if (!abs) return null;
    const out = resolve(abs, kind) || abs;
    return hashIndex >= 0 ? out + value.slice(hashIndex) : out;
  };

  for (const [tag, attr] of URL_ATTRS) {
    $(tag).each((_, el) => {
      const node = $(el);
      const raw = node.attr(attr);
      if (raw === undefined) return;
      if (tag === 'link' && LINK_RELS_TO_LEAVE.test(node.attr('rel') || '')) return;
      const abs = normalizeUrl(raw.split('#')[0], pageUrl);
      const kind = (tag === 'a' || tag === 'area' || tag === 'iframe' || tag === 'frame') && abs && isPageLike(abs)
        ? 'page'
        : 'asset';
      const out = mapValue(raw, kind);
      if (out) node.attr(attr, out);
    });
  }

  for (const attr of LAZY_ATTRS) {
    $(`[${attr}]`).each((_, el) => {
      const out = mapValue($(el).attr(attr), 'asset');
      if (out) $(el).attr(attr, out);
    });
  }

  for (const attr of SRCSET_ATTRS) {
    $(`[${attr}]`).each((_, el) => {
      const items = splitSrcset($(el).attr(attr));
      const mapped = items.map(({ url, descriptor }) => `${mapValue(url, 'asset') || url}${descriptor ? ` ${descriptor}` : ''}`);
      $(el).attr(attr, mapped.join(', '));
    });
  }

  $('[style]').each((_, el) => {
    const style = $(el).attr('style');
    if (style && style.includes('url(')) {
      $(el).attr('style', rewriteCss(style, pageUrl, (abs) => resolve(abs, 'asset')));
    }
  });
  $('style').each((_, el) => {
    const css = $(el).html();
    if (css && (css.includes('url(') || css.includes('@import'))) {
      $(el).text(rewriteCss(css, pageUrl, (abs) => resolve(abs, 'asset')));
    }
  });

  if ($('head').length && !$('meta[charset]').length) {
    $('head').prepend('<meta charset="utf-8">');
  }
  return $.html();
}
