import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import type { HomeContextSnapshot } from '../snapshot.js';

vi.mock('../../agent/agent-scope.js', () => ({
  resolveDefaultAgentId: vi.fn(() => 'main'),
}));

vi.mock('../../config/agent-model-intents.js', () => ({
  resolveModelSelector: vi.fn(() => 'test/reasoning'),
}));

vi.mock('../../providers/index.js', () => ({
  resolveModel: vi.fn(() => ({ provider: 'test', id: 'reasoning', baseUrl: 'https://example.test' })),
}));

vi.mock('../../providers/model-call.js', () => ({
  completeWithResolvedCredentials: vi.fn(),
  isLocalModelBaseUrl: vi.fn(() => false),
}));

import { completeWithResolvedCredentials } from '../../providers/model-call.js';
import { HomeAdviceBudgetExceededError, HomeAdviceGenerator } from '../generator.js';

const snapshot: HomeContextSnapshot = {
  generatedAt: 1,
  locale: 'zh',
  projects: [],
  tasks: [],
  knowledge: [],
  recentSessions: [],
  successfulPatterns: [],
  evidence: [],
  hash: 'snapshot',
};

const config = {
  userContext: { userModel: { processingPolicy: 'remote_allowed' } },
} as Config;

function modelResponse(result: unknown, usage = { input: 10, output: 5, cost: { total: 0.01 } }) {
  return {
    content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
    usage,
  } as never;
}

function thinkingModelResponse(result: unknown) {
  return {
    content: [{ type: 'thinking', thinking: typeof result === 'string' ? result : JSON.stringify(result) }],
    usage: { input: 10, output: 5, cost: { total: 0.01 } },
  } as never;
}

function readyResult() {
  return {
    state: 'ready',
    candidates: [{
      kind: 'project_next_step',
      title: '明确下一步',
      outcome: '形成计划',
      rationale: '当前项目需要推进',
      evidenceIds: ['project:atlas:v1'],
      confidence: 'high',
      urgency: 'today',
      risk: 'analysis',
      proposedSteps: ['检查目标'],
      requiredCapabilities: [],
      verification: ['计划可审阅'],
      actionPrompt: '检查项目并提出下一步。',
    }],
  };
}

describe('HomeAdviceGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps machine fields in English while localizing only user-visible prose', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue(modelResponse({
      state: 'quiet', reason: 'no_change',
    }));

    await new HomeAdviceGenerator(() => config).generate(snapshot, {
      agentId: 'main', connectors: new Set(), skills: new Set(),
    });

    const context = vi.mocked(completeWithResolvedCredentials).mock.calls[0]?.[1];
    expect(context?.systemPrompt).toContain('Never translate them');
    expect(context?.systemPrompt).toContain('candidate.confidence: "high" | "medium" | "low"');
    expect(context?.systemPrompt).toContain('requiredCapabilities must be an array of objects');
    expect(context?.systemPrompt).toContain('verification must be JSON arrays of strings');
    expect(context?.systemPrompt).toContain('user-visible prose values');
    expect(context?.systemPrompt).toContain('Simplified Chinese');
  });

  it('corrects one invalid model result with validation feedback and combines usage', async () => {
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce(modelResponse({
        state: 'ready',
        candidates: [{ ...readyResult().candidates[0], confidence: '高', verification: '计划可审阅' }],
      }))
      .mockResolvedValueOnce(modelResponse(readyResult(), {
        input: 7, output: 4, cost: { total: 0.02 },
      }));

    const generation = await new HomeAdviceGenerator(() => config).generate(snapshot, {
      agentId: 'main', connectors: new Set(), skills: new Set(),
    });

    expect(generation.result).toEqual(readyResult());
    expect(generation.usage).toEqual({ inputTokens: 17, outputTokens: 9, estimatedCostUsd: 0.03 });
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(2);
    const correctionContext = vi.mocked(completeWithResolvedCredentials).mock.calls[1]?.[1];
    const correction = correctionContext?.messages[1];
    expect(correction?.role).toBe('user');
    expect(correction?.content).toContain('candidates.0.confidence');
    expect(correction?.content).toContain('candidates.0.verification');
    expect(correction?.content).toContain('Return the corrected JSON object only');
  });

  it('repairs English recommendations generated from English evidence for a Chinese user', async () => {
    const english = readyResult();
    english.candidates[0]!.title = 'Stop lane replay from contaminating shared dev validation';
    english.candidates[0]!.rationale = 'The calendar issue was traced to lane branches.';
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce(modelResponse(english))
      .mockResolvedValueOnce(modelResponse(readyResult()));

    const generation = await new HomeAdviceGenerator(() => config).generate(snapshot, {
      agentId: 'main', connectors: new Set(), skills: new Set(),
    });
    expect(generation.result).toEqual(readyResult());
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(2);
    expect(vi.mocked(completeWithResolvedCredentials).mock.calls[1]?.[1].messages[1]?.content)
      .toContain('User-visible prose must be in Simplified Chinese');
  });

  it('rejects English prose when the correction still ignores the requested language', async () => {
    const english = readyResult();
    english.candidates[0]!.outcome = 'Establish whether the lane environment is replaying events.';
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue(modelResponse(english));
    await expect(new HomeAdviceGenerator(() => config).generate(snapshot, {
      agentId: 'main', connectors: new Set(), skills: new Set(),
    })).rejects.toThrow('User-visible prose must be in Simplified Chinese');
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(2);
  });

  it('decodes HTML entities only in prose, preserving evidence and capability identifiers', async () => {
    const encoded = readyResult();
    encoded.candidates[0]!.rationale = '&#x5F53;前项目 &amp; PR #9173 需要推进';
    encoded.candidates[0]!.evidenceIds = ['project:atlas:&amp;'];
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue(modelResponse(encoded));
    const generation = await new HomeAdviceGenerator(() => config).generate(snapshot, {
      agentId: 'main', connectors: new Set(), skills: new Set(),
    });
    expect(generation.result).toMatchObject({
      state: 'ready', candidates: [{ rationale: '当前项目 & PR #9173 需要推进', evidenceIds: ['project:atlas:&amp;'] }],
    });
    expect(completeWithResolvedCredentials).toHaveBeenCalledOnce();
  });

  it('accepts English prose for an English locale', async () => {
    const english = readyResult();
    english.candidates[0]!.title = 'Stop lane replay';
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue(modelResponse(english));
    const generation = await new HomeAdviceGenerator(() => config).generate({ ...snapshot, locale: 'en' }, {
      agentId: 'main', connectors: new Set(), skills: new Set(),
    });
    expect(generation.result).toEqual(english);
    expect(completeWithResolvedCredentials).toHaveBeenCalledOnce();
  });

  it('checks the provider budget again before a JSON correction call', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue(modelResponse({
      state: 'ready', candidates: [{ ...readyResult().candidates[0], confidence: 'invalid' }],
    }));
    const allowProviderCall = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    await expect(new HomeAdviceGenerator(() => config).generate(
      snapshot,
      { agentId: 'main', connectors: new Set(), skills: new Set() },
      undefined,
      { allowProviderCall },
    )).rejects.toBeInstanceOf(HomeAdviceBudgetExceededError);
    expect(completeWithResolvedCredentials).toHaveBeenCalledOnce();
    expect(allowProviderCall).toHaveBeenCalledTimes(2);
  });

  it('accepts structured output returned in a thinking block', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue(thinkingModelResponse({
      state: 'quiet', reason: 'no_change',
    }));

    const generation = await new HomeAdviceGenerator(() => config).generate(snapshot, {
      agentId: 'main', connectors: new Set(), skills: new Set(),
    });

    expect(generation.result).toEqual({ state: 'quiet', reason: 'no_change' });
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(1);
  });

  it('surfaces provider failures without requesting a JSON correction', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue({
      content: [],
      stopReason: 'error',
      errorMessage: '502: provider_error',
    } as never);

    await expect(new HomeAdviceGenerator(() => config).generate(snapshot, {
      agentId: 'main', connectors: new Set(), skills: new Set(),
    })).rejects.toThrow('Home intelligence provider request failed: 502: provider_error');
    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(1);
  });

  it('reports a concise error when the correction is still invalid', async () => {
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce(modelResponse({ state: 'ready', candidates: [] }))
      .mockResolvedValueOnce(modelResponse({ state: 'ready', candidates: [] }));

    await expect(new HomeAdviceGenerator(() => config).generate(snapshot, {
      agentId: 'main', connectors: new Set(), skills: new Set(),
    })).rejects.toThrow(
      'Home intelligence model returned invalid structured JSON after correction: candidates: Too small',
    );
  });
});
