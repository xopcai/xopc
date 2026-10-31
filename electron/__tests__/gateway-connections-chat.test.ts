import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RemoteChatStateStore, type ChatState } from '../chat/state.js';
import { ChatApiError, RemoteChatModel, type ChatApi } from '../chat/model.js';
import { shellRoute, shellWrite } from '../shell/policy.js';

const clients = vi.hoisted(() => [] as Array<{ options: Record<string, (...args: unknown[]) => unknown>; subscribe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>);
vi.mock('@xopcai/realtime-client', async original => {
  const module = await original<Record<string, unknown>>();
  return { ...module, RealtimeClient: class {
    subscribe = vi.fn(); unsubscribe = vi.fn(); disconnect = vi.fn(); reconnect = vi.fn();
    constructor(readonly options: Record<string, (...args: unknown[]) => unknown>) { clients.push(this); }
    connect() { this.options.onStateChange('connected'); }
  } };
});
const conversationId = randomUUID(), otherId = randomUUID();
const command = { kind: 'start', clientMessageId: randomUUID(), origin: { type: 'system', source: 'cli' }, input: { content: 'hello' },
  creation: { agentId: 'main', projectId: null, execution: null, model: 'fixture/model', temporary: false, thinkingLevel: 'off' } };

describe('text-only proxy contract', () => {
  it('permits only explicit text/receipt/stop routes and rejects execution context', () => {
    expect(shellRoute('POST', `/api/sessions/${conversationId}/inputs`)).toBe('input');
    expect(shellRoute('GET', `/api/sessions/${conversationId}/input-receipts/${command.clientMessageId}`)).toBe('json');
    expect(JSON.parse(shellWrite('input', command))).toEqual(command);
    for (const input of [{ ...command, origin: { type: 'endpoint', endpointId: 'pc', token: 'secret' } },
      { ...command, input: { content: 'x', attachments: [] } }, { ...command, input: { content: 'x', endpointContext: {} } },
      { ...command, creation: { ...command.creation, projectId: 'project', execution: { mode: 'local_checkout' } } },
      { ...command, input: { content: 'x'.repeat(8193) } }]) expect(() => shellWrite('input', input)).toThrow('DENIED');
    expect(() => shellWrite('stop', { runId: 'run', path: '/local' })).toThrow();
    expect(shellRoute('POST', `/api/sessions/${conversationId}/materialize`)).toBeUndefined();
  });
});

describe('encrypted identity-scoped recovery hints', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'xopc-chat-state-')); });
  afterEach(async () => { vi.useRealTimers(); await rm(directory, { recursive: true, force: true }); });
  const encryption = () => {
    const key = randomBytes(32);
    return { available: async () => true,
      encrypt: async (text: string) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
      decrypt: async (data: Buffer) => { const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); decipher.setAuthTag(data.subarray(-16)); return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString(); } };
  };
  const scope = { profileId: randomUUID(), gatewayId: randomUUID(), publicKey: 'public-key' };
  const value: ChatState = { version: 1, selected: conversationId, drafts: { [conversationId]: 'private draft' }, pending: { conversationId, clientMessageId: randomUUID(), createdAt: 123 } };
  it('encrypts drafts/pending ids and isolates profile, Gateway identity and public key', async () => {
    const store = new RemoteChatStateStore(directory, encryption());
    await store.write(scope, value); expect(await store.read(scope)).toEqual(value);
    const bytes = await readFile(join(directory, (await readdir(directory))[0])); expect(bytes.includes(Buffer.from('private draft'))).toBe(false);
    for (const alternate of [{ ...scope, profileId: randomUUID() }, { ...scope, gatewayId: randomUUID() }, { ...scope, publicKey: 'changed' }]) expect(await store.read(alternate)).toEqual({ version: 1, drafts: {} });
    await store.prune([]); expect(await readdir(directory)).toEqual([]);
  });
  it('fails closed on corrupt, oversized and unknown state without plaintext fallback', async () => {
    const store = new RemoteChatStateStore(directory, encryption()); await store.write(scope, value);
    const path = join(directory, (await readdir(directory))[0]); await writeFile(path, 'corrupt');
    await expect(store.read(scope)).rejects.toThrow('UNAVAILABLE');
    await expect(store.write(scope, { ...value, token: 'secret' })).rejects.toThrow('UNAVAILABLE');
    await expect(store.write(scope, { ...value, drafts: { [conversationId]: 'x'.repeat(8193) } })).rejects.toThrow('UNAVAILABLE');
    expect(await readFile(path, 'utf8')).toBe('corrupt');
  });
  it('quarantines a timed-out secure-store operation', async () => {
    vi.useFakeTimers(); const crypto = encryption(); crypto.available = () => new Promise(() => {});
    const store = new RemoteChatStateStore(directory, crypto);
    const pending = expect(store.write(scope, value)).rejects.toThrow('RESTART_REQUIRED');
    await vi.advanceTimersByTimeAsync(15_000); await pending;
    await expect(store.read(scope)).rejects.toThrow('RESTART_REQUIRED');
  });
});

describe('receipt recovery and window state', () => {
  let state: ChatState, accepted: boolean, receiptVisible: boolean, lost: boolean, failWrite: boolean, active: boolean;
  let api: ReturnType<typeof vi.fn>, model: RemoteChatModel;
  let writes: ChatState[];
  beforeEach(() => {
    clients.length = 0; state = { version: 1, selected: conversationId, drafts: {} }; writes = [];
    accepted = false; receiptVisible = true; lost = false; failWrite = false; active = false;
    api = vi.fn(async (path: string, body?: unknown) => {
      if (path === '/api/models') return { models: [{ id: 'fixture/model', thinking: { initialValue: 'off' } }] };
      if (path === '/api/agents') return { agents: [{ id: 'main' }], defaultId: 'main' };
      if (path.startsWith('/api/sessions?')) return { items: [] };
      if (path.endsWith('/inputs') && body) { expect(state.pending).toBeDefined(); accepted = true; if (lost) throw new TypeError('Lost response'); return {}; }
      if (path.includes('/input-receipts/')) {
        if (!accepted || !receiptVisible) throw new ChatApiError(404, 'NOT_RECEIVED');
        return { receipt: { conversationId: state.pending!.conversationId, clientMessageId: state.pending!.clientMessageId, inputId: 'input' }, inputState: {} };
      }
      if (path.includes('/messages')) return { messages: accepted ? [{ id: 'message', role: 'assistant', content: 'answer' }] : [] };
      if (path.endsWith('/input-state')) return { activeRunId: active ? 'run' : undefined, control: { phase: active ? 'running' : 'idle' } };
      if (path === '/api/agent/abort') return { ok: true };
      throw new ChatApiError(404, 'NOT_FOUND');
    });
    model = make();
  });
  function make() {
    return new RemoteChatModel(api as ChatApi, { read: async () => structuredClone(state), write: async value => {
      if (failWrite) throw new Error('disk failed'); state = structuredClone(value); writes.push(state);
    } }, () => {}, () => { throw new Error('mock realtime'); }, 'ws://fixture');
  }
  afterEach(() => { model.dispose(); });
  async function ready() { await model.initialize(); await vi.waitFor(() => expect(model.view.phase).toBe('ready')); }
  const posts = () => api.mock.calls.filter(([path, body]) => String(path).endsWith('/inputs') && body);
  it('records intent before POST and never replays a lost response during reconnect/new window', async () => {
    await ready(); await model.draft('hello'); lost = true; receiptVisible = false;
    await model.send(); await vi.waitFor(() => expect(model.view.phase).toBe('unknown'));
    await model.send(); await model.refresh(); expect(posts()).toHaveLength(1); expect(state.pending).toBeDefined();
    const pendingId = state.pending!.clientMessageId;
    model.dispose(); receiptVisible = true; model = make(); await ready();
    expect(state.pending).toBeUndefined(); expect(posts()).toHaveLength(1);
    expect(api.mock.calls.some(([path]) => String(path).endsWith('/input-receipts/' + pendingId))).toBe(true);
    expect(model.view.messages.filter(message => message.content === 'answer')).toHaveLength(1);
    expect(writes.some(write => write.pending?.clientMessageId === pendingId)).toBe(true);
  });
  it('rejects submission when secure persistence fails and when offline', async () => {
    await ready(); await model.draft('hello'); failWrite = true; await model.send(); expect(posts()).toHaveLength(0); expect(model.view.phase).toBe('recovery');
    failWrite = false; model.dispose(); model = make(); await ready(); await model.draft('new');
    clients.at(-1)!.options.onStateChange('reconnecting'); await model.send(); expect(posts()).toHaveLength(0);
  });
  it('isolates drafts by conversation and does not mutate stale/disposed UI', async () => {
    await ready(); await model.draft('A'); await model.select(otherId); await vi.waitFor(() => expect(model.view.phase).toBe('ready'));
    expect(model.view.draft).toBe(''); await model.draft('B'); await model.select(conversationId);
    expect(model.view.draft).toBe('A'); model.dispose(); clients.at(-1)!.options.onStateChange('connected'); expect(model.view.selected).toBe(conversationId);
  });
  it('uses stream offset replacement to avoid duplicate bubbles and reconciles gaps from history', async () => {
    active = true; await ready(); const client = clients.at(-1)!;
    const event = { topic: 'run:run', event: 'assistant_delta', data: { payload: { messageId: 'stream', delta: 'hello', offset: 0 } } };
    client.options.onEvent(event); client.options.onEvent(event);
    expect(model.view.messages.filter(message => message.id === 'stream')).toEqual([{ id: 'stream', role: 'assistant', content: 'hello' }]);
    await client.options.onGap({ topic: 'run:run' }); expect(model.view.messages.some(message => message.id === 'stream')).toBe(false);
  });
  it('separates requested/acknowledged stop from server-confirmed idle', async () => {
    active = true; await ready(); await model.stop(); expect(model.view.stop).toBe('acknowledged');
    active = false; await model.refresh(); expect(model.view.stop).toBe('confirmed');
  });
});
