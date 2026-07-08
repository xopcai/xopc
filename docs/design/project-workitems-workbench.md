# Project WorkItems Workbench 产品与技术方案

> Status: implemented direction / first-class WorkItem
> Scope: Project, WorkItem, Chat Session, Goal, Workflow, Automation
> Goal: 让 Project 成为持续推进工作的工作台，而不是 session / goal / workflow / automation 的资源列表。

---

## 1. 产品判断

xopc 的核心使用方式应该是：

```txt
进入 Project
  -> 新建一个 WorkItem
  -> 在 WorkItem 下选择推进方式：chat / goal / workflow / automation
  -> 所有对话、目标、执行和活动都回到这个 WorkItem
  -> 用户通过看板判断状态、优先级、阻塞和下一步
```

因此 WorkItem 不是从 Goal、Session、WorkflowRun 临时推导出来的视图，也不是运行时实体上的 UI override。WorkItem 是 Project 内的一等业务对象。

旧方案里的 `WorkItemView`、`work_item_overrides`、`kind:id` 聚合 ID、由 runtime status 推导 display status 的逻辑全部删除。状态属于 WorkItem 本身，所有 WorkItem 都可以被用户拖拽和更新。

---

## 2. 用户价值

用户进入 Project 后优先看到：

- 项目里有哪些事情要推进。
- 哪些正在进行、阻塞、需要输入、等待验收或已经完成。
- 每件事的负责人、优先级、下一步和相关上下文。
- 可以直接从工作项启动 chat 或创建 goal，后续 workflow / automation 也围绕工作项挂载。

这个模型避免用户先思考“我要创建 session 还是 goal”，而是先表达“我要推进什么事”。

---

## 3. 产品模型

```txt
Project
  └── WorkItem
        ├── Links
        │     ├── Chat Session
        │     ├── Goal
        │     ├── Workflow Run
        │     ├── Automation
        │     └── Note / Artifact
        └── Events
              ├── created
              ├── status_changed
              ├── chat_started
              ├── goal_created
              ├── workflow_started
              └── automation_added
```

| 概念 | 定位 |
| --- | --- |
| Project | 项目工作台，承载一组工作项 |
| WorkItem | 用户视角里要推进的一件事 |
| Chat Session | WorkItem 的开放式沟通和即时推进上下文 |
| Goal | WorkItem 的持续推进执行器，适合 checklist / evidence / judge |
| Workflow Run | WorkItem 的结构化执行记录 |
| Automation | WorkItem 的周期性或事件触发推进方式 |
| Link | WorkItem 与推进方式、执行记录、产物的关系 |
| Event | WorkItem 活动时间线 |

---

## 4. 状态与优先级

### WorkItemStatus

```ts
type WorkItemStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'blocked'
  | 'needs_input'
  | 'in_review'
  | 'done'
  | 'cancelled';
```

状态语义：

| Status | 中文表达 | 使用场景 |
| --- | --- | --- |
| backlog | 暂存 | 想做，但还没有排期 |
| todo | 待开始 | 已决定做，等待开始 |
| in_progress | 进行中 | 用户、agent、goal 或 workflow 正在推进 |
| blocked | 已阻塞 | 需要外部条件解除 |
| needs_input | 需要输入 | 明确等待用户补充信息或确认 |
| in_review | 待验收 | agent 认为完成，等待用户确认 |
| done | 已完成 | 用户确认完成 |
| cancelled | 已取消 | 不再推进 |

归档不是状态，使用 `archivedAt` 表达可见性。

### WorkItemPriority

```ts
type WorkItemPriority = 'urgent' | 'high' | 'normal' | 'low';
```

---

## 5. 关键交互

### 看板

- 默认视图是 Board。
- 每个状态是一条泳道。
- 每个 WorkItem 卡片固定宽度和高度，必须在泳道内。
- 所有 WorkItem 都能拖拽更新状态，不再限制只有 goal 可以移动。
- 顶部只保留一条紧凑工具栏：标题、数量、视图切换、刷新、新建。
- 状态过滤不在顶部重复展示，因为 Board 本身已经按状态分组。

### 新建 WorkItem

用户在 Project 内创建工作项：

- 标题必填。
- 描述、下一步、优先级、状态、负责人 agent 可选。
- 默认状态为 `todo`。
- 默认优先级为 `normal`。
- 默认负责人使用 Project 默认 agent 或系统默认 agent。

### 推进 WorkItem

WorkItem 详情里提供推进入口：

- Start chat：创建一个新的 project session，自动链接到 WorkItem。
- Create goal：从 WorkItem 标题/描述/下一步创建 goal，自动链接到 WorkItem。
- 后续接入 Run workflow、Add automation 时，也必须先链接到 WorkItem，再产生执行记录。

当 WorkItem 处于 `todo` 或 `backlog` 时，启动 chat 或创建 goal 会把状态推进到 `in_progress`。

### 活动时间线

WorkItem 的关键变化必须写入事件：

- 创建工作项。
- 更新状态。
- 启动 chat。
- 创建 goal。
- 链接 workflow / automation。
- 归档。

---

## 6. 数据模型

### work_items

```sql
CREATE TABLE work_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  owner_agent_id TEXT,
  next_action TEXT,
  blocked_reason TEXT,
  due_at INTEGER,
  completed_at INTEGER,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### work_item_links

```sql
CREATE TABLE work_item_links (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  title TEXT,
  status_snapshot TEXT,
  created_at INTEGER NOT NULL
);
```

`kind` 当前支持：

```ts
type WorkItemLinkKind =
  | 'chat'
  | 'goal'
  | 'workflow_run'
  | 'automation'
  | 'note';
```

### work_item_events

```sql
CREATE TABLE work_item_events (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT,
  created_at INTEGER NOT NULL
);
```

---

## 7. API

### List WorkItems

```http
GET /api/projects/:projectId/work-items
```

Query:

- `status`
- `priority`
- `q`
- `includeArchived`
- `limit`
- `offset`

Response:

```ts
{
  items: WorkItem[];
  total: number;
  hasMore: boolean;
}
```

### Create WorkItem

```http
POST /api/projects/:projectId/work-items
```

Body:

```ts
{
  title: string;
  description?: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  ownerAgentId?: string;
  nextAction?: string;
  blockedReason?: string;
  dueAt?: number;
}
```

### Update WorkItem

```http
PATCH /api/work-items/:id
```

Body 支持更新：

- `title`
- `description`
- `status`
- `priority`
- `ownerAgentId`
- `nextAction`
- `blockedReason`
- `dueAt`
- `archivedAt`

### Archive WorkItem

```http
DELETE /api/work-items/:id
```

语义是设置 `archivedAt`，不是物理删除。

### Start Chat

```http
POST /api/work-items/:id/start-chat
```

创建新的 project chat session，写入 `work_item_links(kind='chat')` 和 `work_item_events(type='chat_started')`。

### Create Goal

```http
POST /api/work-items/:id/create-goal
```

从 WorkItem 创建 goal，写入 `work_item_links(kind='goal')` 和 `work_item_events(type='goal_created')`。

### Events

```http
GET /api/work-items/:id/events
```

---

## 8. 前端实现

位置：

- `web/src/features/work-items/api.ts`
- `web/src/features/work-items/work-items-panel.tsx`
- `web/src/i18n/locales/en/projects.json`
- `web/src/i18n/locales/zh/projects.json`

体验约束：

- 默认 Board。
- 顶部工具栏压缩为一行。
- 移动端和中屏不平铺状态筛选，避免覆盖。
- Board 高度使用剩余视口空间，不超过页面导致双滚动。
- 卡片固定宽度、高度、内边距，内容截断，底部标签不撑高。
- 切换状态、刷新、拖拽使用局部更新和 loading 状态，不应让整个页面重排。
- 中英文文案都使用 i18n，不在组件中写裸字符串。

---

## 9. 已删除的 Legacy

以下设计不再保留：

- 从 Goal / Session / WorkflowRun 临时推导 WorkItem。
- `WorkItemView`。
- `kind:id` 作为 WorkItem id。
- `displayStatus`。
- `userStatusOverride`。
- `work_item_overrides` 表。
- 只有 goal 可以拖拽改状态的限制。
- UI 顶部重复展示完整状态过滤器。

---

## 10. 后续产品开发优先级

1. Workflow picker：从 WorkItem 详情选择 workflow 并启动 run，自动链接 `workflow_run`。
2. Automation picker：从 WorkItem 创建 recurring automation，自动链接 `automation`。
3. Agent assignment：支持把 WorkItem 分配给具体 agent，并在 chat / goal / workflow 中默认继承。
4. WorkItem summary：根据 links/events 自动生成最新进展和下一步建议。
5. 子 WorkItem：支持拆解和父子关系。
