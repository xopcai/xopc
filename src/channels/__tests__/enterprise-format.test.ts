import { describe, expect, it } from 'vitest';

import {
  formatDingTalkOutboundMessages,
  formatDiscordOutboundChunks,
  formatDiscordOutboundText,
  formatSlackOutboundChunks,
  formatSlackOutboundMrkdwn,
  formatWeComOutboundChunks,
} from '../enterprise/format.js';

describe('DingTalk outbound formatting', () => {
  it('formats bullet lists, bold emphasis, hard line breaks, and plain-text title', () => {
    const input = [
      '有！不全是刚出的新游，但这几款都挺有意思：',
      '',
      '- **《双影奇境》**：双人合作冒险。',
      '- **《小丑牌》**：组合效果、疯狂叠分。',
      '',
      '你主要玩手机还是电脑？',
    ].join('\n');

    const messages = formatDingTalkOutboundMessages(input);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.title).toBe('有！不全是刚出的新游，但这几款都挺有意思：');
    expect(messages[0]!.text).toContain('• **《双影奇境》**：双人合作冒险。  \n• **《小丑牌》**：组合效果、疯狂叠分。');
    expect(messages[0]!.text).toContain('\n\n你主要玩手机还是电脑？');
  });

  it('strips markdown markers from title, converts tables, and keeps code fences clean', () => {
    const input = [
      '# **周报总结**',
      '',
      '| 项目 | 状态 |',
      '| --- | --- |',
      '| 网关 | 正常 |',
      '',
      '```ts',
      'const a = 1;',
      'const b = 2;',
      '```',
    ].join('\n');

    const messages = formatDingTalkOutboundMessages(input);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.title).toBe('周报总结');
    expect(messages[0]!.text).not.toContain('| --- |');
    expect(messages[0]!.text).toContain('状态: 正常');
    expect(messages[0]!.text).toContain('```\nconst a = 1;\nconst b = 2;\n```');
  });

  it('keeps safe links, drops unsafe links, prefixes multiline blockquotes, and removes unsupported strikethrough', () => {
    const input = [
      '> 第一行',
      '> 第二行',
      '',
      '查看 [文档](https://example.com/docs) 与 [相对](/settings) 与 [凭证](https://u:p@example.com) 以及 ~~删除~~。',
    ].join('\n');

    const messages = formatDingTalkOutboundMessages(input);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toContain('> 第一行  \n> 第二行');
    expect(messages[0]!.text).toContain('[文档](https://example.com/docs)');
    expect(messages[0]!.text).not.toContain('/settings');
    expect(messages[0]!.text).not.toContain('u:p@example.com');
    expect(messages[0]!.text).toContain('相对');
    expect(messages[0]!.text).toContain('凭证');
    expect(messages[0]!.text).not.toContain('~~');
    expect(messages[0]!.text).toContain('删除');
  });
});

describe('Slack outbound mrkdwn formatting', () => {
  it('converts CommonMark styles and links to Slack mrkdwn', () => {
    const input = [
      '## 摘要',
      '',
      '这是 **加粗**、*斜体*、~~删除~~ 与 `code`。',
      '打开 [安全入口](https://example.com/a?x=1&y=2) 或 https://example.com/bare',
    ].join('\n');

    const out = formatSlackOutboundMrkdwn(input);
    expect(out).toContain('*摘要*');
    expect(out).toContain('*加粗*');
    expect(out).toContain('_斜体_');
    expect(out).toContain('~删除~');
    expect(out).toContain('`code`');
    expect(out).toContain('<https://example.com/a?x=1&amp;y=2|安全入口>');
    expect(out).toContain('<https://example.com/bare>');
  });

  it('escapes raw angle brackets so mentions and spoofed links cannot fire', () => {
    const out = formatSlackOutboundMrkdwn('<!channel> <@U12345> <https://evil.example/a|click> [cred](https://u:p@example.com) [rel](/settings)');
    expect(out).toContain('&lt;!channel&gt;');
    expect(out).toContain('&lt;@U12345&gt;');
    expect(out).not.toContain('<https://evil.example/a|click>');
    expect(out).not.toContain('u:p@example.com');
    expect(out).not.toContain('/settings');
    expect(out).toContain('cred');
    expect(out).toContain('rel');
  });

  it('converts markdown tables and chunks long messages', () => {
    const table = '| Name | Value |\n| --- | --- |\n| CPU | 42% |';
    const out = formatSlackOutboundMrkdwn(table);
    expect(out).not.toContain('| --- |');
    expect(out).toContain('Value: 42%');

    const longText = Array.from({ length: 40 }, (_, i) => `- **Item ${i}**: ${'hello '.repeat(25)}`).join('\n');
    const chunks = formatSlackOutboundChunks(longText, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(650);
    }
  });
});

describe('WeCom outbound markdown formatting', () => {
  it('converts tables to bullets, strips strikethrough, and enforces UTF-8 byte ceiling', () => {
    const input = '| 指标 | 数值 |\n| --- | --- |\n| QPS | ~~100~~ **200** |';
    const chunks = formatWeComOutboundChunks(input);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).not.toContain('| --- |');
    expect(chunks[0]).not.toContain('~~');
    expect(chunks[0]).toContain('**200**');

    const longChinese = Array.from({ length: 120 }, (_, i) => `- **条目${i}**：这是一段用于测试企微字节上限的中文内容。`).join('\n');
    const split = formatWeComOutboundChunks(longChinese, 3800);
    expect(split.length).toBeGreaterThan(1);
    for (const chunk of split) {
      expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThanOrEqual(3800);
    }

    const ascii = 'a'.repeat(2000);
    expect(formatWeComOutboundChunks(ascii, 3800)).toHaveLength(1);
  });
});

describe('Discord outbound formatting', () => {
  it('preserves native Discord markdown when there are no tables', () => {
    const input = '## Title\n- **bold** ||secret||\n```ts\nconst x = 1;\n```';
    expect(formatDiscordOutboundText(input)).toBe(input);
  });

  it('converts GFM tables to bullets while preserving styles and chunking safely', () => {
    const input = [
      '## Results',
      '',
      '| Service | Status |',
      '| --- | --- |',
      '| API | **OK** |',
    ].join('\n');

    const chunks = formatDiscordOutboundChunks(input, 1900);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).not.toContain('| --- |');
    expect(chunks[0]).toContain('**Results**');
    expect(chunks[0]).toContain('**OK**');
  });
});
