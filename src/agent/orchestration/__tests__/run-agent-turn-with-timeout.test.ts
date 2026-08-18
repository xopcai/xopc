import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import {
  DEFAULT_AGENT_TURN_TIMEOUT_MS,
  MAX_AGENT_TURN_TIMEOUT_MS,
  MIN_AGENT_TURN_TIMEOUT_MS,
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
