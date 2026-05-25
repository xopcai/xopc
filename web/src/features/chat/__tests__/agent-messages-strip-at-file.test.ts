import { describe, expect, it } from 'vitest';

import { normalizeAgentMessages } from '@/features/chat/messages/agent-messages';
import { stripExpandedAtFileBlocks } from '@/features/chat/messages/wire-text-scrub';

describe('stripExpandedAtFileBlocks', () => {
  it('removes single file block and preserves @file: token', () => {
    const input = '<file path="README.md">\n# Title\nContent\n</file>\n\n@file:README.md analyze this';
    expect(stripExpandedAtFileBlocks(input)).toBe('@file:README.md analyze this');
  });

  it('removes multiple file blocks', () => {
    const input =
      '<file path="a.ts">\ncode a\n</file>\n\n<file path="b.ts">\ncode b\n</file>\n\n@file:a.ts @file:b.ts compare';
    expect(stripExpandedAtFileBlocks(input)).toBe('@file:a.ts @file:b.ts compare');
  });

  it('returns text unchanged when no file blocks present', () => {
    const input = '@file:README.md hello';
    expect(stripExpandedAtFileBlocks(input)).toBe(input);
  });

  it('strips CRLF after opening tag', () => {
    const input = '<file path="README.md">\r\nline\r\n</file>\r\n\r\n@file:README.md hi';
    expect(stripExpandedAtFileBlocks(input)).toBe('@file:README.md hi');
  });
});

describe('normalizeAgentMessages expanded @file XML', () => {
  it('strips prepended file blocks from persisted user text', () => {
    const expanded =
      '<file path="README.md">\n# Title\n</file>\n\n@file:README.md summarize';
    const ui = normalizeAgentMessages([
      {
        role: 'user',
        content: [{ type: 'text', text: expanded }],
        timestamp: 1,
      },
    ]);
    expect(ui).toHaveLength(1);
    const block = ui[0]?.content[0];
    expect(block?.type).toBe('text');
    if (block?.type === 'text') {
      expect(block.text).toBe('@file:README.md summarize');
    }
  });
});
