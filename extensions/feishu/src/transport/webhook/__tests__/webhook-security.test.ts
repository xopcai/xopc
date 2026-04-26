import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { MessageBus } from '@xopcai/xopc/infra/bus/index.js';

import { createFeishuWebhookMonitor } from '../monitor.js';
import type { ResolvedFeishuAccount } from '../../../state/accounts.js';

function signFeishuPayload(params: {
  encryptKey: string;
  rawBody: string;
  timestamp?: string;
  nonce?: string;
}): Record<string, string> {
  const timestamp = params.timestamp ?? '1711111111';
  const nonce = params.nonce ?? 'nonce-test';
  const signature = crypto
    .createHash('sha256')
    .update(timestamp + nonce + params.encryptKey + params.rawBody)
    .digest('hex');
  return {
    'content-type': 'application/json',
    'x-lark-request-timestamp': timestamp,
    'x-lark-request-nonce': nonce,
    'x-lark-signature': signature,
  };
}

async function getFreePort(): Promise<number> {
  const server = (await import('node:http')).createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as any;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return addr.port as number;
}

async function waitUntilServerReady(url: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.status >= 200 && res.status < 500) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`server did not start: ${url}`);
}

describe('Feishu webhook security hardening (xopc)', () => {
  const abortControllers: AbortController[] = [];
  afterEach(() => {
    for (const ac of abortControllers) ac.abort();
    abortControllers.length = 0;
  });

  it('rejects invalid signatures with 401', async () => {
    const port = await getFreePort();
    const path = '/feishu-test-invalid-signature';
    const url = `http://127.0.0.1:${port}${path}`;

    const account: ResolvedFeishuAccount = {
      accountId: 'default',
      enabled: true,
      configured: true,
      appId: 'x',
      appSecret: 'y',
      domain: 'feishu',
      connectionMode: 'webhook',
      webhookHost: '127.0.0.1',
      webhookPort: port,
      webhookPath: path,
      verificationToken: 'verify_token',
      encryptKey: 'encrypt_key',
      dmPolicy: 'open',
      groupPolicy: 'open',
      historyLimit: 0,
      textChunkLimit: 4000,
      streaming: false,
    };

    const bus = new MessageBus();
    const ac = new AbortController();
    abortControllers.push(ac);
    const monitor = createFeishuWebhookMonitor({
      account,
      config: { channels: { feishu: { enabled: true } } } as any,
      bus,
      abortSignal: ac.signal,
      security: { checkAccess: () => ({ allowed: true }) },
    });
    const runPromise = monitor.run();

    await waitUntilServerReady(url);

    const payload = { type: 'url_verification', challenge: 'challenge-token' };
    const rawBody = JSON.stringify(payload);
    const response = await fetch(url, {
      method: 'POST',
      headers: signFeishuPayload({ encryptKey: 'wrong_key', rawBody }),
      body: rawBody,
    });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Invalid signature');

    ac.abort();
    await runPromise.catch(() => undefined);
  });
});
