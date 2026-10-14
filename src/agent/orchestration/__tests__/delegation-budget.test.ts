import { describe, expect, it } from 'vitest';

import { createAgentTurnPolicy } from '../agent-turn-policy.js';
import { createDelegationBudgetPolicy, resolveDelegationBudget } from '../delegation-budget.js';

const call = { toolCall: { id: 'read', name: 'read_file', arguments: {} }, args: {} } as any;
const turn = { toolResults: [{}] } as any;

describe('delegation budgets', () => {
  it('preserves standard defaults and lets call overrides retain tier token/time limits', () => {
    expect(resolveDelegationBudget().limits).toMatchObject({ maxToolCalls: 30, maxTotalTokens: 100000, timeoutMs: 300000 });
    expect(resolveDelegationBudget('deep', 40).limits).toMatchObject({ maxToolCalls: 40, maxTotalTokens: 200000, timeoutMs: 600000 });
    expect(resolveDelegationBudget('light', 100, 500000).limits).toMatchObject({ maxToolCalls: 60, timeoutMs: 120000 });
  });

  it('counts underlying batch reads rather than one wrapper call', async () => {
    const budget = createDelegationBudgetPolicy(resolveDelegationBudget(), {});
    const expanded = createAgentTurnPolicy({ authorizeToolCall: budget.policy.beforeToolCall });
    const args = { operations: [1, 2, 3].map(n => ({ id: String(n), kind: 'file_read', path: `file${n}` })) };
    await expanded.beforeToolCall({ toolCall: { id: 'batch', name: 'data_batch', arguments: args }, args } as any);
    expect(budget.snapshot().usage.toolCalls).toBe(3);
  });

  it('reserves one summary round and denies further tools without executing them', async () => {
    const budget = createDelegationBudgetPolicy(resolveDelegationBudget('standard', 5), {});
    for (let n = 0; n < 4; n++) await budget.policy.beforeToolCall(call);
    expect(budget.policy.shouldStopAfterTurn(turn)).toBe(false);
    expect(budget.policy.takeContinuationMessage?.()).toContain('precise next steps');
    expect(budget.policy.takeContinuationMessage?.()).toBeUndefined();
    expect(await budget.policy.beforeToolCall(call)).toMatchObject({ block: true });
    expect(budget.snapshot().usage.toolCalls).toBe(4);
    expect(budget.policy.beforeModelRequest?.()).toBeUndefined();
    expect(budget.policy.shouldStopAfterTurn({ toolResults: [] } as any)).toBe(true);
    expect(budget.snapshot()).toMatchObject({ stopReason: 'tool_calls', handoffRequested: true });
  });

  it('distinguishes cumulative tokens from context size and stops at the hard limit', async () => {
    const budget = createDelegationBudgetPolicy(resolveDelegationBudget(), {});
    budget.addTokens(45000);
    budget.addTokens(45000);
    expect(budget.policy.shouldStopAfterTurn(turn)).toBe(false);
    expect(budget.snapshot()).toMatchObject({ usage: { totalTokens: 90000 }, handoffReason: 'total_tokens' });
    budget.addTokens(12000);
    expect(await budget.policy.beforeToolCall(call)).toMatchObject({ block: true, terminate: true });
    expect(budget.snapshot().stopReason).toBe('total_tokens');
  });

  it('distinguishes elapsed time, failed tools and model turns', async () => {
    let time = 0;
    const timed = createDelegationBudgetPolicy(resolveDelegationBudget('light'), {}, () => time);
    time = 100000;
    timed.policy.shouldStopAfterTurn(turn);
    expect(timed.snapshot().handoffReason).toBe('timeout');
    time = 120000;
    expect(await timed.policy.beforeToolCall(call)).toMatchObject({ terminate: true });
    expect(timed.snapshot().stopReason).toBe('timeout');
    const failed = createDelegationBudgetPolicy(resolveDelegationBudget(), {});
    for (let n = 0; n < 5; n++) await failed.policy.afterToolCall({ isError: true } as any);
    expect(failed.policy.shouldStopAfterTurn(turn)).toBe(true);
    expect(failed.snapshot().stopReason).toBe('tool_failures');
    const turns = createDelegationBudgetPolicy(resolveDelegationBudget('standard', 1), {});
    turns.policy.shouldStopAfterTurn(turn);
    expect(turns.policy.shouldStopAfterTurn(turn)).toBe(true);
    expect(turns.snapshot().stopReason).toBe('model_turns');
  });

  it('preserves parent policy refusals and natural completion', async () => {
    const blocked = createDelegationBudgetPolicy(resolveDelegationBudget(), {
      authorizeToolCall: async () => ({ block: true, terminate: true, reason: 'Parent call limit reached' }),
    });
    await blocked.policy.beforeToolCall(call);
    expect(blocked.snapshot()).toMatchObject({ stopReason: 'parent_policy', stopMessage: 'Parent call limit reached' });
    const complete = createDelegationBudgetPolicy(resolveDelegationBudget(), {});
    complete.addTokens(85000);
    expect(complete.policy.shouldStopAfterTurn({ toolResults: [] } as any)).toBe(false);
    expect(complete.snapshot().handoffRequested).toBe(false);
  });

  it('rechecks elapsed limits at dispatch after a handoff has been queued', () => {
    let time = 0;
    const budget = createDelegationBudgetPolicy(resolveDelegationBudget('light'), {}, () => time);
    time = 100000;
    budget.policy.shouldStopAfterTurn(turn);
    expect(budget.policy.takeContinuationMessage?.()).toContain('handoff');
    time = 120000;
    expect(budget.policy.beforeModelRequest?.()).toContain('timeout');
    expect(budget.snapshot().stopReason).toBe('timeout');
  });

  it('allows only one handoff dispatch even if recovery retries before a finish hook', () => {
    const budget = createDelegationBudgetPolicy(resolveDelegationBudget(), {});
    budget.addTokens(85000);
    budget.policy.shouldStopAfterTurn(turn);
    expect(budget.policy.beforeModelRequest?.()).toBeUndefined();
    expect(budget.policy.beforeModelRequest?.()).toContain('already attempted');
  });

  it('rejects dispatch after a queued handoff reaches tokens or Credit exhaustion', () => {
    const budget = createDelegationBudgetPolicy(resolveDelegationBudget(), {});
    budget.addTokens(85000);
    budget.policy.shouldStopAfterTurn(turn);
    budget.addTokens(15000);
    expect(budget.policy.beforeModelRequest?.()).toContain('total_tokens');
    const credit = createDelegationBudgetPolicy(resolveDelegationBudget(), {});
    credit.addTokens(85000);
    credit.policy.shouldStopAfterTurn(turn);
    credit.stop('credit_budget', 'credit_budget_exhausted');
    expect(credit.policy.beforeModelRequest?.()).toBe('credit_budget_exhausted');
  });
});

it('queues a handoff at tool admission before a long read can start, without stopping the summary', async () => {
  let time = 0;
  const budget = createDelegationBudgetPolicy(resolveDelegationBudget('light'), {}, () => time);
  time = 96_000;
  expect(budget.researchRemainingMs()).toBe(0);
  expect(budget.remainingMs()).toBe(24_000);
  expect(await budget.policy.beforeToolCall(call)).toMatchObject({ block: true });
  expect(budget.policy.shouldStopAfterTurn(turn)).toBe(false);
  expect(budget.policy.takeContinuationMessage?.()).toContain('handoff');
  expect(budget.policy.beforeModelRequest?.()).toBeUndefined();
  expect(budget.policy.shouldStopAfterTurn({ toolResults: [] } as any)).toBe(true);
});

it('allows a final checkpoint before handoff dispatch but no tools during the summary', async () => {
  let time = 0;
  const budget = createDelegationBudgetPolicy(resolveDelegationBudget('light'), {}, () => time);
  time = 96_000;
  const checkpoint = { ...call, toolCall: { ...call.toolCall, name: 'research_checkpoint' } };
  expect(await budget.policy.beforeToolCall(checkpoint)).toBeUndefined();
  expect(budget.snapshot().usage.toolCalls).toBe(0);
  budget.policy.beforeModelRequest?.();
  expect(await budget.policy.beforeToolCall(checkpoint)).toMatchObject({ block: true });
});
