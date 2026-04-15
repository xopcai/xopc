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
  ico: 'image/x-icon',
};

/** Serve a static file from the gateway console build output directory. */
export function serveStaticFile(relativePath: string): Response | null {
  const filePath = `${UI_STATIC_ROOT}/${relativePath}`;
  try {
    const content = readFileSync(filePath);
    const ext = relativePath.split('.').pop() || '';
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    return new Response(content, {
      headers: { 'Content-Type': contentType },
    });
  } catch {
    return null;
  }
}
