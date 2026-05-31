import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Web UI build output: `pnpm run build:web` → `dist/gateway/static/root` (see web/vite.config.ts).
 * This module compiles under `dist/src/gateway/hono/lib/`; resolve static root relative to this file.
 */
function resolveUiStaticRoot(): string {
  const env = process.env['XOPC_UI_STATIC_ROOT']?.trim();
  if (env) return resolve(env);

  const here = __dirname;
  const normalized = here.replace(/\\/g, '/');
  if (normalized.includes('/dist/src/gateway/')) {
    const fromLib = /\/hono\/lib(?:\/|$)/.test(normalized);
    return resolve(here, fromLib ? '../../../../gateway/static/root' : '../../../gateway/static/root');
  }
  if (normalized.includes('/out/server')) {
    return resolve(here, '../../dist/gateway/static/root');
  }
  const fromLib = /\/gateway\/hono\/lib(?:\/|$)/.test(normalized);
  return resolve(here, fromLib ? '../../../../dist/gateway/static/root' : '../../../dist/gateway/static/root');
}

const UI_STATIC_ROOT = resolveUiStaticRoot();

const MIME_TYPES: Record<string, string> = {
  js: 'application/javascript',
  css: 'text/css',
  json: 'application/json',
  html: 'text/html',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
};

type CachedStaticFile = {
  content: Buffer;
  contentType: string;
  etag: string;
  cacheControl: string;
};

const fileCache = new Map<string, CachedStaticFile>();

export type StaticUiCacheStats = {
  hits: number;
  misses: number;
  entries: number;
  notModified: number;
};

const stats: StaticUiCacheStats = {
  hits: 0,
  misses: 0,
  entries: 0,
  notModified: 0,
};

function computeEtag(content: Buffer): string {
  return `"${createHash('sha256').update(content).digest('hex').slice(0, 16)}"`;
}

function resolveCacheControl(relativePath: string): string {
  if (relativePath === 'index.html') {
    return 'no-cache';
  }
  if (relativePath.startsWith('assets/')) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600';
}

function resolveContentType(relativePath: string): string {
  const ext = relativePath.split('.').pop()?.toLowerCase() || '';
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function loadIntoCache(relativePath: string): CachedStaticFile | null {
  const filePath = resolve(UI_STATIC_ROOT, relativePath);
  try {
    const content = readFileSync(filePath);
    const cached: CachedStaticFile = {
      content,
      contentType: resolveContentType(relativePath),
      etag: computeEtag(content),
      cacheControl: resolveCacheControl(relativePath),
    };
    fileCache.set(relativePath, cached);
    stats.entries = fileCache.size;
    stats.misses += 1;
    return cached;
  } catch {
    return null;
  }
}

function getCachedFile(relativePath: string): CachedStaticFile | null {
  const cached = fileCache.get(relativePath);
  if (cached) {
    stats.hits += 1;
    return cached;
  }
  return loadIntoCache(relativePath);
}

export function getStaticUiCacheStats(): StaticUiCacheStats {
  return { ...stats };
}

export function clearStaticUiCacheForTests(): void {
  fileCache.clear();
  stats.hits = 0;
  stats.misses = 0;
  stats.entries = 0;
  stats.notModified = 0;
}

export function resolveStaticUiRootForTests(): string {
  return UI_STATIC_ROOT;
}

const DEFAULT_PREWARM_PATHS = [
  'index.html',
  'favicon.ico',
  'logo.svg',
  'logo-dark.svg',
] as const;

/** Warm commonly requested UI files into memory at gateway startup. */
export function prewarmStaticUiCache(
  relativePaths: readonly string[] = DEFAULT_PREWARM_PATHS,
): { loaded: number; missing: number } {
  let loaded = 0;
  let missing = 0;
  for (const relativePath of relativePaths) {
    if (getCachedFile(relativePath)) {
      loaded += 1;
    } else {
      missing += 1;
    }
  }
  return { loaded, missing };
}

function buildStaticResponse(
  cached: CachedStaticFile,
  request?: Request,
): Response {
  const ifNoneMatch = request?.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === cached.etag) {
    stats.notModified += 1;
    return new Response(null, {
      status: 304,
      headers: {
        ETag: cached.etag,
        'Cache-Control': cached.cacheControl,
      },
    });
  }

  return new Response(new Uint8Array(cached.content), {
    headers: {
      'Content-Type': cached.contentType,
      ETag: cached.etag,
      'Cache-Control': cached.cacheControl,
    },
  });
}

/** Serve a static file from the gateway console build output directory. */
export function serveStaticFile(relativePath: string, request?: Request): Response | null {
  const cached = getCachedFile(relativePath);
  if (!cached) {
    return null;
  }
  return buildStaticResponse(cached, request);
}

/** Exposed for tests: verify cache invalidation when source file changes. */
export function invalidateStaticUiCacheEntry(relativePath: string): void {
  fileCache.delete(relativePath);
  stats.entries = fileCache.size;
}
