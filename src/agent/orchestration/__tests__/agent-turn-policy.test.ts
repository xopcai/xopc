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
  it('applies underlying tool approvals and limits to every batch access', async () => {
    const authorize = vi.fn().mockResolvedValue(undefined);
    const policy = createAgentTurnPolicy({ resolveToolLimit: name => name === 'read_file' ? { id: name, maxCalls: 1 } : undefined, authorizeToolCall: authorize });
    const context = { ...beforeContext('data_batch'), args: { operations: [
      { id: 'a', kind: 'file_read', path: 'a.md' },
      { id: 'b', kind: 'file_read', path: 'b.md' },
    ] } };
    expect(await policy.beforeToolCall(context)).toMatchObject({ block: true, reason: expect.stringContaining('read_file') });
    expect(authorize.mock.calls.map(([call]) => call.toolCall.name)).toEqual(['data_batch', 'read_file']);
    const deny = createAgentTurnPolicy({ authorizeToolCall: async context => context.toolCall.name === 'grep' ? { block: true, reason: 'Approval required' } : undefined });
    expect(await deny.beforeToolCall({ ...beforeContext('data_batch'), args: { operations: [{ id: 's', kind: 'file_search', paths: ['src', 'docs'], patterns: ['value'] }] } })).toMatchObject({ block: true });
  });
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

it('counts each underlying batch query once across a child-to-parent authorization chain', async () => {
  const calls = vi.fn(async () => undefined);
  const parent = createAgentTurnPolicy({ resolveToolLimit: name => name === 'web_search' ? { id: name, maxCalls: 2 } : undefined,
    authorizeToolCall: calls });
  const child = createAgentTurnPolicy({ authorizeToolCall: parent.beforeToolCall });
  const context = { ...beforeContext('data_batch'), args: { operations: [
    { id: 'a', kind: 'web_search', query: 'Vendor A' }, { id: 'b', kind: 'web_search', query: 'Vendor B' },
  ] } };
  expect(await child.beforeToolCall(context)).toBeUndefined();
  expect(calls.mock.calls.map(([context]) => context.toolCall.name)).toEqual(['data_batch', 'web_search', 'web_search']);
  expect(await child.beforeToolCall(beforeContext('web_search'))).toMatchObject({ block: true, terminate: true });
});
