import { describe, expect, it } from 'vitest';

import { draftGoalContract } from '../goal-contract-draft.js';

describe('draftGoalContract', () => {
  it('returns a safe, editable local draft when no model is configured', async () => {
    const result = await draftGoalContract({
      title: 'Improve export compatibility',
      context: 'Only update the export module.',
    });

    expect(result.generated).toBe(false);
    expect(result.contract).toMatchObject({
      objective: 'Improve export compatibility',
      scopeBoundary: 'Only update the export module.',
    });
    expect(result.contract.criteria).toHaveLength(2);
    expect(result.contract.evidencePlan).toHaveLength(1);
  });

  it('uses Chinese fallback copy for a Chinese goal draft', async () => {
    const result = await draftGoalContract({
      title: '深入调研目前 AI 世界模型的技术进展，有什么机会',
      uiLocale: 'zh',
    });

    expect(result.contract.criteria).toEqual([
      '“深入调研目前 AI 世界模型的技术进展，有什么机会”具有清晰且可由用户验证的最终结果。',
      '“深入调研目前 AI 世界模型的技术进展，有什么机会”在约定范围内完成所需工作。',
    ]);
    expect(result.contract.evidencePlan).toEqual(['提供可检查的测试结果、产物、链接或报告，以证明目标完成。']);
  });
});
