import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import line from '../../../../skills/creative/chat-charts/references/line-example.json';
import bar from '../../../../skills/creative/chat-charts/references/bar-example.json';
import { NoteMarkdownView } from '@/features/notes/note-markdown-view';
import { useThemeStore } from '@/stores/theme-store';
import '@/styles/globals.css';

function Fixture() {
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const [value, setValue] = useState(12000);
  const [visible, setVisible] = useState(true);
  const theme = useThemeStore(s => s.resolved);
  const lineSpec = { ...line, series: [{ ...line.series[0], values: [value, 12500, 13000] }, line.series[1]] };
  const fence = (spec: unknown) => `\`\`\`chart\n${JSON.stringify(spec, null, 2)}\n\`\`\``;
  const charts = pending ? `\`\`\`chart\n${JSON.stringify(lineSpec)}`
    : invalid ? fence({ ...lineSpec, option: { formatter: 'unsupported' } }) : `${fence(lineSpec)}\n\n${fence(bar)}`;
  const content = `# 笔记图表验证\n\n笔记中可保留正文、表格、公式和图表。\n\n${visible ? charts : 'Charts removed'}${pending ? '' : '\n\n## 其他内容\n\n| 项目 | 数量 |\n| --- | --- |\n| 示例 | 3 |\n\n$$\nx^2 + y^2 = 1\n$$\n\n```mermaid\nflowchart LR\nA[数据] --> B[图表]\n```\n\n```json\n{"ordinary":true}\n```'}`;
  return <main className="mx-auto h-screen w-full min-w-0 max-w-4xl overflow-y-auto bg-surface-base p-4 text-fg">
    <nav className="mb-4 flex flex-wrap gap-4 text-sm">
      <button onClick={() => setValue(value === 12000 ? 14320 : 12000)}>Update data</button>
      <button onClick={() => setInvalid(!invalid)}>Invalid</button>
      <button onClick={() => setPending(!pending)}>Incomplete</button>
      <button onClick={() => setVisible(!visible)}>Toggle charts</button>
      <button onClick={() => useThemeStore.getState().setPreference(theme === 'dark' ? 'light' : 'dark')}>Theme</button>
    </nav>
    <NoteMarkdownView noteId="chart-validation" content={content} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<MemoryRouter><Fixture /></MemoryRouter>);
