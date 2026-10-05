# HarmonyOS 原生笔记编辑器产品与技术方案（Draft）

> 状态：调研稿，等待评审后再进入实现计划
>
> 日期：2026-09-27
>
> 范围：`apps/mobile-harmony` 第三个 Tab「资料库」内的笔记体验

## 1. 结论先行

推荐建设一个“华为备忘录式”的原生文本笔记体验，而不是在本期复制“华为笔记”的手写、无界画布和专业绘图能力。

技术上采用 ArkUI 原生 `RichEditor`（`RichEditorController` 的 Span 模式）作为编辑表面，Markdown 继续作为服务端唯一持久化格式；在编辑器与 Markdown 之间增加稳定的 `NoteDocument` 文档模型和 adapter contract。列表、阅读态、编辑态、附件、保存、离线队列和 AI 动作分别解耦，不继续扩展当前通用 `XopcWorkspaceView`。

产品信息架构上保留第三个 Tab「资料库」，但默认直接进入笔记列表；“收件箱”降为笔记筛选条件，“文件”成为资料库内的二级入口。这样既保留 Notes 与 Files 的共同归属，也避免当前“先进入 Hub，再点笔记，再进入列表”的多余层级。

核心原则：

1. 输入必须是原生、低延迟、兼容中文输入法的。
2. 本地先保存，远端异步同步；退出页面不弹“是否放弃修改”。
3. Markdown 是交换格式，不让 RichEditor Span 或私有 JSON 成为服务端格式。
4. AI 是笔记的外部动作，结果先预览再应用，不侵入编辑器输入协议。
5. 先做好文本笔记，不在同一编辑器里同时承担无限画布、手写和实时协作。

## 2. 调研范围与依据

### 2.1 HarmonyOS 当前实现

当前第三个 Tab 是「资料库」：

- `HomeView.ets` 的第 3 个 Tab 加载 `XopcLibraryView`。
- `XopcLibraryView` 是一个 Hub，展示笔记、文件、收件箱快捷入口，以及最近文件和最近笔记。
- 笔记列表和详情复用 `XopcWorkspaceView`；任务、项目、自动化、笔记共用一个页面和 ViewModel。
- 笔记编辑只有标题 `TextInput`、固定高度 260 的 `TextArea` 和显式保存按钮。
- 阅读态用 `XopcMarkdownView`，但编辑态是纯 Markdown 文本，不具备 WYSIWYG、块级格式、选区、附件或稳定的输入状态。

相关代码：

- `entry/src/main/ets/view/HomeView.ets`
- `entry/src/main/ets/view/HomeHubs.ets`
- `entry/src/main/ets/view/WorkspaceView.ets`
- `entry/src/main/ets/viewmodel/workspaceViewModel.ets`
- `entry/src/main/ets/repository/workspaceRepository.ets`
- `entry/src/main/ets/model/workspace.ets`

当前数据层存在几个关键缺口：

- `XopcNote` 只保留 `id/title/markdown/snippet/status/remoteVersion/updatedAt`，丢失 tags、pinned、attachments、kind、localVersion 等服务端已有字段。
- `noteItem()` 把 `updatedAt` 优先当作 `version`，语义错误；并且 PATCH 没有发送 `expectedRevision`。
- 当前保存路径没有本地 draft、outbox、操作合并和冲突恢复。
- 页面离开时以“放弃修改”对话框兜底，这与系统笔记的自动保存心智相反。

### 2.2 retired cross-platform client 当前实现中值得复用的部分

retired cross-platform client 端已经具备相对完整的笔记领域结构：

- 笔记列表：全部 / 收件箱 / 待办 / 归档、标签、搜索、置顶、批量操作。
- 详情页：阅读态与编辑态、标题、Markdown、标签、分享、朗读、打开对话。
- 编辑器：DOM + Tiptap，支持标题、粗体、斜体、列表、todo、引用、代码、分割线、链接、附件、undo/redo。
- 编辑器协议：`EditorCommand`、`EditorRuntimeState`、`NoteEditorDraft`、`flushDraft()`。
- 保存：600ms debounce、离线队列、pending/failed/saving/saved 状态，以及离开页面前的确定性 flush。
- 附件：持久化 canonical ref，编辑器展示使用临时 display src map。
- AI：请求 Markdown patch，用户确认后应用。

相关代码：

- `src/features/notes/editor/editor-protocol.ts`
- `src/features/notes/editor/NoteEditorBridge.tsx`
- `src/features/notes/web-editor/NoteEditorDomAdapter.tsx`
- `src/features/page/useNoteEditSession.ts`
- `src/features/page/useNoteEditorAttachments.ts`
- `src/features/page/useNotePageActions.ts`
- `src/features/page/PageScreen.tsx`
- `src/features/notes/NotesScreen.tsx`
- `docs/note-editor-long-term-plan.md`

应复用的是领域契约、数据语义和用户路径，不是 DOM/Tiptap 实现。HarmonyOS 端重新做 native adapter。

### 2.3 华为系统产品边界

华为官方把两类产品区分得很清楚：

- 「备忘录」偏快速记录和信息收集，覆盖文本、清单、图片/文档、扫描、语音、涂鸦、整理和 AI。
- 「笔记」偏平板与手写笔场景，强调笔刷、手写、无界画布、图形、公式和会议转写。

xopc 当前的数据基座是 Markdown、附件、标签、任务与 Agent 上下文，更匹配前者。若直接追求后者，需要额外建设画布文档格式、笔迹存储、矢量渲染、手写笔事件、缩放平移、OCR/公式识别和大对象同步，已经是另一条产品线。

## 3. 产品定位

### 3.1 核心用户任务

用户在手机上需要完成四件事：

1. 快速记下想法，不等待网络。
2. 对内容做轻量结构化：标题、段落、列表、待办、引用、图片和链接。
3. 稍后通过搜索、标签、置顶、收件箱和归档找回内容。
4. 把笔记交给 Agent 总结、改写、提炼任务或继续对话。

### 3.2 范围

P0/P1 包含：

- 原生标题与正文编辑。
- 段落、H1-H3、粗体、斜体、项目列表、待办、引用、代码块、分割线。
- 链接、图片、文件、语音附件。
- 自动保存、离线编辑、同步状态、冲突处理。
- 搜索、标签、置顶、收件箱、归档。
- 分享、打开对话、AI patch 预览与应用。
- 手机与平板自适应、深色模式、无障碍、减少动态效果。

暂不包含：

- 无限画布、手写笔刷、套索、图形绘制。
- OCR 扫描、公式识别、多人语音识别。
- 表格、复杂嵌套列表、实时多人协作。
- 任意 HTML 的无损 round-trip。

## 4. 信息架构

### 4.1 推荐结构

```text
主 Tab 3：资料库
├─ 笔记（默认）
│  ├─ 全部
│  ├─ 收件箱
│  ├─ 待办
│  ├─ 归档
│  └─ 标签筛选
├─ 文件
└─ 笔记详情（同一页面内阅读态 ↔ 编辑态）
```

调整点：

- 删除 Hub 中“笔记”和“收件箱”两个平级快捷卡片；收件箱本质是 `Note.status=inbox` 的筛选。
- 资料库默认显示笔记列表，顶部提供「笔记 / 文件」切换；最近文件不再占据笔记首屏。
- 搜索只占一个明确入口，默认跨当前分区；后续可升级为资料库全局搜索。
- 新建按钮固定在拇指热区，点击直接创建空白 note 并进入编辑，不先弹类型选择。

### 4.2 笔记列表

列表项只展示高价值信息：

- 第一行：标题 + 置顶标记。
- 第二行：正文摘要，最多 1-2 行。
- 第三行：状态/类型、一个标签、更新时间。
- 点击打开；长按弹出菜单；不引入侧滑操作。

过滤顺序：

1. 全部 / 收件箱 / 待办 / 归档。
2. 标签。
3. 搜索。

空状态直接提供“新建笔记”，搜索空状态提供清除搜索，不展示泛化插图。

### 4.3 笔记详情与编辑

一个页面承载两种模式，切换不产生路由跳转：

**阅读态**

- 顶部：返回、同步状态、对话、编辑、更多。
- 正文：大标题、标签、Markdown 阅读面、附件。
- 底部：朗读、分享、置顶、对话、更多。
- 点击正文或编辑按钮进入编辑态。

**编辑态**

- 顶部：返回、保存状态、完成、更多。
- 内容：无边框标题 + 原生 RichEditor 正文。
- 键盘上方工具条：文本样式、待办、列表、附件、撤销、重做、更多。
- “完成”只退出编辑态，不承担保存；所有变更已经本地保存。
- 返回、切后台、分享、打开对话前执行确定性 flush。

保存状态只在非正常状态时显著展示：

- 已保存：短暂出现后淡出。
- 正在保存：弱提示。
- 等待同步：云朵时钟，可点按立即重试。
- 冲突/失败：常驻提示条，提供处理入口。

### 4.4 AI 的位置

AI 不进入 `NoteEditorAdapter`，也不直接操作 RichEditor selection API。

推荐入口：详情页“更多”中的「AI 整理」，或编辑工具条“更多”中的二级入口。动作包括：

- 摘要。
- 润色/改写。
- 智能排版。
- 提取待办。
- 打开对话继续思考。

结果必须进入 preview sheet：原文 / 新版本 / 差异，对应“替换原文”“插入到光标后”“新建笔记”“取消”。只有用户确认后才修改 `NoteDocument`。

## 5. 技术选型

### 5.1 方案比较

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| ArkUI `RichEditorController` Span 模式 | 原生输入、选区、图文混排、IME 事件、样式与段落控制；项目 API 23 可用 | Markdown 语义需自建；无公开的完整编辑器命令栈 | 推荐 |
| `RichEditorStyledStringController` | StyledString 管理直观，整段样式迁移方便 | 不支持 `onWillChange/onDidChange/aboutToIMEInput` 等关键增量回调；`setStyledString` 是全量替换 | 不适合作为主编辑器 |
| ArkWeb + Tiptap | 与 retired cross-platform client 逻辑接近，功能成熟 | 输入链路、桥接、首屏、内存和键盘体验不够原生 | 仅作为 fallback/spike |
| 多个 TextArea 的 block editor | 每块模型简单 | 中文输入法、跨块选择、粘贴、撤销和焦点切换复杂 | 不推荐 |
| NDK 自研排版编辑器 | 完全可控 | 成本和风险远超当前需求 | 不考虑 |

选择 Span 模式还有两个重要原因：

- `onWillChange/onDidChange` 可驱动增量文档更新和自动保存；StyledString 模式不支持这些回调。
- `RichEditorController` 能获得选区、光标、span、段落，并进行局部插入、删除和样式更新，避免每次输入全量重建。

### 5.2 不使用 `customKeyboard` 做格式工具栏

ArkUI 的 `customKeyboard` 会替代系统输入法，不适合普通笔记输入。格式工具栏应作为跟随键盘高度的页面 overlay / safe-area bottom bar，让 RichEditor 继续使用系统 IME。

## 6. 目标架构

```text
NoteListView / NoteDetailView
             │
             ▼
       NoteEditSession
       ├─ NoteRepository ───── Gateway Notes API
       ├─ DraftStore ───────── ArkData RDB
       ├─ SyncOutbox ───────── coalesce/retry/conflict
       ├─ AttachmentService ── picker/upload/cache
       └─ NoteEditorAdapter
          └─ ArkUI RichEditor
                 │
                 ▼
          NoteDocument reducer
                 │
                 ▼
           Markdown codec
```

推荐新目录：

```text
entry/src/main/ets/
├─ feature/notes/
│  ├─ view/NoteListView.ets
│  ├─ view/NoteDetailView.ets
│  ├─ view/NoteEditorView.ets
│  ├─ view/NoteEditorToolbar.ets
│  ├─ view/NoteConflictSheet.ets
│  ├─ viewmodel/NoteListViewModel.ets
│  ├─ viewmodel/NoteEditSession.ets
│  ├─ editor/NoteEditorAdapter.ets
│  ├─ editor/RichEditorAdapter.ets
│  ├─ editor/NoteDocument.ets
│  ├─ editor/NoteDocumentReducer.ets
│  ├─ editor/MarkdownCodec.ets
│  ├─ editor/EditorHistory.ets
│  ├─ data/NoteRepository.ets
│  ├─ data/NoteDraftStore.ets
│  ├─ data/NoteSyncOutbox.ets
│  └─ service/NoteAttachmentService.ets
```

先独立出 notes domain，再让 `HomeView` 的 notes route 指向新页面；不要继续把笔记逻辑塞进 `WorkspaceView`。

## 7. 文档模型与 Markdown

### 7.1 内部模型

```text
NoteDocument
├─ title: string
├─ blocks: NoteBlock[]
└─ selection: EditorSelection

NoteBlock
├─ paragraph(runs)
├─ heading(level, runs)
├─ bulletItem(depth, runs)
├─ todoItem(checked, runs)
├─ quote(runs)
├─ code(language?, text)
├─ divider
├─ image(attachmentRef, alt)
└─ attachment(attachmentRef, label, kind)

TextRun
├─ text
└─ marks: bold | italic | link
```

`NoteDocument` 是编辑时的权威状态；RichEditor 是渲染和输入 adapter；Markdown 是同步格式。三者不能互相越层调用。

### 7.2 Markdown contract

需要与 retired cross-platform client 和 Gateway 共同遵守：

- H1-H3：`#` / `##` / `###`。
- 列表：`- item`。
- 待办：`- [ ]` / `- [x]`。
- 引用：`> `。
- 代码：fenced code block。
- 分割线：`---`。
- 链接：`[label](url)`。
- 图片：`![alt](xopc-attachment://notes/{noteId}/{attachmentId})`。
- 文件/音频：`[label](xopc-attachment://notes/{noteId}/{attachmentId})`。

必须新增跨端 golden fixtures，同一组 Markdown 在 Gateway、retired cross-platform client 和 HarmonyOS parse/serialize 后保持语义一致。允许规范化空白，但不能丢块、链接、附件或 todo 状态。

### 7.3 RichEditor 映射策略

- 普通文字和 inline mark 使用 TextSpan。
- 图片使用 ImageSpan；网络资源先异步下载/解码为本地缓存或 PixelMap，不能在同步 `addImageSpan` 中直接加载网络图。
- 文档、音频以可点击的文本链接 Span 表达，不用 BuilderSpan。
- todo 不使用 BuilderSpan：BuilderSpan 无法通过 `getSpans/getSelection/onSelect` 完整读取，也不支持复制粘贴。使用文本前缀 + block metadata + 点击命中区域切换状态。
- 用户输入只更新受影响的 block/range；禁止每次键入调用 `setStyledString` 或重建全部 span。
- Markdown 解析、超长文档序列化、图片解码放到 TaskPool；UI 线程只做局部 reducer 与 RichEditor command。

## 8. Editor Adapter Contract

HarmonyOS 端应对齐 retired cross-platform client 的语义，但使用 ArkTS 类型：

```text
NoteEditorAdapter
├─ setDocument(document)
├─ applyCommand(command)
├─ flushDraft(): Promise<NoteEditorDraft>
├─ focus(target, position?)
├─ stopEditing()
└─ callbacks
   ├─ onDocumentChanged(changeSet)
   ├─ onSelectionChanged(context)
   ├─ onRuntimeStateChanged(state)
   └─ onAttachmentRequested(source)
```

命令最小集合：

- focus / blur。
- setHeading。
- toggleBold / toggleItalic。
- toggleBullet / toggleTodo / toggleQuote / toggleCode。
- insertDivider / insertAttachment / setLink / removeLink。
- undo / redo。

运行状态：

- ready / focused / selection。
- canUndo / canRedo。
- 当前块类型和 active marks。
- composing（输入法预上屏中）。

`flushDraft()` 必须确定性返回标题和 Markdown；禁止依赖固定延迟等待输入回调。

## 9. 撤销与输入法

ArkUI RichEditor 没有暴露足够稳定的跨版本应用级 undo/redo contract，因此业务层需要自己的 `EditorHistory`：

- 一个 IME composition 合并为一个历史事务。
- 连续输入按时间窗口和光标连续性合并。
- 格式、粘贴、附件、todo 切换各自形成原子事务。
- 最多保留 100 个事务或受控内存大小。
- 远端 hydration、保存回写不进入用户 undo 栈。

中文输入重点验证：拼音预上屏、候选词替换、联想删除、emoji、语音输入、第三方输入法、硬件键盘、折叠屏切换。输入法 composition 期间不做全量 Markdown 重建，也不触发远端保存；composition 完成后再提交一个 change set。

## 10. 本地优先保存与同步

### 10.1 本地数据

Preferences 只存用户偏好；笔记草稿和 outbox 使用 ArkData RDB。

建议表：

```text
note_drafts
- note_id PK
- base_remote_version
- title
- markdown
- tags_json
- status
- dirty
- updated_at

note_outbox
- operation_id PK
- note_id
- base_remote_version
- patch_json
- state
- attempt_count
- next_retry_at
- created_at
```

附件二进制存应用文件目录，RDB 只存 metadata 与 canonical ref。

### 10.2 保存时序

```text
RichEditor onDidChange
  → update NoteDocument (同步、局部)
  → 250ms debounce 写本地 draft
  → 700ms debounce 合并远端 patch
  → outbox 写入成功后再发请求
  → PATCH /api/notes/:id { expectedRevision, ...patch }
  → success: 更新 remoteVersion，清理 draft/outbox
```

以下事件强制 `flushDraft()` + 本地 commit，但不阻塞返回动画：

- 返回。
- 切后台。
- 完成编辑。
- 分享。
- 打开对话。
- 发起 AI 动作。

### 10.3 冲突

HarmonyOS 模型必须把 `remoteVersion` 与 `updatedAt` 分开，保存时发送 `expectedRevision` 和稳定 idempotency key。

收到 409：

1. 拉取 remote 当前版本。
2. 以 base/local/remote 做三方 Markdown merge。
3. 无重叠则自动合并并重试。
4. 有重叠则展示冲突 sheet：保留本地、使用远端、查看差异后合并。
5. 冲突期间本地草稿不得丢失。

## 11. 附件链路

```text
系统 Picker / Camera / Recorder
  → 拷贝到 app cache
  → 创建 upload outbox
  → POST /api/notes/:id/media
  → 获得 attachmentId
  → 生成 canonical ref
  → 插入 NoteDocument
  → RichEditor 使用本地 display source
```

约束：

- 图片编辑时显示缩略图，阅读态按需加载高清图。
- PixelMap 与临时文件采用 LRU/生命周期管理，大图先降采样。
- 上传失败时保留本地占位卡，可重试或删除。
- 插入附件和正文保存必须可重放，不能因路由恢复重复上传。
- P1 扩展现有 ShareExtensionAbility 对图片、文件的接收；P0 保留现有文本分享能力。

## 12. 性能设计与验收

体验指标：

| 指标 | 目标 |
|---|---|
| 缓存命中后笔记内容可见 | P95 < 300ms |
| 缓存命中后编辑器可输入 | P95 < 500ms |
| 冷启动编辑器可输入 | P95 < 1000ms |
| 按键到画面反馈 | P95 < 50ms |
| 普通输入掉帧 | 连续输入保持 55fps+ |
| 返回页面 flush | 本地 commit P95 < 100ms |
| 进程被杀后的内容丢失窗口 | ≤ 500ms |
| 50k 字文档滚动/编辑 | 无明显卡顿、无全量重建 |

测试档位：5k、50k、200k 字；0、20、100 张图；手机、折叠屏、平板；深浅色；系统字体放大；减少动态效果。

实现约束：

- RichEditor 与标题输入组件保持稳定 identity，不因 toolbar 状态重建。
- `onSelectionChange` 高频事件按帧合并，只更新必要 toolbar state。
- 图片解码、Markdown parse/serialize、diff/merge 不占 UI 线程。
- 列表用懒加载和稳定 key；摘要由 API 返回，不在列表滚动时解析全文。
- 埋点只记录时长、字符数、block 数和错误码，不记录正文或标题。

## 13. 可访问性与多设备

- 所有按钮触控区至少 44vp。
- toolbar 提供 accessibilityText、selected、disabled 状态。
- todo 状态用可读文本表达，不只依赖颜色或图标。
- 字体放大时 toolbar 横向滚动，不能挤压正文。
- 平板横屏采用 `列表 360-420vp + 详情` 双栏；手机单栏 Navigation。
- 折叠/旋转时保持 note id、selection、scroll position 和未提交 draft。
- 遵循系统减少动态效果；模式切换只做 120-180ms 内容淡入，不做大幅位移。

## 14. 分阶段落地

### P0：原生可靠编辑（必须先完成）

- notes domain 与路由从 `WorkspaceView` 拆出。
- 完整 Note model、Repository、RDB draft/outbox。
- NoteList + NoteDetail 阅读态。
- RichEditor：标题、段落、H1-H3、粗体、斜体、列表、todo、链接。
- 自动保存、确定性 flush、expectedRevision、冲突保底。
- Markdown golden fixtures、IME/性能基线。

验收重点：不丢字、不跳光标、离线可写、返回不弹放弃对话框。

### P1：附件与完整格式

- 图片、文件、语音附件。
- 引用、代码块、分割线。
- undo/redo 业务历史栈。
- 标签、置顶、归档、批量操作。
- Share Extension 图片/文件接入。

### P2：资料库 IA 与跨设备体验

- 第三个 Tab 默认笔记列表。
- 笔记/文件分区、统一搜索。
- 平板双栏、折叠屏状态保持。
- 大文档和大图专项优化。

### P3：AI 与高级动作

- 摘要、润色、排版、提取待办。
- patch diff preview、替换/插入/新建。
- 选区上下文。
- 历史版本查看与恢复。

### P4：独立评估，不承诺进入当前编辑器

- 手写、无界画布、OCR/扫描、公式识别。
- 若立项，定义独立 CanvasDocument，而不是塞进 Markdown/RichEditor。

## 15. 测试矩阵

单元测试：

- Markdown parse/serialize golden fixtures。
- NoteDocument reducer 和 selection 映射。
- history transaction 合并。
- outbox 合并、重试、幂等与冲突。
- attachment canonical ref。

组件/设备测试：

- 中文/英文/emoji/第三方输入法。
- 长按选区、复制、粘贴、剪切、链接。
- 键盘弹出/收起、返回、切后台、旋转。
- 图片插入、失败、重试、删除。
- 网络断开、恢复、服务器 409、进程被杀。
- 深色、高对比、字体放大、屏幕朗读。

回归测试：

- retired cross-platform client 与 HarmonyOS 编辑同一笔记后 Markdown 语义一致。
- 笔记可被聊天引用、分享、朗读和历史恢复。
- Gateway 版本低于能力要求时安全降级为只读或基础编辑。

## 16. 灰度、监控与应急

功能开关：

- `harmony.native_note_editor`：原生编辑器总开关。
- `harmony.note_offline_sync`：RDB draft/outbox。
- `harmony.note_attachments`：附件。
- `harmony.note_ai_actions`：AI patch。

灰度顺序：内部设备 → 5% → 25% → 100%。保留旧的 TextArea 编辑页面作为一个版本周期的 fallback，但两套编辑器共享 Repository 和 Markdown contract，禁止双写不同格式。

监控：

- editor ready P50/P95。
- input lag / slow frame 比例。
- local commit 与 remote sync 成功率。
- pending 超过 5 分钟数量。
- 409 冲突率、自动合并率、人工处理率。
- Markdown round-trip 失败、附件上传失败、OOM/crash。

应急：

- 编辑器崩溃率异常：关闭 native editor，回退基础编辑器；本地 draft 仍可恢复。
- 同步异常：暂停 outbox 消费，继续本地保存，恢复后重放。
- codec 异常：禁止覆盖远端，导出本地 Markdown 并提示用户处理。
- 附件异常：关闭附件入口，不影响纯文本编辑。

## 17. 需要产品确认的两个决策

1. 第三个 Tab 是否继续叫「资料库」并默认展示笔记（推荐），还是直接改名为「笔记」并把文件入口迁到个人页/更多页。
2. P0 是否只做“备忘录式文本笔记”（推荐），把手写/无界画布明确排除，还是必须首期包含手写能力。后者需要另开技术方案和排期。

## 18. 外部调研链接

- 华为：备忘录与笔记的区别：https://consumer.huawei.com/cn/support/content/zh-cn16058597/
- 华为：备忘录摘要、润色、排版：https://consumer.huawei.com/cn/support/content/zh-cn16030285/
- 华为：智能整理备忘内容：https://consumer.huawei.com/cn/support/content/zh-cn16025864/
- 华为笔记产品页：https://consumer.huawei.com/cn/mobileservices/notes/
- HarmonyOS 自定义键盘：https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkts-customize-keyboard
- HarmonyOS 数据存储方案选择：https://developer.huawei.com/consumer/cn/doc/doccenter-dev-faq/faqs-local-database-management-38

