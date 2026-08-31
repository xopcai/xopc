import { describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import {
  DEFAULT_AGENT_TURN_TIMEOUT_MS,
  MAX_AGENT_TURN_TIMEOUT_MS,
  MIN_AGENT_TURN_TIMEOUT_MS,
  AgentTurnUnsettledError,
  runAgentTurnWithTimeout,
  resolveAgentTurnTimeoutMs,
} from '../run-agent-turn-with-timeout.js';

describe('resolveAgentTurnTimeoutMs', () => {
  it('reads and clamps the effective agent runtime timeout', () => {
    const base = ConfigSchema.parse({});
    const withTimeout = (timeoutMs: number) => ConfigSchema.parse({
      ...base,
      agents: {
        ...base.agents,
        list: base.agents.list.map((agent) => ({ ...agent, runtime: { timeoutMs } })),
      },
    });

    expect(resolveAgentTurnTimeoutMs()).toBe(DEFAULT_AGENT_TURN_TIMEOUT_MS);
    expect(resolveAgentTurnTimeoutMs(withTimeout(90_000))).toBe(90_000);
    expect(resolveAgentTurnTimeoutMs(withTimeout(1_000))).toBe(MIN_AGENT_TURN_TIMEOUT_MS);
    expect(resolveAgentTurnTimeoutMs(withTimeout(MAX_AGENT_TURN_TIMEOUT_MS * 2)))
      .toBe(MAX_AGENT_TURN_TIMEOUT_MS);
  });
});

describe('runAgentTurnWithTimeout', () => {
  it('aborts and settles a timed-out agent within the cleanup grace period', async () => {
    vi.useFakeTimers();
    try {
      let settleTurn!: () => void;
      const turn = new Promise<void>((resolve) => {
        settleTurn = resolve;
      });
      const agent = {
        abort: vi.fn(() => settleTurn()),
        waitForIdle: vi.fn().mockResolvedValue(undefined),
      } as any;
      const promise = runAgentTurnWithTimeout(agent, () => turn, 100, {
        abortGraceMs: 50,
      });
      const rejection = expect(promise).rejects.toThrow('Agent turn timed out');
      await vi.advanceTimersByTimeAsync(100);

      await rejection;
      expect(agent.abort).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails cleanup when the turn callback remains active after the agent becomes idle', async () => {
    vi.useFakeTimers();
    try {
      const agent = {
        abort: vi.fn(),
        waitForIdle: vi.fn().mockResolvedValue(undefined),
      } as any;
      const promise = runAgentTurnWithTimeout(agent, () => new Promise(() => {}), 100, {
        abortGraceMs: 50,
      });
      const rejection = expect(promise).rejects.toBeInstanceOf(AgentTurnUnsettledError);
      await vi.advanceTimersByTimeAsync(150);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
