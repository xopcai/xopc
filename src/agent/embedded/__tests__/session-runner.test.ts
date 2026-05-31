import { afterEach, describe, expect, it } from 'vitest';

import {
  buildEmbeddedRunnerFingerprint,
  evictEmbeddedSessionRunner,
  getEmbeddedSessionRunnerStats,
  isEmbeddedSessionRunnerEnabled,
  resetEmbeddedSessionRunnerForTest,
} from '../session-runner.js';

describe('EmbeddedSessionRunner fingerprint', () => {
  afterEach(() => {
    resetEmbeddedSessionRunnerForTest();
    delete process.env.XOPC_SESSION_RUNNER;
    delete process.env.XOPC_SESSION_RUNNER_TTL_MS;
  });

  it('changes when model, tools, or system prompt change', () => {
    const base = {
      sessionFile: '/tmp/s.jsonl',
      workspaceDir: '/tmp/ws',
      modelRef: 'openai/gpt-4o',
      toolNames: ['read', 'write'],
      systemPrompt: 'You are helpful.',
      thinkingLevel: 'medium',
    };

    const a = buildEmbeddedRunnerFingerprint(base);
    const b = buildEmbeddedRunnerFingerprint({ ...base, modelRef: 'anthropic/claude-sonnet' });
    const c = buildEmbeddedRunnerFingerprint({ ...base, toolNames: ['read'] });
    const d = buildEmbeddedRunnerFingerprint({ ...base, systemPrompt: 'Different prompt.' });

    expect(b).not.toBe(a);
    expect(c).not.toBe(a);
    expect(d).not.toBe(a);
  });

  it('is stable for identical inputs regardless of tool order', () => {
    const inputA = {
      sessionFile: '/tmp/s.jsonl',
      workspaceDir: '/tmp/ws',
      modelRef: 'openai/gpt-4o',
      toolNames: ['b', 'a'],
      systemPrompt: 'Prompt',
      thinkingLevel: 'low',
    };
    const inputB = { ...inputA, toolNames: ['a', 'b'] };
    expect(buildEmbeddedRunnerFingerprint(inputA)).toBe(buildEmbeddedRunnerFingerprint(inputB));
  });

  it('respects XOPC_SESSION_RUNNER disable flag', () => {
    expect(isEmbeddedSessionRunnerEnabled()).toBe(true);
    process.env.XOPC_SESSION_RUNNER = '0';
    expect(isEmbeddedSessionRunnerEnabled()).toBe(false);
  });

  it('does not bump eviction stats for missing pooled entries', () => {
    resetEmbeddedSessionRunnerForTest();
    const before = getEmbeddedSessionRunnerStats().evictions;
    evictEmbeddedSessionRunner('missing-session');
    expect(getEmbeddedSessionRunnerStats().evictions).toBe(before);
    expect(getEmbeddedSessionRunnerStats().pooled).toBe(0);
  });
});
