# 统一 Markdown 组件系统

> chat 气泡渲染、编辑器预览、文件编辑器共用同一套 Markdown 解析与渲染组件库，一处改动全局生效。

---

## 目录

- [设计原则](#设计原则)
- [组件架构](#组件架构)
- [目录结构](#目录结构)
- [组件详解](#组件详解)
  - [parseMarkdown — 统一解析层](#parsemarkdown--统一解析层)
  - [MarkdownView — 只读渲染](#markdownview--只读渲染)
  - [MarkdownEditor — CodeMirror 6 编辑器](#markdowneditor--codemirror-6-编辑器)
  - [MarkdownSplit — 左编辑右预览](#markdownsplit--左编辑右预览)
- [样式系统](#样式系统)
- [依赖清单](#依赖清单)
- [使用场景速查](#使用场景速查)

---

## 设计原则

1. **单一解析入口** — `parseMarkdown()` 是唯一的 Markdown → HTML 转换函数，基于 `marked` + `highlight.js`，支持完整 GFM
2. **组件按用途分层** — 只读渲染 / 编辑器 / 分栏布局 各自独立，按需引用
3. **样式统一** — 一份 `markdown.css`，使用项目设计 token，chat 和编辑器预览视觉完全一致
4. **安全** — 所有 HTML 输出必须经过 DOMPurify 净化后才能注入 DOM

---

## 组件架构

```
web/src/components/markdown/          ← 统一组件库（新建）
├── parse-markdown.ts                 ← 解析层：marked + highlight.js
├── markdown-view.tsx                 ← 只读渲染（chat 气泡 / 编辑器预览）
├── markdown-editor.tsx               ← CodeMirror 6 编辑器
├── markdown-split.tsx                ← 左编辑 + 右预览分栏布局
└── markdown.css                      ← 统一样式（设计 token）

web/src/features/chat/markdown/       ← 保留（向后兼容重导出）
└── markdown-view.tsx                 ← export { MarkdownView } from '@/components/markdown/...'
```

### 调用关系图

```
chat/message-bubble.tsx
        │
        └──► MarkdownView          ← 只读，memo 优化，streaming 友好
                  │
                  └──► parseMarkdown()  ← marked + hljs
                  └──► DOMPurify        ← XSS 净化

editor/editor-page.tsx
        │
        └──► MarkdownSplit
                  ├──► MarkdownEditor  ← CodeMirror 6，实时编辑
                  └──► MarkdownView    ← 实时预览（共用同一个组件）
```

---

## 目录结构

```
web/src/components/markdown/
├── parse-markdown.ts      # 解析入口，唯一出口
├── markdown-view.tsx      # 只读渲染组件
├── markdown-editor.tsx    # CodeMirror 6 编辑器组件
├── markdown-split.tsx     # 左右分栏布局组件
└── markdown.css           # 统一样式（从 chat/markdown/ 迁移并扩展）
```

---

## 组件详解

### parseMarkdown — 统一解析层

**文件：** `web/src/components/markdown/parse-markdown.ts`

```typescript
import { marked, type MarkedOptions } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

// 配置代码块语法高亮
marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  })
);

const MARKED_OPTIONS: MarkedOptions = {
  gfm: true,      // GitHub Flavored Markdown（表格、删除线、任务列表）
  breaks: false,  // 不把单个换行转成 <br>（streaming 场景更稳定）
};

/**
 * Parse markdown to HTML string.
 * Output MUST be passed through DOMPurify before dangerouslySetInnerHTML.
 */
export function parseMarkdown(text: string): string {
  return marked.parse(text, MARKED_OPTIONS) as string;
}
```

**关键决策：**
- `breaks: false` — streaming 场景下 AI 输出的换行不应被转成 `<br>`，否则段落会被打散
- `gfm: true` — 支持 GitHub 风格的表格、删除线、任务列表
- 输出不含 DOMPurify，调用方负责净化（职责分离）

---

### MarkdownView — 只读渲染

**文件：** `web/src/components/markdown/markdown-view.tsx`

```tsx
import DOMPurify from 'dompurify';
import { memo, useMemo } from 'react';

import { parseMarkdown } from './parse-markdown';
import './markdown.css';

interface MarkdownViewProps {
  content: string;
  /** 紧凑模式：chat 气泡用，减小标题/段落间距 */
  compact?: boolean;
  className?: string;
}

function MarkdownViewImpl({ content, compact = false, className }: MarkdownViewProps) {
  const safeHtml = useMemo(() => {
    if (!content.trim()) return '';
    const raw = parseMarkdown(content);
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [content]);

  return (
    <div
      className={[
        'markdown-body',
        compact ? 'markdown-compact' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

/**
 * Pure markdown renderer.
 * Memo avoids re-parse when sibling bubbles re-render during streaming.
 */
export const MarkdownView = memo(MarkdownViewImpl);
MarkdownView.displayName = 'MarkdownView';
```

**Props 说明：**

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `content` | `string` | — | Markdown 原文 |
| `compact` | `boolean` | `false` | 紧凑模式，chat 气泡使用 |
| `className` | `string` | — | 额外 CSS 类名 |

**性能优化：**
- `memo` — 父组件 re-render 时，若 `content` 未变则跳过 DOMPurify + parse
- `useMemo` — `content` 变化时才重新解析，避免每次渲染都执行正则

---

### MarkdownEditor — CodeMirror 6 编辑器

**文件：** `web/src/components/markdown/markdown-editor.tsx`

```tsx
import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';

interface MarkdownEditorProps {
  /** 初始内容（切换文件时传入新值会重建编辑器） */
  initialContent: string;
  /** 内容变化回调（每次按键触发，调用方负责防抖） */
  onChange: (content: string) => void;
  isDark?: boolean;
  className?: string;
}

export function MarkdownEditor({
  initialContent,
  onChange,
  isDark = false,
  className,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  // 用 ref 持有最新回调，避免 effect 因 onChange 引用变化而重建编辑器
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        lineNumbers(),
        highlightActiveLine(),
        history(),
        isDark ? oneDark : syntaxHighlighting(defaultHighlightStyle),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px' },
          '.cm-scroller': {
            fontFamily: 'var(--font-mono)',
            lineHeight: '1.7',
            overflow: 'auto',
          },
          '.cm-content': { padding: '16px 20px' },
          '.cm-focused': { outline: 'none' },
        }),
      ],
    });

    editorRef.current = new EditorView({ state, parent: containerRef.current });

    return () => {
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  // initialContent 和 isDark 变化时重建编辑器（切换文件 / 切换主题）
  }, [initialContent, isDark]);

  return <div ref={containerRef} className={`h-full w-full overflow-hidden ${className ?? ''}`} />;
}
```

**关键设计：**
- `onChangeRef` 模式 — `onChange` 回调用 ref 持有，`useEffect` 依赖数组不包含它，避免每次父组件传新函数引用时重建整个编辑器实例
- `initialContent` 变化时重建 — 对应切换文件场景，编辑器完整重置
- `isDark` 变化时重建 — 主题切换，重新应用 `oneDark` 或默认主题

---

### MarkdownSplit — 左编辑右预览

**文件：** `web/src/components/markdown/markdown-split.tsx`

```tsx
import { useState, useCallback } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import { MarkdownEditor } from './markdown-editor';
import { MarkdownView } from './markdown-view';

interface MarkdownSplitProps {
  initialContent: string;
  /** 防抖 500ms 后触发，用于文件写入 */
  onSave?: (content: string) => void;
  isDark?: boolean;
}

export function MarkdownSplit({ initialContent, onSave, isDark = false }: MarkdownSplitProps) {
  const [content, setContent] = useState(initialContent);

  const triggerSave = useDebouncedCallback((value: string) => {
    onSave?.(value);
  }, 500);

  const handleChange = useCallback(
    (value: string) => {
      setContent(value);
      triggerSave(value);
    },
    [triggerSave]
  );

  return (
    <div className="flex h-full divide-x divide-edge">
      {/* 左：编辑区 */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <MarkdownEditor
          initialContent={initialContent}
          onChange={handleChange}
          isDark={isDark}
        />
      </div>

      {/* 右：实时预览 */}
      <div className="flex-1 min-w-0 overflow-y-auto px-6 py-4 bg-surface">
        <MarkdownView content={content} />
      </div>
    </div>
  );
}
```

**防抖策略：**
- 编辑器 `onChange` 每次按键都触发 → `setContent` 立即更新预览（实时）
- `onSave` 防抖 500ms → 文件写入（避免频繁 I/O）

---

## 样式系统

样式文件从 `web/src/features/chat/markdown/markdown.css` 迁移到 `web/src/components/markdown/markdown.css`，并新增编辑器紧凑模式。

**新增的 `.markdown-compact` 修饰类**（chat 气泡场景）：

```css
/* 紧凑模式：减小标题和段落间距，适合 chat 气泡 */
.markdown-body.markdown-compact h1,
.markdown-body.markdown-compact h2,
.markdown-body.markdown-compact h3 {
  margin-top: 0.75em;
  margin-bottom: 0.25em;
}

.markdown-body.markdown-compact p {
  margin: 0 0 0.5em;
}

.markdown-body.markdown-compact pre {
  margin-bottom: 0.75em;
}
```

**代码高亮主题**（跟随系统暗色/亮色）：

```css
/* 亮色：github 主题 */
@import 'highlight.js/styles/github.css' layer(hljs-light);

/* 暗色：github-dark 主题 */
@media (prefers-color-scheme: dark) {
  @import 'highlight.js/styles/github-dark.css' layer(hljs-dark);
}
```

所有颜色变量均使用 `web/src/styles/globals.css` 中定义的语义 token（`--color-fg`、`--color-edge`、`--color-surface-hover` 等），不引入新的 token 体系。

---

## 依赖清单

```bash
# 在 web/ 子包中安装
cd web

# Markdown 解析与代码高亮
pnpm add marked marked-highlight highlight.js

# CodeMirror 6 编辑器核心
pnpm add @codemirror/state @codemirror/view @codemirror/commands
pnpm add @codemirror/lang-markdown @codemirror/language-data
pnpm add @codemirror/language @codemirror/theme-one-dark

# 防抖（MarkdownSplit 用）
pnpm add use-debounce
```

**包体积影响（gzip 估算）：**

| 包 | 大小 |
|----|------|
| `marked` | ~15 KB |
| `highlight.js`（按需） | ~30 KB |
| `@codemirror/*`（核心） | ~80 KB |
| `use-debounce` | ~1 KB |
| **合计** | **~126 KB** |

> CodeMirror 6 支持 tree-shaking，实际打包体积取决于引入的语言包数量。

---

## 使用场景速查

| 场景 | 使用组件 | 关键 Props |
|------|----------|-----------|
| Chat 气泡（AI 回复） | `MarkdownView` | `compact` |
| Chat 气泡（streaming 中） | `MarkdownView` | `memo` 自动跳过未变内容 |
| Electron 编辑器预览面板 | `MarkdownView` | — |
| Electron 编辑器（编辑模式） | `MarkdownEditor` | `initialContent`, `onChange`, `isDark` |
| Electron 编辑器（分栏模式） | `MarkdownSplit` | `initialContent`, `onSave`, `isDark` |
| 未来：笔记详情只读页 | `MarkdownView` | — |
| 未来：内联编辑 | `MarkdownEditor` | — |

> 详见 [Electron PC 应用构建方案](electron.md)

---

_Last updated: 2026-03-27_
