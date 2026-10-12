import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { chatVirtualScroll } from '@/features/chat/scroll/chat-virtual-scroll';
import { ChatMarkdownView } from '@/features/chat/messages/message-content-renderer';
import { MessageList } from '@/features/chat/messages/message-list';
import { appendTextDelta } from '@/features/chat/messages/streaming';
import { defaultSessionMeta } from '@/features/chat/session/chat-session-defaults';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { selectDisplayMessages } from '@/features/chat/session/chat-session-view';
import { useChatSessionShell } from '@/features/chat/rendering/use-chat-render-state';
import '@/styles/globals.css';

import { runChatCompletionFixture, type ChatCompletionOptions, type ChatCompletionReport } from './completion-fixture';

const root = createRoot(document.getElementById('root')!);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const prose = '我们一起分析这个问题，保持已有文字稳定。Emoji 👨‍👩‍👧‍👦，mixed English and 中文。';
const fixtures = {
  prose: Array.from({ length: 80 }, () => prose).join('\n\n'),
  code: `代码示例：\n\n\`\`\`typescript\n${'const value = { ready: true };\n'.repeat(700)}\`\`\``,
  history: Array.from({ length: 300 }, (_, i) => `第 ${i} 条消息。${prose}\n\n**已经完成**`).join('\n\n'),
};

declare global {
  interface Window {
    runChatCompletionFixture: (options: ChatCompletionOptions) => Promise<ChatCompletionReport>;
    runChatRenderingFixture: (name: keyof typeof fixtures) => Promise<{
      commitMs: number[]; durationMs: number; nodes: number; longTasks: number[]; textLength: number;
    }>;
    runChatHistoryFixture: (count: number) => Promise<{ count: number; mountMs: number; readyMs: number; navigation?: boolean; selection?: boolean; prependDrift?: number; geometry?: {top: number; height: number; viewport: number; rows: string[]}; deltaMs: number[]; nodes: number; textComplete: boolean }>;
  }
}

const registerContent = () => {};
window.runChatCompletionFixture = options => runChatCompletionFixture(root, options);
function StoredHistory() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const slice = useChatSessionShell('render-fixture');
  const rows = slice ? selectDisplayMessages({ ...slice, viewConversationId: 'render-fixture', conversationId: 'render-fixture' }) : [];
  return <div ref={scrollRef} style={{height: 800, overflow: 'auto'}} className="chat-messages mx-auto w-full max-w-3xl p-6"><MessageList personal scrollRef={scrollRef} messages={rows}
    conversationId="render-fixture" streaming={slice?.streaming ?? false} progress={null}
    reasoningLevel="off" registerListContentRef={registerContent} /></div>;
}

window.runChatHistoryFixture = async count => {
  flushSync(() => root.render(null));
  const store = () => useChatSessionStore.getState();
  store().initSessionSnapshot('render-fixture', { ...defaultSessionMeta(), historyStatus: 'ready', hasMore: false,
    messages: Array.from({ length: count }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', timestamp: i + 1,
      content: [{ type: 'text', text: `History ${i}. ${prose}` }] })),
    streamingMsg: null, streaming: false, sending: false, progress: null, taskPlan: null });
  const started = performance.now();
  flushSync(() => root.render(<MemoryRouter><StoredHistory /></MemoryRouter>));
  const mountMs = performance.now() - started;
  for (let i = 0; i < 100 && !document.querySelector('[data-chat-message-row]'); i++) await sleep(20);
  await nextFrame();
  const readyMs = performance.now() - started;
  const deltaMs: number[] = [];
  for (let i = 0; i < 100; i++) {
    const before = performance.now();
    store().mutateSessionStreaming('render-fixture', message => appendTextDelta(message.content, 'x', 'answer'));
    deltaMs.push(performance.now() - before);
    await sleep(16);
    const viewport = document.querySelector<HTMLElement>('#root .chat-messages');
    if (viewport) chatVirtualScroll(viewport)?.end(false);
  }
  store().finalizeStreamingTurn('render-fixture', store().sessions['render-fixture'].streamingMsg!);
  await sleep(750);
  const viewport = document.querySelector<HTMLElement>('#root .chat-messages');
  if (viewport) chatVirtualScroll(viewport)?.end(false);
  await sleep(200);
  if (viewport && viewport.clientWidth < 300) throw new Error('Invalid history benchmark viewport');
  const visible = viewport && Array.from(viewport.querySelectorAll('[data-chat-message-row]')).some(row => {
    const bounds = row.getBoundingClientRect(); const box = viewport.getBoundingClientRect();
    return bounds.bottom > box.top && bounds.top < box.bottom;
  });
  if (!visible) throw new Error('History has no visible rows');
  const textComplete = Array.from(document.querySelectorAll('[data-chat-message-row]')).at(-1)?.querySelector('.markdown-body')?.textContent === 'x'.repeat(100);
  if (!textComplete) throw new Error(`History ${count} lost live text: ${Array.from(document.querySelectorAll('[data-chat-message-row]')).map(row => [row.getAttribute('data-chat-message-index'), row.textContent?.slice(-150)]).slice(-3)}`);
  const result: Awaited<ReturnType<typeof window.runChatHistoryFixture>> = {
    count, mountMs, readyMs, deltaMs, nodes: document.querySelectorAll('#root *').length, textComplete,
  };
  result.geometry = viewport ? {top: viewport.scrollTop, height: viewport.scrollHeight, viewport: viewport.clientHeight,
    rows: Array.from(viewport.querySelectorAll('[data-chat-message-row]')).map(row => row.getAttribute('data-chat-message-index') ?? '')} : undefined;
  const virtual = viewport && chatVirtualScroll(viewport);
  if (virtual && viewport) {
    if (document.querySelectorAll('[data-chat-message-row]').length > 80) throw new Error('History window is unbounded');
    virtual.reveal(50);
    for (let i = 0; i < 100 && !viewport.querySelector('[data-chat-message-index="50"]'); i++) await sleep(20);
    const target = viewport.querySelector<HTMLElement>('[data-chat-message-index="50"]');
    if (!target) throw new Error('Could not reveal unmounted history');
    await sleep(200);
    const targetBounds = target.getBoundingClientRect(); const box = viewport.getBoundingClientRect();
    if (targetBounds.top < box.top - 1 || targetBounds.top > box.bottom) throw new Error('History reveal missed the viewport');
    result.navigation = true;
    const node = target.querySelector('.markdown-body p')?.firstChild;
    if (!node) throw new Error('Missing selection target');
    const range = document.createRange();
    range.setStart(node, 0); range.setEnd(node, Math.min(8, node.textContent?.length ?? 0));
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await sleep(200);
    viewport.scrollTop = viewport.scrollHeight;
    await sleep(200);
    result.selection = node.isConnected && !window.getSelection()?.isCollapsed;
    if (!result.selection) throw new Error('History virtualization lost a selection');
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    await sleep(200);
    chatVirtualScroll(viewport)?.reveal(50);
    await sleep(250);
    const anchor = Array.from(viewport.querySelectorAll<HTMLElement>('[data-chat-message-row]'))
      .find(row => row.getBoundingClientRect().bottom > viewport.getBoundingClientRect().top);
    const key = anchor?.dataset.messageRenderKey;
    if (!anchor || !key || anchor.getBoundingClientRect().top > viewport.getBoundingClientRect().bottom) throw new Error('Missing visible prepend anchor');
    const before = anchor?.getBoundingClientRect().top ?? 0;
    store().prependHistoryMessages('render-fixture', Array.from({length: 20}, (_, i) => ({
      role: 'user', timestamp: i - 100, content: [{type: 'text', text: `Older ${i}`}],
    })), false);
    await sleep(300);
    const restored = Array.from(viewport.querySelectorAll<HTMLElement>('[data-chat-message-row]'))
      .find(row => row.dataset.messageRenderKey === key);
    result.prependDrift = restored ? Math.abs(restored.getBoundingClientRect().top - before) : Infinity;
    if (result.prependDrift > 2) throw new Error(`History prepend lost anchor: ${result.prependDrift}px`);
  }
  return result;
};

window.runChatRenderingFixture = async name => {
  flushSync(() => root.render(null));
  useChatSessionStore.getState().clearSession('render-fixture');
  const source = fixtures[name];
  const longTasks: number[] = [];
  const observer = new PerformanceObserver(list => {
    longTasks.push(...list.getEntries().map(entry => entry.duration));
  });
  observer.observe({ type: 'longtask' });
  const commitMs: number[] = [];
  const start = performance.now();
  const chunk = name === 'prose' ? 160 : source.length;
  for (let end = chunk; end < source.length + chunk; end += chunk) {
    const content = source.slice(0, Math.min(end, source.length));
    const before = performance.now();
    flushSync(() => root.render(
      <MemoryRouter><div className="chat-messages mx-auto max-w-3xl p-6">
        <ChatMarkdownView content={content} streaming={end < source.length} compact />
      </div></MemoryRouter>,
    ));
    commitMs.push(performance.now() - before);
    if (end < source.length) await sleep(20);
  }
  await sleep(750);
  await nextFrame();
  observer.disconnect();
  const body = document.querySelector('.markdown-body')?.parentElement?.cloneNode(true) as HTMLElement | undefined;
  body?.querySelectorAll('button, .markdown-code-block-header, [hidden]').forEach(el => el.remove());
  const renderedText = body?.textContent?.replace(/\s/g, '') ?? '';
  const expectedText = source.replace(/^```[^\n]*\n|```/gm, '').replace(/\*\*/g, '').replace(/\s/g, '');
  if (renderedText !== expectedText) throw new Error(`Fixture ${name} lost or duplicated visible text`);
  return {
    commitMs, durationMs: performance.now() - start,
    nodes: document.querySelectorAll('#root *').length, longTasks,
    textLength: Array.from(document.querySelectorAll('.markdown-body')).reduce((n, el) => n + (el.textContent?.length ?? 0), 0),
  };
};
