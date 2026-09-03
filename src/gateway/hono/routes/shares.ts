import type { Context, Hono } from 'hono';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { extractToken } from '../../auth.js';
import { FileServiceError } from '../../../files/file-service.js';
import { getGatewayFileSpaceService } from '../../file-space-service.js';
import { getClientIpFromHeaders } from '../../security/loopback.js';
import { SHARED_HTML_CSP } from '../../security/csp.js';
import { getShareStore, shareResponseContentType } from '../../../share/share-store.js';
import { getSiteShareStore } from '../../../share/site-share-store.js';
import { resolveSiteShareConfig } from '../../../share/site-share-config.js';
import { resolveShareUrl, resolveSiteShareUrl } from '../../../share/share-url.js';
import { resolveReverseProxyPublicUrl } from '../../public-url.js';
import { consumeSharePublicLimit } from '../../../share/share-rate-limit.js';
import { logShareAudit } from '../../../share/share-audit.js';
import {
  renderShareLandingPage,
  renderShareExpiredPage,
  renderFolderLandingPage,
  renderSnapshotShareLandingPage,
} from '../../../share/share-landing.js';
import type { ShareExpiredReason } from '../../../share/share-landing.js';
import type { DirectoryShareRecord, ShareConfig, ShareRecord, WorkspaceShareRecord } from '../../../share/share-types.js';
import { NoteShareService } from '../../../share/note-share-service.js';
import { SessionShareService, SessionShareSnapshotConflictError } from '../../../share/session-share-service.js';
import {
  HostedSessionShareBuilder,
  HostedSessionSharePublisher,
  HostedShareAuthorizationError,
  HostedShareBindingStore,
  type HostedShareBinding,
} from '../../../share/hosted-session-share.js';
import { loadCompactionSourceSnapshot } from '../../../storage/sqlite/index.js';
import { resolveGatewayEffectiveHost } from '../../../config/gateway-bind.js';
import { SHARE_CONFIG_DEFAULTS } from '../../../share/share-types.js';
import { createZipStream, planDirectoryFiles } from '../../../share/share-zip.js';
import {
  audienceDefaults,
  cleanupStagedSite,
  decideShareKind,
  forgetStagedSite,
  makeDescription,
  makeTitle,
  probeShareTarget,
  rememberStagedSite,
  stageSingleHtmlAsSite,
  type ShareAudience,
  type ShareAutoMode,
} from '../../../share/share-auto.js';
import {
  deleteThumbnail,
  placeholderSvg,
  readThumbnail,
  scheduleThumbnail,
  thumbnailContentType,
  thumbnailExists,
} from '../../../share/share-thumbnail.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import type { GatewayService } from '../../service.js';

function getShareUrlContext(service: GatewayService) {
  const gateway = service.currentConfig.gateway;
  return {
    gatewayHost: resolveGatewayEffectiveHost(service.currentConfig),
    gatewayPort: gateway.port ?? 18790,
    reverseProxyPublicUrl: resolveReverseProxyPublicUrl(service.currentConfig),
  };
}

function thumbnailRenderContext(service: GatewayService) {
  const cfg = { ...SHARE_CONFIG_DEFAULTS, ...resolveShareConfig(service) };
  const port = service.currentConfig.gateway.port ?? 18790;
  // Always use loopback for the internal renderer — never the public tunnel URL.
  const internalBaseUrl = cfg.thumbnail.internalGatewayUrl ?? `http://127.0.0.1:${port}`;
  return { config: cfg.thumbnail, internalBaseUrl };
}

function resolveShareConfig(service: GatewayService): Partial<ShareConfig> {
  const raw = (service.currentConfig.gateway as Record<string, unknown>)?.share;
  if (!raw || typeof raw !== 'object') return {};
  return raw as Partial<ShareConfig>;
}

function hashGatewayToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 12);
}

const MAX_CONCURRENT_DOWNLOADS_PER_TOKEN = 5;
const activeDownloads = new Map<string, number>();
const activeZipStreams = new Map<string, number>();

function acquireDownloadSlot(token: string): boolean {
  const current = activeDownloads.get(token) ?? 0;
  if (current >= MAX_CONCURRENT_DOWNLOADS_PER_TOKEN) return false;
  activeDownloads.set(token, current + 1);
  return true;
}

function releaseDownloadSlot(token: string): void {
  const current = activeDownloads.get(token) ?? 0;
  if (current <= 1) activeDownloads.delete(token);
  else activeDownloads.set(token, current - 1);
}

function acquireZipSlot(token: string, limit: number): boolean {
  const current = activeZipStreams.get(token) ?? 0;
  if (current >= limit) return false;
  activeZipStreams.set(token, current + 1);
  return true;
}

function releaseZipSlot(token: string): void {
  const current = activeZipStreams.get(token) ?? 0;
  if (current <= 1) activeZipStreams.delete(token);
  else activeZipStreams.set(token, current - 1);
}

/**
 * Whether the browser can render this MIME natively (when served with
 * `Content-Disposition: inline`). Honours the per-deployment whitelist so
 * admins can block specific types.
 */
function isPreviewableInline(mime: string, whitelist: string[]): boolean {
  return whitelist.includes(mime);
}

/**
 * Whether the type benefits from being rendered through the SPA preview page
 * (e.g. markdown — the browser would otherwise show raw source). Independent
 * of the inline whitelist: SPA preview pulls the bytes via the share API and
 * renders client-side, so admins control reach via TTL/maxViews, not MIME.
 */
function isRichSpaPreviewable(mime: string): boolean {
  return (
    mime === 'text/markdown' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  );
}

function rfc5987ContentDisposition(disposition: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  const utf8 = encodeURIComponent(fileName);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// ── Public routes (no auth required) ──────────────────────────────────────────

export function registerSharePublicRoutes(app: Hono, service: GatewayService): void {
  const store = getShareStore(resolveShareConfig(service));
  const noteShares = new NoteShareService(store, service.notesServiceInstance);
  const sessionShares = createSessionShareService(service, store);

  /** Landing page — does NOT consume downloadCount. */
  app.get('/s/:token', async (c) => {
    const clientIp = getClientIpFromHeaders({ get: (n: string) => c.req.header(n) ?? undefined });
    const rateResult = consumeSharePublicLimit(clientIp);
    if (!rateResult.allowed) {
      c.header('Retry-After', String(Math.ceil(rateResult.retryAfterMs / 1000)));
      return c.text('Too many requests', 429);
    }

    const token = c.req.param('token');
    const record = store.getByToken(token);
    if (!record) return c.html(renderShareExpiredPage('not_found'), 404);

    const validation = store.validateAccess(record);
    if (!validation.valid) {
      logShareAudit(
        'share.access_denied',
        { shareId: record.id, tokenPrefix: token.slice(0, 8), reason: validation.reason, clientIp },
        `Share access denied: ${validation.reason}`,
      );
      return c.html(renderShareExpiredPage(validation.reason as ShareExpiredReason), 410);
    }

    if (record.kind === 'directory') {
      return renderDirectoryLanding(c, store, service, record, token);
    }

    if (record.kind === 'note' || record.kind === 'session') {
      const previewUrl = `/#/share/${encodeURIComponent(token)}`;
      c.header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
      c.header('X-Frame-Options', 'DENY');
      c.header('Referrer-Policy', 'no-referrer');
      return c.html(renderSnapshotShareLandingPage(record, previewUrl, {
        label: record.kind === 'note' ? 'Note' : 'conversation',
        og: buildLandingOg(service, record),
      }));
    }

    // File: support direct download / inline preview shortcuts
    if (c.req.query('dl') === '1') {
      return handleFileDownload(c, store, record, clientIp);
    }
    if (c.req.query('inline') === '1') {
      const cfg = { ...SHARE_CONFIG_DEFAULTS, ...resolveShareConfig(service) };
      if (cfg.inlinePreviewMimes.includes(record.mimeType)) {
        return handleFileDownload(c, store, record, clientIp, true);
      }
    }

    const downloadPath = `/s/${token}/download`;
    const cfg = { ...SHARE_CONFIG_DEFAULTS, ...resolveShareConfig(service) };
    const previewable = isPreviewableInline(record.mimeType, cfg.inlinePreviewMimes);
    const richPreviewable = isRichSpaPreviewable(record.mimeType);
    const og = buildLandingOg(service, record);
    return c.html(
      renderShareLandingPage(record, downloadPath, {
        inlineUrl: previewable ? `/s/${token}?inline=1` : null,
        previewUrl: richPreviewable ? `/#/share/${encodeURIComponent(token)}` : null,
        og,
      }),
    );
  });

  /** Single-file download — POST so unfurl/scrapers don't consume views. */
  app.post('/s/:token/download', async (c) => {
    const clientIp = getClientIpFromHeaders({ get: (n: string) => c.req.header(n) ?? undefined });
    const rateResult = consumeSharePublicLimit(clientIp);
    if (!rateResult.allowed) {
      c.header('Retry-After', String(Math.ceil(rateResult.retryAfterMs / 1000)));
      return c.text('Too many requests', 429);
    }

    const token = c.req.param('token');
    const record = store.getByToken(token);
    if (!record) return c.html(renderShareExpiredPage('not_found'), 404);

    const validation = store.validateAccess(record);
    if (!validation.valid) {
      logShareAudit(
        'share.access_denied',
        { shareId: record.id, tokenPrefix: token.slice(0, 8), reason: validation.reason, clientIp },
        `Share download denied: ${validation.reason}`,
      );
      return c.html(renderShareExpiredPage(validation.reason as ShareExpiredReason), 410);
    }

    if (record.kind !== 'file') {
      return c.html(renderShareExpiredPage('not_found'), 404);
    }
    return handleFileDownload(c, store, record, clientIp);
  });

  /** Claim one state-owned snapshot view. POST prevents social unfurlers from consuming maxViews. */
  app.post('/s/:token/view', async (c) => {
    const clientIp = getClientIpFromHeaders({ get: (n: string) => c.req.header(n) ?? undefined });
    const rateResult = consumeSharePublicLimit(clientIp);
    if (!rateResult.allowed) {
      c.header('Retry-After', String(Math.ceil(rateResult.retryAfterMs / 1000)));
      return c.json({ ok: false, error: { message: 'rate_limited' } }, 429);
    }
    const token = c.req.param('token');
    const record = store.getByToken(token);
    if (!record || (record.kind !== 'note' && record.kind !== 'session')) {
      return c.json({ ok: false, error: { message: 'not_found' } }, 404);
    }
    const validation = store.validateAccess(record);
    if (!validation.valid) return c.json({ ok: false, error: { message: validation.reason } }, 410);
    try {
      if (record.kind === 'session') {
        const manifest = await sessionShares.readManifest(record);
        const consumed = store.consumeAccess(record.id);
        if (consumed.valid === false) return c.json({ ok: false, error: { message: consumed.reason } }, 410);
        logShareAudit(
          'share.access',
          { shareId: record.id, sourceSessionId: record.sourceSessionId, tokenPrefix: token.slice(0, 8), clientIp, snapshotRevision: record.snapshotRevision },
          `Session share viewed: ${record.fileName}`,
        );
        const ticket = manifest.attachments.length ? sessionShares.issueAssetTicket(record) : null;
        return c.json({
          ok: true,
          payload: {
            kind: 'session',
            title: manifest.title,
            snapshotAt: manifest.snapshotAt,
            expiresAt: record.expiresAt,
            description: record.description ?? null,
            snapshotRevision: record.snapshotRevision,
            messages: manifest.messages,
            toolActivities: manifest.toolActivities,
            attachments: manifest.attachments.map(({ artifactFileName: _artifactFileName, checksum: _checksum, ...attachment }) => ({
              ...attachment,
              url: `/s/${encodeURIComponent(token)}/assets/${encodeURIComponent(attachment.id)}?ticket=${encodeURIComponent(ticket ?? '')}`,
            })),
          },
        });
      }
      const manifest = await noteShares.readManifest(record);
      const consumed = store.consumeAccess(record.id);
      if (consumed.valid === false) return c.json({ ok: false, error: { message: consumed.reason } }, 410);
      const ticket = noteShares.issueAssetTicket(record);
      logShareAudit(
        'share.access',
        { shareId: record.id, noteId: record.sourceNoteId, tokenPrefix: token.slice(0, 8), clientIp, snapshotRevision: record.snapshotRevision },
        `Note share viewed: ${record.fileName}`,
      );
      return c.json({
        ok: true,
        payload: {
          kind: 'note',
          title: manifest.title,
          markdown: noteShares.publicMarkdown(record, manifest, ticket),
          snapshotAt: manifest.snapshotAt,
          expiresAt: record.expiresAt,
          description: record.description ?? null,
          sourceVersion: record.sourceVersion,
          snapshotRevision: record.snapshotRevision,
          attachments: manifest.attachments.map(({ artifactFileName: _artifactFileName, checksum: _checksum, ...attachment }) => attachment),
        },
      });
    } catch {
      logShareAudit(
        'share.access_denied',
        {
          shareId: record.id,
          ...(record.kind === 'note' ? { noteId: record.sourceNoteId } : { sourceSessionId: record.sourceSessionId }),
          tokenPrefix: token.slice(0, 8),
          clientIp,
          reason: 'artifact_missing',
        },
        'Share artifact could not be read',
      );
      return c.json({ ok: false, error: { message: 'artifact_missing' } }, 410);
    }
  });

  /** Serve one snapshotted attachment through a short-lived view ticket. */
  app.get('/s/:token/assets/:attachmentId', async (c) => {
    const clientIp = getClientIpFromHeaders({ get: (n: string) => c.req.header(n) ?? undefined });
    const rateResult = consumeSharePublicLimit(clientIp);
    if (!rateResult.allowed) {
      c.header('Retry-After', String(Math.ceil(rateResult.retryAfterMs / 1000)));
      return c.text('Too many requests', 429);
    }
    const record = store.getByToken(c.req.param('token'));
    if (!record || (record.kind !== 'note' && record.kind !== 'session')) return c.text('Not found', 404);
    if (record.revoked || Date.now() >= new Date(record.expiresAt).getTime()) return c.text('Gone', 410);
    const ticket = c.req.query('ticket') ?? '';
    const ticketValid = record.kind === 'note'
      ? noteShares.verifyAssetTicket(record, ticket)
      : sessionShares.verifyAssetTicket(record, ticket);
    if (!ticketValid) return c.text('Forbidden', 403);
    const resolved = record.kind === 'note'
      ? await noteShares.resolveAsset(record, c.req.param('attachmentId')).catch(() => null)
      : await sessionShares.resolveAsset(record, c.req.param('attachmentId')).catch(() => null);
    if (!resolved) return c.text('Not found', 404);
    const fileStat = await stat(resolved.path).catch(() => null);
    if (!fileStat?.isFile()) return c.text('Not found', 404);
    const inline = record.kind === 'session'
      ? isSafeInlineSessionMime(resolved.attachment.mimeType)
      : 'type' in resolved.attachment && resolved.attachment.type !== 'file';
    const stream = createReadStream(resolved.path);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': shareResponseContentType(resolved.attachment.mimeType),
        'Content-Disposition': rfc5987ContentDisposition(inline ? 'inline' : 'attachment', resolved.attachment.fileName),
        'Content-Length': String(fileStat.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        ...(record.kind === 'session' ? { 'Content-Security-Policy': "sandbox; default-src 'none'" } : {}),
      },
    });
  });

  /** Directory child file (GET — preview counts as download per product). */
  app.get('/s/:token/file', async (c) => {
    const clientIp = getClientIpFromHeaders({ get: (n: string) => c.req.header(n) ?? undefined });
    const rateResult = consumeSharePublicLimit(clientIp);
    if (!rateResult.allowed) {
      c.header('Retry-After', String(Math.ceil(rateResult.retryAfterMs / 1000)));
      return c.text('Too many requests', 429);
    }

    const token = c.req.param('token');
    const record = store.getByToken(token);
    if (!record) return c.html(renderShareExpiredPage('not_found'), 404);
    if (record.kind !== 'directory') return c.html(renderShareExpiredPage('not_found'), 404);

    const validation = store.validateAccess(record);
    if (!validation.valid) {
      return c.html(renderShareExpiredPage(validation.reason as ShareExpiredReason), 410);
    }

    const relPath = c.req.query('path') ?? '';
    const inline = c.req.query('inline') === '1' || c.req.query('dl') !== '1';
    return handleDirectoryFile(c, store, service, record, relPath, clientIp, inline);
  });

  /** Directory JSON listing. */
  app.get('/s/:token/tree', async (c) => {
    const clientIp = getClientIpFromHeaders({ get: (n: string) => c.req.header(n) ?? undefined });
    const rateResult = consumeSharePublicLimit(clientIp);
    if (!rateResult.allowed) {
      c.header('Retry-After', String(Math.ceil(rateResult.retryAfterMs / 1000)));
      return c.text('Too many requests', 429);
    }

    const token = c.req.param('token');
    const record = store.getByToken(token);
    if (!record) return c.json({ ok: false, error: { message: 'not_found' } }, 404);
    if (record.kind !== 'directory') return c.json({ ok: false, error: { message: 'not_directory' } }, 400);

    const validation = store.validateAccess(record);
    if (!validation.valid) {
      return c.json({ ok: false, error: { message: validation.reason } }, 410);
    }

    const path = c.req.query('path') ?? '';
    // Tree HTML browser pages: render landing for the sub-path
    if ((c.req.header('accept') ?? '').includes('text/html')) {
      return renderDirectoryLanding(c, store, service, record, token, path);
    }
    try {
      const listing = await store.listDirectory(record, path);
      return c.json({ ok: true, payload: listing });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, 400);
    }
  });

  /** Folder ZIP download (whole share or sub-path). */
  app.get('/s/:token/zip', async (c) => {
    const clientIp = getClientIpFromHeaders({ get: (n: string) => c.req.header(n) ?? undefined });
    const rateResult = consumeSharePublicLimit(clientIp);
    if (!rateResult.allowed) {
      c.header('Retry-After', String(Math.ceil(rateResult.retryAfterMs / 1000)));
      return c.text('Too many requests', 429);
    }

    const token = c.req.param('token');
    const record = store.getByToken(token);
    if (!record) return c.html(renderShareExpiredPage('not_found'), 404);
    if (record.kind !== 'directory') return c.html(renderShareExpiredPage('not_found'), 404);

    const validation = store.validateAccess(record);
    if (!validation.valid) {
      return c.html(renderShareExpiredPage(validation.reason as ShareExpiredReason), 410);
    }

    return handleDirectoryZip(c, store, service, record, c.req.query('path') ?? '', clientIp);
  });

  /** Metadata (for link preview cards / unfurl). Does NOT consume views. */
  app.get('/s/:token/meta', async (c) => {
    const clientIp = getClientIpFromHeaders({ get: (n: string) => c.req.header(n) ?? undefined });
    const rateResult = consumeSharePublicLimit(clientIp);
    if (!rateResult.allowed) {
      c.header('Retry-After', String(Math.ceil(rateResult.retryAfterMs / 1000)));
      return c.text('Too many requests', 429);
    }

    const token = c.req.param('token');
    const record = store.getByToken(token);
    if (!record) return c.json({ valid: false }, 404);

    const validation = store.validateAccess(record);
    const remainingViews = record.maxViews !== null ? Math.max(0, record.maxViews - record.downloadCount) : null;

    return c.json({
      kind: record.kind,
      fileName: record.fileName,
      fileSize: record.fileSize,
      mimeType: record.mimeType,
      description: record.description ?? null,
      expiresAt: record.expiresAt,
      remainingViews,
      valid: validation.valid,
      directory: record.directory ?? null,
      ...(record.kind === 'note' ? {
        sourceVersion: record.sourceVersion,
        snapshotRevision: record.snapshotRevision,
        attachmentCount: record.attachmentCount,
      } : record.kind === 'session' ? {
        cutoffSeq: record.cutoffSeq,
        snapshotRevision: record.snapshotRevision,
        messageCount: record.messageCount,
        attachmentCount: record.attachmentCount,
        includeToolActivities: record.includeToolActivities,
      } : {}),
    });
  });

  /** HEAD check. */
  app.on('HEAD', '/s/:token', async (c) => {
    const token = c.req.param('token');
    const record = store.getByToken(token);
    if (!record) return c.body(null, 404);
    const validation = store.validateAccess(record);
    return c.body(null, validation.valid ? 200 : 410);
  });

  /** Thumbnail (jpeg/png/svg) — does NOT consume views. */
  app.get('/s/:token/thumbnail', async (c) => {
    const clientIp = getClientIpFromHeaders({ get: (n: string) => c.req.header(n) ?? undefined });
    const rateResult = consumeSharePublicLimit(clientIp);
    if (!rateResult.allowed) {
      c.header('Retry-After', String(Math.ceil(rateResult.retryAfterMs / 1000)));
      return c.text('Too many requests', 429);
    }
    const token = c.req.param('token');
    const record = store.getByToken(token);
    if (!record) return c.body(null, 404);
    const validation = store.validateAccess(record);
    if (!validation.valid) return c.body(null, 410);

    const cached = await readThumbnail(token);
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: {
          'Content-Type': thumbnailContentType(cached),
          'Cache-Control': 'public, max-age=300',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    if (record.kind === 'note' || record.kind === 'session') {
      const placeholder = placeholderSvg(record.fileName, 'text');
      return new Response(placeholder, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    // Schedule and return a placeholder so social-card scrapers always get an image.
    scheduleThumbnail({ scope: 'file', token, recordId: record.id }, thumbnailRenderContext(service));
    const placeholder = placeholderSvg(record.fileName, record.kind === 'directory' ? 'folder' : 'file');
    return new Response(placeholder, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=10',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  app.on('HEAD', '/s/:token/thumbnail', async (c) => {
    const token = c.req.param('token');
    const record = store.getByToken(token);
    if (!record) return c.body(null, 404);
    const validation = store.validateAccess(record);
    if (!validation.valid) return c.body(null, 410);
    const ready = await thumbnailExists(token);
    return c.body(null, ready ? 200 : 202);
  });

  /** Site-share thumbnail. Shape mirrors /s/:token/thumbnail. */
  app.get('/site/:token/thumbnail', async (c) => {
    const clientIp = getClientIpFromHeaders({ get: (n: string) => c.req.header(n) ?? undefined });
    const rateResult = consumeSharePublicLimit(clientIp);
    if (!rateResult.allowed) {
      c.header('Retry-After', String(Math.ceil(rateResult.retryAfterMs / 1000)));
      return c.text('Too many requests', 429);
    }
    const token = c.req.param('token');
    const siteStore = getSiteShareStore(resolveSiteShareConfig(service));
    const record = siteStore.getByToken(token);
    if (!record) return c.body(null, 404);
    const validation = siteStore.validateAccess(record);
    if (!validation.valid) return c.body(null, 410);

    const cached = await readThumbnail(token);
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: {
          'Content-Type': thumbnailContentType(cached),
          'Cache-Control': 'public, max-age=300',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    scheduleThumbnail({ scope: 'site', token, recordId: record.id }, thumbnailRenderContext(service));
    const placeholder = placeholderSvg(record.description ?? 'site share', 'html');
    return new Response(placeholder, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=10',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  app.on('HEAD', '/site/:token/thumbnail', async (c) => {
    const token = c.req.param('token');
    const ready = await thumbnailExists(token);
    return c.body(null, ready ? 200 : 202);
  });

  // Wire share-store cleanup → drop on-disk thumbnail file.
  store.setCleanupHook((rec) => {
    void deleteThumbnail(rec.token);
  });
}

// ── Authenticated routes ──────────────────────────────────────────────────────

export function registerShareRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  const store = getShareStore(resolveShareConfig(service));
  const noteShares = new NoteShareService(store, service.notesServiceInstance);
  const sessionShares = createSessionShareService(service, store);
  const hostedBuilder = new HostedSessionShareBuilder(createSessionShareSource(service));
  const hostedPublisher = new HostedSessionSharePublisher();
  const hostedBindings = new HostedShareBindingStore();
  const siteStoreEager = getSiteShareStore(resolveSiteShareConfig(service));
  // Register once: when a site share is revoked / expires, drop its staging dir (if any).
  siteStoreEager.setCleanupHook((rec) => {
    const dir = forgetStagedSite(rec.id);
    if (dir) void cleanupStagedSite(dir);
  });

  authenticated.get('/api/sessions/:key/share-preview', async (c) => {
    try {
      const preview = await sessionShares.preview(c.req.param('key'));
      return c.json({ ok: true, payload: preview });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, message === 'Session not found' ? 404 : 400);
    }
  });

  authenticated.get('/api/sessions/:key/shares', async (c) => {
    const metadata = await service.sessionIndexInstance.getSessionMetadata(c.req.param('key'));
    if (!metadata?.sessionId) return c.json({ ok: false, error: { message: 'Session not found' } }, 404);
    const urlCtx = getShareUrlContext(service);
    const now = Date.now();
    const items = sessionShares.list(metadata.sessionId).map((record) => {
      const resolved = resolveShareUrl(record.token, urlCtx);
      return {
        id: record.id,
        kind: record.kind,
        delivery: 'local',
        fileName: record.fileName,
        shareUrl: resolved.shareUrl,
        lanUrl: resolved.lanUrl,
        reachability: resolved.reachability,
        reachabilityHint: resolved.reachabilityHint,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        viewCount: record.downloadCount,
        maxViews: record.maxViews,
        revoked: record.revoked,
        expired: now >= new Date(record.expiresAt).getTime(),
        description: record.description ?? null,
        cutoffSeq: record.cutoffSeq,
        snapshotRevision: record.snapshotRevision,
        messageCount: record.messageCount,
        attachmentCount: record.attachmentCount,
        includeToolActivities: record.includeToolActivities,
      };
    });
    return c.json({ ok: true, payload: { shares: items } });
  });

  authenticated.post('/api/sessions/:key/shares', async (c) => {
    const gatewayToken = extractToken({ authorization: c.req.header('authorization') ?? undefined });
    if (!gatewayToken) return c.json({ ok: false, error: { message: 'Token required' } }, 401);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.expectedSessionId !== 'string' || typeof body.expectedCutoffSeq !== 'number' || typeof body.expectedMetadataUpdatedAt !== 'string') {
      return c.json({ ok: false, error: { message: 'Share preview fingerprint is required' } }, 400);
    }
    try {
      const record = await sessionShares.create(c.req.param('key'), {
        expectedSessionId: body.expectedSessionId,
        expectedCutoffSeq: body.expectedCutoffSeq,
        expectedMetadataUpdatedAt: body.expectedMetadataUpdatedAt,
        ttlMs: typeof body.ttlMs === 'number' ? body.ttlMs : undefined,
        maxViews: body.maxViews === null ? null : typeof body.maxViews === 'number' ? body.maxViews : undefined,
        description: typeof body.description === 'string' ? body.description.trim() || undefined : undefined,
        includeToolActivities: body.includeToolActivities === true,
        attachmentIds: Array.isArray(body.attachmentIds)
          ? body.attachmentIds.filter((id): id is string => typeof id === 'string')
          : undefined,
        gatewayTokenHash: hashGatewayToken(gatewayToken),
      });
      const resolved = resolveShareUrl(record.token, getShareUrlContext(service));
      return c.json({
        ok: true,
        payload: {
          id: record.id,
          kind: record.kind,
          delivery: 'local',
          shareUrl: resolved.shareUrl,
          lanUrl: resolved.lanUrl,
          reachability: resolved.reachability,
          reachabilityHint: resolved.reachabilityHint,
          expiresAt: record.expiresAt,
          maxViews: record.maxViews,
          fileName: record.fileName,
          messageCount: record.messageCount,
          attachmentCount: record.attachmentCount,
          snapshotRevision: record.snapshotRevision,
          includeToolActivities: record.includeToolActivities,
        },
      }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof SessionShareSnapshotConflictError
        ? 409
        : message === 'Session not found' ? 404 : 400;
      return c.json({ ok: false, error: { message, code: status === 409 ? 'session_snapshot_conflict' : undefined } }, status);
    }
  });

  authenticated.post('/api/sessions/:key/shares/:shareId/refresh', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.expectedSessionId !== 'string' || typeof body.expectedCutoffSeq !== 'number' || typeof body.expectedMetadataUpdatedAt !== 'string') {
      return c.json({ ok: false, error: { message: 'Share preview fingerprint is required' } }, 400);
    }
    try {
      const record = await sessionShares.refresh(c.req.param('key'), c.req.param('shareId'), {
        expectedSessionId: body.expectedSessionId,
        expectedCutoffSeq: body.expectedCutoffSeq,
        expectedMetadataUpdatedAt: body.expectedMetadataUpdatedAt,
        includeToolActivities: typeof body.includeToolActivities === 'boolean' ? body.includeToolActivities : undefined,
        attachmentIds: Array.isArray(body.attachmentIds)
          ? body.attachmentIds.filter((id): id is string => typeof id === 'string')
          : undefined,
      });
      const resolved = resolveShareUrl(record.token, getShareUrlContext(service));
      return c.json({ ok: true, payload: {
        id: record.id,
        kind: record.kind,
        delivery: 'local',
        shareUrl: resolved.shareUrl,
        lanUrl: resolved.lanUrl,
        reachability: resolved.reachability,
        reachabilityHint: resolved.reachabilityHint,
        expiresAt: record.expiresAt,
        maxViews: record.maxViews,
        fileName: record.fileName,
        messageCount: record.messageCount,
        attachmentCount: record.attachmentCount,
        snapshotRevision: record.snapshotRevision,
        includeToolActivities: record.includeToolActivities,
      } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof SessionShareSnapshotConflictError
        ? 409
        : message === 'Session share not found' || message === 'Session not found' ? 404 : 400;
      return c.json({ ok: false, error: { message, code: status === 409 ? 'session_snapshot_conflict' : undefined } }, status);
    }
  });

  authenticated.get('/api/sessions/:key/hosted-shares', async (c) => {
    const metadata = await service.sessionIndexInstance.getSessionMetadata(c.req.param('key'));
    if (!metadata?.sessionId) return c.json({ ok: false, error: { message: 'Session not found' } }, 404);
    try {
      await hostedBindings.reconcile(await hostedPublisher.list());
      return c.json({
        ok: true,
        payload: { shares: (await hostedBindings.list(metadata.sessionId)).map(hostedBindingResponse) },
      });
    } catch (err) {
      return hostedShareErrorResponse(c, err);
    }
  });

  authenticated.post('/api/sessions/:key/hosted-shares', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.expectedSessionId !== 'string' || typeof body.expectedCutoffSeq !== 'number' || typeof body.expectedMetadataUpdatedAt !== 'string') {
      return c.json({ ok: false, error: { message: 'Share preview fingerprint is required' } }, 400);
    }
    try {
      const snapshot = await hostedBuilder.build(c.req.param('key'), hostedBuildInput(body));
      const result = await hostedPublisher.create(snapshot, {
        ttlMs: typeof body.ttlMs === 'number' ? body.ttlMs : 86_400_000,
        maxViews: body.maxViews === null ? null : typeof body.maxViews === 'number' ? body.maxViews : null,
      });
      const now = new Date().toISOString();
      const binding: HostedShareBinding = {
        ...result,
        sessionId: snapshot.sessionId,
        cutoffSeq: snapshot.cutoffSeq,
        title: snapshot.manifest.title,
        description: snapshot.manifest.description ?? null,
        messageCount: snapshot.manifest.messages.length,
        attachmentCount: snapshot.manifest.attachments.length,
        includeToolActivities: body.includeToolActivities === true,
        attachmentIds: snapshot.manifest.attachments.map((attachment) => attachment.id),
        createdAt: now,
        updatedAt: now,
        revoked: false,
      };
      await hostedBindings.upsert(binding);
      return c.json({ ok: true, payload: hostedBindingResponse(binding) }, 201);
    } catch (err) {
      return hostedShareErrorResponse(c, err);
    }
  });

  authenticated.post('/api/sessions/:key/hosted-shares/:shareId/refresh', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.expectedSessionId !== 'string' || typeof body.expectedCutoffSeq !== 'number' || typeof body.expectedMetadataUpdatedAt !== 'string') {
      return c.json({ ok: false, error: { message: 'Share preview fingerprint is required' } }, 400);
    }
    const previous = (await hostedBindings.list(body.expectedSessionId))
      .find((binding) => binding.id === c.req.param('shareId') && !binding.revoked);
    if (!previous) return c.json({ ok: false, error: { message: 'Hosted share not found' } }, 404);
    try {
      const snapshot = await hostedBuilder.build(c.req.param('key'), {
        ...hostedBuildInput(body),
        description: previous.description ?? undefined,
        includeToolActivities: typeof body.includeToolActivities === 'boolean'
          ? body.includeToolActivities
          : previous.includeToolActivities,
        attachmentIds: Array.isArray(body.attachmentIds)
          ? body.attachmentIds.filter((id): id is string => typeof id === 'string')
          : previous.attachmentIds,
      });
      const result = await hostedPublisher.refresh(previous.id, previous.snapshotRevision, previous.shareUrl, snapshot);
      const binding: HostedShareBinding = {
        ...previous,
        ...result,
        cutoffSeq: snapshot.cutoffSeq,
        title: snapshot.manifest.title,
        messageCount: snapshot.manifest.messages.length,
        attachmentCount: snapshot.manifest.attachments.length,
        includeToolActivities: typeof body.includeToolActivities === 'boolean'
          ? body.includeToolActivities
          : previous.includeToolActivities,
        attachmentIds: snapshot.manifest.attachments.map((attachment) => attachment.id),
        updatedAt: new Date().toISOString(),
      };
      await hostedBindings.upsert(binding);
      return c.json({ ok: true, payload: hostedBindingResponse(binding) });
    } catch (err) {
      return hostedShareErrorResponse(c, err);
    }
  });

  authenticated.delete('/api/sessions/:key/hosted-shares/:shareId', async (c) => {
    const metadata = await service.sessionIndexInstance.getSessionMetadata(c.req.param('key'));
    if (!metadata?.sessionId) return c.json({ ok: false, error: { message: 'Session not found' } }, 404);
    const binding = (await hostedBindings.list(metadata.sessionId)).find((item) => item.id === c.req.param('shareId'));
    if (!binding) return c.json({ ok: false, error: { message: 'Hosted share not found' } }, 404);
    try {
      await hostedPublisher.revoke(binding.id);
      await hostedBindings.upsert({ ...binding, revoked: true, updatedAt: new Date().toISOString() });
      return c.json({ ok: true, payload: { revoked: binding.id } });
    } catch (err) {
      return hostedShareErrorResponse(c, err);
    }
  });

  authenticated.post('/api/shares', async (c) => {
    const gatewayToken = extractToken({ authorization: c.req.header('authorization') ?? undefined });
    if (!gatewayToken) return c.json({ ok: false, error: { message: 'Token required' } }, 401);

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }

    const path = typeof body.path === 'string' ? body.path.trim() : '';
    if (!path) return c.json({ ok: false, error: { message: 'Missing path' } }, 400);

    const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : undefined;
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : undefined;

    const workspaceRoot = await resolveWorkspaceRootForShare(service, sessionKey, agentId);
    if (!workspaceRoot) {
      return c.json({ ok: false, error: { message: 'Workspace not configured' } }, 400);
    }

    const ttlMs = typeof body.ttlMs === 'number' ? body.ttlMs : undefined;
    const maxViews = body.maxViews === null ? null : typeof body.maxViews === 'number' ? body.maxViews : undefined;
    const description = typeof body.description === 'string' ? body.description.trim() || undefined : undefined;
    const kind = body.kind === 'directory' || body.kind === 'file' ? body.kind : undefined;
    const directoryMode = body.directoryMode === 'zip-only' ? 'zip-only' : body.directoryMode === 'browse' ? 'browse' : undefined;
    const followSymlinks = body.followSymlinks === true;
    const maxFileCount = typeof body.maxFileCount === 'number' ? body.maxFileCount : undefined;
    const maxFolderSize = typeof body.maxFolderSize === 'number' ? body.maxFolderSize : undefined;
    const maxDepth = typeof body.maxDepth === 'number' ? body.maxDepth : undefined;

    try {
      store.updateConfig(resolveShareConfig(service));
      const record = await store.create({
        path,
        ttlMs,
        maxViews,
        description,
        sessionKey,
        agentId,
        workspaceRoot,
        gatewayTokenHash: hashGatewayToken(gatewayToken),
        kind,
        directoryMode,
        followSymlinks,
        maxFileCount,
        maxFolderSize,
        maxDepth,
      });

      const urlCtx = getShareUrlContext(service);
      const resolved = resolveShareUrl(record.token, urlCtx);

      return c.json(
        {
          ok: true,
          payload: {
            id: record.id,
            token: record.token,
            kind: record.kind,
            shareUrl: resolved.shareUrl,
            lanUrl: resolved.lanUrl,
            reachability: resolved.reachability,
            reachabilityHint: resolved.reachabilityHint,
            expiresAt: record.expiresAt,
            maxViews: record.maxViews,
            fileName: record.fileName,
            fileSize: record.fileSize,
            directory: record.directory ?? null,
          },
        },
        201,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, 400);
    }
  });

  /**
   * Smart share — picks file vs site, fills sensible defaults, returns the
   * payload the mobile share-sheet needs (title, description, thumbnailUrl,
   * reachability) in a single round-trip.
   */
  authenticated.post('/api/shares/auto', async (c) => {
    const gatewayToken = extractToken({ authorization: c.req.header('authorization') ?? undefined });
    if (!gatewayToken) return c.json({ ok: false, error: { message: 'Token required' } }, 401);

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }

    const fileId = typeof body.fileId === 'string' ? body.fileId.trim() : '';
    let path = typeof body.path === 'string' ? body.path.trim() : '';
    if (!fileId && !path) return c.json({ ok: false, error: { message: 'Missing path or fileId' } }, 400);
    const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : undefined;
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : undefined;
    const mode = (typeof body.mode === 'string' && ['auto', 'force-file', 'force-site', 'force-zip'].includes(body.mode))
      ? (body.mode as ShareAutoMode)
      : 'auto';
    const audience: ShareAudience | undefined =
      body.audience === 'friend' || body.audience === 'colleague' || body.audience === 'public'
        ? body.audience
        : undefined;
    const title = typeof body.title === 'string' ? body.title : undefined;
    const description = typeof body.description === 'string' ? body.description : undefined;
    const ttlOverride = typeof body.ttlMs === 'number' ? body.ttlMs : undefined;
    const maxViewsOverride =
      body.maxViews === null ? null : typeof body.maxViews === 'number' ? body.maxViews : undefined;
    const wantThumbnail = body.thumbnail !== false;

    let workspaceRoot: string;
    let probe;
    try {
      if (fileId) {
        const target = await getGatewayFileSpaceService(service).resource(fileId);
        workspaceRoot = target.space.root;
        path = target.resource.relativePath || '.';
      } else {
        workspaceRoot = await resolveWorkspaceRootForShare(service, sessionKey, agentId);
      }
      if (!workspaceRoot) {
        return c.json({ ok: false, error: { message: 'Workspace not configured' } }, 400);
      }
      probe = await probeShareTarget(workspaceRoot, path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, err instanceof FileServiceError ? err.status : 400);
    }

    let decision;
    try {
      decision = decideShareKind(probe, mode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, 400);
    }

    const defaults = audienceDefaults(audience);
    const ttlMs = ttlOverride ?? defaults.ttlMs;
    const maxViews = maxViewsOverride !== undefined ? maxViewsOverride : defaults.maxViews;
    const tokenHash = hashGatewayToken(gatewayToken);
    const urlCtx = getShareUrlContext(service);

    try {
      if (decision.kind === 'site') {
        const siteStore = getSiteShareStore(resolveSiteShareConfig(service));
        // Single HTML file → stage into a temp dir as index.html so it can be
        // served as a site (recipient lands on a rendered page, not the
        // file-landing). The staging dir is auto-cleaned on revoke/expire.
        let sitePath = path;
        let stagedDir: string | null = null;
        if (probe.kind === 'file') {
          const staged = await stageSingleHtmlAsSite(workspaceRoot, probe.absolutePath);
          sitePath = staged.relativePath;
          stagedDir = staged.stagingDir;
        }
        const siteRec = await siteStore.create({
          kind: 'static',
          path: sitePath,
          ttlMs,
          description,
          subdomain: typeof body.subdomain === 'string' ? body.subdomain : undefined,
          spaFallback: true,
          rewriteMode: 'html-css',
          sessionKey,
          agentId,
          workspaceRoot,
          gatewayTokenHash: tokenHash,
        });
        if (stagedDir) rememberStagedSite(siteRec.id, stagedDir);
        const cfg = siteStore.getConfig();
        const subdomainLabel = siteRec.subdomain ?? siteRec.token;
        const resolved = resolveSiteShareUrl({
          ...urlCtx,
          token: siteRec.token,
          subdomainLabel,
          publicHostSuffix: cfg.publicHostSuffix,
        });
        if (wantThumbnail) {
          scheduleThumbnail({ scope: 'site', token: siteRec.token, recordId: siteRec.id }, thumbnailRenderContext(service));
          siteStore.setThumbnailStatus(siteRec.id, 'pending');
        }
        const titleOut = makeTitle(probe.kind === 'directory' ? path.split('/').pop() || path : path, title);
        return c.json({
          ok: true,
          payload: {
            share: {
              id: siteRec.id,
              kind: 'site',
              title: titleOut,
              description: makeDescription({ audience, expiresAt: siteRec.expiresAt, override: description }),
              shareUrl: resolved.shareUrl,
              lanUrl: null,
              reachability: resolved.reachability,
              reachabilityHint: resolved.reachabilityHint,
              expiresAt: siteRec.expiresAt,
              maxViews: null,
            },
            thumbnail: {
              url: wantThumbnail ? resolved.thumbnailUrl : '',
              status: wantThumbnail ? 'pending' : 'unavailable',
              width: SHARE_CONFIG_DEFAULTS.thumbnail.viewportWidth,
              height: SHARE_CONFIG_DEFAULTS.thumbnail.viewportHeight,
            },
            routing: { reason: decision.reason, hint: decision.hint },
          },
        }, 201);
      }

      return await createFileShareResponse({
        c, service, store, probe, decision,
        ttlMs, maxViews, title, description, audience,
        workspaceRoot, tokenHash, urlCtx, wantThumbnail,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, 400);
    }
  });

  authenticated.get('/api/shares', async (c) => {
    store.updateConfig(resolveShareConfig(service));
    const shares = store.getAllShares();
    const urlCtx = getShareUrlContext(service);
    const now = Date.now();

    const items = shares.map((r) => {
      const resolved = resolveShareUrl(r.token, urlCtx);
      const expired = now >= new Date(r.expiresAt).getTime();
      return {
        id: r.id,
        kind: r.kind,
        fileName: r.fileName,
        workspaceRelativePath: r.workspaceRelativePath,
        shareUrl: resolved.shareUrl,
        lanUrl: resolved.lanUrl,
        reachability: resolved.reachability,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        downloadCount: r.downloadCount,
        maxViews: r.maxViews,
        revoked: r.revoked,
        expired,
        description: r.description ?? null,
        fileSize: r.fileSize,
        mimeType: r.mimeType,
        directory: r.directory ?? null,
        ...(r.kind === 'note' ? {
          sourceNoteId: r.sourceNoteId,
          sourceVersion: r.sourceVersion,
          snapshotRevision: r.snapshotRevision,
          attachmentCount: r.attachmentCount,
        } : r.kind === 'session' ? {
          sourceSessionId: r.sourceSessionId,
          cutoffSeq: r.cutoffSeq,
          snapshotRevision: r.snapshotRevision,
          messageCount: r.messageCount,
          attachmentCount: r.attachmentCount,
          includeToolActivities: r.includeToolActivities,
        } : {}),
      };
    });

    return c.json({ ok: true, payload: { shares: items } });
  });

  authenticated.get('/api/shares/:id', async (c) => {
    const id = c.req.param('id');
    const record = store.getById(id);
    if (!record) return c.json({ ok: false, error: { message: 'Not found' } }, 404);

    const urlCtx = getShareUrlContext(service);
    const resolved = resolveShareUrl(record.token, urlCtx);
    const expired = Date.now() >= new Date(record.expiresAt).getTime();
    const { token: _token, createdByTokenHash: _createdByTokenHash, ...safeRecord } = record;
    if ('assetTicketSecret' in safeRecord) delete (safeRecord as Partial<typeof safeRecord>).assetTicketSecret;

    return c.json({
      ok: true,
      payload: {
        ...safeRecord,
        shareUrl: resolved.shareUrl,
        lanUrl: resolved.lanUrl,
        reachability: resolved.reachability,
        expired,
      },
    });
  });

  authenticated.delete('/api/shares/:id', async (c) => {
    const id = c.req.param('id');
    const record = store.getById(id);
    const success = store.revoke(id);
    if (!success) return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    if (record?.kind === 'note') await noteShares.removeArtifact(record.id);
    if (record?.kind === 'session') await sessionShares.removeArtifact(record.id);
    return c.json({ ok: true });
  });

  authenticated.delete('/api/shares', async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      /* empty body = no-op */
    }

    if (body.expired === true) {
      const expiredStateShares = store.getAllShares().filter(
        (record) => (record.kind === 'note' || record.kind === 'session') && !record.revoked && Date.now() >= new Date(record.expiresAt).getTime(),
      );
      const count = store.revokeExpired();
      await Promise.all(expiredStateShares.map((record) => record.kind === 'note'
        ? noteShares.removeArtifact(record.id)
        : sessionShares.removeArtifact(record.id)));
      return c.json({ ok: true, payload: { revokedCount: count } });
    }

    const ids = Array.isArray(body.ids) ? (body.ids as string[]).filter((x) => typeof x === 'string') : [];
    if (ids.length === 0) {
      return c.json({ ok: false, error: { message: 'Provide ids array or expired: true' } }, 400);
    }
    const stateRecords = ids.map((id) => store.getById(id)).filter(
      (record): record is import('../../../share/share-types.js').NoteShareRecord | import('../../../share/share-types.js').SessionShareRecord =>
        record?.kind === 'note' || record?.kind === 'session',
    );
    const count = store.revokeMany(ids);
    await Promise.all(stateRecords.map((record) => record.kind === 'note'
      ? noteShares.removeArtifact(record.id)
      : sessionShares.removeArtifact(record.id)));
    return c.json({ ok: true, payload: { revokedCount: count } });
  });

  authenticated.patch('/api/shares/:id', async (c) => {
    const id = c.req.param('id');
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }

    const patch: { extendTtlMs?: number; maxViews?: number | null } = {};
    if (typeof body.extendTtlMs === 'number') patch.extendTtlMs = body.extendTtlMs;
    if (body.maxViews === null || typeof body.maxViews === 'number') patch.maxViews = body.maxViews as number | null;

    const updated = store.update(id, patch);
    if (!updated) return c.json({ ok: false, error: { message: 'Not found' } }, 404);

    const urlCtx = getShareUrlContext(service);
    const resolved = resolveShareUrl(updated.token, urlCtx);

    return c.json({
      ok: true,
      payload: {
        id: updated.id,
        expiresAt: updated.expiresAt,
        maxViews: updated.maxViews,
        shareUrl: resolved.shareUrl,
      },
    });
  });
}

function createSessionShareService(
  service: GatewayService,
  store: ReturnType<typeof getShareStore>,
): SessionShareService {
  return new SessionShareService(store, createSessionShareSource(service));
}

function createSessionShareSource(service: GatewayService) {
  return {
    getMetadata: (sessionKey) => service.sessionIndexInstance.getSessionMetadata(sessionKey),
    getSnapshot: async (sessionKey) => loadCompactionSourceSnapshot(sessionKey),
  };
}

function hostedBuildInput(body: Record<string, unknown>) {
  return {
    expectedSessionId: String(body.expectedSessionId),
    expectedCutoffSeq: Number(body.expectedCutoffSeq),
    expectedMetadataUpdatedAt: String(body.expectedMetadataUpdatedAt),
    description: typeof body.description === 'string' ? body.description.trim() || undefined : undefined,
    includeToolActivities: body.includeToolActivities === true,
    attachmentIds: Array.isArray(body.attachmentIds)
      ? body.attachmentIds.filter((id): id is string => typeof id === 'string')
      : undefined,
  };
}

function hostedBindingResponse(binding: HostedShareBinding) {
  return {
    id: binding.id,
    kind: 'session' as const,
    delivery: 'hosted' as const,
    shareUrl: binding.shareUrl,
    lanUrl: null,
    reachability: 'public' as const,
    reachabilityHint: null,
    expiresAt: binding.expiresAt,
    maxViews: binding.maxViews,
    fileName: binding.title,
    messageCount: binding.messageCount,
    attachmentCount: binding.attachmentCount,
    snapshotRevision: binding.snapshotRevision,
    includeToolActivities: binding.includeToolActivities,
    createdAt: binding.createdAt,
    viewCount: binding.viewCount,
    revoked: binding.revoked,
    expired: Date.now() >= new Date(binding.expiresAt).getTime(),
    description: binding.description,
    cutoffSeq: binding.cutoffSeq,
  };
}

function hostedShareErrorResponse(c: Context, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const status = err instanceof HostedShareAuthorizationError
    ? 401
    : err instanceof SessionShareSnapshotConflictError
      ? 409
      : message === 'Session not found' || message === 'Hosted share not found'
        ? 404
        : 400;
  return c.json({
    ok: false,
    error: {
      message,
      code: err instanceof HostedShareAuthorizationError
        ? 'hosted_share_auth_required'
        : status === 409 ? 'session_snapshot_conflict' : undefined,
    },
  }, status);
}

// ── Directory landing / file / zip helpers ────────────────────────────────────

async function renderDirectoryLanding(
  c: Context,
  store: ReturnType<typeof getShareStore>,
  service: GatewayService,
  record: DirectoryShareRecord,
  token: string,
  subPath = '',
): Promise<Response> {
  store.updateConfig(resolveShareConfig(service));
  const urls = {
    tree: (p: string) => (p ? `/s/${token}/tree?path=${encodeURIComponent(p)}` : `/s/${token}`),
    file: (p: string) => `/s/${token}/file?path=${encodeURIComponent(p)}`,
    zip: (p: string) => (p ? `/s/${token}/zip?path=${encodeURIComponent(p)}` : `/s/${token}/zip`),
  };

  let listing: import('../../../share/share-store.js').DirectoryListing | null = null;
  if (record.directory?.mode !== 'zip-only') {
    try {
      listing = await store.listDirectory(record, subPath);
    } catch (err) {
      logShareAudit(
        'share.access_denied',
        { shareId: record.id, tokenPrefix: record.token.slice(0, 8), subPath, reason: String(err) },
        `Directory listing failed`,
      );
      return c.html(renderShareExpiredPage('not_found'), 404);
    }
  }
  const og = buildLandingOg(service, record);
  return c.html(renderFolderLandingPage(record, listing, urls, { og })) as unknown as Response;
}

function buildLandingOg(service: GatewayService, record: ShareRecord) {
  const resolved = resolveShareUrl(record.token, getShareUrlContext(service));
  // Only emit OG tags when the share is genuinely public — otherwise WeChat
  // and friends would silently fall back to "no preview" on unreachable URLs.
  if (resolved.reachability !== 'public') return undefined;
  return {
    absoluteShareUrl: resolved.shareUrl,
    absoluteThumbnailUrl: `${resolved.shareUrl}/thumbnail`,
    title: record.fileName,
    description: record.description
      ?? (record.kind === 'session' ? `${record.messageCount} messages shared via xopc` : undefined),
  };
}

function isSafeInlineSessionMime(mimeType: string): boolean {
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase();
  return normalized === 'image/png'
    || normalized === 'image/jpeg'
    || normalized === 'image/gif'
    || normalized === 'image/webp'
    || normalized?.startsWith('audio/') === true
    || normalized?.startsWith('video/') === true;
}

async function handleDirectoryFile(
  c: Context,
  store: ReturnType<typeof getShareStore>,
  service: GatewayService,
  record: DirectoryShareRecord,
  relPath: string,
  clientIp: string,
  inline: boolean,
): Promise<Response> {
  if (!acquireDownloadSlot(record.token)) {
    return new Response('Too many concurrent downloads for this share', { status: 429 });
  }

  try {
    const resolved = await store.resolveDirectoryChild(record, relPath);
    if (resolved.ok !== true) {
      logShareAudit(
        'share.access_denied',
        { shareId: record.id, tokenPrefix: record.token.slice(0, 8), reason: resolved.reason, clientIp, relPath },
        `Directory child resolution failed: ${resolved.reason}`,
      );
      return c.html(renderShareExpiredPage('not_found'), 404);
    }
    const integrity = await store.validateFileIntegrity(record);
    if (!integrity.valid) {
      return c.html(renderShareExpiredPage((integrity.reason ?? 'file_deleted') as ShareExpiredReason), 410);
    }

    const fileStat = await stat(resolved.absolutePath);
    if (!fileStat.isFile()) {
      return c.html(renderShareExpiredPage('not_found'), 404);
    }

    // Re-check size against configured max
    store.updateConfig(resolveShareConfig(service));
    const cfg = store.getConfig();
    if (fileStat.size > cfg.maxFileSize) {
      return c.html(renderShareExpiredPage('not_found'), 410);
    }

    // Inline preview MIME guard
    const cfgPreview = { ...SHARE_CONFIG_DEFAULTS, ...resolveShareConfig(service) };
    const baseName = relPath.split('/').pop() || record.fileName;
    const { resolveMimeType } = await import('../../../share/share-store.js');
    const mime = resolveMimeType(baseName);
    const useInline = inline && cfgPreview.inlinePreviewMimes.includes(mime);

    store.incrementDownloadCount(record.id);
    logShareAudit(
      'share.access',
      { shareId: record.id, tokenPrefix: record.token.slice(0, 8), clientIp, relPath, mode: useInline ? 'inline' : 'attachment' },
      `Directory file served: ${baseName}`,
    );

    const stream = createReadStream(resolved.absolutePath);
    const webStream = Readable.toWeb(stream) as ReadableStream;
    const disposition = rfc5987ContentDisposition(useInline ? 'inline' : 'attachment', baseName);

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': shareResponseContentType(mime),
        ...(useInline && mime === 'text/html' ? { 'Content-Security-Policy': SHARED_HTML_CSP } : {}),
        'Content-Disposition': disposition,
        'Content-Length': String(fileStat.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } finally {
    releaseDownloadSlot(record.token);
  }
}

async function handleDirectoryZip(
  c: Context,
  store: ReturnType<typeof getShareStore>,
  service: GatewayService,
  record: DirectoryShareRecord,
  subPath: string,
  clientIp: string,
): Promise<Response> {
  store.updateConfig(resolveShareConfig(service));
  const cfg = store.getConfig();
  const zipLimit = cfg.directory.zipConcurrency;
  if (!acquireZipSlot(record.token, zipLimit)) {
    return new Response('Too many concurrent ZIP streams for this share', { status: 429 });
  }

  try {
    const resolved = await store.resolveDirectoryChild(record, subPath);
    if (resolved.ok !== true) {
      return c.html(renderShareExpiredPage('not_found'), 404);
    }
    const integrity = await store.validateFileIntegrity(record);
    if (!integrity.valid) {
      return c.html(renderShareExpiredPage((integrity.reason ?? 'file_deleted') as ShareExpiredReason), 410);
    }

    const files = await planDirectoryFiles(record, {
      rootRelativePath: subPath,
      maxFileCount: cfg.directory.maxFileCount,
      maxFolderSize: cfg.directory.maxFolderSize,
      followSymlinks: record.directory?.followSymlinks ?? false,
      maxDepth: record.directory?.maxDepth ?? cfg.directory.maxDepth,
    });

    store.incrementDownloadCount(record.id);
    logShareAudit(
      'share.access',
      { shareId: record.id, tokenPrefix: record.token.slice(0, 8), clientIp, mode: 'zip', subPath, fileCount: files.length },
      `Directory zip served: ${record.fileName}${subPath ? '/' + subPath : ''}`,
    );

    const zipName = subPath
      ? `${record.fileName}-${subPath.replace(/[\\/]/g, '_')}.zip`
      : `${record.fileName}.zip`;
    const stream = createZipStream({ files });
    const webStream = Readable.toWeb(stream) as ReadableStream;

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': rfc5987ContentDisposition('attachment', zipName),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`zip build failed: ${message}`, { status: 500 });
  } finally {
    releaseZipSlot(record.token);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createFileShareResponse(args: {
  c: Context;
  service: GatewayService;
  store: ReturnType<typeof getShareStore>;
  probe: Awaited<ReturnType<typeof probeShareTarget>>;
  decision: ReturnType<typeof decideShareKind>;
  ttlMs: number;
  maxViews: number | null | undefined;
  title?: string;
  description?: string;
  audience?: ShareAudience;
  workspaceRoot: string;
  tokenHash: string;
  urlCtx: ReturnType<typeof getShareUrlContext>;
  wantThumbnail: boolean;
}): Promise<Response> {
  const { c, service, store, probe, decision, ttlMs, maxViews, title, description, audience, workspaceRoot, tokenHash, urlCtx, wantThumbnail } = args;
  store.updateConfig(resolveShareConfig(service));
  const record = await store.create({
    path: relPathFromAbs(workspaceRoot, probe.absolutePath),
    workspaceRoot,
    gatewayTokenHash: tokenHash,
    ttlMs,
    maxViews: maxViews === undefined ? undefined : maxViews,
    description,
    kind: probe.kind === 'directory' ? 'directory' : 'file',
    directoryMode: decision.kind === 'zip' ? 'zip-only' : (probe.kind === 'directory' ? 'browse' : undefined),
  });
  const resolved = resolveShareUrl(record.token, urlCtx);
  const titleOut = makeTitle(record.fileName, title);
  const descOut = makeDescription({ audience, expiresAt: record.expiresAt, override: description });
  const thumbnailUrl = wantThumbnail
    ? `${resolved.shareUrl}/thumbnail`
    : '';
  if (wantThumbnail) {
    scheduleThumbnail({ scope: 'file', token: record.token, recordId: record.id }, thumbnailRenderContext(service));
    store.setThumbnailStatus(record.id, 'pending');
  }
  return c.json({
    ok: true,
    payload: {
      share: {
        id: record.id,
        kind: decision.kind,
        title: titleOut,
        description: descOut,
        shareUrl: resolved.shareUrl,
        lanUrl: resolved.lanUrl,
        reachability: resolved.reachability,
        reachabilityHint: resolved.reachabilityHint,
        expiresAt: record.expiresAt,
        maxViews: record.maxViews,
      },
      thumbnail: {
        url: thumbnailUrl,
        status: wantThumbnail ? 'pending' : 'unavailable',
        width: SHARE_CONFIG_DEFAULTS.thumbnail.viewportWidth,
        height: SHARE_CONFIG_DEFAULTS.thumbnail.viewportHeight,
      },
      routing: { reason: decision.reason, hint: decision.hint },
    },
  }, 201) as unknown as Response;
}

function relPathFromAbs(workspaceRoot: string, abs: string): string {
  const root = workspaceRoot.replace(/[\\/]+$/, '');
  if (abs === root) return '.';
  if (abs.startsWith(`${root}/`)) return abs.slice(root.length + 1);
  if (abs.startsWith(`${root}\\`)) return abs.slice(root.length + 1).replace(/\\/g, '/');
  // Fall back to basename — store.create will resolve again under workspace.
  return abs.split(/[\\/]/).pop() ?? abs;
}

async function resolveWorkspaceRootForShare(
  service: GatewayService,
  sessionKey: string | undefined,
  agentId: string | undefined,
): Promise<string | null> {
  const cfg = service.currentConfig;

  if (sessionKey) {
    try {
      return await service.sessions.getEffectiveWorkspacePath(sessionKey);
    } catch {
      /* fall through to agentId */
    }
  }

  const { getWorkspacePath } = await import('../../../config/workspace-path-helpers.js');
  const { resolveAgentWorkspaceDir, normalizeAgentId, resolveDefaultAgentId } = await import(
    '../../../agent/agent-scope.js'
  );

  if (agentId) {
    const normalized = normalizeAgentId(agentId);
    return resolveAgentWorkspaceDir(cfg, normalized);
  }

  const root = getWorkspacePath(cfg);
  if (root) return root;

  const defaultId = resolveDefaultAgentId(cfg);
  return resolveAgentWorkspaceDir(cfg, defaultId);
}

async function handleFileDownload(
  c: Context,
  store: ReturnType<typeof getShareStore>,
  record: WorkspaceShareRecord,
  clientIp: string,
  inline = false,
): Promise<Response> {
  if (!acquireDownloadSlot(record.token)) {
    return new Response('Too many concurrent downloads for this share', { status: 429 });
  }

  try {
    const integrity = await store.validateFileIntegrity(record);
    if (!integrity.valid) {
      logShareAudit(
        'share.access_denied',
        { shareId: record.id, tokenPrefix: record.token.slice(0, 8), reason: integrity.reason, clientIp },
        `Share file integrity check failed: ${integrity.reason}`,
      );
      return new Response(renderShareExpiredPage((integrity.reason ?? 'file_deleted') as ShareExpiredReason), {
        status: 410,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    store.incrementDownloadCount(record.id);

    logShareAudit(
      'share.access',
      { shareId: record.id, tokenPrefix: record.token.slice(0, 8), clientIp, downloadCount: record.downloadCount },
      `Share downloaded: ${record.fileName}`,
    );

    const fileStat = await stat(record.absolutePath);
    const stream = createReadStream(record.absolutePath);
    const webStream = Readable.toWeb(stream) as ReadableStream;
    const disposition = rfc5987ContentDisposition(inline ? 'inline' : 'attachment', record.fileName);

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': shareResponseContentType(record.mimeType),
        ...(inline && record.mimeType === 'text/html' ? { 'Content-Security-Policy': SHARED_HTML_CSP } : {}),
        'Content-Disposition': disposition,
        'Content-Length': String(fileStat.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } finally {
    releaseDownloadSlot(record.token);
  }
}
