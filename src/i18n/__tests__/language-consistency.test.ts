import { describe, expect, it } from 'vitest';

import { analyzeResponseLanguage } from '../language-consistency.js';

describe('analyzeResponseLanguage', () => {
  it('recognizes predominantly Chinese prose with technical names', () => {
    const result = analyzeResponseLanguage(
      '这个实现会保留 TypeScript、OpenAI API 和 pnpm 等技术名称，同时确保其余说明使用简体中文。',
      'zh-CN',
    );
    expect(result).toMatchObject({ observed: 'zh-CN', compliant: true });
  });

  it('recognizes English prose and ignores code and URLs', () => {
    const result = analyzeResponseLanguage(
      'The implementation now keeps every user-facing explanation consistently in English. `这是代码` https://example.com/中文',
      'en',
    );
    expect(result).toMatchObject({ observed: 'en', compliant: true });
  });

  it('flags substantial bilingual prose', () => {
    const result = analyzeResponseLanguage(
      '这个功能已经完成，现在所有面向用户的说明都会保持一致。 The feature is complete and every user-facing explanation now stays in one language.',
      'auto',
    );
    expect(result).toMatchObject({ observed: 'mixed', compliant: false });
  });

  it('flags the wrong configured language', () => {
    const result = analyzeResponseLanguage(
      'This response contains enough ordinary English prose to identify its primary language reliably.',
      'zh-CN',
    );
    expect(result).toMatchObject({ observed: 'en', compliant: false });
  });

  it('does not judge short or code-only output', () => {
    const result = analyzeResponseLanguage('`pnpm test`', 'zh-CN');
    expect(result).toMatchObject({ observed: 'neutral', compliant: true });
  });
});
