import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayFetch, outbox } = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  outbox: new Map<string, unknown>(),
}));

vi.mock('./auth', () => ({
  gatewayFetch,
  getAccessProfile: vi.fn().mockResolvedValue({ gatewayUrl: 'http://localhost:8080' }),
}));

vi.mock('@xopcai/realtime-client', () => ({
  RealtimeClient: class {},
}));

vi.mock('./chat-outbox', () => ({
  readBrowserOutbox: vi.fn(async (sessionKey: string) => outbox.get(sessionKey)),
  writeBrowserOutbox: vi.fn(async (sessionKey: string, value: unknown) => { outbox.set(sessionKey, value); }),
  deleteBrowserOutbox: vi.fn(async (sessionKey: string) => { outbox.delete(sessionKey); }),
}));

import { BrowserChatClient, type BrowserChatSnapshot } from './chat-client';

type ClientInternals = {
  snapshot: BrowserChatSnapshot;
  turnClaim?: { endpointId: string; token: string };
  reloadMessages(): Promise<void>;
  update(patch: Partial<BrowserChatSnapshot>): void;
};

function internals(client: BrowserChatClient): ClientInternals {
  return client as unknown as ClientInternals;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubChrome() {
  const session = new Map<string, unknown>();
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.flatMap((key) => session.has(key) ? [[key, session.get(key)]] : []));
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.entries(values).forEach(([key, value]) => session.set(key, value));
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => session.delete(key));
        }),
      },
      local: { get: vi.fn(), set: vi.fn() },
    },
  });
  return session;
}

function readyClient(): BrowserChatClient {
  const client = new BrowserChatClient();
  internals(client).update({ sessionKey: 'chat:one', endpointReady: true });
  internals(client).turnClaim = { endpointId: 'browser:one', token: 'turn-token' };
  return client;
}

beforeEach(() => {
  gatewayFetch.mockReset();
  outbox.clear();
  stubChrome();
});

afterEach(() => vi.unstubAllGlobals());

describe('BrowserChatClient delivery safety', () => {
  it('keeps an uncertain delivery queued and blocks a second message', async () => {
    const client = readyClient();
    gatewayFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(client.send('hello')).resolves.toBe('queued');

    expect(internals(client).snapshot).toMatchObject({ submitting: false, pendingDelivery: true });
    expect(internals(client).snapshot.messages.at(-1)).toMatchObject({ role: 'user', text: 'hello' });
    expect(outbox.has('chat:one')).toBe(true);
    await expect(client.send('send twice')).rejects.toThrow('queued message');
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });

  it('rolls back an optimistic message when the Gateway rejects it', async () => {
    const client = readyClient();
    gatewayFetch.mockResolvedValueOnce(response({ error: { message: 'Invalid input' } }, 400));

    await expect(client.send('invalid')).rejects.toThrow('Invalid input');

    expect(internals(client).snapshot).toMatchObject({ submitting: false, pendingDelivery: false, messages: [] });
    expect(outbox.has('chat:one')).toBe(false);
  });

  it('does not queue a message again after the Gateway accepted it', async () => {
    const client = readyClient();
    gatewayFetch
      .mockResolvedValueOnce(response({ payload: { state: { inputs: [] } } }))
      .mockRejectedValueOnce(new TypeError('Could not refresh input state'));

    await expect(client.send('accepted')).resolves.toBe('sent');

    expect(internals(client).snapshot).toMatchObject({ submitting: false, pendingDelivery: false });
    expect(internals(client).snapshot.messages.at(-1)).toMatchObject({ text: 'accepted' });
    expect(internals(client).snapshot.error).toContain('Message sent');
    expect(outbox.has('chat:one')).toBe(false);
  });

  it('does not apply a late transcript response to a different chat', async () => {
    const client = readyClient();
    let finishRequest!: (value: Response) => void;
    gatewayFetch.mockReturnValueOnce(new Promise<Response>((resolve) => { finishRequest = resolve; }));

    const loading = internals(client).reloadMessages();
    internals(client).update({ sessionKey: 'chat:two', messages: [] });
    finishRequest(response({ payload: { messages: [{ role: 'assistant', content: 'old chat' }] } }));
    await loading;

    expect(internals(client).snapshot.sessionKey).toBe('chat:two');
    expect(internals(client).snapshot.messages).toEqual([]);
  });

  it('restores safe attachment metadata for attachment-only messages', async () => {
    const client = readyClient();
    gatewayFetch.mockResolvedValueOnce(response({
      payload: {
        messages: [{
          id: 'message-with-file',
          role: 'user',
          content: '',
          media: [{
            type: 'photo',
            mimeType: 'image/png',
            name: 'diagram.png',
            size: 2048,
            path: '/private/path/diagram.png',
            uri: 'media://inbound/diagram.png',
            data: 'must-not-reach-ui',
          }],
        }],
      },
    }));

    await internals(client).reloadMessages();

    expect(internals(client).snapshot.messages).toEqual([{
      id: 'message-with-file',
      role: 'user',
      text: '',
      attachments: [{ type: 'image', mimeType: 'image/png', name: 'diagram.png', size: 2048 }],
    }]);
    expect(JSON.stringify(internals(client).snapshot.messages)).not.toContain('/private/path');
    expect(JSON.stringify(internals(client).snapshot.messages)).not.toContain('media://');
  });
});
