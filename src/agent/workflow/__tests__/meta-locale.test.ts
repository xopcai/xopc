import { describe, expect, it } from 'vitest';

import { resolveWorkflowLocalizedCopy } from '../meta-locale.js';
import type { WorkflowMeta } from '../types.js';

describe('resolveWorkflowLocalizedCopy', () => {
  const meta: WorkflowMeta = {
    name: 'research',
    description: 'English description',
    whenToUse: 'English when',
    examplePrompts: [{ field: 'question', text: 'English prompt' }],
    i18n: {
      zh: {
        description: '中文描述',
        whenToUse: '中文场景',
        examplePrompts: [{ field: 'question', text: '中文示例' }],
      },
    },
  };

  it('returns English defaults for en locale', () => {
    expect(resolveWorkflowLocalizedCopy(meta, 'en')).toEqual({
      description: 'English description',
      whenToUse: 'English when',
      examplePrompts: [{ field: 'question', text: 'English prompt' }],
    });
  });

  it('returns zh bundle when present', () => {
    expect(resolveWorkflowLocalizedCopy(meta, 'zh')).toEqual({
      description: '中文描述',
      whenToUse: '中文场景',
      examplePrompts: [{ field: 'question', text: '中文示例' }],
    });
  });
});
