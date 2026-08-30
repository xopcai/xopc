import { describe, expect, it } from 'vitest';

import { normalizeAgentMessages } from '@/features/chat/messages/agent-messages';
import {
  stripExpandedAtFileBlocks,
  stripSourceContextsForDisplay,
  stripUserMessageForDisplay,
} from '@/features/chat/messages/wire-text-scrub';

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

describe('message-level Note context display', () => {
  const injected = [
    '<source_contexts>',
    '<source_context kind="note" id="note-1" version="42">',
    'Private frozen Note snapshot',
    '</source_context>',
    '</source_contexts>',
    '',
    '<user_message>',
    'Please summarize this',
    '</user_message>',
  ].join('\n');

  it('removes the frozen source snapshot and unwraps the user message', () => {
    expect(stripSourceContextsForDisplay(injected)).toBe('Please summarize this');
  });

  it('restores Note chips from safe metadata summaries', () => {
    const ui = normalizeAgentMessages([{
      role: 'user',
      content: [{ type: 'text', text: injected }],
      metadata: {
        sourceContexts: [{
          kind: 'note', sourceId: 'note-1', version: '42', title: 'Launch plan', truncated: true,
        }],
      },
      timestamp: 1,
    }]);
    expect(ui[0]?.content).toEqual([{ type: 'text', text: 'Please summarize this' }]);
    expect(ui[0]?.contextRefs).toEqual([{
      kind: 'note', sourceId: 'note-1', version: '42', title: 'Launch plan', truncated: true,
    }]);
  });
});

describe('runtime user context display', () => {
  it('shows only the actual user text after an injected profile and timestamp', () => {
    const injected = [
      '<user-profile>',
      'Preferred name: micjoyce',
      'Timezone: Asia/Shanghai',
      'Language/locale: zh-CN',
      '</user-profile>',
      '',
      '[2026-08-30 13:54 GMT+8] 看下note 内容',
    ].join('\n');

    expect(stripUserMessageForDisplay(injected)).toBe('看下note 内容');
  });

  it('removes the complete generated task, Note, and user-context envelope', () => {
    const injected = [
      '<xopc_task_execution>',
      'Task: Review the note',
      '</xopc_task_execution>',
      '',
      '<source_contexts>',
      '<source_context kind="note" id="note-1" version="42">',
      'Frozen note',
      '</source_context>',
      '</source_contexts>',
      '',
      '<user_message>',
      '<active-focuses>',
      '- Ship the feature: Keep the UI clean (now)',
      '</active-focuses>',
      '',
      '<user-context>',
      'Selected background understanding',
      '</user-context>',
      '',
      '[2026-08-30 13:54 GMT+8] 看下note 内容',
      '</user_message>',
    ].join('\n');

    expect(stripUserMessageForDisplay(injected)).toBe('看下note 内容');
  });

  it('keeps user-authored profile XML when no runtime timestamp follows it', () => {
    const authored = '<user-profile>\nExample text\n</user-profile>\n\n请解释这个 XML';
    expect(stripUserMessageForDisplay(authored)).toBe(authored);
  });

  it('normalizes persisted profile context before building a user bubble', () => {
    const ui = normalizeAgentMessages([{
      role: 'user',
      content: '<user-profile>\nPreferred name: micjoyce\n</user-profile>\n\n[2026-08-30 13:54 GMT+8] 看下note 内容',
      timestamp: 1,
    }]);
    expect(ui[0]?.content).toEqual([{ type: 'text', text: '看下note 内容' }]);
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
