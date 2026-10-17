import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { MessageBubble } from '@/features/chat/messages/message-bubble';
import { ExtensionProvider } from '@/features/extensions/extension-provider';
import type { Message } from '@/features/chat/messages/messages.types';
import { useLocaleStore } from '@/stores/locale-store';
import '@/styles/globals.css';

useLocaleStore.setState({ language: 'zh' });

function ActivityFixture() {
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    return () => document.documentElement.classList.remove('dark');
  }, [dark]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (phase === 3) setPlaying(false);
      else setPhase(value => value + 1);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [playing, phase]);
  const message: Message = { role: 'assistant', timestamp: Date.now() - 32000, completedAt: Date.now(), content: [
    { type: 'thinking', text: 'Internal reasoning is never shown by default.', streaming: phase === 0 },
    ...(phase > 0 ? [
      { type: 'text' as const, text: '已找到相关资料，正在核对关键信息。', presentation: 'narration' as const, segmentId: 'narration' },
      { type: 'tool_use' as const, id: 'search', name: 'web_search', status: phase === 1 ? 'running' as const : 'done' as const,
        input: { query: 'example', token: 'never shown' }, result: 'Example result', startedAt: Date.now() - 18000 },
    ] : []),
    ...(phase > 1 ? [{ type: 'text' as const, text: '信息已整理完成。\n\n这里保留现有的 **final result**、引用和交付内容。',
      presentation: 'answer' as const, segmentId: 'answer' }] : []),
  ] };
  return <div className={dark ? 'dark' : ''}>
    <main className="min-h-screen bg-surface-panel p-5 text-fg">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex flex-wrap gap-2">
          {['思考中', '查询中', '输出答案', '已完成'].map((label, index) => <button key={label} type="button"
            className="rounded-md border border-edge px-3 py-2 text-sm" aria-pressed={index === phase}
            onClick={() => { setPlaying(false); setPhase(index); }}>{label}</button>)}
          <button type="button" className="rounded-md border border-edge px-3 py-2 text-sm"
            onClick={() => { setPhase(0); setPlaying(true); }}>播放过程</button>
          <button type="button" className="rounded-md border border-edge px-3 py-2 text-sm"
            onClick={() => setDark(value => !value)}>切换明暗</button>
        </div>
        <MessageBubble message={message} isStreaming={phase < 3} progress={null} responseFeedbackEnabled={false} />
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<MemoryRouter><ExtensionProvider><ActivityFixture /></ExtensionProvider></MemoryRouter>);
