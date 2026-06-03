import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { resolve as resolvePath, relative as relPathPosix, join } from 'node:path';
import { Readable } from 'node:stream';

import { isPathUnderWorkspace } from '../gateway/workspace-editor-path.js';
import { resolveMimeType, shareResponseContentType } from './share-store.js';
import type { SiteShareRecord, SiteStaticSource } from './site-share-types.js';

const HASHED_ASSET_RE = /\.[a-f0-9]{8,}\.(?:js|mjs|css|woff2?|ttf|otf|svg|png|jpg|jpeg|gif|webp|avif|ico)$/i;
const REWRITABLE_TYPES = new Set(['text/html', 'text/css']);

/**
 * Serve a request for a static site share.
 *
 * `urlPath` is the in-site path (already stripped of any subdomain/subpath base).
 * `basePrefix` is the path prefix that the share is mounted under, used by the
 * HTML rewriter to make root-relative URLs (`/assets/x`) point back into the
 * share. Pass '' when serving on a subdomain (root mode).
 */
export async function serveStaticSiteRequest(
  record: SiteShareRecord,
  urlPath: string,
  basePrefix: string,
): Promise<Response> {
  if (record.source.kind !== 'static') {
    return new Response('not_static', { status: 400 });
  }
  const source = record.source;

  const sanitized = sanitizePath(urlPath);
  if (sanitized.startsWith('..')) return new Response('forbidden', { status: 403 });

  const absInitial = resolvePath(source.rootDir, sanitized);
  const inside = await pathInsideRoot(source.rootDir, source.workspaceRoot, absInitial);
  if (!inside.ok) {
    if (source.spaFallback) {
      return serveIndexFallback(source, basePrefix);
    }
    return new Response('not_found', { status: 404 });
  }

  let abs = inside.abs;
  let stats;
  try {
    stats = await stat(abs);
  } catch {
    if (source.spaFallback) return serveIndexFallback(source, basePrefix);
    return new Response('not_found', { status: 404 });
  }

  if (stats.isDirectory()) {
    const indexPath = join(abs, 'index.html');
    try {
      const indexStat = await stat(indexPath);
      if (indexStat.isFile()) {
        abs = indexPath;
        stats = indexStat;
      } else if (source.spaFallback) {
        return serveIndexFallback(source, basePrefix);
      } else {
        return new Response('not_found', { status: 404 });
      }
    } catch {
      if (source.spaFallback) return serveIndexFallback(source, basePrefix);
      return new Response('not_found', { status: 404 });
    }
  }

  const fileName = abs.split(/[\\/]/).pop() ?? 'file';
  const mime = resolveMimeType(fileName);

  const cacheHeader = decideCacheHeader(sanitized, mime);

  if (source.rewriteMode !== 'none' && REWRITABLE_TYPES.has(mime)) {
    const raw = await readFile(abs, 'utf8');
    const rewritten = rewriteAbsolutePaths(raw, mime, basePrefix, source.rewriteMode);
    const bytes = Buffer.from(rewritten, 'utf8');
    return new Response(bytes, {
      status: 200,
      headers: buildHeaders(mime, bytes.length, cacheHeader, fileName),
    });
  }

  const stream = createReadStream(abs);
  const webStream = Readable.toWeb(stream) as ReadableStream;
  return new Response(webStream, {
    status: 200,
    headers: buildHeaders(mime, stats.size, cacheHeader, fileName),
  });
}

async function serveIndexFallback(source: SiteStaticSource, basePrefix: string): Promise<Response> {
  const indexPath = join(source.rootDir, 'index.html');
  try {
    const raw = await readFile(indexPath, 'utf8');
    const rewritten =
      source.rewriteMode !== 'none' ? rewriteAbsolutePaths(raw, 'text/html', basePrefix, source.rewriteMode) : raw;
    const bytes = Buffer.from(rewritten, 'utf8');
    return new Response(bytes, {
      status: 200,
      headers: buildHeaders('text/html', bytes.length, 'no-cache', 'index.html'),
    });
  } catch {
    return new Response('not_found', { status: 404 });
  }
}

function buildHeaders(
  mime: string,
  contentLength: number,
  cacheControl: string,
  fileName: string,
): Record<string, string> {
  return {
    'Content-Type': shareResponseContentType(mime),
    'Content-Length': String(contentLength),
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // Don't force attachment — site-share is meant to be browsed.
    'Content-Disposition': `inline; filename="${fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"`,
  };
}

function decideCacheHeader(urlPath: string, mime: string): string {
  if (HASHED_ASSET_RE.test(urlPath)) {
    return 'public, max-age=31536000, immutable';
  }
  if (mime === 'text/html') return 'no-cache';
  return 'public, max-age=600';
}

function sanitizePath(input: string): string {
  let p = input.replace(/\\/g, '/');
  p = p.replace(/^\/+/, '');
  if (p.includes('\0')) return '..';
  if (p.split('/').includes('..')) return '..';
  return p;
}

async function pathInsideRoot(
  rootDir: string,
  workspaceRoot: string,
  abs: string,
): Promise<{ ok: true; abs: string } | { ok: false }> {
  const relToRoot = relPathPosix(rootDir, abs);
  if (relToRoot.startsWith('..') || relToRoot.split(/[/\\]/).includes('..')) {
    return { ok: false };
  }
  if (!isPathUnderWorkspace(workspaceRoot, abs)) {
    return { ok: false };
  }
  return { ok: true, abs };
}

// ── HTML/CSS rewriting ────────────────────────────────────────────────────────
//
// Best-effort root-relative path prefixing. For SPAs built with `base: '/'`,
// the produced HTML/CSS contains `/assets/...` references that need to be
// prefixed with the share's `basePrefix`. JS-generated URLs at runtime are NOT
// handled here — recommend the user set `base` at build time when possible.

function rewriteAbsolutePaths(
  body: string,
  mime: string,
  basePrefix: string,
  mode: 'none' | 'html-only' | 'html-css',
): string {
  if (mode === 'none' || !basePrefix) return body;
  if (mime === 'text/html') {
    return rewriteHtml(body, basePrefix);
  }
  if (mime === 'text/css' && mode === 'html-css') {
    return rewriteCss(body, basePrefix);
  }
  return body;
}

function rewriteHtml(html: string, basePrefix: string): string {
  // Match attribute values like src="/x", href='/y', srcset="/a, /b 2x"
  const attrRe = /\s(href|src|action|poster|formaction|data)\s*=\s*("|')\/([^"']*?)\2/gi;
  let out = html.replace(attrRe, (_match, attr, quote, rest) => {
    if (rest.startsWith('/')) return _match; // protocol-relative '//'
    return ` ${attr}=${quote}${basePrefix}/${rest}${quote}`;
  });

  const srcsetRe = /\s(srcset|imagesrcset)\s*=\s*("|')([^"']*)\2/gi;
  out = out.replace(srcsetRe, (_match, attr, quote, value) => {
    const fixed = value
      .split(',')
      .map((part: string) => {
        const trimmed = part.trim();
        const [url, descriptor] = trimmed.split(/\s+/, 2);
        if (!url || !url.startsWith('/') || url.startsWith('//')) return trimmed;
        return descriptor ? `${basePrefix}${url} ${descriptor}` : `${basePrefix}${url}`;
      })
      .join(', ');
    return ` ${attr}=${quote}${fixed}${quote}`;
  });

  // Inject <base> tag for clarity (helps relative URLs inside the page)
  out = out.replace(/<head([^>]*)>/i, `<head$1><base href="${basePrefix}/">`);

  return out;
}

function rewriteCss(css: string, basePrefix: string): string {
  // url(/x) — only absolute-root references
  return css.replace(/url\(\s*("|'|)\/([^)"']*?)\1\s*\)/g, (_m, quote, rest) => {
    if (rest.startsWith('/')) return _m;
    return `url(${quote}${basePrefix}/${rest}${quote})`;
  });
}
