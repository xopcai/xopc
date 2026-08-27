import { describe, expect, it } from 'vitest';

import { buildRetrievalQueryProfile } from '../queryProfile.js';
import {
  extractCjkBigrams,
  extractRetrievalIdentifiers,
  normalizeRetrievalText,
  retrievalLexicalSimilarity,
} from '../textFeatures.js';

describe('retrieval text features', () => {
  it('normalizes text and extracts stable identifiers', () => {
    expect(normalizeRetrievalText('  XOPC\u3000Gateway  ')).toBe('xopc gateway');
    expect(extractRetrievalIdentifiers('Fix src/agent/service.ts for @xopcai/xopc issue #123')).toEqual([
      '@xopcai/xopc',
      'src/agent/service.ts',
      'service.ts',
      '#123',
    ]);
  });

  it('uses Chinese bigrams for reformulated lexical overlap', () => {
    expect(extractCjkBigrams('低风险操作直接执行')).toContain('风险');
    expect(retrievalLexicalSimilarity('低风险操作直接执行', '低风险修改可以直接处理')).toBeGreaterThan(0);
    expect(retrievalLexicalSimilarity('低风险操作直接执行', '喜欢详细解释')).toBe(0);
  });
});

describe('retrieval query profile', () => {
  it('derives deterministic kind and time hints without a model', () => {
    const profile = buildRetrievalQueryProfile(
      '上次 xopc 发布失败后，我们决定怎么处理？',
      { sessionKey: 'session-1', workspaceId: '/repo/xopc' },
    );
    expect(profile.intentKinds).toEqual(['project_context', 'workspace_fact', 'task_lesson']);
    expect(profile.timeHints).toEqual(['historical']);
    expect(profile.scope).toEqual({ sessionKey: 'session-1', workspaceId: '/repo/xopc' });
    expect(profile.cjkBigrams).toContain('发布');
  });

  it('deduplicates overlapping intent hints', () => {
    const profile = buildRetrievalQueryProfile('我通常偏好这种格式和语言风格');
    expect(profile.intentKinds).toEqual(['preference', 'tool_preference', 'routine']);
  });
});
