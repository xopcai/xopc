import type { Hono, MiddlewareHandler } from 'hono';

import {
  E2EE_CONTENT_TYPE,
  base64UrlToBytes,
  decryptEnvelope,
  deriveRelayStreamKey,
  encryptEnvelope,
  encryptFrame,
  frameToBase64,
  type E2eeEnvelope,
} from '@xopcai/xopc-e2ee';
import type { Config } from '../../../config/schema.js';
import { getGatewayE2eePublicMeta } from '../../../e2ee/identity.js';
import {
  consumeRequestSeq,
  createE2eeSession,
  ensureE2eeSessionsLoaded,
  finalizeE2eeStreamSession,
  getE2eeSession,
  getE2eeSessionAsync,
  nextResponseSeq,
} from '../../../e2ee/session-store.js';
import { getTunnelService } from '../../../tunnel/index.js';
import { createLogger } from '../../../utils/logger.js';
import type { GatewayService } from '../../service.js';
import { resolveGatewayServiceListenPort } from '../../host.js';

const log = createLogger('E2EE:Relay');

const EXEMPT_PREFIXES = [
  '/health',
  '/api/health',
  '/api/tunnel/pair',
  '/api/tunnel/pair/',
  '/api/tunnel/exchange-token',
  '/api/e2ee/handshake',
  '/api/e2ee/status',
  '/api/e2ee/relay',
  '/api/e2ee/relay-stream',
];

function isExemptPath(path: string): boolean {
  return EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

function isRemoteTunnelRequest(c: { req: { header: (name: string) => string | undefined } }, config: Config): boolean {
  if (config.tunnel?.appE2ee?.enabled === false) return false;
  if (config.tunnel?.appE2ee?.requiredOnRemote === false) return false;
  const tunnel = getTunnelService().getStatus();
  if (tunnel.state !== 'connected' || !tunnel.publicUrl?.trim()) return false;
  const host = (c.req.header('host') ?? '').split(':')[0]?.toLowerCase() ?? '';
  if (!host) return false;
  try {
    const tunnelHost = new URL(tunnel.publicUrl).hostname.toLowerCase();
    return host === tunnelHost || host.endsWith('.frp.xopc.ai');
  } catch {
    return host.endsWith('.frp.xopc.ai');
  }
}

/** Loopback base for relay sub-requests — must not use the public tunnel Host (nginx ACL blocks most /api/*). */
export function resolveInternalGatewayRelayBaseUrl(service: GatewayService): string {
  const port = resolveGatewayServiceListenPort(service);
  return `http://127.0.0.1:${port}`;
}

function resolveInternalRelayTarget(service: GatewayService, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${resolveInternalGatewayRelayBaseUrl(service)}${normalized}`;
}

export function registerE2eePublicRoutes(app: Hono): void {
  app.get('/api/e2ee/status', async (c) => {
    const meta = await getGatewayE2eePublicMeta();
    return c.json({
      version: 1,
      gatewayPub: meta.publicKey,
      fingerprint: meta.fingerprint,
    });
  });
}

export function registerE2eeRoutes(authenticated: Hono, service: GatewayService): void {
  void ensureE2eeSessionsLoaded().catch((err) => {
    const em = err instanceof Error ? err.message : String(err);
    log.warn({ err, errorMessage: em }, 'E2EE session hydrate failed on gateway start');
  });

  authenticated.post('/api/e2ee/handshake', async (c) => {
    let body: { sessionId?: unknown; devicePub?: unknown; pairingSecret?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    const devicePub = typeof body.devicePub === 'string' ? body.devicePub.trim() : '';
    const pairingSecret =
      typeof body.pairingSecret === 'string' && body.pairingSecret.trim()
        ? body.pairingSecret.trim()
        : undefined;
    if (!sessionId || !devicePub) {
      return c.json({ error: 'sessionId and devicePub required' }, 400);
    }

    try {
      const { serverConfirm } = await createE2eeSession({
        sessionId,
        devicePublicKey: base64UrlToBytes(devicePub),
        pairingSecret,
      });
      const meta = await getGatewayE2eePublicMeta();
      log.info({ sessionId, phase: 'handshake_ok' }, 'E2EE handshake established');
      return c.json({
        ok: true,
        sessionId,
        serverConfirm,
        gatewayPub: meta.publicKey,
        fingerprint: meta.fingerprint,
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  authenticated.get('/api/e2ee/session', async (c) => {
    const sessionId = c.req.query('sessionId')?.trim() ?? '';
    if (!sessionId) return c.json({ error: 'sessionId required' }, 400);
    const session = await getE2eeSessionAsync(sessionId);
    if (!session) return c.json({ ok: false, active: false }, 404);
    return c.json({
      ok: true,
      active: true,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  });

  /** Decrypt envelope, forward to internal gateway route, encrypt JSON response. */
  authenticated.post('/api/e2ee/relay', async (c) => {
    const startedAt = Date.now();
    await ensureE2eeSessionsLoaded();
    let body: {
      sessionId?: unknown;
      seq?: unknown;
      method?: unknown;
      path?: unknown;
      envelope?: unknown;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    const seq = typeof body.seq === 'number' ? body.seq : Number(body.seq);
    const method = typeof body.method === 'string' ? body.method.toUpperCase() : 'GET';
    const path = typeof body.path === 'string' ? body.path.trim() : '';
    if (!sessionId || !Number.isFinite(seq) || !path.startsWith('/api/')) {
      return c.json({ error: 'sessionId, seq, and /api path required' }, 400);
    }

    const session = consumeRequestSeq(sessionId, seq);
    if (!session) {
      const known = getE2eeSession(sessionId);
      log.warn(
        {
          sessionId,
          seq,
          relayPath: path,
          relayMethod: method,
          phase: 'relay_auth',
          code: known ? 'E2EE_SEQ' : 'E2EE_SESSION',
        },
        known ? 'E2EE relay rejected: sequence out of sync' : 'E2EE relay rejected: invalid session',
      );
      return c.json(
        {
          error: known ? 'E2EE request sequence out of sync' : 'Invalid or expired E2EE session',
          code: known ? 'E2EE_SEQ' : 'E2EE_SESSION',
        },
        401,
      );
    }

    const envelope = body.envelope as E2eeEnvelope;
    if (!envelope?.ciphertext) return c.json({ error: 'envelope required' }, 400);

    let plaintext = '';
    try {
      plaintext = await decryptEnvelope(session.requestKey, envelope);
    } catch {
      return c.json({ error: 'E2EE decrypt failed' }, 400);
    }

    const auth = c.req.header('authorization') ?? '';
    const target = resolveInternalRelayTarget(service, path);
    const internal = await fetch(target, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: auth } : {}),
      },
      body: method === 'GET' || method === 'HEAD' ? undefined : plaintext,
    });

    const resText = await internal.text();
    const outSeq = nextResponseSeq(session);
    const encrypted = await encryptEnvelope(session.responseKey, outSeq, resText, {
      method,
      path,
      status: internal.status,
    });

    const statusCode = internal.ok ? 200 : (internal.status as 400);
    log.info(
      {
        sessionId,
        relayPath: path,
        relayMethod: method,
        status: internal.status,
        durationMs: Date.now() - startedAt,
        phase: 'relay',
      },
      internal.ok ? 'E2EE relay completed' : 'E2EE relay upstream error',
    );
    return c.json(
      {
        ok: internal.ok,
        status: internal.status,
        seq: outSeq,
        envelope: encrypted,
      },
      statusCode,
    );
  });

  /** Decrypt envelope, forward to internal SSE route, encrypt each chunk as E2EE frames. */
  authenticated.post('/api/e2ee/relay-stream', async (c) => {
    const startedAt = Date.now();
    await ensureE2eeSessionsLoaded();
    let body: {
      sessionId?: unknown;
      seq?: unknown;
      method?: unknown;
      path?: unknown;
      envelope?: unknown;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    const seq = typeof body.seq === 'number' ? body.seq : Number(body.seq);
    const method = typeof body.method === 'string' ? body.method.toUpperCase() : 'POST';
    const path = typeof body.path === 'string' ? body.path.trim() : '';
    if (!sessionId || !Number.isFinite(seq) || !path.startsWith('/api/')) {
      return c.json({ error: 'sessionId, seq, and /api path required' }, 400);
    }

    const session = consumeRequestSeq(sessionId, seq);
    if (!session) {
      const known = getE2eeSession(sessionId);
      log.warn(
        {
          sessionId,
          seq,
          relayPath: path,
          relayMethod: method,
          phase: 'relay_stream_auth',
          code: known ? 'E2EE_SEQ' : 'E2EE_SESSION',
        },
        known ? 'E2EE relay-stream rejected: sequence out of sync' : 'E2EE relay-stream rejected: invalid session',
      );
      return c.json(
        {
          error: known ? 'E2EE request sequence out of sync' : 'Invalid or expired E2EE session',
          code: known ? 'E2EE_SEQ' : 'E2EE_SESSION',
        },
        401,
      );
    }

    const streamEnvelope = body.envelope as E2eeEnvelope;
    if (!streamEnvelope?.ciphertext) return c.json({ error: 'envelope required' }, 400);

    let plaintext = '';
    try {
      plaintext = await decryptEnvelope(session.requestKey, streamEnvelope);
    } catch {
      return c.json({ error: 'E2EE decrypt failed' }, 400);
    }

    const auth = c.req.header('authorization') ?? '';
    const target = resolveInternalRelayTarget(service, path);
    const internal = await fetch(target, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(auth ? { Authorization: auth } : {}),
      },
      body: method === 'GET' || method === 'HEAD' ? undefined : plaintext,
    });

    if (!internal.ok || !internal.body) {
      const text = await internal.text();
      const outSeq = nextResponseSeq(session);
      const encrypted = await encryptEnvelope(session.responseKey, outSeq, text, {
        method,
        path,
        status: internal.status,
      });
      log.warn(
        {
          sessionId,
          relayPath: path,
          relayMethod: method,
          status: internal.status,
          durationMs: Date.now() - startedAt,
          phase: 'relay_stream_upstream',
        },
        'E2EE relay-stream upstream failed',
      );
      return c.json(
        { ok: false, status: internal.status, seq: outSeq, envelope: encrypted },
        internal.status >= 400 && internal.status < 600 ? (internal.status as 400) : 502,
      );
    }

    log.info(
      {
        sessionId,
        relayPath: path,
        relayMethod: method,
        phase: 'relay_stream_open',
      },
      'E2EE relay-stream opened',
    );

    const encoder = new TextEncoder();
    const reader = internal.body.getReader();
    const streamKey = await deriveRelayStreamKey(session.rootKey, seq);
    let frameCount = 0;
    let localFrameSeq = 0;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              break;
            }
            const chunk = new TextDecoder().decode(value);
            localFrameSeq += 1;
            frameCount += 1;
            const frame = await encryptFrame(streamKey, localFrameSeq, chunk);
            controller.enqueue(encoder.encode(`data: ${frameToBase64(frame)}\n\n`));
          }
          finalizeE2eeStreamSession(session);
          log.info(
            {
              sessionId,
              relayPath: path,
              relayMethod: method,
              frameCount,
              durationMs: Date.now() - startedAt,
              phase: 'relay_stream_close',
            },
            'E2EE relay-stream closed',
          );
        } catch (err) {
          finalizeE2eeStreamSession(session);
          const em = err instanceof Error ? err.message : String(err);
          log.warn(
            {
              err,
              sessionId,
              relayPath: path,
              relayMethod: method,
              frameCount,
              durationMs: Date.now() - startedAt,
              phase: 'relay_stream_error',
              errorMessage: em,
            },
            'E2EE relay-stream error',
          );
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Xopc-E2ee-Session': sessionId,
      },
    });
  });
}

export function createE2eeRequirementMiddleware(service: GatewayService): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    if (isExemptPath(path)) return next();
    if (!isRemoteTunnelRequest(c, service.currentConfig)) return next();

    const contentType = c.req.header('content-type') ?? '';
    const isE2eeRelay = path === '/api/e2ee/relay' || path === '/api/e2ee/relay-stream';
    if (isE2eeRelay || contentType.startsWith(E2EE_CONTENT_TYPE)) {
      return next();
    }

    return c.json(
      {
        error: 'Application-layer E2EE required for remote tunnel access',
        code: 'E2EE_REQUIRED',
      },
      426,
    );
  };
}
