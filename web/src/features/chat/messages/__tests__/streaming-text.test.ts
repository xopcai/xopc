import { describe, expect, it } from 'vitest';

import { parseMarkdown } from '@/components/markdown/parse-markdown';
import type { MessageContent } from '@/features/chat/messages/messages.types';
import { appendTextDelta } from '@/features/chat/messages/streaming';

describe('streaming text assembly', () => {
  it('preserves adjacent repeated text deltas', () => {
    const content: MessageContent[] = [];

    appendTextDelta(content, 'ha', 'message-1');
    appendTextDelta(content, 'ha', 'message-1');

    expect(content).toEqual([
      {
        type: 'text',
        text: 'haha',
        segmentId: 'message-1',
        presentation: 'pending',
      },
    ]);
  });

  it('preserves a fenced code delimiter split across deltas', () => {
    const content: MessageContent[] = [];
    const fence = '`'.repeat(3);

    for (const delta of [
      `Intro\n\n${fence}ts\nconst value = 1;\n`,
      '`',
      '``',
      '\n\nFollowing paragraph.',
    ]) {
      appendTextDelta(content, delta, 'message-1');
    }

    const text = content[0]?.type === 'text' ? content[0].text : '';
    expect(text).toContain(`\n${fence}\n\nFollowing paragraph.`);
    expect(parseMarkdown(text)).toContain('<p>Following paragraph.</p>');
  });

  it('reconciles a hydrated assistant segment that is ahead of the resume cursor', () => {
    const fence = '`'.repeat(3);
    const fullText = `Intro\n\n${fence}ts\nconst value = 1;\n${fence}\n\nFollowing paragraph.`;
    const content: MessageContent[] = [
      { type: 'text', text: fullText, presentation: 'answer' },
    ];
    const deltas = [
      `Intro\n\n${fence}ts\n`,
      'const value = 1;\n',
      '`',
      '``',
      '\n\nFollowing paragraph.',
    ];
    let offset = 0;

    for (const delta of deltas) {
      appendTextDelta(content, delta, 'message-1', {
        offset,
        reconcileHydratedSegment: true,
      });
      offset += delta.length;
    }

    expect(content).toEqual([
      {
        type: 'text',
        text: fullText,
        segmentId: 'message-1',
        presentation: 'pending',
      },
    ]);
    expect(parseMarkdown(fullText)).toContain('<p>Following paragraph.</p>');
  });

  it('appends new repeated text after catching up to a hydrated segment', () => {
    const content: MessageContent[] = [
      { type: 'text', text: 'Intro', presentation: 'answer' },
    ];

    appendTextDelta(content, 'Intro', 'message-1', {
      offset: 0,
      reconcileHydratedSegment: true,
    });
    appendTextDelta(content, 'ha', 'message-1', { offset: 5 });
    appendTextDelta(content, 'ha', 'message-1', { offset: 7 });

    expect(content[0]).toMatchObject({ text: 'Introhaha', segmentId: 'message-1' });
  });
});
