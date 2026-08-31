import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentRunSupervisor } from '../agent-run-supervisor.js';

describe('AgentRunSupervisor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('caps each model attempt to the remaining absolute deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const supervisor = new AgentRunSupervisor({ timeoutMs: 60_000, deadlineAtMs: 40_000 });

    expect(supervisor.planModelAttempt(false)).toEqual({
      ok: true,
      remainingMs: 30_000,
      timeoutMs: 30_000,
    });
    supervisor.dispose();
  });

  it('refuses to start a fallback that cannot receive its minimum budget', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const supervisor = new AgentRunSupervisor({ timeoutMs: 60_000, deadlineAtMs: 20_000 });
    vi.setSystemTime(16_000);

    expect(supervisor.planModelAttempt(true)).toEqual({
      ok: false,
      reason: 'Agent run deadline left too little time for a fallback model attempt',
    });
    supervisor.dispose();
  });

  it('propagates parent cancellation to pending work', () => {
    const parent = new AbortController();
    const reason = new Error('cancelled by caller');
    const supervisor = new AgentRunSupervisor({ timeoutMs: 60_000, parentSignal: parent.signal });

    parent.abort(reason);

    expect(supervisor.signal.aborted).toBe(true);
    expect(supervisor.signal.reason).toBe(reason);
    expect(supervisor.planModelAttempt(false)).toEqual({ ok: false, reason: 'Agent run aborted' });
    supervisor.dispose();
  });
});
