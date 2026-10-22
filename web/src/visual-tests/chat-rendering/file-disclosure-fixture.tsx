import { flushSync } from 'react-dom';
import type { Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { MessageList } from '@/features/chat/messages/message-list';
import type { Message } from '@/features/chat/messages/messages.types';
import { useChatScrollViewport } from '@/features/chat/scroll/use-chat-scroll-viewport';

function FileDisclosureViewport({ messages }: { messages: Message[] }) {
  const viewport = useChatScrollViewport({
    hasToken: true, showSessionLoading: false, conversationId: 'file-disclosure-fixture',
    chatMessages: messages, streaming: false, hasMore: false, loadingMore: false,
    loadMoreMessages: () => {},
  });
  return <div ref={viewport.scrollRef} onScroll={viewport.onScroll} data-chat-scroll-viewport
    className="chat-messages mx-5 my-5 overflow-x-hidden overflow-y-auto px-5 py-4 [overflow-anchor:none]"
    style={{ height: 500, width: 640 }}>
    <MessageList messages={messages} streaming={false} progress={null} reasoningLevel="off"
      showAssistantWorkLog={false} scrollRef={viewport.scrollRef} replySpaceRef={viewport.replySpaceRef}
      registerListContentRef={viewport.registerListContentRef} />
  </div>;
}

/** Real transcript, file disclosure, and scroll controller for browser regressions. */
export function mountChatFileDisclosureFixture(root: Root, count: number): void {
  flushSync(() => root.render(null));
  const messages: Message[] = Array.from({ length: count }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user', renderKey: `file-history-${index}`, timestamp: index + 1,
    content: [{ type: 'text', text: `History ${index}. ${'已有历史内容。'.repeat(20 + index % 5 * 10)}` }],
  }));
  messages[count - 1] = {
    role: 'assistant', renderKey: 'file-answer', timestamp: count,
    content: [{ type: 'text', text: '处理完成，以下为文件列表。\n\n'.repeat(45) }],
    outcome: {
      version: 1, outcomeId: 'files', runId: 'files-run', turnId: 'files-turn', status: 'succeeded',
      deliverables: Array.from({ length: 5 }, (_, index) => ({
        artifactId: `file-${index}`, title: `report-${index}.xlsx`, kind: 'file',
        availability: 'available', location: 'workspace', capabilities: [], uri: `xopc-file:file-${index}`,
      })),
      evidence: [], createdAt: '2026-10-22T00:00:00Z',
    },
  };
  flushSync(() => root.render(<MemoryRouter><FileDisclosureViewport messages={messages} /></MemoryRouter>));
}
