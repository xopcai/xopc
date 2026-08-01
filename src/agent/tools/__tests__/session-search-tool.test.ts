import type { Api, Model } from '@earendil-works/pi-ai/compat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveModel } from '../../../providers/index.js';
import { completeWithResolvedCredentials } from '../../../providers/model-call.js';
import { createSessionSearchTool } from '../session-search-tool.js';

vi.mock('../../../providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../providers/index.js')>();
  return {
    ...actual,
    resolveModel: vi.fn(),
  };
});

vi.mock('../../../providers/model-call.js', () => ({
  completeWithResolvedCredentials: vi.fn(),
}));

function model(provider: string, id: string): Model<Api> {
  return { provider, id, api: 'openai-completions' } as Model<Api>;
}

function createStore() {
  return {
    list: vi.fn(async () => ({
      items: [{ key: 'agent:main:webchat:default:direct:target' }],
      total: 1,
    })),
    load: vi.fn(async () => [
      { role: 'user', content: 'Remember the launch date.' },
      { role: 'assistant', content: 'The launch is Friday.' },
    ]),
  };
}

async function executeSearch(getPrimaryModel: () => Model<Api>) {
  const tool = createSessionSearchTool({
    getSessionStore: () => createStore() as never,
    getPrimaryModel,
  });
  return tool.execute('call-1', { query: 'launch date', limit: 1 });
}

describe('session_search summary model', () => {
  beforeEach(() => {
    delete process.env.XOPC_SESSION_SEARCH_MODEL;
    vi.mocked(resolveModel).mockImplementation((ref) => {
      const [provider, ...idParts] = ref.split('/');
      return model(provider!, idParts.join('/'));
    });
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue({
      content: [{ type: 'text', text: 'Summary' }],
    } as never);
  });

  afterEach(() => {
    delete process.env.XOPC_SESSION_SEARCH_MODEL;
    vi.clearAllMocks();
  });

  it('uses the current effective session model for every execution', async () => {
    let currentModel = model('deepseek', 'deepseek-v4-flash');
    const getPrimaryModel = () => currentModel;

    await executeSearch(getPrimaryModel);
    expect(vi.mocked(completeWithResolvedCredentials).mock.calls[0]?.[0]).toBe(currentModel);

    currentModel = model('anthropic', 'claude-sonnet-4-5');
    await executeSearch(getPrimaryModel);
    expect(vi.mocked(completeWithResolvedCredentials).mock.calls[1]?.[0]).toBe(currentModel);
  });

  it('uses XOPC_SESSION_SEARCH_MODEL as a strict explicit override', async () => {
    process.env.XOPC_SESSION_SEARCH_MODEL = 'openai/gpt-4o-mini';
    const currentModel = model('deepseek', 'deepseek-v4-flash');

    await executeSearch(() => currentModel);

    expect(resolveModel).toHaveBeenCalledWith('openai/gpt-4o-mini');
    expect(vi.mocked(completeWithResolvedCredentials).mock.calls[0]?.[0]).toMatchObject({
      provider: 'openai',
      id: 'gpt-4o-mini',
    });
  });

  it('does not fall back when the explicit override is invalid', async () => {
    process.env.XOPC_SESSION_SEARCH_MODEL = 'missing/model';
    vi.mocked(resolveModel).mockImplementation(() => {
      throw new Error('Unknown model: missing/model');
    });

    const result = await executeSearch(() => model('deepseek', 'deepseek-v4-flash'));

    expect(completeWithResolvedCredentials).not.toHaveBeenCalled();
    expect(result.content).toEqual([
      { type: 'text', text: 'session_search error: Unknown model: missing/model' },
    ]);
  });
});
