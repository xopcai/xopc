import { request as undiciRequest } from 'undici';
import { Readable } from 'node:stream';
import * as ws from 'ws';

// `ws` resolves differently under various loaders (tsx's CJS bridge vs Node's
// native ESM wrapper). Reach into both shapes so the class refs stay stable.
const wsAny = ws as unknown as {
  default?: typeof import('ws').WebSocket & { WebSocketServer?: typeof import('ws').WebSocketServer };
  WebSocket?: typeof import('ws').WebSocket;
  WebSocketServer?: typeof import('ws').WebSocketServer;
};
const WSClient = (wsAny.WebSocket ?? wsAny.default) as typeof import('ws').WebSocket;
const WebSocketServer = (wsAny.WebSocketServer ?? wsAny.default?.WebSocketServer) as typeof import('ws').WebSocketServer;
type WSClient = import('ws').WebSocket;
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';

import { createLogger } from '../utils/logger.js';
import type { SiteShareRecord, SiteProxySource } from './site-share-types.js';
import type { SiteShareStore } from './site-share-store.js';

const log = createLogger('SiteProxy');

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

const FORWARDED_HEADERS_SKIP = new Set([
  'host',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'connection',
  'keep-alive',
  'upgrade',
  'transfer-encoding',
]);

export interface ProxyRequestContext {
  /** Path inside the share to forward (no leading basePrefix). */
  innerPath: string;
  /** Path prefix the share is mounted under (used for Set-Cookie/Location rewrite). For subdomain mode use ''. */
  basePrefix: string;
  /** Client IP for forwarded headers and audit. */
  clientIp: string;
  /** Full request URL (for forwarded proto). */
  originalUrl: URL;
  /** Whether the request reached us via HTTPS at the edge. */
  forwardedProto: 'http' | 'https';
}

export interface ProxyResult {
  response: Response;
}

/** Build the upstream URL preserving search params from the incoming request. */
function buildUpstreamUrl(source: SiteProxySource, innerPath: string, search: string): string {
  const base = source.upstreamUrl.replace(/\/+$/, '');
  const path = innerPath.startsWith('/') ? innerPath : `/${innerPath}`;
  return `${base}${path}${search}`;
}

function filterRequestHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (FORWARDED_HEADERS_SKIP.has(lower)) return;
    out[lower] = value;
  });
  return out;
}

function rewriteSetCookie(value: string, basePrefix: string): string {
  if (!basePrefix) return value;
  return value.replace(/(;\s*Path=)([^;]*)/gi, (_match, prefix, path) => {
    if (path.startsWith(basePrefix)) return _match;
    if (path.startsWith('/')) return `${prefix}${basePrefix}${path}`;
    return `${prefix}${basePrefix}/${path}`;
  });
}

function rewriteLocation(value: string, source: SiteProxySource, basePrefix: string): string {
  try {
    const upstream = new URL(source.upstreamUrl);
    const target = new URL(value, source.upstreamUrl);
    if (target.host === upstream.host) {
      return `${basePrefix}${target.pathname}${target.search}${target.hash}`;
    }
    return value;
  } catch {
    // Relative path
    if (value.startsWith('/') && !value.startsWith('//')) {
      return `${basePrefix}${value}`;
    }
    return value;
  }
}

/**
 * Forward an HTTP request to the upstream and return a streaming Response.
 * Handles header filtering, forwarded headers, Set-Cookie / Location rewriting,
 * and a per-request timeout.
 */
export async function forwardHttpRequest(
  record: SiteShareRecord,
  store: SiteShareStore,
  req: Request,
  ctx: ProxyRequestContext,
): Promise<ProxyResult> {
  if (record.source.kind !== 'proxy') {
    return { response: new Response('not_proxy', { status: 400 }) };
  }
  const source = record.source;
  const cfg = store.getConfig().proxy;

  const upstreamUrl = buildUpstreamUrl(source, ctx.innerPath, ctx.originalUrl.search);
  const requestHeaders = filterRequestHeaders(req.headers);

  // Forwarded headers
  const forwardedFor = req.headers.get('x-forwarded-for');
  requestHeaders['x-forwarded-for'] = forwardedFor ? `${forwardedFor}, ${ctx.clientIp}` : ctx.clientIp;
  requestHeaders['x-forwarded-host'] = req.headers.get('host') ?? '';
  requestHeaders['x-forwarded-proto'] = ctx.forwardedProto;
  requestHeaders['x-real-ip'] = ctx.clientIp;
  // Override Host to match upstream so vhost-routed dev servers behave
  const upstreamHost = new URL(source.upstreamUrl).host;
  requestHeaders.host = upstreamHost;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);
  timer.unref?.();

  try {
    const method = req.method.toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD' && req.body != null;
    const upstream = await undiciRequest(upstreamUrl, {
      method: method as Parameters<typeof undiciRequest>[1]['method'],
      headers: requestHeaders,
      body: hasBody ? (Readable.fromWeb(req.body as never) as never) : undefined,
      signal: controller.signal,
      bodyTimeout: cfg.requestTimeoutMs,
      headersTimeout: cfg.requestTimeoutMs,
    });

    const responseHeaders = new Headers();
    for (const [rawKey, rawValue] of Object.entries(upstream.headers)) {
      if (rawValue === undefined) continue;
      const lower = rawKey.toLowerCase();
      if (HOP_BY_HOP_HEADERS.has(lower)) continue;
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) {
        if (typeof value !== 'string') continue;
        let outValue = value;
        if (lower === 'set-cookie' && source.rewriteSetCookiePath) {
          outValue = rewriteSetCookie(value, ctx.basePrefix);
        } else if (lower === 'location') {
          outValue = rewriteLocation(value, source, ctx.basePrefix);
        }
        responseHeaders.append(rawKey, outValue);
      }
    }

    const body = upstream.body
      ? (Readable.toWeb(upstream.body as unknown as Readable) as ReadableStream)
      : null;

    store.recordRequest(record.id, ctx.clientIp);

    return {
      response: new Response(body, {
        status: upstream.statusCode,
        headers: responseHeaders,
      }),
    };
  } catch (err) {
    log.warn(
      { err, shareId: record.id, upstreamUrl },
      `Proxy request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      response: new Response('Bad gateway', { status: 502 }),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── WebSocket bridge ──────────────────────────────────────────────────────────

const wsServer = new WebSocketServer({ noServer: true });

export function handleProxyWebSocketUpgrade(args: {
  record: SiteShareRecord;
  store: SiteShareStore;
  req: IncomingMessage;
  socket: Socket;
  head: Buffer;
  innerPath: string;
  basePrefix: string;
  clientIp: string;
}): void {
  const { record, store, req, socket, head, innerPath, basePrefix, clientIp } = args;
  if (record.source.kind !== 'proxy') {
    socket.destroy();
    return;
  }
  const source = record.source;
  const cfg = store.getConfig().proxy;
  if (!cfg.forwardWebSocket || !source.forwardWebSocket) {
    socket.destroy();
    return;
  }

  const upstreamBase = new URL(source.upstreamUrl);
  const wsProto = upstreamBase.protocol === 'https:' ? 'wss:' : 'ws:';
  const search = req.url ? new URL(req.url, 'http://localhost').search : '';
  const path = innerPath.startsWith('/') ? innerPath : `/${innerPath}`;
  const upstreamWsUrl = `${wsProto}//${upstreamBase.host}${path}${search}`;

  const forwardHeaders: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(req.headers)) {
    if (rawValue === undefined) continue;
    const lower = rawKey.toLowerCase();
    if (FORWARDED_HEADERS_SKIP.has(lower)) continue;
    if (lower.startsWith('sec-websocket-')) continue; // ws lib rebuilds these
    forwardHeaders[lower] = Array.isArray(rawValue) ? rawValue.join(', ') : String(rawValue);
  }
  const xff = req.headers['x-forwarded-for'];
  forwardHeaders['x-forwarded-for'] = xff ? `${xff}, ${clientIp}` : clientIp;
  forwardHeaders['x-forwarded-host'] = String(req.headers.host ?? '');
  forwardHeaders['x-forwarded-proto'] = 'http';
  forwardHeaders['x-real-ip'] = clientIp;
  forwardHeaders.host = upstreamBase.host;

  let upstreamWs: WSClient;
  try {
    upstreamWs = new WSClient(upstreamWsUrl, {
      headers: forwardHeaders,
      handshakeTimeout: cfg.requestTimeoutMs,
    });
  } catch (err) {
    log.warn({ err, shareId: record.id }, 'WebSocket upstream connect threw');
    socket.destroy();
    return;
  }

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = (kill: () => void) => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(kill, cfg.wsIdleTimeoutMs);
    idleTimer.unref?.();
  };

  upstreamWs.once('open', () => {
    wsServer.handleUpgrade(req, socket, head, (clientWs) => {
      void basePrefix;
      store.recordRequest(record.id, clientIp);

      const killAll = () => {
        if (idleTimer) clearTimeout(idleTimer);
        try {
          clientWs.close();
        } catch {
          /* ignore */
        }
        try {
          upstreamWs.close();
        } catch {
          /* ignore */
        }
      };

      resetIdleTimer(killAll);

      const pump = (from: WSClient, to: WSClient): void => {
        from.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
          resetIdleTimer(killAll);
          try {
            to.send(data as unknown as Buffer, { binary: isBinary });
          } catch (err) {
            log.warn({ err, shareId: record.id }, 'WS forward failed');
            killAll();
          }
        });
        from.on('close', killAll);
        from.on('error', (err) => {
          log.warn({ err, shareId: record.id }, 'WS error');
          killAll();
        });
      };

      pump(clientWs as unknown as WSClient, upstreamWs);
      pump(upstreamWs, clientWs as unknown as WSClient);
    });
  });

  upstreamWs.once('error', (err) => {
    log.warn({ err, shareId: record.id, upstreamWsUrl }, 'WS upstream error');
    try {
      socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    } catch {
      /* ignore */
    }
    socket.destroy();
  });
}
