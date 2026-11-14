import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import type { Hono } from 'hono';

import type { GatewayService } from '../../service.js';
import { extensionAssetMimeType } from '../lib/extension-assets.js';

const EXTENSION_ASSET_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "connect-src 'none'; " +
  "frame-ancestors 'self'; " +
  "frame-src 'none'; " +
  "base-uri 'none'; " +
  "object-src 'none'; " +
  "form-action 'none'";

/** Sandboxed extension iframes send `Origin: null`; echo it (and real origins) so every status includes ACAO. */
function extensionUiAssetCorsAllowOrigin(c: { req: { header: (name: string) => string | undefined } }): string {
  const origin = c.req.header('origin');
  if (origin === 'null') return 'null';
  if (origin) return origin;
  return '*';
}

function rewriteExtensionAssetHtml(html: string, extensionId: string, assetPath: string): string {
  const assetDir = assetPath.includes('/') ? assetPath.slice(0, assetPath.lastIndexOf('/') + 1) : '';
  const assetBase = `/api/extensions/${extensionId}/assets/${assetDir}`;

  return html
    .replace(/(<script\b[^>]*?\ssrc=)(["'])(\.\/)?([^"']+)\2/gi, (_match, tag, quote, _dot, file) => {
      const isAbsolute =
        file.startsWith('/') || file.startsWith('http://') || file.startsWith('https://');
      const resolvedSrc = isAbsolute ? file : `${assetBase}${file}`;
      return `${tag}${quote}${resolvedSrc}${quote} crossorigin="anonymous"`;
    })
    .replace(/(<link\b[^>]*?\shref=)(["'])(\.\/)?([^"']+)\2/gi, (_match, tag, quote, _dot, file) => {
      const isAbsolute =
        file.startsWith('/') || file.startsWith('http://') || file.startsWith('https://');
      const resolvedHref = isAbsolute ? file : `${assetBase}${file}`;
      return `${tag}${quote}${resolvedHref}${quote}`;
    });
}

/**
 * Register extension UI asset routes on the public (unauthenticated) app.
 *
 * Sandboxed iframes (`sandbox="allow-scripts …"` without `allow-same-origin`) have an
 * opaque origin of `null`, so sub-resource requests from inside the iframe cannot
 * carry the `?token=` query parameter that was on the parent HTML URL. Putting these
 * routes behind the auth middleware therefore causes every JS/CSS asset to return 401.
 *
 * Security is maintained by the strict Content-Security-Policy returned with every
 * asset (`frame-ancestors 'self'`), which prevents any page other than the gateway
 * console itself from embedding the extension iframes.
 */
export function registerPublicExtensionAssetRoutes(app: Hono, service: GatewayService): void {
  app.get('/api/extensions/:id/assets/*', async (c) => {
    const acao = extensionUiAssetCorsAllowOrigin(c);
    const corsHdr = { 'Access-Control-Allow-Origin': acao } as const;

    const extensionId = c.req.param('id');
    const loader = service.getExtensionLoader();
    if (!loader) {
      return c.json({ error: 'Extensions unavailable' }, 503, corsHdr);
    }

    const discovered = loader.discoverExtensions();
    const ext = discovered.find((e) => e.id === extensionId);
    if (!ext || !ext.manifest.ui) {
      return c.json({ error: 'Extension not found or has no UI' }, 404, corsHdr);
    }

    const prefix = `/api/extensions/${extensionId}/assets/`;
    const assetPathEncoded = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : '';
    let assetPath = assetPathEncoded;
    try {
      assetPath = decodeURIComponent(assetPathEncoded);
    } catch {
      return c.json({ error: 'Invalid asset path' }, 400, corsHdr);
    }

    if (!assetPath || assetPath.includes('..')) {
      return c.json({ error: 'Invalid asset path' }, 400, corsHdr);
    }

    const localAsset = service.localApps?.resolveUiAsset(extensionId, assetPath);
    if (localAsset === null) return c.json({ error: 'Not found' }, 404, corsHdr);
    const root = realpathSync(resolve(ext.path));
    const unresolvedPath = localAsset ?? resolve(root, assetPath);
    const fullPath = existsSync(unresolvedPath) ? realpathSync(unresolvedPath) : unresolvedPath;
    // Managed Local Apps are served from their release inventory, outside the discovery directory.
    const managed = localAsset !== undefined;
    const rel = relative(root, fullPath);
    if (!managed && (rel.startsWith('..') || rel === '')) {
      return c.json({ error: 'Path traversal denied' }, 403, corsHdr);
    }

    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      return c.json({ error: 'Not found' }, 404, corsHdr);
    }

    const rawContent = readFileSync(fullPath);
    const mimeType = extensionAssetMimeType(assetPath);

    const body: string | Uint8Array = mimeType.startsWith('text/html')
      ? rewriteExtensionAssetHtml(rawContent.toString('utf-8'), extensionId, assetPath)
      : new Uint8Array(rawContent);
    const assetBase = new URL(`/api/extensions/${encodeURIComponent(extensionId)}/assets/`, c.req.url).href;
    const localAppCsp = `default-src 'none'; script-src ${assetBase}; style-src ${assetBase} 'unsafe-inline'; `
      + `img-src ${assetBase} data: blob:; font-src ${assetBase} data:; connect-src 'none'; `
      + "frame-ancestors 'self'; frame-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; sandbox allow-scripts";

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Security-Policy': managed ? localAppCsp : EXTENSION_ASSET_CSP,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': acao,
      },
    });
  });
}
