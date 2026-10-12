import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { MarkdownView as DocumentMarkdown } from '@/components/markdown/markdown-view';
import { ChatMarkdownRenderer } from '@/features/chat/rendering/markdown/chat-markdown-renderer';
import { useLocaleStore } from '@/stores/locale-store';
import '@fontsource-variable/figtree';
import '@/styles/globals.css';

const samples = {
  wide: `## 宽表与局部滚动\n\n| 文件 | 数量 | 链接 | 状态 | 负责人 | 日期 | 版本 | 备注 |\n| --- | ---: | --- | --- | --- | --- | --- | --- |\n| src/components/app.tsx:18 | 300 | [笔记](/notes/review-note) | 完成 | 小王 | 2026-10-13 | 2.7.0 | 保持表格内滚动，整条消息不超宽 |\n\n宽表之后的段落仍应使用原本的阅读宽度。`,
  typography: `# 标题与阅读节奏\n\n这是第一段中文，含有 **加粗重点**、*italic emphasis* 和 inline code：\`const ready = true\`。与英文 mixed text 混排，文字应自然换行。\n\n这是第二段，应有适当的段落间距，而不是与上一段挤在一起。\n\n## 二级标题\n\n- 无序列表第一项\n- 无序列表第二项\n  - 嵌套项目，保持清楚的缩进\n\n3. 有序列表从第三项开始\n4. 下一项\n\n- [x] 已完成\n- [ ] 待处理\n\n> 引用内容第一段。\n>\n> 引用内容第二段，不应过于拥挤。\n\n---\n\n### 表格和代码\n\n| 名称 | 数量 | 说明 |\n| :--- | ---: | :---: |\n| 苹果 | 12 | 中文说明 |\n| LongIdentifierThatMustRemainReadableAndNeverWidenThePage | 300 | Centered |\n\n\`\`\`typescript\nconst greeting = "你好，世界";\nconst longer = "a-long-code-line-that-should-scroll-in-the-code-pane-instead-of-widening-the-whole-chat-message";\n\`\`\`\n\n段尾留白与标题的间距也要一致。\n\n#### 四级标题\n\n详细说明。\n\n##### 五级标题\n\n补充细节。\n\n脚注[^detail]也应可以定位。中文脚注[^中文]也要正确跳转。\n\n[^detail]: 这是脚注说明。\n\n[^中文]: 中文标识的脚注说明。\n\n图表：\n\n\`\`\`mermaid\nflowchart LR\n  A[输入] --> B[处理] --> C[输出]\n\`\`\`\n\n无语言标签图表：\n\n\`\`\`\nflowchart TD\n  Start[开始] --> End[结束]\n\`\`\``,
  links: `## 内部与外部链接\n\n[打开会话](xopc://open?kind=session&key=review-session) · [Open](xopc://open?kind=note&id=review-note) · [项目](/projects/review-project) · [设置](xopc://settings/appearance)\n\n[工作流](/workflows?run=review-run&agent=coder) · [任务](/tasks/review-task)\n\n裸链接：xopc://open?kind=note&id=review-note。\n\n转义链接：[笔记]\\(xopc://open?kind=note&id=escaped-note\\)\n\n[官方网站](https://example.com/docs?q=中文#intro) · https://example.com · [本机服务](http://127.0.0.1:9999/site/demo)\n\n**文件：** [查看源码](file:///Users/demo/My%20Report.ts#L12) · [中文报告](xopc://workspace/file?path=报告.md&line=5) · src/components/app.tsx:18 · **销售汇总.xlsx**\n\n\`src/code-only.ts\` 不应被自动识别为链接。\n\n[引用资料][reference]\n\n[reference]: https://example.com/reference "资料标题"\n\n[不安全地址](javascript:alert%281%29) · [缺少目标](xopc://open?kind=note) · hello@example.com`,
};

function Review() {
  const [sample, setSample] = useState<keyof typeof samples>('typography');
  const [generation, setGeneration] = useState(0);
  const [narrow, setNarrow] = useState(false);
  const [compare, setCompare] = useState(true);
  const [dark, setDark] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [length, setLength] = useState<number | null>(null);
  const [opened, setOpened] = useState('');
  const [failExternal, setFailExternal] = useState(false);
  const location = useLocation();
  const content = length === null ? samples[sample] : samples[sample].slice(0, length);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  useEffect(() => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { shell: {
      openExternalUrl: async (url: string) => { setOpened(`external: ${url}`); return failExternal ? {ok: false, error: 'Fixture failure'} : {ok: true}; },
    } } });
    return () => { Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined }); };
  }, [failExternal]);
  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => setLength(current => {
      const next = (current ?? 0) + 24;
      if (next >= samples[sample].length) { setStreaming(false); return null; }
      return next;
    }), 50);
    return () => clearInterval(timer);
  }, [streaming, sample]);
  return <div style={narrow ? {width: 375, maxWidth: '100%', marginInline: 'auto'} : undefined} className="flex h-full min-h-0 flex-col text-fg">
    <header className="flex shrink-0 flex-wrap gap-2 border-b border-edge bg-surface-panel p-3 text-sm">
      <button type="button" onClick={() => {setSample('typography'); setLength(null); setStreaming(false);}}>排版</button>
      <button type="button" onClick={() => {setSample('wide'); setLength(null); setStreaming(false);}}>宽表</button>
      <button type="button" onClick={() => {setSample('links'); setLength(null); setStreaming(false);}}>链接</button>
      <button type="button" onClick={() => setNarrow(value => !value)}>{narrow ? '恢复宽度' : '375px 阅读栏'}</button>
      <button type="button" onClick={() => setCompare(value => !value)}>{compare ? '仅聊天' : '显示对照'}</button>
      <button type="button" onClick={() => setDark(value => !value)}>切换明暗</button>
      <button type="button" onClick={() => {setGeneration(value => value + 1); setLength(0); setStreaming(true);}}>流式重放</button>
      <button type="button" onClick={() => setFailExternal(value => !value)}>外部失败：{failExternal ? '开' : '关'}</button>
      <button type="button" onClick={() => useLocaleStore.setState({language: useLocaleStore.getState().language === 'zh' ? 'en' : 'zh'})}>切换语言</button>
    </header>
    <div className="shrink-0 break-all border-b border-edge px-3 py-2 text-xs text-fg-muted">
      <output data-review-route>{location.pathname}{location.search}</output><br />
      <output data-review-opened>{opened}</output>
    </div>
    <main className="chat-messages min-h-0 flex-1 overflow-auto p-5">
      <div className={`mx-auto grid w-full gap-8 ${compare ? 'max-w-6xl md:grid-cols-2' : 'max-w-3xl'}`}>
        {compare && <section className="min-w-0" data-review-document><h2 className="mb-4 text-sm text-fg-muted">共享文档渲染（对照）</h2>
          <div className="assistant-markdown-content markdown-content text-base leading-[1.6875]"><DocumentMarkdown content={content} compact onWorkspaceFileOpen={target => setOpened(`file: ${JSON.stringify(target)}`)} /></div>
        </section>}
        <section className="min-w-0" data-review-chat><h2 className="mb-4 text-sm text-fg-muted">聊天渲染</h2>
          <div className="assistant-markdown-content markdown-content text-base leading-[1.6875]"><ChatMarkdownRenderer key={generation} mermaidActions content={content} streaming={streaming} compact onWorkspaceFileOpen={target => setOpened(`file: ${JSON.stringify(target)}`)} /></div>
        </section>
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/chat/render-check']}><Review /></MemoryRouter>);
