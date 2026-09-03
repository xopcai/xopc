import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../providers/index.js', () => ({ resolveModel: () => ({ provider: 'test', id: 'one', reasoning: true }) }));
import { patchChatModelConfig } from '../chat-model-config.js';
import { submitSessionInput } from '../session-input-handler.js';

function fixture() {
  let config = { model: 'test/one', thinkingLevel: 'high', configVersion: 1, fixedModel: true };
  let pending = false;
  const service = {
    endpointTools: { registry: { verifyTurnClaim: () => true } },
    sessions: {
      getAgentConfig: vi.fn(async () => config),
      getActiveRun: () => ({ active: false }),
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
  app.patch('/config', async (c) => patchChatModelConfig(c, service as never, 'chat', await c.req.json()));
  app.post('/input', (c) => submitSessionInput(c, { service } as never, 'chat'));
  const patch = (version = 1) => app.request('/config', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'test/two', thinkingLevel: 'low', configVersion: version }) });
  const send = (version = 1) => app.request('/input', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Hello', clientMessageId: 'test-input', delivery: 'next', configVersion: version, thinking: 'low', origin: { type: 'endpoint', endpointId: 'tab-1', token: 'a'.repeat(32) } }) });
  return { service, patch, send };
}

describe('chat model configuration and input acceptance', () => {
  it('rejects stale input without invoking the agent after a configuration change', async () => {
    const { patch, send, service } = fixture();
    expect((await patch()).status).toBe(200);
    expect((await send()).status).toBe(409);
    expect(service.submitSessionInput).not.toHaveBeenCalled();
  });

  it('accepts the displayed configuration and prevents changes while its input is pending', async () => {
    const { send, patch, service } = fixture();
    expect((await send()).status).toBe(202);
    expect(service.submitSessionInput).toHaveBeenCalledWith(expect.objectContaining({ thinking: 'high' }));
    expect((await patch()).status).toBe(409);
    expect(service.sessions.patchAgentConfig).not.toHaveBeenCalled();
  });

  it('serializes competing writes so exactly one succeeds', async () => {
    const { patch } = fixture();
    const results = await Promise.all([patch(), patch()]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
  });
});
