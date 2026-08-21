import { describe, expect, it } from 'vitest';

import { parseUnderstandingCandidates } from '../run-background-review.js';

function response(candidates: unknown[]): string {
  return JSON.stringify({ candidates });
}

describe('background understanding candidate parsing', () => {
  it('keeps standalone durable user understanding', () => {
    const result = parseUnderstandingCandidates(response([{
      kind: 'long_term_goal',
      content: '我希望长期系统学习 Rust，并完成一个可以发布的工具。',
      confidence: 0.9,
      importance: 0.8,
      durability: 'durable',
      sensitivity: 'normal',
      disclosurePolicy: 'referenceable',
    }]));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'long_term_goal' });
  });

  it('rejects clause fragments, deferred work, and one-off task instructions', () => {
    const result = parseUnderstandingCandidates(response([
      { kind: 'long_term_goal', content: '并且将现状更新进来', confidence: 0.9 },
      { kind: 'long_term_goal', content: '事项，汇总并更新到项目 note。', confidence: 0.9 },
      { kind: 'long_term_goal', content: '这个方向暂时不用开始推进', confidence: 0.9 },
      { kind: 'commitment', content: '调查并修复当前项目的问题', confidence: 0.9 },
    ]));
    expect(result).toEqual([]);
  });
});
