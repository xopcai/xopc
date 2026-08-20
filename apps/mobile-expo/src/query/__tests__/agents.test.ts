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
  typedModels: { defaults: [], effective: [] },
  skills: { defaults: [] },
  tools: { defaultsDisable: [], entryDisable: [], effectiveDisable: [] },
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
});
