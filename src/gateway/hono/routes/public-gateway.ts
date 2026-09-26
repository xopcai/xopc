import { createHash, timingSafeEqual } from 'node:crypto';

import type { Hono } from 'hono';

import { composioLogoResponse } from '../../../connectors/composio-logo.js';
import {
  appendComposioTriggerEvent,
  applyComposioConnectionLifecycleEvent,
  normalizeComposioTriggerPayload,
  verifyComposioWebhook,
} from '../../../connectors/composio-triggers.js';
import { PACKAGE_VERSION } from '../../../package-version.js';
import { resolveAutomationWebhookSecret } from '../../../automations/webhook-secrets.js';
import {
  claimConnectorWebhookDelivery,
  completeConnectorWebhookDelivery,
  releaseConnectorWebhookDelivery,
} from '../../../storage/sqlite/index.js';
import type { GatewayService } from '../../service.js';
import { serveStaticFile } from '../lib/static-ui.js';

const PUBLIC_UI_ROOT_ASSETS = [
  'apple-touch-icon.png',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'favicon.png',
  'favicon.svg',
  'notification-sw.js',
  'pwa-192x192.png',
  'pwa-512x512.png',
  'site.webmanifest',
] as const;

function secretsEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(actual).digest(),
    createHash('sha256').update(expected).digest(),
  );
}

export function registerPublicGatewayRoutes(app: Hono, service: GatewayService): void {
  app.get('/health', (c) => {
    return c.json(service.getHealth());
  });

  /** Public liveness probe (no auth) — minimal payload for CLI / load balancers. */
  app.get('/api/health', (c) => {
    const health = service.getHealth();
    return c.json({
      status: health.ready ? 'ok' : 'starting',
      ready: health.ready,
      httpListening: health.httpListening,
      version: health.version,
      uptime: health.uptime,
      startupDurationMs: health.startupDurationMs,
    });
  });

  app.post('/api/connectors/composio/webhook', async (c) => {
    const secret = process.env.COMPOSIO_WEBHOOK_SECRET?.trim();
    if (!secret) return c.json({ ok: false, error: 'Composio webhook is not configured.' }, 503);
    const webhookId = c.req.header('webhook-id')?.trim() ?? '';
    const body = await c.req.text();
    let payload: unknown;
    try {
      payload = verifyComposioWebhook({
        body,
        webhookId,
        webhookTimestamp: c.req.header('webhook-timestamp')?.trim() ?? '',
        signature: c.req.header('webhook-signature')?.trim() ?? '',
        secret,
      });
    } catch {
      return c.json({ ok: false, error: 'Invalid Composio webhook.' }, 401);
    }
    try {
      const claim = claimConnectorWebhookDelivery({
        id: webhookId,
        provider: 'composio',
        payloadHash: createHash('sha256').update(body).digest('hex'),
      });
      if (claim !== 'claimed') {
        return c.json({ ok: true, payload: { eventId: webhookId, duplicate: true, status: claim } });
      }
      const archivedPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? { ...payload as Record<string, unknown>, id: webhookId }
        : { id: webhookId, data: payload };
      const normalized = normalizeComposioTriggerPayload(archivedPayload, webhookId);
      const inactiveConnectionId = applyComposioConnectionLifecycleEvent(archivedPayload);
      if (inactiveConnectionId) service.setConnectorLearningPaused(inactiveConnectionId, true);
      const event = await appendComposioTriggerEvent(service.currentConfig, archivedPayload);
      if (normalized.toolkit) service.requestConnectorLearningForToolkit(normalized.toolkit);
      const ingested = service.ingestAutomationEvent({
        id: `connector:composio:${webhookId}`,
        type: `connector.${normalized.trigger ?? normalized.type}`,
        source: normalized.toolkit ? `composio:${normalized.toolkit}` : 'composio',
        subject: { kind: 'connector_event', id: webhookId },
        dedupeKey: webhookId,
        trust: 'connector',
        payload: {
          ...normalized.data,
          connectorId: normalized.toolkit ? `composio-${normalized.toolkit}` : 'composio',
          webhookId,
        },
      });
      completeConnectorWebhookDelivery(webhookId);
      return c.json({ ok: true, payload: { eventId: event.id, automationDeliveries: ingested.deliveryCount } });
    } catch (error) {
      releaseConnectorWebhookDelivery(webhookId, error);
      return c.json({ ok: false, error: 'Composio webhook processing failed.' }, 500);
    }
  });

  app.post('/api/automation-hooks/:automationId', async (c) => {
    const automationId = c.req.param('automationId');
    const automation = await service.automationServiceInstance.get(automationId);
    if (!automation || !automation.enabled || automation.trigger.kind !== 'webhook') {
      return c.json({ ok: false, error: 'Automation webhook not found.' }, 404);
    }
    const secretId = automation.trigger.secretId?.trim();
    let expectedSecret: string | undefined;
    try {
      expectedSecret = secretId ? resolveAutomationWebhookSecret(secretId) : undefined;
    } catch {
      return c.json({ ok: false, error: 'Automation webhook secrets are misconfigured.' }, 503);
    }
    if (!expectedSecret) return c.json({ ok: false, error: 'Automation webhook secret is not configured.' }, 503);
    const authorization = c.req.header('authorization')?.trim() ?? '';
    const suppliedSecret = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : c.req.header('x-xopc-webhook-secret')?.trim() ?? '';
    if (!suppliedSecret || !secretsEqual(suppliedSecret, expectedSecret)) {
      return c.json({ ok: false, error: 'Invalid automation webhook secret.' }, 401);
    }
    const idempotencyKey = c.req.header('idempotency-key')?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return c.json({ ok: false, error: 'A valid Idempotency-Key header is required.' }, 400);
    }
    const declaredSize = Number(c.req.header('content-length') ?? 0);
    if (Number.isFinite(declaredSize) && declaredSize > 1_000_000) {
      return c.json({ ok: false, error: 'Webhook payload is too large.' }, 413);
    }
    const rawBody = await c.req.text();
    if (Buffer.byteLength(rawBody) > 1_000_000) {
      return c.json({ ok: false, error: 'Webhook payload is too large.' }, 413);
    }
    let payload: Record<string, unknown>;
    try {
      const parsed = rawBody ? JSON.parse(rawBody) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid payload');
      payload = parsed as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: 'Webhook payload must be a JSON object.' }, 400);
    }
    try {
      const result = service.ingestAutomationEvent({
        id: `webhook:${automationId}:${idempotencyKey}`,
        type: 'automation.webhook.received',
        source: `webhook:${automationId}`,
        subject: { kind: 'automation', id: automationId },
        correlationId: c.req.header('x-correlation-id')?.trim() || undefined,
        dedupeKey: idempotencyKey,
        trust: 'untrusted_webhook',
        payload,
      }, { targetAutomationIds: [automationId] });
      return c.json({ ok: true, eventId: result.event.id, duplicate: !result.created }, result.created ? 202 : 200);
    } catch {
      return c.json({ ok: false, error: 'Automation webhook ingestion failed.' }, 500);
    }
  });

  app.get('/api', (c) => {
    return c.json({
      service: 'xopc-gateway',
      version: PACKAGE_VERSION,
      transport: 'streamable-http',
      endpoints: [
        'GET  /health',
        'GET  /api/health',
        'GET  /status',
        'GET  /api/status',
        'POST /api/sessions/:conversationId/inputs',
        'GET  /api/sessions/:conversationId/input-state',
        'PATCH/DELETE /api/sessions/:conversationId/inputs/:inputId',
        'POST /api/agent/abort',
        'POST /api/send',
        'POST /api/realtime/tickets',
        'WS   /api/realtime/v1/ws',
        'GET  /api/channels/catalog',
        'GET  /api/channels/status',
        'POST /api/channels/:channelId/actions/:actionId',
        'GET  /api/config',
        'GET  /api/agents',
        'POST /api/agents',
        'PATCH /api/agents/:id',
        'DELETE /api/agents/:id',
        'GET/PUT/DELETE /api/agents/:id/avatar',
        'GET/PUT /api/agents/:id/files/...',
        'DELETE /api/providers/:providerId/key',
        'PATCH /api/config',
        'POST /api/config/reload',
        '...  /api/automations/*',
        '...  /api/automation-runs/*',
        'GET/PATCH /api/sessions/:key/agent-config',
        '...  /api/sessions/*',
        'GET  /api/host/fs/meta',
        'GET  /api/host/fs/list',
      ],
    });
  });

  app.get('/assets/*', (c) => {
    const path = c.req.path.replace('/assets/', '');
    const response = serveStaticFile(`assets/${path}`, c.req.raw);
    if (response) return response;
    return c.text('Not found', 404);
  });

  /** From `web/public/channel-icons/` (Vite copies to static root). Public: img requests send no Bearer token. */
  app.get('/channel-icons/*', (c) => {
    const path = c.req.path.replace('/channel-icons/', '');
    const response = serveStaticFile(`channel-icons/${path}`, c.req.raw);
    if (response) return response;
    return c.text('Not found', 404);
  });

  app.get('/connector-icons/composio/:toolkit', async (c) => {
    try {
      return await composioLogoResponse(c.req.param('toolkit'));
    } catch {
      return c.json({ ok: false, error: 'Connector logo is unavailable.' }, 404);
    }
  });

  /** From `web/public/connector-icons/` (Vite copies to static root). Public: img requests send no Bearer token. */
  app.get('/connector-icons/*', (c) => {
    const path = c.req.path.replace('/connector-icons/', '');
    const response = serveStaticFile(`connector-icons/${path}`, c.req.raw);
    if (response) return response;
    return c.text('Not found', 404);
  });

  app.get('/favicon.ico', (c) => {
    const response = serveStaticFile('favicon.ico', c.req.raw);
    if (response) return response;
    const fallback = serveStaticFile('logo.svg', c.req.raw);
    if (fallback) return fallback;
    return c.text('Not found', 404);
  });

  for (const assetPath of PUBLIC_UI_ROOT_ASSETS) {
    app.get(`/${assetPath}`, (c) => {
      const response = serveStaticFile(assetPath, c.req.raw);
      if (response) return response;
      return c.text('Not found', 404);
    });
  }

  app.get('/logo.svg', (c) => {
    const response = serveStaticFile('logo.svg', c.req.raw);
    if (response) return response;
    return c.text('Not found', 404);
  });

  app.get('/logo-dark.svg', (c) => {
    const response = serveStaticFile('logo-dark.svg', c.req.raw);
    if (response) return response;
    return c.text('Not found', 404);
  });

  app.get('/', (c) => {
    const response = serveStaticFile('index.html', c.req.raw);
    if (response) return response;
    return c.text('UI not found', 404);
  });
}
