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

  it('changes when model, tools, system prompt, or provider credential changes', () => {
    const base = {
      sessionId: 'aaa2f53e-7cc1-43bf-8581-84f4254cb335',
      workspaceDir: '/tmp/ws',
      modelRef: 'openai/gpt-4o',
      toolNames: ['read', 'write'],
      systemPrompt: 'You are helpful.',
      thinkingLevel: 'medium',
      credentialRevision: 'current-credential',
    };

    const a = buildEmbeddedRunnerFingerprint(base);
    const b = buildEmbeddedRunnerFingerprint({ ...base, modelRef: 'anthropic/claude-sonnet' });
    const c = buildEmbeddedRunnerFingerprint({ ...base, toolNames: ['read'] });
    const d = buildEmbeddedRunnerFingerprint({ ...base, systemPrompt: 'Different prompt.' });
    const e = buildEmbeddedRunnerFingerprint({ ...base, credentialRevision: 'new-credential' });

    expect(b).not.toBe(a);
    expect(c).not.toBe(a);
    expect(d).not.toBe(a);
    expect(e).not.toBe(a);
  });

  it('is stable for identical inputs regardless of tool order', () => {
    const inputA = {
      sessionId: 'aaa2f53e-7cc1-43bf-8581-84f4254cb335',
      workspaceDir: '/tmp/ws',
      modelRef: 'openai/gpt-4o',
      toolNames: ['b', 'a'],
      systemPrompt: 'Prompt',
      thinkingLevel: 'low',
      credentialRevision: 'current-credential',
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
