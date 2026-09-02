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
      { role: 'user', content: opts.needsCompaction ? 'x'.repeat(420_000) : 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ] as AgentMessage[]),
    compact: vi.fn().mockResolvedValue(compactResult),
    loadTranscriptRows: vi.fn().mockResolvedValue([]),
    prepareModelFallback: vi.fn().mockResolvedValue('prompt'),
  };
}

function createMockAgentManager() {
  const turnPolicy = {
    reset: vi.fn(),
    beforeToolCall: vi.fn(),
    afterToolCall: vi.fn(),
    shouldStopAfterTurn: vi.fn(),
  };
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
    createAgentTurnPolicy: vi.fn().mockReturnValue(turnPolicy),
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
    userContext: {
      memory: {
        retention: {
          compaction: {
            enabled,
            triggerThreshold: 0.8,
            reserveTokens: 8_192,
            minMessagesBeforeCompact: 2,
            keepRecentTokens: 20_000,
            recentTurnsPreserve: 3,
            summaryMaxTokens: 2_000,
            summaryChunkTokens: 24_000,
            summaryTimeoutMs: 180_000,
            summaryRetries: 2,
            qualityGuard: true,
            minToolResultKeepChars: 1_000,
            maxActiveTranscriptBytes: 2_000_000,
            postCompactionSections: ['Session Startup', 'Red Lines'],
          },
        },
      },
    },
    agents: {
      default: 'main',
      defaults: {
        models: { chat: { primary: 'test/test-model', fallbacks: [] }, intents: {} },
        skills: { mode: 'all-enabled', exclude: [] },
        tools: {},
        workflows: {},
        runtime: {},
      },
      list: [
        {
          id: 'main',
          profile: { name: 'Main' },
          workspace: '/tmp/workspace',
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

  it('triggers compaction when the full context budget crosses the threshold', async () => {
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
      getConfig: () => configWithCompaction(true) as any,
      onEvent: (e) => events.push(e),
    });

    // Compaction was executed
    expect(sessionStore.load).toHaveBeenCalledWith('agent:main:test-session');
    expect(sessionStore.compact).toHaveBeenCalledWith(
      'agent:main:test-session',
      expect.any(Array),
      expect.objectContaining({ id: 'test-model' }),
      undefined,
      false,
      expect.objectContaining({ fallbackModels: [] }),
    );

    // Agent was evicted for fresh reload
    expect(agentManager.removeAgent).toHaveBeenCalledWith('agent:main:test-session');

    // Run events emitted in order: started → completed
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

  it('forces compaction when the active transcript exceeds the byte limit', async () => {
    const sessionStore = createMockSessionStore({
      needsCompaction: false,
      compactResult: {
        compacted: true,
        tokensBefore: 17_000,
        tokensAfter: 3_000,
        summary: 'Byte pressure summary.',
        firstKeptIndex: 1,
      },
    });
    sessionStore.load.mockResolvedValue([
      { role: 'user', content: 'x'.repeat(70_000) },
      { role: 'assistant', content: 'ok' },
    ] as AgentMessage[]);
    const config = configWithCompaction(true);
    config.userContext.memory.retention.compaction.maxActiveTranscriptBytes = 64_000;

    await runEmbeddedTurnForSession({
      sessionKey: 'agent:main:test-session',
      userMessage: { role: 'user', content: 'test' } as AgentMessage,
      sessionStore: sessionStore as any,
      agentManager: createMockAgentManager() as any,
      modelManager: createMockModelManager() as any,
      getConfig: () => config as any,
    });

    expect(sessionStore.compact).toHaveBeenCalledWith(
      'agent:main:test-session',
      expect.any(Array),
      expect.any(Object),
      undefined,
      true,
      expect.any(Object),
    );
  });

  it('tries fallback model when the primary embedded turn fails', async () => {
    mockRunXopcEmbeddedTurn
      .mockResolvedValueOnce({ ok: false, errorMessage: 'primary failed' })
      .mockResolvedValueOnce({ ok: true, lastAssistantText: 'fallback ok' });
    const sessionStore = createMockSessionStore({ needsCompaction: false });
    sessionStore.prepareModelFallback.mockResolvedValue('resume');
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
      resumeLastUserMessage: true,
    }));
    expect(sessionStore.prepareModelFallback).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-retryable harness failure with a fallback model', async () => {
    mockRunXopcEmbeddedTurn.mockResolvedValueOnce({
      ok: false,
      retryable: false,
      errorMessage: 'another run already owns this session',
    });
    const sessionStore = createMockSessionStore({ needsCompaction: false });
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
      agentManager: createMockAgentManager() as any,
      modelManager: modelManager as any,
    });

    expect(result).toEqual({
      ok: false,
      retryable: false,
      errorMessage: 'another run already owns this session',
    });
    expect(mockRunXopcEmbeddedTurn).toHaveBeenCalledOnce();
    expect(sessionStore.prepareModelFallback).not.toHaveBeenCalled();
  });

  it('recomputes each model attempt timeout from the shared run deadline', async () => {
    let now = 10_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    mockRunXopcEmbeddedTurn
      .mockImplementationOnce(async () => {
        now += 10_000;
        return { ok: false, errorMessage: 'primary failed' };
      })
      .mockResolvedValueOnce({ ok: true, lastAssistantText: 'fallback ok' });
    const sessionStore = createMockSessionStore({ needsCompaction: false });
    sessionStore.prepareModelFallback.mockResolvedValue('resume');
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

    try {
      await runEmbeddedTurnForSession({
        sessionKey: 'agent:main:test-session',
        userMessage: { role: 'user', content: 'test' } as AgentMessage,
        sessionStore: sessionStore as any,
        agentManager: createMockAgentManager() as any,
        modelManager: modelManager as any,
        deadlineAtMs: 70_000,
      });

      expect(mockRunXopcEmbeddedTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({
        timeoutMs: 60_000,
      }));
      expect(mockRunXopcEmbeddedTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
        timeoutMs: 50_000,
      }));
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('does not start a fallback when the remaining deadline cannot support it', async () => {
    let now = 10_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    mockRunXopcEmbeddedTurn.mockImplementationOnce(async () => {
      now += 8_000;
      return { ok: false, errorMessage: 'primary failed' };
    });
    const sessionStore = createMockSessionStore({ needsCompaction: false });
    sessionStore.prepareModelFallback.mockResolvedValue('resume');
    const modelManager = {
      ...createMockModelManager(),
      getModelForSession: vi.fn().mockReturnValue('primary/model-a'),
      getResolvedModelForSession: vi.fn().mockReturnValue({ provider: 'primary', id: 'model-a' }),
      getFallbackCandidatesForSession: vi.fn().mockReturnValue([
        { provider: 'primary', model: 'model-a' },
        { provider: 'fallback', model: 'model-b' },
      ]),
    };

    try {
      const result = await runEmbeddedTurnForSession({
        sessionKey: 'agent:main:test-session',
        userMessage: { role: 'user', content: 'test' } as AgentMessage,
        sessionStore: sessionStore as any,
        agentManager: createMockAgentManager() as any,
        modelManager: modelManager as any,
        deadlineAtMs: 20_000,
      });

      expect(result).toMatchObject({ ok: false });
      expect(result.errorMessage).toContain('too little time');
      expect(mockRunXopcEmbeddedTurn).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('does not start a fallback after the root run is cancelled', async () => {
    const controller = new AbortController();
    mockRunXopcEmbeddedTurn.mockImplementationOnce(async () => {
      controller.abort();
      return { ok: false, errorMessage: 'aborted' };
    });
    const sessionStore = createMockSessionStore({ needsCompaction: false });
    const modelManager = {
      ...createMockModelManager(),
      getModelForSession: vi.fn().mockReturnValue('primary/model-a'),
      getResolvedModelForSession: vi.fn().mockReturnValue({ provider: 'primary', id: 'model-a' }),
      getFallbackCandidatesForSession: vi.fn().mockReturnValue([
        { provider: 'primary', model: 'model-a' },
        { provider: 'fallback', model: 'model-b' },
      ]),
    };

    const result = await runEmbeddedTurnForSession({
      sessionKey: 'agent:main:test-session',
      userMessage: { role: 'user', content: 'test' } as AgentMessage,
      sessionStore: sessionStore as any,
      agentManager: createMockAgentManager() as any,
      modelManager: modelManager as any,
      abortSignal: controller.signal,
    });

    expect(result).toEqual({ ok: false, errorMessage: 'aborted' });
    expect(mockRunXopcEmbeddedTurn).toHaveBeenCalledTimes(1);
    expect(sessionStore.prepareModelFallback).not.toHaveBeenCalled();
  });

  it('respects memory.retention.compaction.enabled=false config', async () => {
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
      getConfig: () => configWithCompaction(true) as any,
      onEvent: (e) => events.push(e),
    });

    // Turn still succeeds
    expect(result.ok).toBe(true);
    expect(mockRunXopcEmbeddedTurn).toHaveBeenCalled();

    // Agent was NOT evicted (compaction failed)
    expect(agentManager.removeAgent).not.toHaveBeenCalled();

    // Run stream emits started then skipped (due to error)
    const compactionEvents = events.filter((e) => e.type === 'compaction');
    expect(compactionEvents).toHaveLength(2);
    expect(compactionEvents[0]).toMatchObject({ type: 'compaction', status: 'started' });
    expect(compactionEvents[1]).toMatchObject({ type: 'compaction', status: 'skipped' });
  });

  it('blocks the provider call when compaction fails above the hard context limit', async () => {
    const sessionStore = createMockSessionStore({ needsCompaction: true });
    sessionStore.load.mockResolvedValue([
      { role: 'user', content: 'x'.repeat(520_000), timestamp: 1 },
      { role: 'assistant', content: 'previous answer', timestamp: 2 },
    ] as AgentMessage[]);
    sessionStore.compact.mockRejectedValue(new Error('summary unavailable'));

    await expect(runEmbeddedTurnForSession({
      sessionKey: 'agent:main:test-session',
      userMessage: { role: 'user', content: 'test' } as AgentMessage,
      sessionStore: sessionStore as any,
      agentManager: createMockAgentManager() as any,
      modelManager: createMockModelManager() as any,
    })).rejects.toThrow('summary unavailable');

    expect(mockRunXopcEmbeddedTurn).not.toHaveBeenCalled();
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
      getConfig: () => configWithCompaction(true) as any,
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

    expect(sessionStore.load).toHaveBeenCalledWith('agent:main:test-session');
    expect(sessionStore.compact).not.toHaveBeenCalled();
  });
});
