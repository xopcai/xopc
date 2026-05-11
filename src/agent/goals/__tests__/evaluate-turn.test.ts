import { describe, expect, it, vi } from 'vitest';

import * as judge from '../judge.js';
import { evaluateAfterTurnHermesLike } from '../evaluate-turn.js';

const baseState = {
  goal: 'Ship the widget',
  status: 'active' as const,
  turnsUsed: 0,
  maxTurns: 3,
  createdAt: 1,
  lastTurnAt: 0,
};

describe('evaluateAfterTurnHermesLike', () => {
  it('pauses when turn budget is exhausted', async () => {
    vi.spyOn(judge, 'judgeGoalHermesStyle').mockResolvedValue({
      verdict: 'continue',
      reason: 'more work',
      parseFailed: false,
    });
    const s0 = { ...baseState, turnsUsed: 2, maxTurns: 3 };
    const d = await evaluateAfterTurnHermesLike(s0, 'step', 'openai/gpt-4o-mini');
    expect(d.newState?.status).toBe('paused');
    expect(d.shouldContinue).toBe(false);
    expect(d.message).toContain('Goal paused');
    vi.restoreAllMocks();
  });

  it('continues when under budget and judge says continue', async () => {
    vi.spyOn(judge, 'judgeGoalHermesStyle').mockResolvedValue({
      verdict: 'continue',
      reason: 'keep going',
      parseFailed: false,
    });
    const d = await evaluateAfterTurnHermesLike({ ...baseState }, 'progress', 'openai/gpt-4o-mini');
    expect(d.shouldContinue).toBe(true);
    expect(d.continuationPrompt).toContain('[Continuing toward your standing goal]');
    expect(d.newState?.turnsUsed).toBe(1);
    vi.restoreAllMocks();
  });

  it('marks done when judge says done', async () => {
    vi.spyOn(judge, 'judgeGoalHermesStyle').mockResolvedValue({
      verdict: 'done',
      reason: 'shipped',
      parseFailed: false,
    });
    const d = await evaluateAfterTurnHermesLike({ ...baseState }, 'Done!', 'openai/gpt-4o-mini');
    expect(d.newState?.status).toBe('done');
    expect(d.shouldContinue).toBe(false);
    expect(d.message).toContain('Goal achieved');
    vi.restoreAllMocks();
  });

  it('pauses after consecutive judge parse failures (Hermes-style)', async () => {
    vi.spyOn(judge, 'judgeGoalHermesStyle').mockResolvedValue({
      verdict: 'continue',
      reason: 'judge reply was not JSON',
      parseFailed: true,
    });
    const s0 = { ...baseState, turnsUsed: 0, maxTurns: 20, decomposed: true };
    const d1 = await evaluateAfterTurnHermesLike(s0, 'step', 'openai/gpt-4o-mini', undefined, {
      goalsSlice: { maxConsecutiveParseFailures: 2, checklistMode: false },
    });
    expect(d1.newState?.consecutiveParseFailures).toBe(1);
    expect(d1.shouldContinue).toBe(true);

    const d2 = await evaluateAfterTurnHermesLike(d1.newState!, 'step', 'openai/gpt-4o-mini', undefined, {
      goalsSlice: { maxConsecutiveParseFailures: 2, checklistMode: false },
    });
    expect(d2.newState?.status).toBe('paused');
    expect(d2.shouldContinue).toBe(false);
    expect(d2.message).toContain('unparseable');
    vi.restoreAllMocks();
  });
});
