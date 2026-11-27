# xopc 移动端任务体验重设计规范

> 适用范围：**仅针对原生移动端三端（iOS / Android / HarmonyOS）**，`web/` 保持不变。
> 设计基线：2026-11-27，承接 [移动端底部 Tab 与路由架构设计](mobile-bottom-tab-routing-design.md)、[三端信息架构盘点](mobile-information-architecture-audit-2026-11-11.md) 与现有 Gateway 契约（`packages/gateway-contract/src/tasks.ts`）。

---

## 1. 背景与核心设计原则

### 1.1 现状核心痛点总结

当前三端任务体验存在三层叠加问题：
1. **心智分裂**：从任务列表/进展/项目点任务进「任务对话」，从推送点任务进「任务详情」；新建待规划任务后直接落进空白聊天屏；「任务详情」藏在输入框上方极小的 `ⓘ 任务详情` 胶囊里。
2. **渲染混乱与实现分叉**：iOS `TaskConversationView` 存在系统导航栏与自定义 `taskHeader` 双顶栏叠加并遮挡首条消息；iOS 列表行未限制行数且缺少状态色彩编码；HarmonyOS 列表与 iOS/Android 详情局部仍裸露项目 UUID、原始英文优先级或 `actor.id / source` 调试字段；Android 存在两套样式不一的详情实现，HarmonyOS 残留旧版 fallback 详情分支。
3. **控制台化暴露内部状态机**：将 `phase`、`operationalState` 和 5 阶段手动切换平铺在主路径中，而后台已计算好的 `presentation.primaryAction` 未被移动端作为情景主操作使用。

### 1.2 五条设计铁律

1. **唯一产品定位**：xopc 的任务 ≠ 静态 Todo，而是**「有明确交付目标、可委派 Agent 异步推进、最终需要交付与验收的工作单元」**。
2. **一处全管，多处轻透出**：`工作台 → 任务` 是任务唯一的全量管理队列；`进展`、`项目`、`对话`、`笔记`、`资料库` 只做轻量状态透出与上下文联动，不各自造一套管理逻辑。
3. **唯一落地页（双态一体）**：全 App 任何入口打开任务，统一落入 **`TaskWorkspace`（顶部 `概览 | 对话` 双段切换）**，彻底废除「独立详情页」与「对话底部藏 `ⓘ` 胶囊」两套割裂结构。
4. **行动优先、隐藏状态机**：界面只展示**单一「人话状态」**与**当前最该点的 1 个主操作按钮**；底层 `phase` 手动流转退居右上角 `···` 菜单。
5. **零技术字段泄漏**：严禁在任何用户界面渲染项目 UUID、未本地化英文枚举（`high`/`backlog`/`idle`）、`actor.kind / actor.id / source` 或重复的说明字段。

---

## 2. 全局透出规范：任务在 5-Tab 架构中的职责分工

| 所在位置 | 用户心智 | 任务呈现形式 | 点击落点 |
|---|---|---|---|
| **Tab 3 `工作台 · 进展`**（默认首屏） | 「此刻什么等我拍板？后台在忙啥？」 | 仅展示**动态态**：`需要你处理` → `已交付` → `正在进行` → `接下来`。**不展示静态 backlog**。待处理卡严格收敛为 **1 个主 CTA**（见 2.1）。 | `TaskWorkspace`（按第 5.3 节规则自动选默认 Tab） |
| **Tab 3 `工作台 · 任务`** | 「查看、筛选、推进所有工作」 | 唯一全量任务队列：默认 `待办中` 并按紧急度自动分组；统一 3 行任务卡；顶栏支持折叠搜索、项目/优先级筛选与 `+` 新建。 | `TaskWorkspace` |
| **Tab 3 `工作台 · 项目`** | 「某个大目标下的聚合工作空间」 | 项目内「任务」区复用**完全同一套 3 行任务卡**（省略已确定的项目名元数据以减噪）；`+` 新建默认绑定 `projectId`。 | `TaskWorkspace` |
| **Tab 1 `Ada` / Tab 2 `对话`** | 「交办任务、追问、临时调整」 | ① 消息流中的任务引用渲染为紧凑状态卡（语义圆点 + 标题 + 状态短标签 + `>`）；<br>② 关联任务的普通会话在顶栏下保留单行 `Context Strip`；<br>③ 对话列表父会话展开的子任务行保持单行极简态（语义圆点 + 标题 + 状态短标签），表达「派生执行轨迹」。 | 消息链接 / 子任务行 → `TaskWorkspace`（默认落 `对话`） |
| **Tab 4 `笔记` / Tab 5 `资料库`** | 「沉淀行动项 / 找回交付物」 | 会议/录音笔记行动项确认后可转任务并保留回链；资料库交付物详情页提供「查看来源任务」。 | `TaskWorkspace`（默认落 `概览`） |
| **底栏 `工作台` Tab 角标** | 「有没有事等我处理？」 | **仅统计 `需要用户处理` 数量**（待验收、需确认、阻塞、执行失败），不统计普通进行中或待规划任务。 | 切至 `工作台` |

### 2.1 `进展` 页待处理卡片按钮去重铁律

当前 `ProgressHubView` / `ProgressOverview` / `XopcProgressView` 会在同一张待验收卡上同时渲染 `openAction`（「查看任务」）和 `secondaryAction`（「查看结果并验收」），导致双按钮指向同一任务。

**统一去重规则**：
- 若卡片存在 `primaryAction`（非 `open`）或 `task_review` 动作，**卡片主体点击区域**直接承担打开任务的能力，**不再单独渲染 `openAction` 按钮**。
- `secondaryActions` 中凡 `href === openAction.href` 或 `type === 'task_review'` 且已由主按钮/卡片点击承载的，一律过滤不重复展示。
- 每张待处理卡片底部操作区最多展示 **1 个主按钮 + 1 个次按钮**（如：`[ 去验收 ]` 或 `[ 批准 ] [ 拒绝 ]`）。

---

## 3. 三端统一状态映射、视觉语义与数据净化规范

### 3.1 统一状态映射表（唯一数据源：`presentation.status`）

三端必须统一按以下优先级解析任务显示状态：
```text
rawStatus = presentation?.status
  || (operationalState !== 'idle' ? operationalState : undefined)
  || (task.phase === 'closed' ? (task.resolution || 'closed') : task.phase)
```
**禁止**在列表或详情主区域同时并列展示 `阶段（phase）` 与 `运行状态（operationalState）`。

| `rawStatus` | 归属阶段 `stage` | 语义视觉等级 | 圆点/图标样式 | 中文标签 | 英文标签 | 列表分组 | 排序权重 `rank` |
|---|---|---|---|---|---|---|---|
| `needsUser` / `needs_user` / `waiting_for_user` | `needs_user` | **Attention（琥珀）** | 8pt 琥珀实心圆 | 需你处理 | Needs attention | ① 需要你处理 | 0 |
| `failed` / `timeout` | `needs_user` | **Danger（红）** | 8pt 红色实心圆 | 执行失败 | Failed | ① 需要你处理 | 1 |
| `blocked` | `needs_user` | **Danger（红）** | 8pt 红色实心圆 | 已阻塞 | Blocked | ① 需要你处理 | 2 |
| `review` | `review` | **Attention（琥珀）** | 8pt 琥珀实心圆 | 等待验收 | Ready for review | ① 需要你处理 | 3 |
| `paused` | `needs_user` | **Attention（琥珀）** | 8pt 琥珀双竖/实心圆 | 已暂停 | Paused | ① 需要你处理 | 4 |
| `running` / `active` / `in_progress` | `in_progress` | **Accent（蓝·动态）** | 8pt 蓝色脉冲点 | 执行中 | Running | ② 正在执行 | 10 |
| `verifying` | `in_progress` | **Accent（蓝·动态）** | 8pt 蓝色脉冲点 | 验证中 | Verifying | ② 正在执行 | 11 |
| `allocating` | `in_progress` | **Accent（蓝·动态）** | 8pt 蓝色脉冲点 | 分配中 | Assigning | ② 正在执行 | 12 |
| `queued` | `in_progress` | **Accent（蓝）** | 8pt 蓝色实心圆 | 排队中 | Queued | ② 正在执行 | 13 |
| `waiting` | `in_progress` | **Neutral（次级灰）** | 8pt 灰色空心环 | 等待条件 | Waiting | ② 正在执行 | 14 |
| `ready` | `ready` | **Neutral（次级灰）** | 8pt 灰色空心圆 | 待开始 | Ready | ③ 待开始与待规划 | 20 |
| `captured` / `backlog` | `backlog` | **Neutral（次级灰）** | 8pt 虚线/浅灰圈 | 待规划 | Backlog | ③ 待开始与待规划 | 21 |
| `completed` / `done` | `completed` | **Success（绿）** | 12pt 绿色对勾 | 已完成 | Completed | ④ 已结束 | 30 |
| `cancelled` | `ended` | **Muted（浅灰）** | 12pt 灰色终止符 | 已取消 | Cancelled | ④ 已结束 | 31 |
| `ended` / `closed` / `duplicate` / `wont_do` | `ended` | **Muted（浅灰）** | 12pt 灰色终止符 | 已结束 | Ended | ④ 已结束 | 32 |

- **排序公式**：同一视图内按 `rank ASC, (hasOverdueDueAt ? 0 : 1) ASC, task.updatedAt DESC` 排序（同级内优先逾期项，再按最近活跃倒序）。
- **无障碍兜底**：`reduceMotion == true` 时，「蓝色脉冲点」降级为静态蓝色实心圆。

### 3.2 优先级视觉与本地化规范

| 枚举值 | 中文 | 英文 | 列表卡片是否展示 | 视觉色 | 详情页是否展示 |
|---|---|---|---|---|---|
| `critical` | 紧急 | Critical | **展示**（紧凑微标） | `danger`（红底浅/红字） | 展示 |
| `high` | 高 | High | **展示**（紧凑微标） | `attention`（琥珀底/琥珀字） | 展示 |
| `normal` | 普通 | Normal | **不展示（降噪）** | — | 仅在元数据/编辑态展示 |
| `low` | 低 | Low | **不展示（降噪）** | — | 仅在元数据/编辑态展示 |

### 3.3 数据净化与禁令清单

1. **项目名解析**：三端在进入工作台或任务域时维护轻量内存缓存 `Map<projectId, projectName>`（来源于 `GET /api/projects?limit=100`）；若某任务的 `projectId` 尚未在缓存中命中，**禁止渲染原始 UUID**，显示占位文案 `关联项目` / `Linked project` 并在后台异步补查刷新。
2. **纯文本摘要提取**：列表卡片副标题禁止使用富 Markdown 渲染器（避免出现标题字号跳变、代码块撑爆卡片、列表符号错位）。提取前先去除 `#`、`**`、`` ` ``、链接语法与多余换行，压缩为单行纯文本。
3. **技术字段严禁上屏**：`projectId` 原始串、`priority` 原始英文、`actor.kind` / `actor.id` / `source`、`expectedVersion`、`idempotencyKey`、`"已加载 N 项"` 均不得直接暴露在用户界面。

---

## 4. 任务列表页（`工作台 → 任务`）规范

### 4.1 顶栏与筛选结构（三端 100% 一致）

```text
┌──────────────────────────────────────────────────────────┐
│  =               任务 ⌄               🔍    ⏷    ＋     │  ← L0 顶栏（与对话/项目/笔记一致）
├──────────────────────────────────────────────────────────┤
│  [🔍 搜索任务标题或目标…                       ✕ ]       │  ← 点击 🔍 后平滑展开，默认收起
├──────────────────────────────────────────────────────────┤
│  [ 待办中 ]   [ 需处理 · 2 ]   [ 已结束 ]   [ 全部 ]     │  ← 一级状态分段（默认选中「待办中」）
└──────────────────────────────────────────────────────────┘
```

- **顶栏右侧 3 个动作**：
  1. `🔍 搜索`：点击展开吸顶搜索框（250ms 防抖触发服务端 `search` 查询）；清空或点返回键收起并恢复列表。
  2. `⏷ 筛选`：打开紧凑 Bottom Sheet，提供 **按项目筛选**（全部项目 + 活跃项目列表）与 **按优先级筛选**（全部 / 紧急 / 高 / 普通 / 低）。存在生效条件时，`⏷` 按钮显示高亮色点，列表顶部出现可一键清除的筛选胶囊（如 `[ 📁 保靖黄金茶 × ]`）。
  3. `＋ 新建`：打开第 6 节定义的轻量化新建任务 Sheet。
- **一级状态分段（4 项，默认 `待办中`）**：
  - **`待办中`（默认）**：所有 `stage` 非 `completed`/`ended` 的任务。列表内使用轻量分组头自然分隔：
    - `需要你处理`（仅非空时出现，显示数量）
    - `正在执行`（仅非空时出现，显示数量）
    - `待开始与待规划`（仅非空时出现；若前两组都为空则不显示分组头，直接平铺列表减少视觉冗余）
  - **`需处理`**：仅 `rank <= 4` 的任务（`needsUser`、`failed`、`blocked`、`review`、`paused`），带角标计数。
  - **`已结束`**：`completed` 与 `ended` 任务，按 `closedAt ?? updatedAt` 倒序。
  - **`全部`**：不限状态，按第 3.1 节排序。

### 4.2 统一任务卡片规范（3 行预算，单卡高度约 78–96pt）

```text
┌──────────────────────────────────────────────────────────┐
│ ●  完成销售主体证照（长沙）个体户办理与食品备案     [高] │  ← Row 1: 状态点 + 标题(≤2行) + 可选高/紧急微标
│    等待验收 · 已生成材料清单与办理步骤，待你核对          │  ← Row 2: 状态短标签 · 单行动态摘要(≤1行)
│    📁 保靖黄金茶线上销售 · 验收 2/3 · 截止 11/30          │  ← Row 3: 低噪元数据(≤1行, 省略无值项)
└──────────────────────────────────────────────────────────┘
```

- **Row 1（主体识别）**：
  - 左侧：`8pt` 语义状态圆点（与标题首行基线居中对齐），**废除 40pt 大圆形文档图标**，释放 48pt 横向阅读宽度。
  - 中间：`task.title`，`16pt/sp/fp` Medium，`lineLimit = 2`，超长尾部省略。
  - 右侧：仅 `priority === 'high' | 'critical'` 时渲染紧凑微标（`11pt`，圆角 `6pt`）。
- **Row 2（动态上下文 — 仅 1 行，`13pt` 次级色）**：
  - 前缀为中文状态短标签（如 `等待验收`、`执行中`），颜色在 `Attention`/`Danger`/`Accent` 时使用对应语义色，其余用次级灰。
  - 摘要文案按以下优先级取第一条非空纯文本并用 ` · ` 连接：
    1. `attention[0]?.summary`（若存在需处理/阻塞说明）
    2. `presentation?.reason`
    3. `task.contract?.objective`
    4. `task.body`（经纯文本清洗）
  - 若上述均为空或与 `task.title` 完全一致，则 Row 2 仅显示状态短标签（不重复标题）。
- **Row 3（低噪元数据 — 仅 1 行，`12pt` 三级色；无任何字段时整行隐藏）**：
  - 按顺序拼接（用 ` · ` 分隔）：
    1. `📁 {projectName}`（在「项目详情 → 任务」页隐藏，避免重复）
    2. `验收 {passed}/{total}`（仅存在验收标准且未关闭时显示，需要列表数据或缓存提供时展示；若列表接口未返回检查数则省略）
    3. `截止 {MM/dd}`（逾期标 `danger` 并显示 `已逾期`；24 小时内标 `attention`）或无截止日时在最右侧显示相对活跃时间（如 `10分钟前` / `昨天` / `11-24`）。

### 4.3 列表轻交互与异常态

- **左滑 / 长按快捷菜单**（受 `allowedCommands` 或详情状态约束，列表无 `allowedCommands` 时先展示安全高频入口，点击执行前自动校验最新版本）：
  - 未关闭且未运行：`开始执行`、`标记完成`、`取消任务`
  - 运行中：`查看对话`、`暂停`
  - 已关闭：`重新打开`
- **加载态**：骨架屏 `MobileListSkeleton(rows: 4)`，禁止出现 `"正在加载..."` 纯文本。
- **空态**：
  - `需处理` 为空：正向反馈文案「目前没有需要你处理的任务」+ 轻量图标。
  - 搜索/筛选无结果：「没有匹配的任务」+ 一键「清除筛选」按钮。
  - 全量为空：「暂无任务」+ 引导按钮「新建任务」。

### 4.4 筛选与后端 API 对齐策略

现状 `GET /api/tasks` 支持 `phase / priority / projectId / search / limit / offset`（见 [capabilities.ts](file:///Users/micjoyce/develop/github/xopc/packages/gateway-contract/src/capabilities.ts#L172-L179)），但尚未提供 `open` / `attention` 服务端视图与分组计数：
- **阶段 A（不改后端即可上线）**：
  - `已结束` Tab 直接传 `phase=closed`；
  - `待办中` / `需处理` / `全部` 首屏请求 `limit=100`（对齐 Web 端 `TASK_PAGE_SIZE = 100`），同时透传 `projectId`、`priority`、`search` 到服务端；若仍存在 `total > items.length` 且当前前端筛选命中为空，提示「当前筛选结果可能在更早记录中」并提供「继续加载」按钮，杜绝误报「暂无任务」。
- **阶段 B（建议后端小幅增强 `xopc.tasks.list`）**：
  - 新增可选入参 `view?: 'open' | 'attention' | 'closed' | 'all'`，并在响应中返回 `counts: { open, attention, closed, all }`，彻底实现大任务量下的精准服务端筛选与角标计数。

---

## 5. 核心重构：统一任务落地页 `TaskWorkspace`（`概览 | 对话` 双态一体）

### 5.1 废弃的旧结构

三端统一清除以下历史包袱：
- **废弃** iOS `TaskConversationView` 内的自定义 `taskHeader` 叠层（彻底消除双顶栏与首条消息被遮挡 Bug）。
- **废弃** 三端任务对话输入框上方的 `ⓘ 任务详情` 小胶囊（`task-chat-details-tip`）。
- **废弃** Android 独立并存的 `TaskChatOverview` 简化详情代码（只保留一套统一的 `TaskOverviewContent`）。
- **废弃** HarmonyOS `WorkspaceView.ets` 第 1338–1460 行中 `section === 'tasks'` 的旧版 fallback 详情分支。

### 5.2 页面骨架与导航栏规范

`TaskWorkspace` 属于 **L1 栈内推送页**（遵循 [路由规范](mobile-bottom-tab-routing-design.md#3-四级路由分层与显隐铁律)：强制隐藏底部 TabBar、左上角 `< 返回`、系统原生右滑返回）。

```text
┌──────────────────────────────────────────────────────────┐
│  <           [  概览  |  对话 ● ]                  ···   │  ← 单一原生顶栏（44-56pt）
├──────────────────────────────────────────────────────────┤
│  [仅在「对话」态 & 存在待验收/阻塞时吸顶显示 1 行横幅]    │
│  ● 等待验收 · 3 项结果已产出                  去验收 >   │  ← 点击切到「概览」并滚至对应区
├──────────────────────────────────────────────────────────┤
│                                                          │
│           概览（滚动卡片流）  /  对话（聊天流）           │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- **顶栏居中双段控件 `[ 概览 | 对话 ]`**：
  - 宽度紧凑（约 156–180pt），采用三端统一分段胶囊样式。
  - 状态提示微点（6pt）：
    - 在 `对话` 态时，若任务存在待验收/需处理项，`概览` 标签右上角显示琥珀点；
    - 在 `概览` 态时，若任务正在运行或有新对话进展，`对话` 标签右上角显示蓝点。
  - 切换 `概览 ↔ 对话` 为**原地视图切换**（不 push 新页面、不销毁聊天流滚动位置与草稿输入）。
- **右上角 `···` 菜单**：
  - 通用：`编辑任务`、`手动调整阶段`、`刷新`
  - 仅在 `对话` 态额外展示：`搜索消息`、`会话选项`
  - 底部危险区：`停止当前执行`（运行中可见）、`取消任务`（未关闭可见）
- **对话态吸顶状态横幅（仅 36–40pt 高，按需出现）**：
  - 仅当处于 `对话` Tab 且状态属于 `review / needsUser / failed / blocked` 时展示，点击直接切回 `概览` Tab；运行中或常规状态不占高度。

### 5.3 智能默认落地态规则（Context-Aware Default）

路由统一收敛为唯一目标 `TaskWorkspace(taskId, initialTab?: 'auto' | 'overview' | 'chat')`：

| 进入来源 | `initialTab` 参数 | 实际落点逻辑 |
|---|---|---|
| 任务列表 / 进展页 / 项目任务 / 资料库来源 / 推送通知 | `'auto'` | 请求详情（或使用列表预传快照）：<br>• 若状态为 `running / verifying / queued / allocating` → 落 **`对话`**<br>• 其余状态（`backlog / ready / review / needsUser / failed / blocked / paused / completed / ended`）→ 落 **`概览`** |
| 对话列表父会话展开的子任务行 / 聊天消息内任务卡片链接 | `'chat'` | 直接落 **`对话`**（符合用户连续阅读对话上下文的直觉） |
| 轻量化新建任务 — 选择「先记为待办」 | `'overview'`（或停留列表 + Toast 查看） | 落 **`概览`**，绝不落空白对话 |
| 轻量化新建任务 — 选择「立即派给 Agent 执行」 | `'chat'` | 落 **`对话`**，实时观看执行流 |
| 推送冷启动深链（原 `taskDetail` / `taskChat`） | `'auto'` / `'chat'` | 统一合成 `workbench: [TaskWorkspace(tid, initialTab)]`，按一次返回直达工作台 |

> **懒加载会话铁律**：用户停留在 `概览` Tab 时，**不自动调用 `POST /api/tasks/:id/conversation`** 创建空会话；仅当用户首次切到 `对话` Tab 或任务已有 `conversation.activeConversationId` 时才加载/建立任务会话，避免产生大量无内容的空对话记录。

---

### 5.4 `概览` Tab 模块顺序与交互规范

页面采用 `20pt` 水平边距、`12–16pt` 卡片间距，自上而下严格按决策优先级排布：

#### 模块 1：Hero 状态与情景主行动卡（固定在最顶部）
- **状态胶囊**：单一语义胶囊（使用第 3.1 节状态色 + 人话标签；运行中带微妙活动指示器）。点击状态胶囊不直接弹出 10 项复杂表单，仅在右上角 `···` 提供「手动调整阶段」。
- **任务标题**：`20pt` Bold，无行数截断，支持长按复制。
- **元数据胶囊行**（自动换行 `FlowRow`，仅渲染有值项）：
  - `📁 {projectName}`（点击可跳至该项目详情）
  - `🤖 {executorAgentName}`（`conversation.currentExecutorAgentId ?? task.delegateAgentId`）
  - `📅 截止 {MM/dd HH:mm}`（逾期红 / 临期琥珀）
  - `⚑ {priorityLabel}`（仅 `high` / `critical` 高亮显示）
- **情景主行动区（直接消费后端 `presentation.primaryAction` 与 `allowedCommands`）**：

| 当前状态 / `primaryAction` | 主按钮（Full-width 突出样式） | 次按钮（轻量配角，最多 1 个） |
|---|---|---|
| `signoff`（全部验收条件满足） | **确认验收并完成**（调用 `signoff`） | 退回继续修改（切至 `对话` 并聚焦输入框） |
| `review`（有待核对验收项） | **核对验收标准**（平滑滚至模块 4 验收清单） | 去对话沟通（切 `对话`） |
| `start` / `mark_ready`（待规划或待开始） | **派给 {默认/指定 Agent} 执行**（右侧带小下拉切 Agent，点击直接 `start` 并切 `对话`） | 标记完成（仅 `runs.length === 0` 时展示） |
| `running` / `verifying` / `queued` | **查看实时进展**（切至 `对话`） | 暂停（`add_wait`） |
| `paused` / `resume` | **继续执行**（`resolve_wait`） | 取消任务 |
| `retry_run` / `failed` | **重试执行**（`POST /api/tasks/:id/retry`） | 去对话排查（切 `对话`） |
| `retry_allocation` | **重新分配执行者**（`retry_allocation`） | 手动选择 Agent |
| `completed` / `ended` | **重新打开任务**（`reopen(ready)`） | 查看任务对话（切 `对话`） |

> **关键降噪**：不再使用底部固定的 3 个等权按钮（`调整状态 | 编辑任务 | 任务对话`）。`编辑任务` 和 `手动调整阶段` 收纳到右上角 `···` 菜单；`任务对话` 已升格为顶栏双段切换，首屏操作焦点 100% 集中在「此刻唯一最该做的事」。

#### 模块 2：需你处理 / 阻塞提示卡（仅 `attention.length > 0` 时显示）
- 琥珀/红浅底卡片，列出 `attention[].summary`（与 `presentation.reason` 去重，避免重复展示同一句话）。
- 已知技术错误文案继续做本地化人话转译（如 `provider_setup_required` → 「请先完成模型服务配置后再继续」，并提供直达设置入口）。

#### 模块 3：最新成果 & 交付物卡（有 `receipts` 或 `deliverables` 时置顶于目标之前）
- **执行结果摘要**：取最新 `receipt.summary`，默认展示最多 6 行，超长提供「展开全部」按钮；支持长按选择文本。
- **剩余工作**：若 `receipt.remainingWork` 非空，以紧凑项目符号列表展示。
- **交付物附件列表**（合并 `deliverables` 与 `context(role='deliverable'|'evidence')` + `receipt.evidence(kind='artifact')`，按 URI/ID 去重）：
  - 每条显示文件类型图标 + 标题 + 可点击右箭头，点击调用各端原生文件/笔记预览（对齐资料库体验）。

#### 模块 4：交互式验收清单（仅 `acceptanceChecks.length > 0` 时显示）
- 卡片头：`验收标准` + 右侧进度胶囊 `{passed}/{total}`。
- 每行验收项结构：
  - 左侧：44×44pt 触控热区的勾选控件（`passed` 蓝/绿勾、`failed` 红感叹、`unverified` 空圈）。
  - 中间：标准正文（不截断）+ 极轻来源副标（`AI 已验证` / `人工已核对` / `待核对`）。
  - 交互：当存在 `acceptanceTarget` 且任务未关闭、无活跃 wait 时，**整行可点击直接切换 `passed ↔ unverified`**（调用 `PUT /api/tasks/:id/criteria/:checkId/review`），带局部 loading 反馈，无需额外找文字按钮。
  - 当所有项均为 `passed` 且后端返回 `signoffResultId` 时，清单底部浮现顺滑的「全部已通过 · 确认验收」快捷按钮（与 Hero 主按钮同步）。

#### 模块 5：目标与任务说明（合并去重）
- 优先显示 `task.contract.objective`；仅当 `task.body` 非空且与 `objective` 去空白后不同时，在下方以分隔线补充显示 `说明`（Markdown 渲染）。
- 若存在 `task.contract.expectedOutputs`，以轻量列表紧随其后。
- 若均为空，**不渲染空白占位大卡**，仅保留极轻的一行文字按钮 `+ 添加任务说明`（点开编辑）。

#### 模块 6：低频信息折叠区（默认收起）
- **`关联工作`（仅存在依赖/子任务/历史会话时显示）**：
  - 父任务 / 前置依赖 / 子任务（显示标题 + 状态圆点，点击 push 对应 `TaskWorkspace`）
  - 历史执行会话（显示时间与 Agent 名，点击打开历史对话）
- **`流转记录`（仅 `phaseChanges.length > 0` 或 `runs.length > 0` 时显示）**：
  - 按时间倒序合并展示，用可读中文表达（如 `11-26 14:20 · 从「待开始」进入「进行中」`、`第 2 次执行 · 已完成`），**严禁输出 `actor.kind`、`actor.id`、`source` 原始英文**。

### 5.5 「手动调整阶段」二级 Sheet（从右上角 `···` 进入）

仅服务于高阶手动管理需求，结构精简为 3 段：
1. **阶段单选列表**：待规划 / 待开始 / 进行中 / 等待验收 / 已关闭（带当前选中对勾；不可用时灰显并附一行人话原因）。
2. **执行控制**（仅当前状态支持时显示）：暂停任务 / 继续任务 / 停止当前执行（需二次确认）。
3. **终止操作**：取消任务（红色破坏性按钮，二次确认后调用 `close(resolution: 'cancelled')`）。

---

## 6. 轻量化新建与编辑任务规范

### 6.1 新建任务 Bottom Sheet（渐进式披露）

废弃 5 个平铺 Form Section 的重型表单，三端统一为紧凑的 **Bottom Sheet**：

```text
┌──────────────────────────────────────────────────────────┐
│  新建任务                                         ✕      │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 想完成什么结果？（必填，自动聚焦）                  │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ 补充说明、约束或验收要求（可选）                    │  │
│  └────────────────────────────────────────────────────┘  │
│  [ 📁 项目 ]  [ 📅 截止 ]  [ ⚑ 普通 ]  [ ✓ 验收标准 ]    │  ← 横向可滚动属性胶囊，按需点开
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 执行方式                                            │  │
│  │ ( ) 先记为待办        (●) 立即派给 Ada ⌄ 执行       │  │
│  └────────────────────────────────────────────────────┘  │
│  [                    创建并开始                      ]  │
└──────────────────────────────────────────────────────────┘
```

- **接口映射（直接使用既有 `POST /api/tasks` 契约，无需后端改动）**：
  - 选择「先记为待办」：`activation: { mode: 'capture', phase: 'ready' }`（默认进 `ready` 而非埋在 `backlog`，用户随时可一键启动）。
  - 选择「立即派给 {Agent} 执行」：`activation: { mode: 'start', executor: { kind: 'agent', agentId } }`，一步原子创建并派发运行。
- **创建后落点**：
  - 「先记为待办」→ 关闭 Sheet，刷新列表，若从任务列表新建可展示轻量 Toast「已创建 · 查看」或直接落 `TaskWorkspace(id, 'overview')`（三端保持一致：推荐统一落 `TaskWorkspace(id, 'overview')`，让用户能立刻补充验收标准或调整）。
  - 「立即派给 Agent 执行」→ 直接落 `TaskWorkspace(id, 'chat')`，立即看到执行反馈。
- **编辑任务**：从 `TaskWorkspace` 右上角 `··· → 编辑任务` 打开同一套字段组件（隐藏「执行方式」切换），保存携带 `expectedVersion`，清空项目或截止日期必须显式发送 `null`，遇到 `409` 版本冲突时保留用户草稿并提供刷新重试。

---

## 7. 实时同步与刷新规范

| 场景 | 当前实现 | 目标实现 |
|---|---|---|
| 任务列表（`工作台 · 任务`） | 仅切页或下拉手动刷新 | 订阅 Gateway 实时事件 `task-changed-v2` / `task-deleted-v1`（200ms 防抖静默刷新当前列表）；App 回前台若距上次刷新 > 30s 自动静默刷新 |
| `TaskWorkspace` 概览与顶栏状态 | 每 8 秒盲轮询 `fetchTask` | 订阅当前 `taskId` 的 `task-changed-v2` 事件触发即时刷新；仅在 WebSocket 断连降级时回退到 10 秒轮询，且编辑/弹层期间暂停覆盖 |
| `工作台` Tab 角标与 `进展` 页 | 15–30 秒轮询 `/api/home` | 收到 `task-changed-v2` 或任务操作成功后主动触发一次 `pendingAttention` 刷新，消除操作完成后底栏红点延迟消失的问题 |

---

## 8. 三端实施路线图与验收清单

### 8.1 分阶段实施计划与文件落点

| 阶段 | 核心交付 | iOS 改动文件 | Android 改动文件 | HarmonyOS 改动文件 |
|---|---|---|---|---|
| **P0 · 止血去乱** | ① 彻底修复 iOS 任务对话双顶栏叠加；<br>② 清理全三端 UUID、英文优先级、`actor/source` 裸露与重复字段渲染；<br>③ 进展页待处理卡按钮去重；<br>④ 列表默认选「待办中」、按紧急度排序、限制卡片行数并补齐状态语义色点 | [ProgressView.swift](file:///Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Progress/ProgressView.swift)<br>[ProgressRow.swift](file:///Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Progress/ProgressRow.swift)<br>[TaskDetailView.swift](file:///Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Progress/TaskDetailView.swift)<br>[ProductModels.swift](file:///Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Core/Models/ProductModels.swift) | [ProgressScreen.kt](file:///Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/ProgressScreen.kt)<br>[ProgressOverview.kt](file:///Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/ProgressOverview.kt)<br>[TaskChatChrome.kt](file:///Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/TaskChatChrome.kt)<br>[ProgressLabels.kt](file:///Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/ProgressLabels.kt) | [WorkspaceView.ets](file:///Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/view/WorkspaceView.ets)<br>[HomeHubs.ets](file:///Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/view/HomeHubs.ets)<br>[HomeView.ets](file:///Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/view/HomeView.ets) |
| **P1 · 核心重塑** | ① 统一 `TaskWorkspace`（`概览 \| 对话` 双态一体 + 智能默认落点），下线底部 `ⓘ` 胶囊与重复详情实现；<br>② 概览页消费 `presentation.primaryAction` 渲染情景主操作、交互式验收清单与可预览交付物；<br>③ 列表统一 3 行紧凑卡、折叠式搜索栏与项目/优先级筛选面板 | `TaskWorkspaceView.swift`（替代/重构 `TaskDetailView.swift`）、[TaskStatusView.swift](file:///Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Progress/TaskStatusView.swift)、[AppRootView.swift](file:///Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/App/AppRootView.swift) | `TaskWorkspaceScreen.kt`（合并 `ProgressTaskDetail` 与 `TaskChatChrome`）、[ProgressScreen.kt](file:///Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/ProgressScreen.kt) | `TaskWorkspaceView.ets`（收编 `TaskChatHeader.ets` + `taskDetailView`）、[ChatView.ets](file:///Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/view/ChatView.ets)、[HomeView.ets](file:///Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/view/HomeView.ets) |
| **P2 · 体验进阶** | ① 轻量化 Bottom Sheet 新建任务（支持「先记待办 / 立即派给 Agent 执行」）；<br>② 接入 `task-changed-v2` 实时刷新；<br>③ 列表左滑/长按快捷操作；<br>④ 后端 `xopc.tasks.list` 增加 `view` 与 `counts` | [TaskEditorView.swift](file:///Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Progress/TaskEditorView.swift)、Realtime Client | [ProgressScreen.kt](file:///Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/ProgressScreen.kt)、[ProgressRepository.kt](file:///Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/gateway/ProgressRepository.kt) | [WorkspaceView.ets](file:///Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/view/WorkspaceView.ets)、`workspaceViewModel.ets` + Gateway `src/tasks/capabilities/read.ts` |

### 8.2 三端统一验收 Checklist

- [ ] **零脏数据**：遍历任务列表、项目任务、任务概览、流转记录，均无原始项目 UUID、英文优先级/状态枚举或 `actor.id / source`。
- [ ] **顶栏与布局**：iOS/Android/HarmonyOS 进入任务工作区均为单一顶栏，无双顶栏叠加、无首条消息被遮挡；键盘弹起与安全区表现正常。
- [ ] **列表可读性**：长标题（>60 字）与长 Markdown 说明在任务列表被规范限制在 3 行预算内，状态圆点颜色与分组排序（需处理 → 执行中 → 待开始）三端一致。
- [ ] **双态落地正确**：点开待规划/待验收任务默认进 `概览`，点开运行中任务或对话子项默认进 `对话`；`概览 ↔ 对话` 原地切换不丢草稿、不丢滚动位置；停留在 `概览` 时不创建空白对话。
- [ ] **决策闭环顺畅**：待验收任务可在 `概览` 逐项勾选验收标准并一键「确认验收并完成」，完成后自动刷新 `工作台` 角标与 `进展` 页；进展页待处理卡片不再出现重复的「查看任务 + 查看结果并验收」双按钮。
- [ ] **轻创建闭环**：新建任务选择「先记为待办」落 `概览`；选择「立即派给 Agent 执行」一步触发执行并落 `对话` 实时观看推进。
