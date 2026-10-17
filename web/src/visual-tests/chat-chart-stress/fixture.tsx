import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { MessageList } from '@/features/chat/messages/message-list';
import type { Message } from '@/features/chat/messages/messages.types';
import { useChatSessionShell } from '@/features/chat/rendering/use-chat-render-state';
import { chatVirtualScroll } from '@/features/chat/scroll/chat-virtual-scroll';
import { defaultSessionMeta } from '@/features/chat/session/chat-session-defaults';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { selectDisplayMessages } from '@/features/chat/session/chat-session-view';
import { useThemeStore } from '@/stores/theme-store';
import '@/styles/globals.css';

type Options = { rows: number; dense?: boolean; points?: number; series?: number };
declare global {
  interface Window {
    chartStress: {
      mount: (id: string, options: Options) => void;
      unmount: () => void;
      release: () => void;
      reveal: (index: number) => boolean;
      theme: (dark: boolean) => void;
      sample: () => Record<string, unknown>;
    };
  }
}
const root = createRoot(document.getElementById('root')!);
const ids = new Set<string>();
const registerContent = () => {};

function chart(index: number, points = 120, series = 3) {
  return `\`\`\`chart\n${JSON.stringify({ version: 1, type: index % 2 ? 'line' : 'bar',
    title: `Chart ${index}`, summary: 'Fixed synthetic chart stress data with gaps and signed values.', dataKind: 'example',
    xAxis: { label: 'Sample', values: Array.from({ length: points }, (_, i) => String(i)) },
    yAxis: { label: 'Value', unit: 'count' },
    series: Array.from({ length: series }, (_, s) => ({ name: `Series ${s}`,
      values: Array.from({ length: points }, (_, i) => i % 31 === 0 ? null : ((i * 7 + s * 13 + index) % 99) - 49) })),
  })}\n\`\`\``;
}

function Session({ id }: { id: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const slice = useChatSessionShell(id);
  const messages = slice ? selectDisplayMessages({ ...slice, viewConversationId: id, conversationId: id }) : [];
  return <div ref={scrollRef} data-chat-scroll-viewport className="chat-messages mx-auto h-[720px] w-full max-w-4xl overflow-auto bg-surface-base p-6 text-fg">
    <MessageList key={id} messages={messages} conversationId={id} scrollRef={scrollRef}
      streaming={false} progress={null} reasoningLevel="off" registerListContentRef={registerContent} hideAssistantActions />
  </div>;
}

window.chartStress = {
  mount(id, options) {
    if (!ids.has(id)) {
      const messages: Message[] = options.dense ? [{ role: 'assistant', timestamp: 1,
        content: [{ type: 'text', text: Array.from({ length: options.rows }, (_, i) => chart(i, options.points, options.series)).join('\n\n') }] }]
        : Array.from({ length: options.rows }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', timestamp: i + 1,
          content: [{ type: 'text', text: i % 2 ? `Reply ${i}\n\n${chart(i, options.points, options.series)}` : `Question ${i}. Fixed synthetic history.` }] }));
      useChatSessionStore.getState().initSessionSnapshot(id, { ...defaultSessionMeta(), messages,
        historyStatus: 'ready', hasMore: false, streamingMsg: null, streaming: false, sending: false, progress: null, taskPlan: null });
      ids.add(id);
    }
    flushSync(() => root.render(<MemoryRouter><Session id={id} /></MemoryRouter>));
  },
  unmount() { flushSync(() => root.render(null)); },
  release() {
    flushSync(() => root.render(null));
    for (const id of ids) useChatSessionStore.getState().clearSession(id);
    ids.clear();
  },
  reveal(index) {
    const viewport = document.querySelector<HTMLElement>('[data-chat-scroll-viewport]');
    return Boolean(viewport && chatVirtualScroll(viewport)?.reveal(index));
  },
  theme(dark) { useThemeStore.getState().setPreference(dark ? 'dark' : 'light'); },
  sample() {
    const viewport = document.querySelector<HTMLElement>('[data-chat-scroll-viewport]');
    const box = viewport?.getBoundingClientRect();
    const figures = Array.from(document.querySelectorAll<HTMLElement>('[data-chart-block]'));
    const visible = figures.filter(element => { const rect = element.getBoundingClientRect(); return box && rect.bottom > box.top && rect.top < box.bottom; });
    return {
      rows: document.querySelectorAll('[data-chat-message-row]').length,
      virtualized: Boolean(document.querySelector('[data-chat-virtualized]')),
      chartBlocks: figures.length, canvases: document.querySelectorAll('canvas').length,
      visibleCharts: visible.length, visibleCanvases: visible.filter(element => element.querySelector('canvas')).length,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      nodes: document.querySelectorAll('*').length,
      scrollTop: viewport?.scrollTop ?? 0, scrollHeight: viewport?.scrollHeight ?? 0,
      theme: document.documentElement.dataset.theme,
      background: viewport ? getComputedStyle(viewport).getPropertyValue('--color-surface-panel').trim() : '',
      sessions: ids.size,
    };
  },
};
