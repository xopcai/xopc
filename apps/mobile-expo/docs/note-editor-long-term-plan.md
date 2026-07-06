# Note Editor Long-Term Plan

## 背景

当前裁剪后的 note editor 只保留最小编辑能力：

- Markdown 正文编辑
- todo block
- 链接插入/移除
- 图片/文档附件插入
- undo/redo
- 标题、标签、置顶、分享、同步、发送到对话等页面动作

本轮裁剪已经移除编辑器内 AI、wiki/backlink、scan、富文本格式化命令和未使用 label。长期方案的核心目标不是马上换编辑器库，而是固定模块边界，让后续功能只能通过明确接口进入系统。

## 目标

1. 编辑器核心稳定：编辑器只负责编辑、选择区、命令执行、内容变化事件。
2. 页面逻辑可维护：`PageScreen` 只做页面编排，不拥有保存、附件、AI 或同步细节。
3. Markdown 继续作为持久化格式：不保存 ProseMirror/Tiptap JSON，不引入编辑器私有格式。
4. AI 留在编辑器外：AI 可以消费笔记上下文或生成 patch，但不进入 editor toolbar / editor protocol。
5. 附件链路明确：持久化使用 canonical attachment ref，展示用临时 display src map。
6. 未来可替换编辑器实现：通过 adapter contract 评估 10tap/Tiptap/native editor，而不是把页面逻辑绑死到某个库。

## 非目标

- 不恢复 wiki/backlink。
- 不恢复编辑器内 AI 面板。
- 不恢复 scan disabled 入口。
- 不恢复 bold/italic/underline/list/heading/alignment 等未使用命令。
- 不引入新的服务端数据获取方式；gateway 数据仍通过 React Query 与 `src/query/`。

## 目标架构

```text
PageScreen
  ├─ useNoteEditSession(noteId)
  │   ├─ fetchNote/query cache
  │   ├─ local draft hydration
  │   ├─ dirty/save/sync state
  │   └─ flush/save/schedule APIs
  ├─ useNoteEditorAttachments(noteId, flushSave)
  │   ├─ pick/upload attachments
  │   ├─ canonical ref generation
  │   └─ display src resolution
  ├─ useNotePageActions(noteId, editorSnapshot)
  │   ├─ share
  │   ├─ pin
  │   ├─ sync now
  │   └─ open chat with note context
  └─ NoteEditorBridge
      └─ NoteEditorAdapter
          └─ current DOM/Tiptap implementation
```

## 模块职责

### `PageScreen`

只保留：

- route param 解析
- screen layout
- header/action bar/sheets/snackbar 编排
- 将 hooks 返回的状态和 handler 连接到 UI

不得新增：

- 直接 `apiFetch`
- 直接上传附件
- 直接写 local note
- 直接构造 AI patch
- 直接解析 editor markdown attachment refs

### `useNoteEditSession`

长期替代当前 `useNoteEditorSave` 与 PageScreen 内的 hydration 逻辑。

职责：

- 加载远端 note。
- 合并本地 pending/failed draft。
- 维护 `markdown/title/tags/status/saveState`。
- 暴露 `updateMarkdown`、`updateTitle`、`updateTags`、`updateStatus`。
- 暴露 `flushSave()`、`scheduleSave()`。
- 统一维护 query cache 与 note list cache。
- 明确处理 server 404。

建议状态模型：

```ts
type NoteEditSessionState = {
  note: Note | undefined;
  markdown: string;
  title: string;
  tags: string[] | undefined;
  status: Note['status'];
  saveState: 'saved' | 'dirty' | 'saving' | 'pending' | 'failed';
  isHydrating: boolean;
  isMissing: boolean;
};
```

### `useNoteEditorAttachments`

保留独立模块，后续再从 `src/features/page` 移到 `src/features/notes/editor` 或 `src/features/notes/attachments`。

职责：

- 从 photos/camera/document pick 文件。
- 上传到 `uploadNoteMedia`。
- 生成 canonical ref：`xopc-attachment://notes/{noteId}/{attachmentId}`。
- 为 DOM editor 生成 transient display src。
- 不保存正文，不决定 UI snackbar 文案之外的页面行为。

长期需要补：

- display src 缓存生命周期。
- 大图/多图内存控制。
- 上传失败重试策略。

### `NoteEditorBridge`

职责：

- 把 native toolbar/sheet 操作转换成 editor command。
- 接收 editor runtime state。
- 只暴露当前实际支持的命令。

不得加入：

- AI prompt
- note 搜索
- wiki/backlink
- save/sync
- page navigation

### `NoteWebEditor`

当前实现仍是 DOM/Tiptap adapter。长期要把它收敛成 adapter 实现，而不是业务组件。

必须保留的 contract：

```ts
type NoteEditorAdapterProps = {
  value: string;
  attachmentSrcMap?: Record<string, string>;
  editable: boolean;
  command?: EditorCommand | null;
  onChangeMarkdown(markdown: string): void | Promise<void>;
  onSelectionChange(selection: EditorSelectionContext): void | Promise<void>;
  onRuntimeStateChange(state: EditorRuntimeState): void | Promise<void>;
  onRequestAttachment(source: EditorAttachmentPickSource): Promise<EditorAttachmentPickResult>;
};
```

长期需要替换当前 `flushMarkdown + setTimeout(80)` 方案。目标是 editor adapter 提供确定性的 flush：

```ts
type NoteEditorHandle = {
  flushMarkdown(): Promise<string>;
  focus(position?: 'start' | 'end' | number): void;
};
```

这样 back/share/open chat/sync 都可以先 await editor 内容，而不是靠延迟等待 DOM 回调。

## AI 长期位置

AI 不进入 editor core。

可接受的长期形态：

- 页面 action：`Open chat with note context`
- 独立 action sheet：`Summarize / rewrite / extract todos`
- 结果页或 bottom sheet 展示 patch preview
- 用户确认后通过 `useNoteEditSession` 写入 markdown/title/tags/status

AI 模块只能依赖：

```ts
type NoteEditorSnapshot = {
  noteId: string;
  markdown: string;
  title?: string;
  tags?: string[];
  status?: Note['status'];
  selection?: EditorSelectionContext;
};
```

不得依赖 editor implementation、DOM selection、Tiptap API 或 PageScreen 内部 state。

## 编辑器实现策略

短期继续使用当前 DOM/Tiptap，因为已经接入 Expo DOM，且裁剪后风险可控。

长期评估 10tap-editor 或其他实现时，先实现 adapter spike：

1. Markdown round-trip。
2. todo/link/image/document 插入。
3. selection context。
4. deterministic flush。
5. iOS/Android 键盘、输入法、光标稳定性。
6. 大文档性能。
7. 附件 display src 映射。

只有 adapter contract 通过，才允许替换底层实现。不要让 PageScreen 或保存逻辑直接依赖 10tap/Tiptap API。

## 分阶段计划

### P0：完成裁剪 PR

- 保持 editor protocol 最小化。
- 删除无入口代码、无用文案和旧测试。
- 确保 lint/typecheck/相关 notes tests 通过。

### P1：收敛 PageScreen

- 新增 `useNoteEditSession`，合并 hydration/save/title/tags/status 逻辑。
- 新增 `useNotePageActions`，移出 share/pin/sync/open chat。
- PageScreen 保留 UI 编排。
- 给 save/session 增加 focused tests。

### P2：稳定 editor adapter contract

- 把 `NoteWebEditor` 命名或目录上收敛为 adapter。
- 增加 imperative `flushMarkdown()`，移除 `flushMarkdown` command + timeout。
- 为 editor protocol 增加 contract tests。

### P3：附件链路产品化

- 附件 hook 移到 notes domain。
- 统一 canonical ref parser/serializer。
- 控制 data URI display map 内存。
- 补充上传失败、权限失败、非图片文档插入测试。

### P4：AI 作为外部动作回归

- 设计 `useNoteAiActions`，只消费 `NoteEditorSnapshot`。
- AI 结果走 patch preview，不进入 editor toolbar。
- 用户确认后通过 `useNoteEditSession` 写入。

### P5：编辑器实现评估

- 以 adapter contract 对比当前 DOM/Tiptap 与 10tap-editor。
- 不以 demo 可跑作为采用标准；必须满足 flush、selection、附件、键盘、性能和 Markdown round-trip。

## 验收标准

- `PageScreen` 不直接 import `apiFetch`、`uploadNoteMedia`、`saveLocalMarkdownNoteEdit`。
- editor protocol 中只出现当前支持的命令。
- editor 目录不出现 AI/wiki/scan/formatting legacy 标识。
- 所有 server data 仍通过 React Query/query helpers。
- `pnpm run mobile:lint` 通过。
- `pnpm run mobile:typecheck` 通过。
- notes save/attachment/markdown tests 覆盖核心路径。
