import type { Context, Hono } from 'hono';

import { resolveMimeType } from './share-store.js';
import { getSiteShareStore } from './site-share-store.js';
import { resolveSiteShareConfig } from './site-share-config.js';
import { serveStaticSiteRequest } from './site-static-serve.js';
import { forwardHttpRequest, handleProxyWebSocketUpgrade } from './site-proxy.js';
import { renderShareExpiredPage } from './share-landing.js';
import { getClientIpFromHeaders } from '../gateway/security/loopback.js';
import { createLogger } from '../utils/logger.js';
import type { GatewayService } from '../gateway/service.js';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';

const log = createLogger('SiteShareRouter');

const SITE_SUBPATH_PREFIX = '/site/';

/**
 * Extract the share label from the request Host header when the public host
 * suffix matches. Returns `null` if the request did not target a site-share
 * subdomain.
 */
export function extractSiteShareLabel(host: string | null | undefined, suffix: string): string | null {
  if (!host) return null;
  const lowered = host.toLowerCase().split(':')[0];
  const normSuffix = suffix.toLowerCase();
  if (lowered === normSuffix) return null;
  if (!lowered.endsWith(`.${normSuffix}`)) return null;
  const label = lowered.slice(0, -1 * (normSuffix.length + 1));
  if (!label || label.includes('.')) return null;
  return label;
}

/**
 * Hono middleware. Intercepts requests whose Host header is `*.share.xopc.ai`
 * (or matches the configured suffix), routes them to the matching site share.
 * Falls through to next() when the host does not match.
 *
 * Also handles the subpath fallback `/site/:token/*` for environments without
 * wildcard DNS — same handler logic, just different prefix extraction.
 */
export function createSiteShareMiddleware(service: GatewayService) {
  return async (c: Context, next: () => Promise<void>) => {
    const config = resolveSiteShareConfig(service);
    if (!config.enabled) return next();
    const store = getSiteShareStore(config);
    store.updateConfig(config);

    const host = c.req.header('host');
    const label = extractSiteShareLabel(host, config.publicHostSuffix);
    const url = new URL(c.req.url);
    const clientIp = getClientIpFromHeaders({ get: (n: string) => c.req.header(n) ?? undefined });

    let record = null as ReturnType<typeof store.getByToken>;
    let innerPath = url.pathname;
    let basePrefix = '';

    if (label) {
      record = store.resolveByHostLabel(label);
      if (!record) return next();
    } else if (url.pathname.startsWith(SITE_SUBPATH_PREFIX)) {
      const rest = url.pathname.slice(SITE_SUBPATH_PREFIX.length);
      const slash = rest.indexOf('/');
      const token = slash < 0 ? rest : rest.slice(0, slash);
      const tail = slash < 0 ? '' : rest.slice(slash);
      record = store.getByToken(token) ?? store.getBySubdomain(token);
      if (!record) return next();
      innerPath = tail || '/';
      basePrefix = `${SITE_SUBPATH_PREFIX}${token}`;
    } else {
      return next();
    }

    const validation = store.validateAccess(record);
    if (!validation.valid) {
      return c.html(renderShareExpiredPage(validation.reason as never), 410);
    }

    if (record.source.kind === 'static') {
      try {
        const result = await serveStaticSiteRequest(record, innerPath, basePrefix);
        store.recordRequest(record.id, clientIp);
        return result;
      } catch (err) {
        log.warn({ err, shareId: record.id }, 'static serve failed');
        return new Response('Internal error', { status: 500 });
      }
    }

    if (record.source.kind === 'proxy') {
      const ctx = {
        innerPath,
        basePrefix,
        clientIp,
        originalUrl: url,
        forwardedProto: url.protocol === 'https:' ? ('https' as const) : ('http' as const),
      };
      const { response } = await forwardHttpRequest(record, store, c.req.raw, ctx);
      return response;
    }

    return next();
  };
}

/** Standalone HTTP upgrade handler that bridges WebSocket requests to the proxy share. */
export function handleSiteShareUpgrade(
  service: GatewayService,
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
): boolean {
  const config = resolveSiteShareConfig(service);
  if (!config.enabled) return false;
  if (!config.proxy.enabled || !config.proxy.forwardWebSocket) return false;

  const store = getSiteShareStore(config);
  store.updateConfig(config);

  const host = (req.headers.host ?? '').toString();
  const label = extractSiteShareLabel(host, config.publicHostSuffix);
  const url = new URL(req.url ?? '/', `http://${host || 'localhost'}`);

  let record: ReturnType<typeof store.getByToken> = null;
  let innerPath = url.pathname;
  let basePrefix = '';
  if (label) {
    record = store.resolveByHostLabel(label);
  } else if (url.pathname.startsWith(SITE_SUBPATH_PREFIX)) {
    const rest = url.pathname.slice(SITE_SUBPATH_PREFIX.length);
    const slash = rest.indexOf('/');
    const token = slash < 0 ? rest : rest.slice(0, slash);
    const tail = slash < 0 ? '' : rest.slice(slash);
    record = store.getByToken(token) ?? store.getBySubdomain(token);
    innerPath = tail || '/';
    basePrefix = `${SITE_SUBPATH_PREFIX}${token}`;
  }
  if (!record) return false;
  const validation = store.validateAccess(record);
  if (!validation.valid) {
    try {
      socket.write('HTTP/1.1 410 Gone\r\nConnection: close\r\n\r\n');
    } catch {
      /* ignore */
    }
    socket.destroy();
    return true;
  }
  if (record.source.kind !== 'proxy') {
    try {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    } catch {
      /* ignore */
    }
    socket.destroy();
    return true;
  }

  const clientIp = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '') || '0.0.0.0';
  handleProxyWebSocketUpgrade({
    record,
    store,
    req,
    socket,
    head,
    innerPath,
    basePrefix,
    clientIp,
  });
  return true;
}

/** Register the middleware on a Hono app — call from createHonoApp. */
export function registerSiteShareMiddleware(app: Hono, service: GatewayService): void {
  app.use(createSiteShareMiddleware(service));
}

void resolveMimeType;
