import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { normalizeComposioTriggerPayload, verifyComposioWebhook } from '../composio-triggers.js';

describe('Composio signed webhooks', () => {
  it('verifies the signed raw payload and normalizes V3 metadata', () => {
    const body = JSON.stringify({
      type: 'composio.trigger.message',
      metadata: { toolkit_slug: 'gmail', trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE' },
      data: { subject: 'Hello' },
    });
    const timestamp = '1784450000';
    const id = 'msg_123';
    const secret = 'whsec_test';
    const signature = createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`).digest('base64');
    const payload = verifyComposioWebhook({
      body,
      webhookId: id,
      webhookTimestamp: timestamp,
      signature: `v1,${signature}`,
      secret,
      nowMs: Number(timestamp) * 1000,
    });
    expect(normalizeComposioTriggerPayload(payload, id)).toEqual({
      id,
      type: 'composio.trigger.message',
      toolkit: 'gmail',
      trigger: 'GMAIL_NEW_GMAIL_MESSAGE',
      data: { subject: 'Hello' },
    });
  });

  it('rejects bad signatures and replayed timestamps', () => {
    expect(() => verifyComposioWebhook({
      body: '{}',
      webhookId: 'id',
      webhookTimestamp: '1',
      signature: 'v1,bad',
      secret: 'secret',
      nowMs: 1_000,
    })).toThrow(/signature/);
    expect(() => verifyComposioWebhook({
      body: '{}',
      webhookId: 'id',
      webhookTimestamp: '1',
      signature: 'v1,bad',
      secret: 'secret',
      nowMs: 1_000_000,
    })).toThrow(/timestamp/);
  });
});
