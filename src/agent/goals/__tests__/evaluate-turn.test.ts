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
    vi.spyOn(judge, 'judgeGoalHermesStyle').mockResolvedValue({ verdict: 'continue', reason: 'more work' });
    const s0 = { ...baseState, turnsUsed: 2, maxTurns: 3 };
    const d = await evaluateAfterTurnHermesLike(s0, 'step', 'openai/gpt-4o-mini');
    expect(d.newState?.status).toBe('paused');
    expect(d.shouldContinue).toBe(false);
    expect(d.message).toContain('Goal paused');
    vi.restoreAllMocks();
  });

  it('continues when under budget and judge says continue', async () => {
    vi.spyOn(judge, 'judgeGoalHermesStyle').mockResolvedValue({ verdict: 'continue', reason: 'keep going' });
    const d = await evaluateAfterTurnHermesLike({ ...baseState }, 'progress', 'openai/gpt-4o-mini');
    expect(d.shouldContinue).toBe(true);
    expect(d.continuationPrompt).toContain('[Continuing toward your standing goal]');
    expect(d.newState?.turnsUsed).toBe(1);
    vi.restoreAllMocks();
  });

  it('marks done when judge says done', async () => {
    vi.spyOn(judge, 'judgeGoalHermesStyle').mockResolvedValue({ verdict: 'done', reason: 'shipped' });
    const d = await evaluateAfterTurnHermesLike({ ...baseState }, 'Done!', 'openai/gpt-4o-mini');
    expect(d.newState?.status).toBe('done');
    expect(d.shouldContinue).toBe(false);
    expect(d.message).toContain('Goal achieved');
    vi.restoreAllMocks();
  });
});
