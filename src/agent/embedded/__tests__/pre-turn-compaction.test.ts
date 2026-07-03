import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { EmbeddedStreamEvent } from '../types.js';

/**
 * Tests for pre-turn automatic compaction in runEmbeddedTurnForSession.
 *
 * We isolate the `maybeAutoCompactBeforeTurn` behavior by mocking dependencies
 * and exercising `runEmbeddedTurnForSession` end-to-end with controlled inputs.
 */

// ---- Mocks ----

const mockRunXopcEmbeddedTurn = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../run-turn.js', () => ({
  runXopcEmbeddedTurn: (...args: unknown[]) => mockRunXopcEmbeddedTurn(...args),
}));

vi.mock('../../orchestration/run-agent-turn-with-timeout.js', () => ({
  resolveAgentTurnTimeoutMs: () => 60_000,
}));

vi.mock('../../reply/apply-turn-user-enrichment.js', () => ({
  applyStartupContextToUserMessage: ({ userMessage }: { userMessage: AgentMessage }) => userMessage,
}));

vi.mock('../../mcp/resolve-embedded-mcp-tools.js', () => ({
  resolveEmbeddedMcpToolsForTurn: async () => ({ tools: [], dispose: async () => {} }),
  mergeTurnTools: (base: unknown[]) => base,
}));

vi.mock('../../../providers/index.js', () => ({
  resolveModel: (modelRef: string) => {
    const [provider, id] = modelRef.split('/');
    return { provider, id };
  },
}));

// ---- Helpers ----

function createMockSessionStore(opts: {
  needsCompaction: boolean;
  compactResult?: { compacted: boolean; tokensBefore: number; tokensAfter: number; summary: string; firstKeptIndex: number };
}) {
  const compactResult = opts.compactResult ?? {
    compacted: opts.needsCompaction,
    tokensBefore: 120_000,
    tokensAfter: 40_000,
    summary: 'Conversation summary after compaction.',
    firstKeptIndex: 20,
  };

  return {
    load: vi.fn().mockResolvedValue([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ] as AgentMessage[]),
    prepareCompaction: vi.fn().mockReturnValue({
      needsCompaction: opts.needsCompaction,
      messages: [],
      stats: opts.needsCompaction
        ? { needed: true, reason: 'threshold_exceeded', usagePercent: 0.92 }
        : { needed: false, reason: 'within_threshold' },
    }),
    compact: vi.fn().mockResolvedValue(compactResult),
  };
}

function createMockAgentManager() {
  return {
    getOrCreateAgent: vi.fn().mockReturnValue({
      state: {
        tools: [],
        systemPrompt: 'You are a helpful assistant.',
        thinkingLevel: 'medium',
        messages: [],
      },
    }),
    getResolvedWorkspaceForSession: vi.fn().mockReturnValue('/tmp/workspace'),
    setModelForSession: vi.fn().mockReturnValue(true),
    removeAgent: vi.fn().mockReturnValue(true),
  };
}

function createMockModelManager() {
  return {
    applyModelForSession: vi.fn().mockResolvedValue(undefined),
    getModelForSession: vi.fn().mockReturnValue('test-model'),
    getResolvedModelForSession: vi.fn().mockReturnValue({
      contextWindow: 128_000,
      id: 'test-model',
    }),
    getFallbackCandidatesForSession: vi.fn().mockReturnValue([{ provider: 'test', model: 'test-model' }]),
    applyResolvedModel: vi.fn(),
  };
}

function configWithCompaction(enabled: boolean) {
  return {
    agents: {
      default: 'main',
      defaultPreset: 'default',
      capabilityPresets: {
        default: {
          id: 'default',
          name: 'Global defaults',
          models: { defaultRole: 'deep', roles: { deep: { model: 'test/test-model' } } },
        },
      },
      list: [
        {
          id: 'main',
          identity: { name: 'Main', role: 'General assistant' },
          responsibilities: { primary: ['Help the user complete tasks'] },
          workspace: { root: '/tmp/workspace' },
          tools: { builtin: {} },
          skills: { mode: 'all' },
          memory: {
            mode: 'confirmWrite',
            sources: ['session'],
            retention: { compaction: enabled },
          },
          workflows: {},
          boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
        },
      ],
    },
  };
}

// ---- Tests ----

describe('pre-turn auto-compaction', () => {
  let runEmbeddedTurnForSession: typeof import('../run-for-session.js').runEmbeddedTurnForSession;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRunXopcEmbeddedTurn.mockReset();
    mockRunXopcEmbeddedTurn.mockResolvedValue({ ok: true });
    const mod = await import('../run-for-session.js');
    runEmbeddedTurnForSession = mod.runEmbeddedTurnForSession;
  });

  it('triggers compaction when prepareCompaction reports needsCompaction=true', async () => {
    const sessionStore = createMockSessionStore({ needsCompaction: true });
    const agentManager = createMockAgentManager();
    const modelManager = createMockModelManager();
    const events: EmbeddedStreamEvent[] = [];

    await runEmbeddedTurnForSession({
      sessionKey: 'agent:main:test-session',
      userMessage: { role: 'user', content: 'test' } as AgentMessage,
      sessionStore: sessionStore as any,
      agentManager: agentManager as any,
      modelManager: modelManager as any,
      onEvent: (e) => events.push(e),
    });

    // Compaction was executed
    expect(sessionStore.load).toHaveBeenCalledWith('agent:main:test-session');
    expect(sessionStore.prepareCompaction).toHaveBeenCalledWith(
      'agent:main:test-session',
      expect.any(Array),
      128_000,
    );
    expect(sessionStore.compact).toHaveBeenCalledWith(
      'agent:main:test-session',
      expect.any(Array),
      128_000,
    );

    // Agent was evicted for fresh reload
    expect(agentManager.removeAgent).toHaveBeenCalledWith('agent:main:test-session');

    // SSE events emitted in order: started → completed
    const compactionEvents = events.filter((e) => e.type === 'compaction');
    expect(compactionEvents).toHaveLength(2);
    expect(compactionEvents[0]).toMatchObject({ type: 'compaction', status: 'started' });
    expect(compactionEvents[1]).toMatchObject({
      type: 'compaction',
      status: 'completed',
      tokensBefore: 120_000,
      tokensAfter: 40_000,
    });

    // The embedded turn still ran
    expect(mockRunXopcEmbeddedTurn).toHaveBeenCalled();
  });

  it('does NOT trigger compaction when below threshold', async () => {
    const sessionStore = createMockSessionStore({ needsCompaction: false });
    const agentManager = createMockAgentManager();
    const modelManager = createMockModelManager();
    const events: EmbeddedStreamEvent[] = [];

    await runEmbeddedTurnForSession({
      sessionKey: 'agent:main:test-session',
      userMessage: { role: 'user', content: 'test' } as AgentMessage,
      sessionStore: sessionStore as any,
      agentManager: agentManager as any,
      modelManager: modelManager as any,
      onEvent: (e) => events.push(e),
    });

    // No compact called
    expect(sessionStore.compact).not.toHaveBeenCalled();
    expect(agentManager.removeAgent).not.toHaveBeenCalled();

    // No compaction events emitted
    const compactionEvents = events.filter((e) => e.type === 'compaction');
    expect(compactionEvents).toHaveLength(0);

    // The embedded turn still ran
    expect(mockRunXopcEmbeddedTurn).toHaveBeenCalled();
  });

  it('tries fallback model when the primary embedded turn fails', async () => {
    mockRunXopcEmbeddedTurn
      .mockResolvedValueOnce({ ok: false, errorMessage: 'primary failed' })
      .mockResolvedValueOnce({ ok: true, lastAssistantText: 'fallback ok' });
    const sessionStore = createMockSessionStore({ needsCompaction: false });
    const agentManager = createMockAgentManager();
    const modelManager = {
      ...createMockModelManager(),
      getModelForSession: vi.fn().mockReturnValue('primary/model-a'),
      getResolvedModelForSession: vi.fn().mockReturnValue({
        contextWindow: 128_000,
        provider: 'primary',
        id: 'model-a',
      }),
      getFallbackCandidatesForSession: vi.fn().mockReturnValue([
        { provider: 'primary', model: 'model-a' },
        { provider: 'fallback', model: 'model-b' },
      ]),
    };

    const result = await runEmbeddedTurnForSession({
      sessionKey: 'agent:main:test-session',
      userMessage: { role: 'user', content: 'test' } as AgentMessage,
      sessionStore: sessionStore as any,
      agentManager: agentManager as any,
      modelManager: modelManager as any,
    });

    expect(result.ok).toBe(true);
    expect(mockRunXopcEmbeddedTurn).toHaveBeenCalledTimes(2);
    expect(mockRunXopcEmbeddedTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({
      modelRef: 'primary/model-a',
    }));
    expect(mockRunXopcEmbeddedTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
      modelRef: 'fallback/model-b',
    }));
  });

  it('respects memory.retention.compaction=false config', async () => {
    const sessionStore = createMockSessionStore({ needsCompaction: true });
    const agentManager = createMockAgentManager();
    const modelManager = createMockModelManager();

    await runEmbeddedTurnForSession({
      sessionKey: 'agent:main:test-session',
      userMessage: { role: 'user', content: 'test' } as AgentMessage,
      sessionStore: sessionStore as any,
      agentManager: agentManager as any,
      modelManager: modelManager as any,
      getConfig: () => configWithCompaction(false) as any,
    });

    // Even though prepareCompaction would say yes, we never call it
    expect(sessionStore.prepareCompaction).not.toHaveBeenCalled();
    expect(sessionStore.compact).not.toHaveBeenCalled();
  });

  it('handles compaction failure gracefully without blocking the turn', async () => {
    const sessionStore = createMockSessionStore({ needsCompaction: true });
    sessionStore.compact.mockRejectedValue(new Error('LLM summary generation failed'));
    const agentManager = createMockAgentManager();
    const modelManager = createMockModelManager();
    const events: EmbeddedStreamEvent[] = [];

    const result = await runEmbeddedTurnForSession({
      sessionKey: 'agent:main:test-session',
      userMessage: { role: 'user', content: 'test' } as AgentMessage,
      sessionStore: sessionStore as any,
      agentManager: agentManager as any,
      modelManager: modelManager as any,
      onEvent: (e) => events.push(e),
    });

    // Turn still succeeds
    expect(result.ok).toBe(true);
    expect(mockRunXopcEmbeddedTurn).toHaveBeenCalled();

    // Agent was NOT evicted (compaction failed)
    expect(agentManager.removeAgent).not.toHaveBeenCalled();

    // SSE emits started then skipped (due to error)
    const compactionEvents = events.filter((e) => e.type === 'compaction');
    expect(compactionEvents).toHaveLength(2);
    expect(compactionEvents[0]).toMatchObject({ type: 'compaction', status: 'started' });
    expect(compactionEvents[1]).toMatchObject({ type: 'compaction', status: 'skipped' });
  });

  it('emits skipped when compact returns compacted=false', async () => {
    const sessionStore = createMockSessionStore({
      needsCompaction: true,
      compactResult: {
        compacted: false,
        tokensBefore: 50_000,
        tokensAfter: 50_000,
        summary: '',
        firstKeptIndex: 0,
      },
    });
    const agentManager = createMockAgentManager();
    const modelManager = createMockModelManager();
    const events: EmbeddedStreamEvent[] = [];

    await runEmbeddedTurnForSession({
      sessionKey: 'agent:main:test-session',
      userMessage: { role: 'user', content: 'test' } as AgentMessage,
      sessionStore: sessionStore as any,
      agentManager: agentManager as any,
      modelManager: modelManager as any,
      onEvent: (e) => events.push(e),
    });

    expect(agentManager.removeAgent).not.toHaveBeenCalled();

    const compactionEvents = events.filter((e) => e.type === 'compaction');
    expect(compactionEvents[1]).toMatchObject({ type: 'compaction', status: 'skipped' });
  });

  it('uses model.contextWindow from resolved model', async () => {
    const sessionStore = createMockSessionStore({ needsCompaction: false });
    const agentManager = createMockAgentManager();
    const modelManager = createMockModelManager();
    modelManager.getResolvedModelForSession.mockReturnValue({
      contextWindow: 200_000,
      id: 'big-model',
    });

    await runEmbeddedTurnForSession({
      sessionKey: 'agent:main:test-session',
      userMessage: { role: 'user', content: 'test' } as AgentMessage,
      sessionStore: sessionStore as any,
      agentManager: agentManager as any,
      modelManager: modelManager as any,
    });

    // prepareCompaction receives 200k context window
    expect(sessionStore.prepareCompaction).toHaveBeenCalledWith(
      'agent:main:test-session',
      expect.any(Array),
      200_000,
    );
  });
});
