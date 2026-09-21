import { createRequire } from 'node:module';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MessageBubble } from '../MessageBubble';
import type { Message } from '../messages.types';
import { mergeStreamingAssistantIntoMessages } from '../session-message-parser';
import { appendTextDelta, finishTextSegment } from '../streaming';

const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as {
  renderToStaticMarkup: (element: ReactNode) => string;
};

// Keep the real bubble projection and block selection; stub only native surfaces and services.
vi.mock('react-native', () => ({
  View: ({ children }: { children: ReactNode }) => children,
  Pressable: ({ children }: { children: ReactNode }) => children,
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: ReactNode }) => children,
  Icon: () => null,
}));
vi.mock('expo-router', () => ({ useRouter: () => ({}) }));
vi.mock('../../../theme', async () => {
  const tokens = await import('../../../theme/tokens');
  return { ...tokens, useTheme: () => ({ colors: tokens.colors.light, isDark: false }) };
});
vi.mock('../../../i18n/messages', () => ({
  useMessages: () => ({ chat: new Proxy({}, { get: () => 'label' }) }),
}));
vi.mock('../../../stores/preferences-store', () => ({
  usePreferencesStore: (select: (state: { language: string }) => unknown) => select({ language: 'en' }),
}));
vi.mock('../../voice/read-aloud-store', () => ({
  useReadAloudStore: (select: (state: object) => unknown) => select({}),
}));
vi.mock('../../../lib/navigation', () => ({ openNoteDetail: vi.fn() }));
vi.mock('../MarkdownView', () => ({ MarkdownView: ({ content }: { content: string }) => content }));
vi.mock('../AssistantStepsBlock', () => ({
  AssistantStepsBlock: ({ blocks }: { blocks: Message['content'] }) =>
    blocks.map(block => block.type === 'thinking' ? block.text : '').join('|'),
}));
vi.mock('../AssistantDeliverablesCard', () => ({ AssistantDeliverablesCard: () => null }));
vi.mock('../AttachmentRenderer', () => ({ AttachmentRenderer: () => null }));
vi.mock('../AudioMessageBlock', () => ({ AudioMessageBlock: () => null }));
vi.mock('../CompactResourceList', () => ({ CompactResourceList: () => null }));
vi.mock('../MessageActionsBar', () => ({ MessageActionsBar: () => null }));

const render = (message: Message, isStreaming = true) => renderToStaticMarkup(createElement(MessageBubble, {
  message, messageIndex: 0, isStreaming, reasoningLevel: 'stream',
}));

describe('assistant bubble rendering', () => {
  it('keeps every paragraph visible through pending, narration, and history handoff', () => {
    const message: Message = { role: 'assistant', content: [] };
    const paragraphs = ['第一段。继续检查。', '第二段。找到线索。', '最后结论。'];
    for (const [index, text] of paragraphs.entries()) {
      const id = `m${index}`;
      appendTextDelta(message.content, text, id);
      for (const visible of paragraphs.slice(0, index + 1)) expect(render(message)).toContain(visible);
      finishTextSegment(message.content, id, index === 2 ? 'answer' : 'narration');
      for (const visible of paragraphs.slice(0, index + 1)) expect(render(message)).toContain(visible);
      if (index < 2) message.content.push({ type: 'tool_use', id: `t${index}`, name: 'read', status: 'done' });
    }
    for (const visible of paragraphs) expect(render(message, false)).toContain(visible);
  });

  it('renders thinking once before and after a mid-stream history refresh', () => {
    const stored: Message = { role: 'assistant', content: [
      { type: 'thinking', text: 'Thought-A', streaming: false },
      { type: 'text', text: 'Checking.', presentation: 'narration' },
    ] };
    const live: Message = { role: 'assistant', content: [
      { type: 'thinking', text: 'Thought-A', streaming: false, segmentId: 'm1' },
      { type: 'text', text: 'Checking.', presentation: 'narration', segmentId: 'm1' },
      { type: 'thinking', text: 'Thought-B', streaming: true, segmentId: 'm2' },
    ] };
    const refreshed = mergeStreamingAssistantIntoMessages([stored], live)[0];
    expect(render(refreshed)).toBe(render(live));
    expect(render(refreshed).match(/Thought-A/g)).toHaveLength(1);
    expect(render(refreshed)).toContain('Thought-B');
  });
});
