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

  it('returns bounded local excerpts without loading conversations or calling a model', async () => {
    const store = { ...createStore(), recallSession: vi.fn(() => [{ entryId: 'entry-9', createdAt: 1700000000000, seq: 9, role: 'assistant', content: 'Friday ' + 'x'.repeat(5000) }]) };
    const getPrimaryModel = vi.fn(() => model('test', 'fast'));
    const tool = createSessionSearchTool({ getSessionStore: () => store as never, getPrimaryModel, localOnly: true });
    const result = await tool.execute('local', { query: 'Friday', limit: 15 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.results[0].excerpts[0]).toMatchObject({ entryId: 'entry-9', createdAt: 1700000000000, role: 'assistant', seq: 9, truncated: true });
    expect(payload.results[0].excerpts[0].content).toHaveLength(800);
    expect(store.load).not.toHaveBeenCalled();
    expect(getPrimaryModel).not.toHaveBeenCalled();
    expect(completeWithResolvedCredentials).not.toHaveBeenCalled();
  });

  it('bounds the total serialized local result even when transcript text requires escaping', async () => {
    const store = { ...createStore(), list: vi.fn(async () => ({
      items: Array.from({ length: 5 }, (_, i) => ({ key: `chat-${i}`, name: '"\\\n'.repeat(300) })), total: 5,
    })), recallSession: vi.fn(() => Array.from({ length: 2 }, (_, i) => ({ seq: i + 1,
      role: 'user', content: 'Friday ' + '"\\\n'.repeat(1000) }))) };
    const tool = createSessionSearchTool({ getSessionStore: () => store as never,
      getPrimaryModel: () => model('test', 'fast'), localOnly: true });
    const result = await tool.execute('local', { query: 'Friday', limit: 5 });
    const text = (result.content[0] as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(8000);
    const payload = JSON.parse(text);
    expect(payload).toMatchObject({ truncated: true });
    expect(payload.results[0].excerpts[0].content).toContain('Friday');
    expect(store.load).not.toHaveBeenCalled();
    expect(completeWithResolvedCredentials).not.toHaveBeenCalled();
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

  it('does not access the store when cross-session history is disabled', async () => {
    const store = createStore();
    const tool = createSessionSearchTool({
      getSessionStore: () => store as never,
      getPrimaryModel: () => model('deepseek', 'deepseek-v4-flash'),
      canAccess: () => false,
    });

    const result = await tool.execute('call-1', { query: 'launch date' });

    expect(store.list).not.toHaveBeenCalled();
    expect(result.details).toEqual({ error: 'cross_session_history_disabled' });
  });

  it('rejects oversized local search keywords before reading the store', async () => {
    const getSessionStore = vi.fn();
    const tool = createSessionSearchTool({ getSessionStore, getPrimaryModel: () => model('test', 'fast'), localOnly: true });
    const result = await tool.execute('local', { query: 'x'.repeat(9000) });
    expect(result.details).toMatchObject({ error: 'invalid_query' });
    expect(getSessionStore).not.toHaveBeenCalled();
    expect((result.content[0] as { text: string }).text.length).toBeLessThan(100);
  });

  it('passes time range, agentId, projectId, and includePersonalAgent when listing sessions', async () => {
    const store = {
      list: vi.fn(async () => ({
        items: [
          { key: 'conv-1', name: 'Alpha API', agentId: 'coder', projectId: 'proj-a', updatedAt: '2026-11-20T10:00:00.000Z', messageCount: 6, sourceChannel: 'webchat' },
        ],
        total: 1,
      })),
    };
    const tool = createSessionSearchTool({
      getSessionStore: () => store as never,
      getPrimaryModel: () => model('test', 'fast'),
      localOnly: true,
    });
    const result = await tool.execute('recent-filter', {
      since: '2026-11-17',
      until: '2026-11-24',
      agentId: 'coder',
      projectId: 'proj-a',
    });
    expect(store.list).toHaveBeenCalledWith(expect.objectContaining({
      includePersonalAgent: true,
      agentId: 'coder',
      projectId: 'proj-a',
      updatedAfter: expect.any(Number),
      updatedBefore: expect.any(Number),
    }));
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      mode: 'recent',
      results: [{ key: 'conv-1', agentId: 'coder', projectId: 'proj-a' }],
    });
  });

  it('rejects invalid since/until ranges before querying the store', async () => {
    const store = createStore();
    const tool = createSessionSearchTool({
      getSessionStore: () => store as never,
      getPrimaryModel: () => model('test', 'fast'),
    });
    const badDate = await tool.execute('bad-date', { since: 'not-a-date' });
    expect(badDate.details).toMatchObject({ error: 'invalid_time_range' });
    const inverted = await tool.execute('inverted', { since: '2026-11-24', until: '2026-11-17' });
    expect(inverted.details).toMatchObject({ error: 'invalid_time_range' });
    expect(store.list).not.toHaveBeenCalled();
  });

  it('reads chronological messages of a specific conversationId with pagination and enforces access policy', async () => {
    const store = {
      getMetadata: vi.fn(async (id: string) => ({ key: id, name: 'Weekly coding', agentId: 'coder', projectId: 'proj-a', updatedAt: '2026-11-21T09:00:00.000Z', messageCount: 4, sourceChannel: 'webchat' })),
      readSessionEntries: vi.fn(() => ({
        entries: [
          { entryId: 'e1', seq: 1, role: 'user', createdAt: 1_763_600_000_000, content: 'Implemented OAuth refresh.' },
          { entryId: 'e2', seq: 2, role: 'assistant', createdAt: 1_763_600_005_000, content: 'Verified OAuth refresh tests pass.' },
        ],
        total: 4,
        offset: 0,
        hasMore: true,
      })),
    };
    const tool = createSessionSearchTool({
      getSessionStore: () => store as never,
      getPrimaryModel: () => model('test', 'fast'),
      localOnly: true,
      canRecallConversation: (id) => id === 'allowed-conv',
    });

    const denied = await tool.execute('deny', { conversationId: 'blocked-conv' });
    expect(denied.details).toMatchObject({ error: 'session_access_denied' });
    expect(store.readSessionEntries).not.toHaveBeenCalled();

    const allowed = await tool.execute('read', { conversationId: 'allowed-conv', since: '2026-11-17', limit: 2, offset: 0 });
    const payload = JSON.parse((allowed.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      mode: 'read',
      conversationId: 'allowed-conv',
      agentId: 'coder',
      projectId: 'proj-a',
      totalMessages: 4,
      hasMore: true,
      nextOffset: 2,
      requiresSpecialist: true,
    });
    expect(payload.messages).toHaveLength(2);
    expect(completeWithResolvedCredentials).not.toHaveBeenCalled();
  });

  it('summarizes a specific conversationId or time-window sessions when summarize=true on non-localOnly agents', async () => {
    const store = {
      list: vi.fn(async () => ({
        items: [
          { key: 'conv-a', name: 'Alpha', agentId: 'coder', projectId: 'proj-a', updatedAt: '2026-11-21T09:00:00.000Z', messageCount: 2, sourceChannel: 'webchat' },
          { key: 'conv-b', name: 'Beta', agentId: 'writer', projectId: 'proj-b', updatedAt: '2026-11-22T09:00:00.000Z', messageCount: 2, sourceChannel: 'webchat' },
        ],
        total: 2,
      })),
      getMetadata: vi.fn(async (id: string) => ({ key: id, name: 'Alpha', agentId: 'coder', projectId: 'proj-a' })),
      readSessionEntries: vi.fn((id: string) => ({
        entries: [{ entryId: `${id}-1`, seq: 1, role: 'user', createdAt: 1_763_600_000_000, content: `Work log for ${id}` }],
        total: 1,
        offset: 0,
        hasMore: false,
      })),
    };
    const tool = createSessionSearchTool({
      getSessionStore: () => store as never,
      getPrimaryModel: () => model('test', 'fast'),
    });

    const single = await tool.execute('sum-1', { conversationId: 'conv-a', since: '2026-11-17', summarize: true });
    expect(JSON.parse((single.content[0] as { text: string }).text)).toMatchObject({
      success: true,
      mode: 'summary',
      conversationId: 'conv-a',
      summary: 'Summary',
    });

    const batch = await tool.execute('sum-batch', { since: '2026-11-17', until: '2026-11-24', summarize: true });
    const batchPayload = JSON.parse((batch.content[0] as { text: string }).text);
    expect(batchPayload).toMatchObject({
      success: true,
      mode: 'timeframe_summary',
      count: 2,
    });
    expect(batchPayload.results.map((r: { conversationId: string; agentId: string }) => ({ id: r.conversationId, agentId: r.agentId }))).toEqual([
      { id: 'conv-a', agentId: 'coder' },
      { id: 'conv-b', agentId: 'writer' },
    ]);
  });
});
