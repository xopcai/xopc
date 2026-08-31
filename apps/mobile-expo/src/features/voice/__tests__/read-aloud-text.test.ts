import { describe, expect, it } from 'vitest';

import {
  buildSpeakableText,
  detectSpeechLanguage,
  splitSpeakableText,
} from '../read-aloud-text';

describe('read aloud text', () => {
  it('keeps visible prose while removing code, URLs, and delivery metadata', () => {
    expect(buildSpeakableText([
      '# 标题',
      '访问 [官网](https://xopc.ai)。',
      '```ts\nconst secret = 1;\n```',
      '图片 ![架构图](a.png)',
      'xopc-product-delivery:%7B%22version%22%3A1%7D',
    ].join('\n\n'))).toBe('标题\n\n访问 官网。\n\n图片 架构图');
  });

  it('keeps the first sentence isolated for fast first audio', () => {
    expect(splitSpeakableText('第一句话。第二句话很长。第三句话。')).toEqual([
      '第一句话。',
      '第二句话很长。第三句话。',
    ]);
  });

  it('hard-splits an oversized first sentence at 80 characters', () => {
    expect(splitSpeakableText(`${'a'.repeat(81)}.第二句。`)).toEqual([
      'a'.repeat(80),
      'a.',
      '第二句。',
    ]);
  });

  it('detects the dominant speech language', () => {
    expect(detectSpeechLanguage('这是一个中文回答。', 'en')).toBe('zh-CN');
    expect(detectSpeechLanguage('This is an English answer.', 'zh')).toBe('en-US');
  });
});
