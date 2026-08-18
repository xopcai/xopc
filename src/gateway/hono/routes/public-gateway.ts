import { createHash } from 'node:crypto';

import type { Hono } from 'hono';

import { composioLogoResponse } from '../../../connectors/composio-logo.js';
import {
  appendComposioTriggerEvent,
  applyComposioConnectionLifecycleEvent,
  normalizeComposioTriggerPayload,
  verifyComposioWebhook,
} from '../../../connectors/composio-triggers.js';
import { PACKAGE_VERSION } from '../../../package-version.js';
import {
  claimConnectorWebhookDelivery,
  completeConnectorWebhookDelivery,
  releaseConnectorWebhookDelivery,
} from '../../../storage/sqlite/index.js';
import type { GatewayService } from '../../service.js';
import { serveStaticFile } from '../lib/static-ui.js';

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
      const runs = await service.automationServiceInstance.triggerEvent({
        type: `connector.${normalized.trigger ?? normalized.type}`,
        source: normalized.toolkit ? `composio:${normalized.toolkit}` : 'composio',
        payload: {
          ...normalized.data,
          connectorId: normalized.toolkit ? `composio-${normalized.toolkit}` : 'composio',
          webhookId,
        },
      });
      completeConnectorWebhookDelivery(webhookId);
      return c.json({ ok: true, payload: { eventId: event.id, automationRuns: runs.length } });
    } catch (error) {
      releaseConnectorWebhookDelivery(webhookId, error);
      return c.json({ ok: false, error: 'Composio webhook processing failed.' }, 500);
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
        'POST /api/sessions/:sessionKey/inputs',
        'GET  /api/sessions/:sessionKey/input-state',
        'PATCH/DELETE /api/sessions/:sessionKey/inputs/:inputId',
        'POST /api/agent/resume          (SSE stream)',
        'POST /api/agent/abort',
        'POST /api/send',
        'GET  /api/events          (SSE stream)',
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
        'POST /api/heartbeat/trigger',
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
