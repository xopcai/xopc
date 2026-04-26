import { describe, expect, it } from 'vitest';

import { formatFeishuOutboundText, markdownToFeishuPlainText, renderFeishuCardMarkdown } from '../format.js';

describe('feishu format', () => {
  it('renders CommonMark emphasis into Lark markdown markers', () => {
    const md = 'Hello **world** and *you*.';
    expect(renderFeishuCardMarkdown(md)).toContain('**world**');
    expect(renderFeishuCardMarkdown(md)).toContain('*you*');
  });

  it('strips markdown markers for plain Feishu text payloads', () => {
    const md = 'Hello **world**';
    expect(markdownToFeishuPlainText(md)).toBe('Hello world');
  });

  it('respects raw render mode', () => {
    const md = 'Hello **world**';
    expect(
      formatFeishuOutboundText({
        text: md,
        renderMode: 'raw',
        forCardMarkdown: true,
      }),
    ).toBe(md);
  });
});
