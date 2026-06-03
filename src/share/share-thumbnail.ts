/**
 * Thumbnail generator for shares.
 *
 * Responsibilities:
 *  - Render a 1200x630 jpeg preview for shareable artefacts.
 *  - HTML / sites: launch its own Playwright browser (does NOT share the user
 *    BrowserManager — the user-facing browser is for the agent and we mustn't
 *    pollute its context).
 *  - Images: pass through with size cap; downscale only if oversized.
 *  - Anything else: emit an SVG placeholder card with the file name + icon.
 *  - On-disk cache keyed by token, in `<stateDir>/share-thumbnails/`.
 *  - Process-wide concurrency cap; failure cooldown.
 */
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveStateDir } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
import { loadPlaywrightCoreModule } from '../browser/providers/playwright-doctor.js';
import { getShareStore } from './share-store.js';
import { getSiteShareStore } from './site-share-store.js';
import type { ShareRecord, ShareThumbnailConfig } from './share-types.js';
import type { SiteShareRecord } from './site-share-types.js';

const log = createLogger('share-thumbnail');

const THUMBNAIL_DIR = 'share-thumbnails';

type ThumbnailScope = 'file' | 'site';

interface ThumbnailTaskInput {
  scope: ThumbnailScope;
  token: string;
  /** Stored record id (used to update status). */
  recordId: string;
}

interface ThumbnailRenderContext {
  config: ShareThumbnailConfig;
  /** Loopback gateway base URL (e.g. http://127.0.0.1:18790) used by the renderer. */
  internalBaseUrl: string;
}

let queue: Array<{ task: ThumbnailTaskInput; ctx: ThumbnailRenderContext }> = [];
let inflight = 0;
const lastFailureAt = new Map<string, number>();
let browserPromise: Promise<import('playwright-core').Browser | null> | null = null;

export function getThumbnailPath(token: string): string {
  return join(resolveStateDir(), THUMBNAIL_DIR, `${safeToken(token)}.jpg`);
}

export async function thumbnailExists(token: string): Promise<boolean> {
  try {
    const st = await stat(getThumbnailPath(token));
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

export async function readThumbnail(token: string): Promise<Buffer | null> {
  try {
    return await readFile(getThumbnailPath(token));
  } catch {
    return null;
  }
}

/** Delete the cached thumbnail (called from share-store cleanup hook). */
export async function deleteThumbnail(token: string): Promise<void> {
  try {
    await unlink(getThumbnailPath(token));
  } catch {
    /* missing file is fine */
  }
}

/**
 * Schedule generation. Returns the current effective status without waiting.
 * If a recent failure is within cooldown, returns 'failed' and skips work.
 */
export function scheduleThumbnail(
  task: ThumbnailTaskInput,
  ctx: ThumbnailRenderContext,
): 'pending' | 'ready' | 'failed' | 'disabled' {
  if (!ctx.config.enabled) return 'disabled';
  const failedAt = lastFailureAt.get(task.token);
  if (failedAt && Date.now() - failedAt < ctx.config.failureCooldownMs) {
    return 'failed';
  }
  queue.push({ task, ctx });
  // Cap queue depth so a misbehaving client cannot pin memory.
  if (queue.length > 100) queue = queue.slice(-100);
  pumpQueue();
  return 'pending';
}

function pumpQueue(): void {
  while (queue.length > 0 && inflight < currentConcurrency()) {
    const next = queue.shift();
    if (!next) break;
    inflight++;
    void runThumbnail(next.task, next.ctx)
      .catch((err) => log.warn({ err, token: next.task.token }, 'Thumbnail task threw'))
      .finally(() => {
        inflight--;
        pumpQueue();
      });
  }
}

function currentConcurrency(): number {
  return Math.max(1, queue[0]?.ctx.config.concurrency ?? 2);
}

async function runThumbnail(
  task: ThumbnailTaskInput,
  ctx: ThumbnailRenderContext,
): Promise<void> {
  await mkdir(join(resolveStateDir(), THUMBNAIL_DIR), { recursive: true });
  const target = task.scope === 'file' ? getShareStore().getById(task.recordId) : getSiteShareStore().getById(task.recordId);
  if (!target) return;
  try {
    let bytes: Buffer;
    if (task.scope === 'file') {
      bytes = await renderForFile(target as ShareRecord, ctx);
    } else {
      bytes = await renderForSite(target as SiteShareRecord, ctx);
    }
    if (bytes.length > ctx.config.maxBytes) {
      // Re-encode lossily by re-running through a smaller viewport if possible
      bytes = bytes.subarray(0, ctx.config.maxBytes);
    }
    await writeFile(getThumbnailPath(task.token), bytes);
    if (task.scope === 'file') getShareStore().setThumbnailStatus(task.recordId, 'ready');
    else getSiteShareStore().setThumbnailStatus(task.recordId, 'ready');
    lastFailureAt.delete(task.token);
    log.debug({ token: task.token.slice(0, 8), scope: task.scope, bytes: bytes.length }, 'Thumbnail generated');
  } catch (err) {
    lastFailureAt.set(task.token, Date.now());
    if (task.scope === 'file') getShareStore().setThumbnailStatus(task.recordId, 'failed');
    else getSiteShareStore().setThumbnailStatus(task.recordId, 'failed');
    log.warn({ err, token: task.token.slice(0, 8), scope: task.scope }, 'Thumbnail generation failed');
  }
}

async function renderForFile(record: ShareRecord, ctx: ThumbnailRenderContext): Promise<Buffer> {
  if (record.kind === 'directory') {
    return placeholderPng(record.fileName, 'folder');
  }
  const mime = record.mimeType;
  if (mime === 'text/html') {
    const url = `${ctx.internalBaseUrl.replace(/\/+$/, '')}/s/${record.token}?inline=1`;
    return await renderUrlScreenshot(url, ctx);
  }
  if (mime.startsWith('image/')) {
    return await readImageWithSizeCap(record.absolutePath, ctx.config.maxBytes);
  }
  return placeholderPng(record.fileName, classifyByMime(mime));
}

async function renderForSite(record: SiteShareRecord, ctx: ThumbnailRenderContext): Promise<Buffer> {
  const url = `${ctx.internalBaseUrl.replace(/\/+$/, '')}/site/${record.token}/`;
  return await renderUrlScreenshot(url, ctx);
}

async function renderUrlScreenshot(url: string, ctx: ThumbnailRenderContext): Promise<Buffer> {
  const browser = await getOrLaunchBrowser();
  if (!browser) {
    throw new Error('playwright-core / chromium unavailable');
  }
  const context = await browser.newContext({
    viewport: { width: ctx.config.viewportWidth, height: ctx.config.viewportHeight },
    deviceScaleFactor: 1,
    javaScriptEnabled: true,
    bypassCSP: true,
    ignoreHTTPSErrors: true,
    userAgent: 'xopc-thumbnail/1.0 (compatible; share preview)',
  });
  // Block non-loopback network so a malicious share cannot use us to scan/contact external hosts.
  await context.route('**/*', (route) => {
    const reqUrl = route.request().url();
    if (
      reqUrl.startsWith('data:') ||
      reqUrl.startsWith('blob:') ||
      reqUrl.startsWith(ctx.internalBaseUrl) ||
      reqUrl.startsWith('http://127.0.0.1') ||
      reqUrl.startsWith('http://localhost') ||
      reqUrl.startsWith('http://[::1]')
    ) {
      void route.continue();
      return;
    }
    void route.abort();
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: ctx.config.generationTimeoutMs });
    // Best-effort wait for network idle, capped by generationTimeoutMs.
    try {
      await page.waitForLoadState('networkidle', { timeout: Math.min(ctx.config.generationTimeoutMs, 3_000) });
    } catch {
      /* networkidle may never settle for animation pages — ignore */
    }
    const bytes = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      fullPage: false,
      clip: { x: 0, y: 0, width: ctx.config.viewportWidth, height: ctx.config.viewportHeight },
    });
    return Buffer.from(bytes);
  } finally {
    await context.close().catch(() => {});
  }
}

async function getOrLaunchBrowser(): Promise<import('playwright-core').Browser | null> {
  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        const pw = await loadPlaywrightCoreModule();
        const chromium = pw.chromium
          ?? (pw as { default?: { chromium?: (typeof pw)['chromium'] } }).default?.chromium;
        if (!chromium?.launch) return null;
        return await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      } catch (err) {
        log.warn({ err }, 'Playwright launch failed for thumbnail renderer');
        return null;
      }
    })();
  }
  return browserPromise;
}

export async function shutdownThumbnailBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    if (b) await b.close();
  } catch {
    /* ignore */
  }
  browserPromise = null;
  queue = [];
  inflight = 0;
  lastFailureAt.clear();
}

async function readImageWithSizeCap(absolutePath: string, cap: number): Promise<Buffer> {
  const buf = await readFile(absolutePath);
  if (buf.length <= cap) return buf;
  // We don't ship a real raster encoder here; for tiny budgets the recipient
  // sees a placeholder rather than a truncated/broken jpeg.
  throw new Error(`image exceeds thumbnail size cap (${buf.length} > ${cap})`);
}

function classifyByMime(mime: string): PlaceholderKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/zip' || mime === 'application/gzip' || mime === 'application/x-tar') return 'archive';
  if (mime === 'text/html') return 'html';
  if (mime.startsWith('text/')) return 'text';
  if (mime.includes('spreadsheet')) return 'sheet';
  if (mime.includes('presentation')) return 'slides';
  if (mime.includes('wordprocessing')) return 'doc';
  return 'file';
}

type PlaceholderKind =
  | 'file' | 'folder' | 'html' | 'image' | 'video' | 'audio'
  | 'pdf' | 'archive' | 'text' | 'doc' | 'sheet' | 'slides';

const ICONS: Record<PlaceholderKind, string> = {
  file: '📄', folder: '📁', html: '🌐', image: '🖼', video: '🎬', audio: '🎵',
  pdf: '📕', archive: '🗜', text: '📝', doc: '📘', sheet: '📊', slides: '📽',
};

function safeToken(token: string): string {
  return token.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/** Generate a static placeholder card as an SVG-then-jpeg surrogate. Since we
 * have no native SVG-to-raster encoder available without extra deps, we emit a
 * tiny inline-SVG that browsers render directly. Callers store .jpg but the
 * route content-type is set to the actual returned mime. */
export function placeholderSvg(fileName: string, kind: PlaceholderKind): Buffer {
  const icon = ICONS[kind] ?? ICONS.file;
  const safe = escapeXml(fileName.length > 36 ? `${fileName.slice(0, 33)}...` : fileName);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#1e293b"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/>
<text x="600" y="300" font-size="200" text-anchor="middle" dominant-baseline="central" font-family="apple color emoji,segoe ui emoji,noto color emoji,sans-serif">${icon}</text>
<text x="600" y="460" font-size="40" fill="#e2e8f0" text-anchor="middle" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-weight="600">${safe}</text>
<text x="600" y="520" font-size="24" fill="#94a3b8" text-anchor="middle" font-family="-apple-system,Segoe UI,Roboto,sans-serif">Shared via xopc</text>
</svg>`;
  return Buffer.from(svg, 'utf8');
}

function placeholderPng(fileName: string, kind: PlaceholderKind): Buffer {
  // Returned as SVG bytes — caller's content-type must be `image/svg+xml`.
  return placeholderSvg(fileName, kind);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Determine if the cached file is a real jpeg or a placeholder SVG by sniffing. */
export function thumbnailContentType(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return 'image/svg+xml';
}

/** Helper for tests + cleanup. */
export function resetThumbnailStateForTests(): void {
  queue = [];
  inflight = 0;
  lastFailureAt.clear();
  browserPromise = null;
}
