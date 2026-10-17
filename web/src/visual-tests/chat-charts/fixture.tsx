import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import line from '../../../../skills/creative/chat-charts/references/line-example.json';
import bar from '../../../../skills/creative/chat-charts/references/bar-example.json';
import { ChatMarkdownRenderer } from '@/features/chat/rendering/markdown/chat-markdown-renderer';
import { InlinePreviewSchedulerProvider } from '@/features/chat/product-delivery/inline-preview-scheduler';
import { useThemeStore } from '@/stores/theme-store';
import { useLocaleStore } from '@/stores/locale-store';
import '@/styles/globals.css';

function Fixture() {
  const [type, setType] = useState<'line' | 'bar'>('line');
  const [invalid, setInvalid] = useState(() => new URLSearchParams(location.search).has('invalid'));
  const [pending, setPending] = useState(() => new URLSearchParams(location.search).has('pending'));
  const [narrow, setNarrow] = useState(false);
  const theme = useThemeStore(s => s.resolved);
  const sample = type === 'line' ? line : bar;
  const source = JSON.stringify(invalid ? { ...sample, option: { formatter: 'unsafe' } } : sample, null, 2);
  const content = `## 图表渲染验证\n\n以下为示例数据。\n\n\`\`\`chart\n${source}${pending ? '' : '\n```'}\n\n${pending ? '' : '图表后的正文继续显示。'}`;
  return <main className={`mx-auto min-h-screen bg-surface-base p-4 text-fg ${narrow ? 'max-w-[375px]' : 'max-w-4xl'}`}>
    <nav className="mb-4 flex flex-wrap gap-3 text-sm">
      <button onClick={() => { setType('line'); setInvalid(false); }}>Line</button>
      <button onClick={() => { setType('bar'); setInvalid(false); }}>Bar</button>
      <button onClick={() => setInvalid(!invalid)}>Invalid</button>
      <button onClick={() => setPending(!pending)}>Streaming</button>
      <button onClick={() => setNarrow(!narrow)}>Narrow</button>
      <button onClick={() => useThemeStore.getState().setPreference(theme === 'dark' ? 'light' : 'dark')}>Theme</button>
      <button onClick={() => useLocaleStore.setState({ language: 'zh' })}>中文</button>
    </nav>
    <InlinePreviewSchedulerProvider><ChatMarkdownRenderer content={content} streaming={pending} /></InlinePreviewSchedulerProvider>
  </main>;
}

createRoot(document.getElementById('root')!).render(<MemoryRouter><Fixture /></MemoryRouter>);
