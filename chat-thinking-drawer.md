# Chat 双栏思考过程抽屉 — 技术方案

> 参考效果：类 Qwen/DeepSeek 的双栏 Chat 布局，AI 思考过程与工具调用步骤从消息内联展开改为右侧可关闭的抽屉面板展示。

---

## 目标效果

| 区域 | 描述 |
|------|------|
| **主内容区（左）** | 消息列表 + 输入框，保持干净整洁，不内联展示思考步骤 |
| **思考入口行** | 消息气泡内嵌一行"已完成思考 ›"，点击展开右侧抽屉 |
| **思考过程抽屉（右）** | 可关闭的侧边面板（约 320px），展示 AI 推理步骤、工具调用、搜索来源 |
| **抽屉内容** | 分步骤时间线：正在思考 → 搜索完成（含来源 favicon）→ 梳理内容 → 完成；底部附搜索来源列表 |

---

## 现状分析

### 当前组件架构

```
ChatPage
├── ChatHeaderBar                    # 顶部 header
├── MessageList                      # 消息列表（单列）
│   └── MessageBubble
│       ├── AssistantStepsBlock      # 思考/工具步骤（内联折叠展示）
│       └── MarkdownView             # 正文内容
└── ChatComposer                     # 输入框
```

### 关键现有文件

| 文件 | 职责 |
|------|------|
| `features/chat/thinking-block.tsx` | 单个 thinking 块的折叠展示（Sparkles 图标 + 展开内容） |
| `features/chat/assistant-steps-block.tsx` | 将 `thinking` + `tool_use` 块聚合为可折叠步骤列表 |
| `features/chat/message-bubble.tsx` | 控制 `conciseMode` 参数，`true` 时跳过渲染 `AssistantStepsBlock` |
| `stores/chat-display-store.ts` | 已有 `conciseMode` 等展示状态的 Zustand store |
| `features/chat/messages.types.ts` | `ThinkingContent`、`ToolUseContent` 等消息类型定义 |

---

## 改造方案

### 改造后组件架构

```
ChatPage（改造后）
├── ChatHeaderBar
├── 主体区域（flex-row）
│   ├── 左：消息区 + 输入框（flex-1）
│   │   └── MessageList（conciseMode=true，不渲染步骤）
│   │       └── MessageBubble
│   │           ├── ThinkingEntryRow   ← 新增：一行入口，点击展开右侧面板
│   │           └── MarkdownView
│   └── 右：ThinkingDrawer（可关闭，宽约 320px）← 新增组件
│       ├── 关闭按钮（×）
│       ├── StepTimeline（步骤时间线）
│       └── SearchSourceList（搜索来源列表）
└── ChatComposer
```

---

## 需要新增 / 修改的文件

### 1. 新增：`thinking-drawer.tsx`

**路径：** `web/src/features/chat/thinking-drawer.tsx`

**职责：** 右侧抽屉面板容器，接收当前选中消息的 `blocks`（`ThinkingContent | ToolUseContent[]`），渲染步骤时间线和搜索来源。

```tsx
import { X } from 'lucide-react';

import type { ThinkingContent, ToolUseContent } from './messages.types';
import { SearchSourceList } from './search-source-list';
import { StepTimeline } from './step-timeline';

interface ThinkingDrawerProps {
  blocks: Array<ThinkingContent | ToolUseContent>;
  onClose: () => void;
}

export function ThinkingDrawer({ blocks, onClose }: ThinkingDrawerProps) {
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-edge bg-surface-panel">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <span className="text-sm font-medium text-fg">思考过程</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
          aria-label="关闭思考过程面板"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 pt-3">
        <StepTimeline blocks={blocks} />
        <SearchSourceList blocks={blocks} />
      </div>
    </aside>
  );
}
```

---

### 2. 新增：`step-timeline.tsx`

**路径：** `web/src/features/chat/step-timeline.tsx`

**职责：** 以时间线形式渲染每个步骤（`thinking` / `tool_use`），对应图中右侧的步骤列表。

**关键渲染规则：**

- `thinking` 块 → 显示"正在获取/梳理..."的文字摘要（截取前 120 字）
- `tool_use` 中 `name` 包含 `search` → 显示"搜索网络完成"，并从 result 中提取 URL 展示 favicon
- 流式状态（`streaming=true` / `status='running'`）→ 显示 spinner + 动态文字
- 完成状态 → 绿色 `CheckCircle2` 图标

```tsx
import { CheckCircle2, Loader2 } from 'lucide-react';

import type { ThinkingContent, ToolUseContent } from './messages.types';
import { cn } from '@/lib/cn';

interface StepTimelineProps {
  blocks: Array<ThinkingContent | ToolUseContent>;
}

export function StepTimeline({ blocks }: StepTimelineProps) {
  const visibleBlocks = blocks.filter(
    (b) => b.type !== 'thinking' || Boolean(b.text?.trim()) || Boolean(b.streaming),
  );

  if (visibleBlocks.length === 0) return null;

  return (
    <div className="space-y-4">
      {visibleBlocks.map((block, index) => (
        <StepTimelineRow key={block.type === 'tool_use' ? block.id : `thinking-${index}`} block={block} />
      ))}
    </div>
  );
}

function StepTimelineRow({ block }: { block: ThinkingContent | ToolUseContent }) {
  if (block.type === 'thinking') {
    const isStreaming = Boolean(block.streaming);
    const text = block.text?.trim() ?? '';
    const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;

    return (
      <div className="flex gap-3">
        <div className="mt-0.5 shrink-0">
          {isStreaming ? (
            <Loader2 className="h-4 w-4 animate-spin text-accent-fg" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm font-medium text-fg', isStreaming && 'animate-pulse')}>
            {isStreaming ? '正在思考…' : '思考完成'}
          </p>
          {preview ? (
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">{preview}</p>
          ) : null}
        </div>
      </div>
    );
  }

  // tool_use block
  const isRunning = block.status === 'running';
  const isError = block.status === 'error';
  const isSearch = block.name.toLowerCase().includes('search');
  const title = isSearch ? '搜索网络' : block.name;

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0">
        {isRunning ? (
          <Loader2 className="h-4 w-4 animate-spin text-accent-fg" />
        ) : isError ? (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">!</span>
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">
          {isRunning ? `${title}中…` : isError ? `${title}失败` : `${title}完成`}
        </p>
      </div>
    </div>
  );
}
```

---

### 3. 新增：`search-source-list.tsx`

**路径：** `web/src/features/chat/search-source-list.tsx`

**职责：** 解析 `tool_use` 结果中的 URL 列表，渲染图中底部的"搜索来源 · N"列表，每条含 favicon + 标题 + 摘要。

```tsx
import type { ToolUseContent } from './messages.types';

interface SearchSource {
  url: string;
  title: string;
  snippet?: string;
}

function extractSearchSources(blocks: ToolUseContent[]): SearchSource[] {
  const sources: SearchSource[] = [];
  for (const block of blocks) {
    if (!block.name.toLowerCase().includes('search') || !block.result) continue;
    try {
      const parsed = JSON.parse(block.result as string);
      const results: Array<{ url?: string; title?: string; snippet?: string }> =
        Array.isArray(parsed) ? parsed : (parsed?.results ?? []);
      for (const item of results) {
        if (item.url) {
          sources.push({ url: item.url, title: item.title ?? item.url, snippet: item.snippet });
        }
      }
    } catch {
      /* skip unparseable results */
    }
  }
  return sources;
}

interface SearchSourceListProps {
  blocks: Array<{ type: string; [key: string]: unknown }>;
}

export function SearchSourceList({ blocks }: SearchSourceListProps) {
  const toolBlocks = blocks.filter((b): b is ToolUseContent => b.type === 'tool_use') as ToolUseContent[];
  const sources = extractSearchSources(toolBlocks);

  if (sources.length === 0) return null;

  return (
    <div className="mt-6">
      <p className="mb-3 text-xs font-medium text-fg-muted">
        搜索来源 · {sources.length}
      </p>
      <ol className="space-y-3">
        {sources.map((source, index) => {
          const hostname = (() => {
            try { return new URL(source.url).hostname; } catch { return ''; }
          })();
          const faviconUrl = hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=16` : undefined;

          return (
            <li key={index} className="flex gap-2.5">
              <span className="mt-0.5 shrink-0 text-xs text-fg-disabled">{index + 1}.</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {faviconUrl ? (
                    <img src={faviconUrl} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" aria-hidden />
                  ) : null}
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-xs font-medium text-accent-fg hover:underline"
                  >
                    {source.title}
                  </a>
                </div>
                {source.snippet ? (
                  <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{source.snippet}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
```

---

### 4. 新增：`thinking-entry-row.tsx`

**路径：** `web/src/features/chat/thinking-entry-row.tsx`

**职责：** 消息气泡内嵌的一行入口，对应图中"已经完成思考 ›"。点击后触发右侧抽屉打开并绑定当前消息的 blocks。

```tsx
import { Lightbulb, Loader2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

interface ThinkingEntryRowProps {
  isStreaming: boolean;
  onClick: () => void;
}

export function ThinkingEntryRow({ isStreaming, onClick }: ThinkingEntryRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isStreaming}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-fg-muted',
        interaction.transition,
        'hover:bg-surface-hover hover:text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'disabled:cursor-default disabled:opacity-70',
      )}
    >
      {isStreaming ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-fg" aria-hidden />
      ) : (
        <Lightbulb className="h-3.5 w-3.5 text-accent-fg" aria-hidden />
      )}
      <span>{isStreaming ? '正在思考…' : '已完成思考'}</span>
      {!isStreaming ? <span className="text-fg-disabled" aria-hidden>›</span> : null}
    </button>
  );
}
```

---

### 5. 修改：`chat-page.tsx`

**改动要点：**

1. 将主体布局从单列改为 `flex-row` 双列
2. 引入 `ThinkingDrawer`，管理抽屉开关状态和当前绑定的 blocks
3. 向 `MessageList` 传入 `onOpenThinking` 回调

```tsx
// 新增 state
const [drawerBlocks, setDrawerBlocks] = useState<Array<ThinkingContent | ToolUseContent> | null>(null);

// 布局变更（核心 JSX 结构）
return (
  <div className="chat-shell flex h-full min-h-0 flex-1 flex-col bg-surface-panel">
    <ChatSseStatus />
    <ChatHeaderBar chatHeadline={chatHeadline} />

    <div className="flex min-h-0 flex-1">
      {/* 左：主消息区 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto flex w-full min-h-0 max-w-app-main flex-1 flex-col px-4 sm:px-8">
          <div ref={scrollRef} className="chat-messages min-h-0 flex-1 overflow-y-auto py-4 [scrollbar-gutter:stable]" onScroll={onScroll}>
            <MessageList
              messages={chatMessages}
              authToken={token ?? undefined}
              streaming={streaming}
              progress={progress}
              scrollElementRef={scrollRef}
              conciseMode={true}                      {/* 主区不渲染步骤 */}
              onOpenThinking={setDrawerBlocks}        {/* 新增 */}
            />
          </div>
          <div className="chat-input-container shrink-0 bg-surface-panel py-4">
            <ChatComposer ... />
          </div>
        </div>
      </div>

      {/* 右：思考过程抽屉 */}
      {drawerBlocks !== null ? (
        <ThinkingDrawer
          blocks={drawerBlocks}
          onClose={() => setDrawerBlocks(null)}
        />
      ) : null}
    </div>

    <ScrollToBottomButton ... />
  </div>
);
```

> **流式更新注意：** 抽屉打开期间，若对应消息仍在 streaming，需通过 `activeMessageId` 从 `chatMessages` 实时派生最新 blocks，而非传入快照。建议在 `ChatPage` 中维护 `activeMessageId: string | null`，通过 `useMemo` 从 `chatMessages` 中实时查找对应消息的 blocks 传给 `ThinkingDrawer`。

---

### 6. 修改：`message-list.tsx`

**改动：** 新增 `onOpenThinking` prop，透传给每个 `MessageBubble`。

```tsx
// 新增 prop
interface MessageListProps {
  // ...现有 props
  onOpenThinking?: (blocks: Array<ThinkingContent | ToolUseContent>) => void;
}

// 透传给 MessageBubble
<MessageBubble
  ...
  onOpenThinking={onOpenThinking}
/>
```

---

### 7. 修改：`message-bubble.tsx`

**改动：** 在 `conciseMode=true` 时，将跳过渲染 `AssistantStepsBlock` 的逻辑改为渲染 `ThinkingEntryRow`，点击时调用 `onOpenThinking`。

```tsx
// 新增 prop
interface MessageBubbleProps {
  // ...现有 props
  onOpenThinking?: (blocks: Array<ThinkingContent | ToolUseContent>) => void;
}

// renderChunkedContent 内部改动
// conciseMode=true 时：
if (conciseMode && stepsBlocks.length > 0) {
  const anyStreaming = stepsBlocks.some(
    (b) => (b.type === 'thinking' && b.streaming) || (b.type === 'tool_use' && b.status === 'running'),
  );
  nodes.push(
    <ThinkingEntryRow
      key={`entry-${start}`}
      isStreaming={anyStreaming}
      onClick={() => onOpenThinking?.(stepsBlocks)}
    />,
  );
} else {
  nodes.push(
    <AssistantStepsBlock key={`steps-${start}`} blocks={stepsBlocks} ... />,
  );
}
```

---

### 8. 修改：`stores/chat-display-store.ts`（可选）

如需跨组件全局控制抽屉状态（例如从 header 按钮触发），可在 store 中新增：

```ts
interface ChatDisplayState {
  // 现有字段...
  thinkingDrawerMessageId: string | null;
  openThinkingDrawer: (messageId: string) => void;
  closeThinkingDrawer: () => void;
}
```

若仅在 `ChatPage` 内部管理，用本地 `useState` 即可，无需改 store。

---

## 数据流设计

```
用户点击"已完成思考 ›"
  → ThinkingEntryRow.onClick
  → MessageBubble.onOpenThinking(blocks)
  → MessageList.onOpenThinking(blocks)
  → ChatPage.setDrawerBlocks(blocks)
  → ThinkingDrawer 渲染

流式更新时（streaming=true）：
  → chatMessages 实时更新
  → ChatPage 通过 activeMessageId 从 chatMessages 派生最新 blocks
  → ThinkingDrawer 自动刷新（无需手动同步）
```

---

## 响应式处理

| 屏幕宽度 | 行为 |
|----------|------|
| `>= 1280px` | 双栏并排，抽屉固定 `w-80`（320px） |
| `768px ~ 1280px` | 抽屉以 overlay 形式覆盖在消息区右侧（`absolute right-0`） |
| `< 768px` | 抽屉从底部弹出（bottom sheet），全宽，使用 `fixed bottom-0` |

---

## 改造文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `features/chat/thinking-drawer.tsx` | **新增** | 右侧抽屉容器 |
| `features/chat/step-timeline.tsx` | **新增** | 步骤时间线组件 |
| `features/chat/search-source-list.tsx` | **新增** | 搜索来源列表 |
| `features/chat/thinking-entry-row.tsx` | **新增** | 消息内嵌入口行 |
| `features/chat/chat-page.tsx` | **修改** | 双列布局 + 抽屉状态管理 |
| `features/chat/message-bubble.tsx` | **修改** | conciseMode 时渲染入口行 |
| `features/chat/message-list.tsx` | **修改** | 透传 `onOpenThinking` |
| `stores/chat-display-store.ts` | **可选修改** | 新增全局抽屉状态 |
| `i18n/messages.ts` | **修改** | 新增文案 key（思考过程、搜索来源等） |

---

_Last updated: 2026-03-27_
