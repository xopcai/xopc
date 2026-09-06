import { describe, expect, it, vi } from 'vitest';

import { createAgentTurnPolicy } from '../agent-turn-policy.js';

function beforeContext(toolName = 'exec_command') {
  return {
    toolCall: { id: 'call-1', name: toolName, arguments: {} },
    args: {},
  } as any;
}

function afterContext(isError: boolean) {
  return { isError } as any;
}

function stopContext(assistantMessages: number) {
  return {
    newMessages: Array.from({ length: assistantMessages }, () => ({ role: 'assistant' })),
  } as any;
}

describe('agent turn policy', () => {
  it('enforces tool calls across the whole user-visible run and resets explicitly', async () => {
    const authorizeToolCall = vi.fn().mockResolvedValue(undefined);
    const policy = createAgentTurnPolicy({
      resolveToolLimit: () => ({ id: 'exec_command', maxCalls: 2 }),
      authorizeToolCall,
    });

    expect(await policy.beforeToolCall(beforeContext())).toBeUndefined();
    expect(await policy.beforeToolCall(beforeContext())).toBeUndefined();
    await expect(policy.beforeToolCall(beforeContext())).resolves.toMatchObject({
      block: true,
      terminate: true,
    });
    expect(authorizeToolCall).toHaveBeenCalledTimes(2);

    policy.reset();
    expect(await policy.beforeToolCall(beforeContext())).toBeUndefined();
  });

  it('stops on cumulative tool failures instead of only the latest tool batch', async () => {
    const policy = createAgentTurnPolicy({ maxToolFailures: 2 });

    await policy.afterToolCall(afterContext(true));
    expect(policy.shouldStopAfterTurn(stopContext(1))).toBe(false);
    await policy.afterToolCall(afterContext(false));
    await policy.afterToolCall(afterContext(true));
    expect(policy.shouldStopAfterTurn(stopContext(2))).toBe(true);
  });

  it('uses assistant rounds as a hard safety fuse', () => {
    const policy = createAgentTurnPolicy({ maxTurns: 3 });

    expect(policy.shouldStopAfterTurn(stopContext(1))).toBe(false);
    expect(policy.shouldStopAfterTurn(stopContext(2))).toBe(false);
    // A repair continuation has its own newMessages, but shares the run budget.
    expect(policy.shouldStopAfterTurn(stopContext(1))).toBe(true);
  });
});
