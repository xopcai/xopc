import { describe, it, expect, vi } from 'vitest';
import type { Agent } from '@mariozechner/pi-agent-core';

import {
  isAgentTurnTimeoutError,
  runAgentTurnWithTimeout,
} from '../run-agent-turn-with-timeout.js';

describe('runAgentTurnWithTimeout', () => {
  it('does not abort when runTurn completes before timeout', async () => {
    const agent = { abort: vi.fn(), waitForIdle: vi.fn() } as unknown as Agent;
    await runAgentTurnWithTimeout(agent, async () => {}, 60_000);
    expect(agent.abort).not.toHaveBeenCalled();
  });

  it('aborts and waits for idle when the turn exceeds the deadline', async () => {
    const agent = {
      abort: vi.fn(),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as Agent;

    await expect(
      runAgentTurnWithTimeout(
        agent,
        () => new Promise<void>(() => {}),
        100,
      ),
    ).rejects.toThrow(/Agent turn timed out after/);
    expect(agent.abort).toHaveBeenCalledTimes(1);
    expect(agent.waitForIdle).toHaveBeenCalledTimes(1);
  });
});

describe('isAgentTurnTimeoutError', () => {
  it('matches timeout errors from this module', () => {
    expect(isAgentTurnTimeoutError(new Error('Agent turn timed out after 120s'))).toBe(true);
    expect(isAgentTurnTimeoutError(new Error('other'))).toBe(false);
  });
});
