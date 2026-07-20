// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { buildSpeakableText, detectSpeechLanguage, splitSpeakableText } from '../read-aloud-text';

describe('read aloud text', () => {
  it('keeps visible prose while skipping code and raw URLs', () => {
    const result = buildSpeakableText('# 标题\n\n访问 [官网](https://xopc.ai)。\n\n```ts\nconst secret = 1;\n```\n图片 ![架构图](a.png)');

    expect(result).toContain('标题');
    expect(result).toContain('访问 官网。');
    expect(result).toContain('架构图');
    expect(result).not.toContain('const secret');
    expect(result).not.toContain('https://');
  });

  it('splits long content without losing order', () => {
    const chunks = splitSpeakableText('第一句话。第二句话很长。Third sentence.', 12);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe('第一句话。第二句话很长。Third sentence.');
    expect(chunks.every((chunk) => chunk.length <= 80)).toBe(true);
  });

  it('detects Chinese and English content', () => {
    expect(detectSpeechLanguage('这是一个中文回答。', 'en')).toBe('zh-CN');
    expect(detectSpeechLanguage('This is an English answer.', 'zh')).toBe('en-US');
  });
});
