import { useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import type { Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { MessageList } from '@/features/chat/messages/message-list';
import type { Message } from '@/features/chat/messages/messages.types';
import { pauseChatTailFollowing } from '@/features/chat/scroll/chat-virtual-scroll';
import { useChatScrollViewport, type UseChatScrollViewportResult } from '@/features/chat/scroll/use-chat-scroll-viewport';

export interface ChatCompletionOptions {
  count: number;
  personal: boolean;
  burst: boolean;
  reading: boolean;
  longQuestion?: boolean;
}

interface CompletionFrame {
  rowHeight: number;
  rowTop: number;
  scrollTop: number;
  scrollHeight: number;
  listHeight: number;
  spacerHeight: number;
  spacerBottom: number;
  text: string;
}

export interface ChatCompletionReport {
  options: ChatCompletionOptions;
  before: CompletionFrame;
  committed: CompletionFrame;
  after: CompletionFrame;
  lateScrollDrift: number;
  heightDrift: number;
  readingDrift: number;
  sendScrollDrift: number;
  frames: CompletionFrame[];
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const shortAnswer = '这是简短的回答。';
const burstAnswer = `${shortAnswer}先明确目标，再确定步骤，然后执行方案，最后检查结果。这样可以减少反复沟通，也能让整个过程更稳定。`;

function CompletionViewport({ messages, streaming, options, onViewport }: {
  messages: Message[];
  streaming: boolean;
  options: ChatCompletionOptions;
  onViewport: (viewport: UseChatScrollViewportResult) => void;
}) {
  const viewport = useChatScrollViewport({
    hasToken: true, showSessionLoading: false, conversationId: 'completion-fixture',
    chatMessages: messages, hasMore: false, loadingMore: false, loadMoreMessages: () => {},
    streaming,
  });
  useLayoutEffect(() => { onViewport(viewport); }, [onViewport, viewport]);
  return <div ref={viewport.scrollRef} onScroll={viewport.onScroll} data-chat-scroll-viewport
    className="chat-messages chat-messages--wide-viewport mx-5 my-5 overflow-x-hidden overflow-y-auto px-5 py-4 [overflow-anchor:none]"
    style={{ height: 500, width: 640 }}>
    <MessageList messages={messages} streaming={streaming} personal={options.personal}
      hideAssistantActions={options.personal} showAssistantWorkLog={false}
      conversationId={null} progress={null} reasoningLevel="off"
      scrollRef={viewport.scrollRef} replySpaceRef={viewport.replySpaceRef}
      registerListContentRef={viewport.registerListContentRef} />
  </div>;
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let n = 0; n < 150; n++) {
    if (check()) return;
    await sleep(20);
  }
  throw new Error('Completion fixture did not become ready');
}

/** Exercise the real message list, Markdown scheduler, and scroll controller together. */
export async function runChatCompletionFixture(root: Root, options: ChatCompletionOptions): Promise<ChatCompletionReport> {
  flushSync(() => root.render(null));
  let controller: UseChatScrollViewportResult | undefined;
  const onViewport = (viewport: UseChatScrollViewportResult) => { controller = viewport; };
  const timestamp = Date.now();
  const history: Message[] = Array.from({ length: options.count }, (_, index) => ({
    role: index % 2 ? 'user' : 'assistant', renderKey: `history-${index}`, timestamp: timestamp - 20_000 + index,
    content: [{ type: 'text', text: '已有历史内容。我们检查短回复结束时的滚动行为。'.repeat(3) }],
  }));
  const question: Message = { role: 'user', renderKey: 'sent-user', timestamp,
    content: [{ type: 'text', text: options.longQuestion ? '长用户输入。'.repeat(3_334) : '请简短回答。' }] };
  const opening: Message = { role: 'assistant', renderKey: 'answer', turnId: 'fixture-run',
    textSurface: 'conversation', timestamp: timestamp + 1, content: [] };
  const answer: Message = { ...opening, content: [{ type: 'text', text: shortAnswer, segmentId: 'answer', presentation: 'pending' }] };
  const render = (messages: Message[], streaming: boolean) => flushSync(() => root.render(
    <MemoryRouter><CompletionViewport messages={messages} streaming={streaming} options={options} onViewport={onViewport} /></MemoryRouter>,
  ));
  render(history, false);
  await waitFor(() => Boolean(controller?.scrollRef.current?.querySelector('[data-chat-message-row]')));
  await document.fonts.ready;
  await sleep(150);
  controller!.reserveReplySpace('sent-user');
  render([...history, question], false);
  const sendPositions: number[] = [];
  if (options.longQuestion) {
    for (let frame = 0; frame < 12; frame++) {
      // Sample after ResizeObserver so this measures painted positions.
      await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      sendPositions.push(controller!.scrollRef.current!.scrollTop);
    }
  } else await sleep(80);
  const sendScrollDrift = sendPositions.length ? Math.max(...sendPositions) - Math.min(...sendPositions) : 0;
  render([...history, question, opening], true);
  await sleep(100);
  render([...history, question, answer], true);
  const viewport = controller!.scrollRef.current!;
  const findAnswer = () => viewport.querySelector<HTMLElement>('[data-message-render-key="answer"]');
  await waitFor(() => findAnswer()?.querySelector('.markdown-body')?.textContent === shortAnswer);
  await sleep(150);
  if (!findAnswer()?.querySelector('[data-chat-streaming-cursor]')) throw new Error('Missing live cursor');
  controller!.scrollToBottom(false);
  await waitFor(() => viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 48);
  await sleep(150);
  if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 48) throw new Error('Completion fixture stopped following before completion');
  if (options.reading) {
    pauseChatTailFollowing(viewport);
    viewport.scrollTop = Math.max(0, viewport.scrollTop - 160);
    viewport.dispatchEvent(new Event('scroll'));
    await sleep(150);
  }
  const read = (): CompletionFrame => {
    const row = findAnswer();
    if (!row) throw new Error('Completion fixture lost its answer row');
    const bounds = row.getBoundingClientRect();
    return { rowHeight: bounds.height, rowTop: bounds.top, scrollTop: viewport.scrollTop,
      listHeight: viewport.firstElementChild!.getBoundingClientRect().height,
      spacerHeight: controller!.replySpaceRef.current!.getBoundingClientRect().height,
      spacerBottom: controller!.replySpaceRef.current!.getBoundingClientRect().bottom,
      scrollHeight: viewport.scrollHeight, text: row.querySelector('.markdown-body')?.textContent ?? '' };
  };
  const before = read();
  const frames: CompletionFrame[] = [];
  let frame = 0;
  let sampleTimer: ReturnType<typeof setTimeout> | undefined;
  // Sample after ResizeObserver has settled the frame's layout, as the user sees it.
  const record = () => { sampleTimer = setTimeout(() => frames.push(read()), 0); frame = requestAnimationFrame(record); };
  const finalText = options.burst ? burstAnswer : shortAnswer;
  render([...history, question, { ...answer, completedAt: timestamp + 5_000,
    content: [{ type: 'text', text: finalText, segmentId: 'answer', presentation: 'answer' }] }], false);
  const committed = read();
  frame = requestAnimationFrame(record);
  try {
    await sleep(750);
  } finally { cancelAnimationFrame(frame); clearTimeout(sampleTimer); }
  const after = read();
  const all = [...frames, after];
  const lateScrollDrift = Math.max(...all.map(value => value.scrollTop)) - Math.min(...all.map(value => value.scrollTop));
  const heightDrift = after.rowHeight - before.rowHeight;
  const readingDrift = options.reading ? Math.abs(after.scrollTop - before.scrollTop) : 0;
  const report = { options, before, committed, after, lateScrollDrift, heightDrift, readingDrift, sendScrollDrift, frames };
  if (sendScrollDrift > 1) throw new Error(`Sending a long question moved after its first paint: ${JSON.stringify({ sendPositions, options })}`);
  if (committed.text !== finalText || after.text !== finalText) throw new Error(`Terminal text was not atomic: ${JSON.stringify(report)}`);
  if (!options.burst && Math.abs(heightDrift) > 1) throw new Error(`Completed short reply changed height: ${JSON.stringify(report)}`);
  if (!options.burst && Math.abs(after.scrollTop - before.scrollTop) > 1) throw new Error(`Completed short reply changed scroll position: ${JSON.stringify(report)}`);
  if (lateScrollDrift > 1 || readingDrift > 1) throw new Error(`Completion moved after its first layout: ${JSON.stringify(report)}`);
  if (findAnswer()?.querySelector('[data-chat-streaming-cursor]')) throw new Error('Cursor survived completion');
  return report;
}
