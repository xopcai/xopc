import { describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import {
  fetchChatAgents,
  resolveEffectiveDefaultAgentId,
  setGatewayDefaultAgent,
  type ChatAgentsPayload,
} from '../agents';

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  formatApiHttpError: (_status: number, _statusText: string, message?: string) => message ?? 'request failed',
}));
vi.mock('../../features/gateway/agents-cache', () => ({
  readCachedAgents: vi.fn(),
  writeCachedAgents: vi.fn(),
}));
vi.mock('../../stores/gateway-store', () => ({
  useGatewayStore: Object.assign(vi.fn(), {
    getState: () => ({ activeGatewayId: 'gateway-1' }),
  }),
}));
vi.mock('../../stores/preferences-store', () => ({ usePreferencesStore: vi.fn() }));

const mockedApiFetch = vi.mocked(apiFetch);
const option = (id: string) => ({
  id,
  modelIntents: { effective: [], overrides: [] },
  skills: { excluded: [], overrides: [] },
  tools: { denied: [], overrides: [] },
});

describe('agent query contract', () => {
  it('uses only the canonical default-agent endpoint', async () => {
    mockedApiFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(setGatewayDefaultAgent('Coder')).resolves.toBe(true);
    expect(mockedApiFetch).toHaveBeenCalledOnce();
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/agents/coder', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ setDefault: true }),
    }));
  });

  it('does not synthesize an agent before the gateway contract is available', () => {
    expect(resolveEffectiveDefaultAgentId(undefined, null)).toBe('');
    const payload: ChatAgentsPayload = {
      defaultId: 'missing',
      builtinToolIds: [],
      items: [option('first')],
    };
    expect(resolveEffectiveDefaultAgentId(payload, null)).toBe('first');
  });

  it('rejects invalid agent responses instead of inventing main', async () => {
    mockedApiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, payload: {} }), { status: 200 }));
    await expect(fetchChatAgents()).rejects.toThrow('invalid agents response');
  });

  it('reads effective defaults and explicit overrides from the canonical agent row', async () => {
    mockedApiFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      payload: {
        defaultId: 'main',
        builtinToolIds: ['exec_command'],
        agents: [{
          id: 'main',
          name: 'Main',
          override: {
            id: 'main',
            models: { intents: { coding: { primary: 'openai/codex', fallbacks: [] } } },
            skills: { mode: 'merge', add: ['coding'], remove: [] },
            tools: { exec_command: { mode: 'ask' } },
          },
          effective: {
            models: {
              chat: { primary: 'openai/gpt-5', fallbacks: ['openai/gpt-5-mini'] },
              intents: { coding: { primary: 'openai/codex', fallbacks: [] } },
            },
            skills: { mode: 'selected', include: ['coding'] },
            tools: { exec_command: { mode: 'ask' }, browser_use: { mode: 'deny' } },
          },
        }],
      },
    }), { status: 200 }));

    const result = await fetchChatAgents();

    expect(result.items[0]).toMatchObject({
      model: { primary: 'openai/gpt-5', fallbacks: ['openai/gpt-5-mini'] },
      modelIntents: { effective: ['coding'], overrides: ['coding'] },
      skills: { mode: 'selected', allowlist: ['coding'], excluded: [], overrides: ['coding'] },
      tools: { denied: ['browser_use'], overrides: ['exec_command'] },
    });
  });

  it('keeps all-enabled exclusions separate from enabled skills', async () => {
    mockedApiFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      payload: {
        defaultId: 'main',
        agents: [{
          id: 'main',
          effective: {
            models: { chat: { primary: 'openai/gpt-5', fallbacks: [] }, intents: {} },
            skills: { mode: 'all-enabled', exclude: ['unsafe'] },
            tools: {},
          },
          override: {},
        }],
      },
    }), { status: 200 }));

    const result = await fetchChatAgents();

    expect(result.items[0]?.skills).toEqual({
      mode: 'all-enabled',
      excluded: ['unsafe'],
      overrides: [],
    });
  });
});
