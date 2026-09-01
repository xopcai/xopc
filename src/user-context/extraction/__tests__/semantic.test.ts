import { describe, expect, it } from 'vitest';

import { parseSemanticUnderstanding } from '../semantic.js';

const evidence = [
  { ref: 'u1', role: 'user' as const, text: '我的长期目标是把 xopc 推进到正式上线，请记住。' },
  { ref: 'a1', role: 'assistant' as const, text: '你的长期目标是上线另一个产品。' },
  { ref: 'u2', role: 'user' as const, text: '你记住这个长期目标了吗？' },
  { ref: 'u3', role: 'user' as const, text: '不要再问了，直接执行当前任务。' },
  { ref: 'u4', role: 'user' as const, text: '报告必须覆盖北京时间和 UTC 窗口。' },
];

function response(value: Record<string, unknown>): string {
  return JSON.stringify({ candidates: [], targetUnderstandingIds: [], ...value });
}

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    factKey: 'product:xopc:launch',
    statement: '把 xopc 推进到正式上线',
    kind: 'long_term_goal',
    explicitness: 'explicit',
    durability: 'durable',
    scopeHint: 'global',
    confidence: 0.98,
    importance: 0.9,
    evidence: [{ ref: 'u1', quote: '我的长期目标是把 xopc 推进到正式上线' }],
    selfContained: true,
    unresolvedReferences: [],
    ...overrides,
  };
}

describe('semantic user-understanding interpretation', () => {
  it('does not create understanding from a memory question', () => {
    const parsed = parseSemanticUnderstanding(response({
      intent: 'memory_query', candidates: [candidate({ statement: '这个长期目标了吗？' })],
    }), evidence);
    expect(parsed).toMatchObject({ intent: 'memory_query', candidates: [] });
  });

  it('does not create understanding from an ordinary task request', () => {
    const parsed = parseSemanticUnderstanding(response({
      intent: 'task_request', candidates: [candidate()],
    }), evidence);
    expect(parsed).toMatchObject({ intent: 'task_request', candidates: [] });
  });

  it('keeps multiple grounded, self-contained candidates', () => {
    const parsed = parseSemanticUnderstanding(response({
      intent: 'memory_create',
      candidates: [
        candidate(),
        candidate({
          factKey: 'product:xopc:active',
          statement: 'xopc 是当前长期推进的产品',
          kind: 'project_context',
          explicitness: 'observed',
          evidence: [{ ref: 'u1', quote: 'xopc' }],
        }),
      ],
    }), evidence);
    expect(parsed?.candidates).toHaveLength(2);
  });

  it('rejects assistant-only evidence, unresolved references, and fabricated quotes', () => {
    const parsed = parseSemanticUnderstanding(response({
      intent: 'memory_create',
      candidates: [
        candidate({ evidence: [{ ref: 'a1', quote: '上线另一个产品' }] }),
        candidate({ selfContained: false, unresolvedReferences: ['这个'] }),
        candidate({ evidence: [{ ref: 'u1', quote: '用户从未说过的目标' }] }),
        candidate({ statement: '移民火星', evidence: [{ ref: 'u1', quote: '我的长期目标是把 xopc 推进到正式上线' }] }),
      ],
    }), evidence);
    expect(parsed?.candidates).toEqual([]);
  });

  it('fails closed on invalid schema and filters unknown target ids', () => {
    expect(parseSemanticUnderstanding('{"intent":"memory_create"}', evidence)).toBeNull();
    const parsed = parseSemanticUnderstanding(response({
      intent: 'memory_forget', targetUnderstandingIds: ['known', 'invented'],
    }), evidence, ['known']);
    expect(parsed?.targetUnderstandingIds).toEqual(['known']);
  });

  it('rejects one-turn execution instructions and task requirements as durable understanding', () => {
    const parsed = parseSemanticUnderstanding(response({
      intent: 'user_assertion',
      candidates: [
        candidate({
          factKey: 'execution:no-questions', statement: '不要再问了，直接执行当前任务', kind: 'boundary',
          evidence: [{ ref: 'u3', quote: '不要再问了，直接执行当前任务' }],
        }),
        candidate({
          factKey: 'report:time-window', statement: '报告必须覆盖北京时间和 UTC 窗口', kind: 'task_lesson',
          evidence: [{ ref: 'u4', quote: '报告必须覆盖北京时间和 UTC 窗口' }],
        }),
      ],
    }), evidence);
    expect(parsed?.candidates).toEqual([]);
  });
});
