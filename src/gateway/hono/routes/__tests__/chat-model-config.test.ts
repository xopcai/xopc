import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../providers/index.js', () => ({
  resolveModel: (ref: string) => {
    if (ref === 'codex') throw new Error('Model unavailable: codex');
    return { provider: 'test', id: 'one', reasoning: true };
  },
}));
import { patchChatModelConfig } from '../chat-model-config.js';
import { registerAgentStreamRoutes } from '../agent-stream.js';
import { submitSessionInput } from '../session-input-handler.js';
import { setGatewayPrincipal, type GatewayPrincipal } from '../../../security/gateway-principal.js';
import { recordDeviceExecutionActor } from '../../../../endpoint-tools/execution-actor.js';
import type { EndpointConnectionSnapshot } from '../../../../endpoint-tools/registry.js';
import { AgentCatalogRepository } from '../../../../agent-catalog/repository.js';
import { createConversation } from '../../../../storage/sqlite/conversation-repository.js';
import { insertSessionInput, mutateQueuedSessionInput, getSessionInputById } from '../../../../storage/sqlite/session-input-repository.js';
import { useTestDatabase } from '../../../../storage/sqlite/__tests__/test-database.js';

useTestDatabase();

function fixture(active = false) {
  let config = { model: 'test/one', thinkingLevel: 'high', configVersion: 1, fixedModel: true };
  let pending = false;
  const service = {
    endpointTools: { registry: { verifyTurnClaim: () => true, get: () => ({
      endpointId: 'tab-1', principalId: 'owner', displayName: 'Browser tab',
      platform: 'chrome', kind: 'browser', connectionId: 'connection',
      appVersion: '1', availability: 'foreground', lastHeartbeatAt: Date.now(), tools: [],
    } satisfies EndpointConnectionSnapshot) } },
    sessions: {
      getAgentConfig: vi.fn(async () => config),
      getActiveRun: () => ({ active }),
      patchAgentConfig: vi.fn(async (_key: string, body: typeof config) => {
        if (body.configVersion !== config.configVersion) return { ok: false, code: 'CONFIG_CHANGED', error: 'Changed' };
        config = { ...config, ...body, configVersion: config.configVersion + 1 };
        return { ok: true };
      }),
    },
    getSessionInputState: () => ({ inputs: pending ? [{}] : [] }),
    submitSessionInput: vi.fn(async () => { pending = true; return { ok: true, state: {} }; }),
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    setGatewayPrincipal(c, { kind: 'owner', principalId: 'owner', scopes: ['gateway.admin'] });
    await next();
  });
  app.patch('/config', async (c) => patchChatModelConfig(c, service as never, 'chat', await c.req.json()));
  app.post('/input', (c) => submitSessionInput(c, { service } as never, 'chat'));
  const patch = (version = 1) => app.request('/config', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'test/two', thinkingLevel: 'low', configVersion: version }) });
  const send = (version = 1) => app.request('/input', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Hello', clientMessageId: 'test-input', delivery: 'next', configVersion: version, thinking: 'low', origin: { type: 'endpoint', endpointId: 'tab-1', token: 'a'.repeat(32) } }) });
  return { service, patch, send };
}

describe('chat model configuration and input acceptance', () => {
  it('requires workspace access and the original sender to edit an external Agent queue entry', async () => {
    const catalog = new AgentCatalogRepository();
    catalog.ensureInitialized();
    catalog.create({ id: 'codex-edit-agent', execution: { kind: 'codex' } }, { ready: true });
    const session = createConversation({ agentId: 'codex-edit-agent' }, '');
    const sender: GatewayPrincipal = { kind: 'device', principalId: 'sender', scopes: ['sessions.write', 'workspace.write'] };
    const input = insertSessionInput({
      id: crypto.randomUUID(), conversationId: session.key, clientMessageId: 'queued-codex-input',
      expectedTranscriptId: session.transcriptId, requestedDelivery: 'next', effectiveDelivery: 'next',
      status: 'queued', content: 'First draft', origin: { type: 'endpoint', endpointId: 'sender-endpoint' },
    });
    recordDeviceExecutionActor(session.key, input.clientMessageId, sender);

    let principal = sender;
    const app = new Hono();
    app.use('*', async (c, next) => { setGatewayPrincipal(c, principal); await next(); });
    registerAgentStreamRoutes(app, {
      service: {
        updateSessionInput: (conversationId: string, id: string, edit: { version: number; content?: string }) => ({
          ok: mutateQueuedSessionInput({ conversationId, id, ...edit }), state: {},
        }),
      },
      chatRateLimitMiddleware: async (_c: unknown, next: () => Promise<void>) => { await next(); },
    } as never);
    const patch = () => app.request(`/api/sessions/${session.key}/inputs/${input.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: input.version, content: 'Edited draft' }),
    });

    principal = { ...sender, scopes: ['sessions.write'] };
    expect((await patch()).status).toBe(403);
    principal = { ...sender, principalId: 'another-sender' };
    expect((await patch()).status).toBe(403);
    expect(getSessionInputById(session.key, input.id)?.content).toBe('First draft');
    principal = sender;
    expect((await patch()).status).toBe(200);
    expect(getSessionInputById(session.key, input.id)?.content).toBe('Edited draft');
  });

  it('rejects stale input without invoking the agent after a configuration change', async () => {
    const { patch, send, service } = fixture();
    expect((await patch()).status).toBe(200);
    expect((await send()).status).toBe(409);
    expect(service.submitSessionInput).not.toHaveBeenCalled();
  });

  it('accepts configuration changes while an input is pending', async () => {
    const { send, patch, service } = fixture();
    expect((await send()).status).toBe(202);
    expect(service.submitSessionInput).toHaveBeenCalledWith(expect.objectContaining({ thinking: 'high' }));
    expect((await patch()).status).toBe(200);
    expect(service.sessions.patchAgentConfig).toHaveBeenCalled();
  });

  it('accepts model and thinking changes during an active reply for the next input', async () => {
    const { patch, send, service } = fixture(true);
    expect((await patch()).status).toBe(200);
    expect((await send(2)).status).toBe(202);
    expect(service.submitSessionInput).toHaveBeenCalledWith(expect.objectContaining({ thinking: 'low' }));
  });

  it('serializes competing writes so exactly one succeeds', async () => {
    const { patch } = fixture();
    const results = await Promise.all([patch(), patch()]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
  });

  it('allows Codex model/thinking patches, attachments, and text input with configVersion', async () => {
    const catalog = new AgentCatalogRepository();
    catalog.ensureInitialized();
    catalog.create({ id: 'codex-agent', execution: { kind: 'codex' } }, { ready: true });
    const session = createConversation({ agentId: 'codex-agent' }, '');
    let currentConfig = { model: 'gpt-5.3-codex', thinkingLevel: 'medium', configVersion: 1, fixedModel: true };
    const service = {
      endpointTools: { registry: { verifyTurnClaim: () => true, get: () => ({
        endpointId: 'tab-1', principalId: 'owner', displayName: 'Browser tab',
        platform: 'chrome', kind: 'browser', connectionId: 'connection',
        appVersion: '1', availability: 'foreground', lastHeartbeatAt: Date.now(), tools: [],
      } satisfies EndpointConnectionSnapshot) } },
      sessions: {
        getAgentConfig: vi.fn(async () => currentConfig),
        patchAgentConfig: vi.fn(async (_id: string, body: { model?: string; thinkingLevel?: string }) => {
          currentConfig = {
            ...currentConfig,
            ...(body.model ? { model: body.model } : {}),
            ...(body.thinkingLevel ? { thinkingLevel: body.thinkingLevel } : {}),
            configVersion: currentConfig.configVersion + 1,
          };
          return { ok: true };
        }),
      },
      submitSessionInput: vi.fn(async () => ({ ok: true, state: {} })),
    };
    const app = new Hono();
    app.use('*', async (c, next) => {
      setGatewayPrincipal(c, { kind: 'owner', principalId: 'owner', scopes: ['gateway.admin', 'workspace.write'] });
      await next();
    });
    app.patch('/config', async (c) => patchChatModelConfig(c, service as never, session.key, await c.req.json()));
    app.post('/input', (c) => submitSessionInput(c, { service } as never, session.key));

    const patchRes = await app.request('/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.4-codex', thinkingLevel: 'high', configVersion: 1 }),
    });
    expect(patchRes.status).toBe(200);
    expect(service.sessions.patchAgentConfig).toHaveBeenCalledWith(
      session.key,
      expect.objectContaining({ model: 'gpt-5.4-codex', thinkingLevel: 'high', configVersion: 1, fixedModel: true }),
    );

    const attRes = await app.request('/input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: 'Inspect',
        attachments: [{ type: 'image', uri: 'file:///tmp/a.png', mimeType: 'image/png' }],
        clientMessageId: 'codex-att',
        delivery: 'next',
        configVersion: 2,
        origin: { type: 'endpoint', endpointId: 'tab-1', token: 'a'.repeat(32) },
      }),
    });
    expect(attRes.status).toBe(202);

    const textRes = await app.request('/input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: 'Run tests',
        clientMessageId: 'codex-text',
        delivery: 'next',
        configVersion: 2,
        origin: { type: 'endpoint', endpointId: 'tab-1', token: 'a'.repeat(32) },
      }),
    });
    expect(textRes.status).toBe(202);
    expect(service.submitSessionInput).toHaveBeenCalledTimes(2);
  });
});
