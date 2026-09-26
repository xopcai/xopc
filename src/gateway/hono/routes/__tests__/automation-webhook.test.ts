import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GatewayService } from '../../../service.js';
import { registerPublicGatewayRoutes } from '../public-gateway.js';

function createApp(input: { enabled?: boolean; secretId?: string } = {}) {
  const ingestAutomationEvent = vi.fn(() => ({
    event: { id: 'event-1' }, created: true, deliveryCount: 1,
  }));
  const app = new Hono();
  registerPublicGatewayRoutes(app, {
    automationServiceInstance: {
      get: vi.fn(async () => ({
        id: 'automation-1',
        enabled: input.enabled ?? true,
        trigger: { kind: 'webhook', secretId: input.secretId ?? 'primary' },
      })),
    },
    ingestAutomationEvent,
  } as unknown as GatewayService);
  return { app, ingestAutomationEvent };
}

describe('automation webhook ingress', () => {
  beforeEach(() => {
    process.env.XOPC_AUTOMATION_WEBHOOK_SECRETS = JSON.stringify({ primary: 'secret-value-long' });
  });
  afterEach(() => {
    delete process.env.XOPC_AUTOMATION_WEBHOOK_SECRETS;
  });

  it('authenticates and durably ingests a targeted event', async () => {
    const { app, ingestAutomationEvent } = createApp();
    const response = await app.request('/api/automation-hooks/automation-1', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret-value-long',
        'content-type': 'application/json',
        'idempotency-key': 'delivery-1',
      },
      body: JSON.stringify({ issueId: 'issue-1' }),
    });

    expect(response.status).toBe(202);
    expect(ingestAutomationEvent).toHaveBeenCalledWith(expect.objectContaining({
      id: 'webhook:automation-1:delivery-1',
      trust: 'untrusted_webhook',
      payload: { issueId: 'issue-1' },
    }), { targetAutomationIds: ['automation-1'] });
  });

  it('rejects missing authentication or idempotency', async () => {
    const { app, ingestAutomationEvent } = createApp();
    expect((await app.request('/api/automation-hooks/automation-1', {
      method: 'POST', body: '{}',
    })).status).toBe(401);
    expect((await app.request('/api/automation-hooks/automation-1', {
      method: 'POST', headers: { authorization: 'Bearer secret-value-long' }, body: '{}',
    })).status).toBe(400);
    expect(ingestAutomationEvent).not.toHaveBeenCalled();
  });
});
