# 用户理解可信闭环：产品与技术方案

> 实现状态（2026-08-20）：Milestone A-D 已完成。运行时只有 SQLite 事实源、`/api/you/*` API 和 `/you` 产品入口；本文件同时记录最终产品模型与已落地技术边界。

## 1. 版本结论

下一阶段版本命名为 **Understanding Confidence Loop**。目标不是增加更多记忆来源，而是让已有的用户理解能力形成一个稳定、可解释、可度量的闭环：

```text
捕获证据 → 形成候选 → 本轮使用 → 用户反馈 → 纠正或强化 → Dreaming 巩固
```

版本交付由三个不可拆分的能力组成：

1. **稳定归因**：每次回答与产生它的 turn、context trace、record ids 精确关联，不再按时间猜测。
2. **Dreaming Shadow Ledger**：Dreaming 的每次分析都有结构化 run 和 decision，可以解释“为什么建议晋升、为什么跳过”。
3. **统一产品闭环**：用户在 `/you` 完成查看、审核、纠正、反馈、隐私控制和 Dreaming 管理；不再在 `/you` 与独立设置页之间跳转。

## 2. 改造基线与已关闭缺口

### 2.1 已经具备

- `/you` 已有用户理解列表、候选确认、批量确认、纠正、拒绝、忘记、历史版本、冲突处理、证据、来源、引用授权和隐私控制；
- 聊天回答已有 helpful / not helpful 反馈，并能关联最近一次 inject trace；
- SQLite 已保存 `memory_records`、`memory_signals`、`memory_trace_events`，并能计算候选率、确认率和召回反馈；
- Dreaming 已统一消费结构化 records 和 signals，Light / Deep / REM 不再依赖文件记忆。

### 2.2 改造前缺口（现已关闭）

| 缺口 | 当前风险 | 目标状态 |
|---|---|---|
| 反馈按 `sessionKey + assistantTimestamp` 查最近 trace | 并发、排队或重试时可能归因到错误回答 | 使用稳定 `turnId` 精确关联 |
| 一个回答的负反馈平均施加给全部注入记录 | 无法区分哪个理解真正有问题 | response 反馈与 record 反馈分层 |
| Dreaming 只有 trace 和即时 preview | 无法形成可审核的决策账本，也无法比较算法版本 | 持久化 run、decision、score components 和 reason code |
| `/you` 与 Dreaming 设置页分离 | 用户看见“系统理解了什么”，但看不见“系统准备如何改变理解” | Dreaming 进入 `/you` 的记忆闭环 |
| 有质量 API，但没有产品化质量视图和发布门禁 | 只能证明代码运行，不能证明理解有效 | Shadow 指标、离线 episode 和自动化启用门槛 |
| `/api/user-context/*`、`/api/you/*`、`/api/dreaming/*` 并存 | 概念重复，前端与外部调用面分裂 | 统一为 `/api/you/*` 与 turn feedback API |

## 3. 产品原则

1. **用户看到结论，而不是存储实现**：不显示数据库、文件、锁、hash 等内部概念。
2. **先解释，再请求决策**：审核卡首先回答“系统为什么这样认为”。
3. **自动化权限逐级增加**：observe → review → automatic，不用一个布尔开关同时表达运行和写入权限。
4. **显式信息优先**：用户明确说“记住”或纠正时，不应等待 Dreaming 召回次数。
5. **推断默认可撤销**：inferred 记录必须有证据、复查期和明确的失效路径。
6. **反馈必须可归因**：不能把一次回答不满意直接解释为所有注入记忆都错误。
7. **产品入口唯一**：用户理解相关操作全部进入 `/you`；高级实现参数不暴露为普通设置。

## 4. 产品信息架构

`/you` 使用六个一级页签：

| 页签 | 用户问题 | 主要内容 |
|---|---|---|
| Overview | “你现在对我了解多少，最近发生了什么变化？” | 理解摘要、待处理数、最近变化、Dreaming 状态、来源健康 |
| Memory | “你认为关于我的哪些事情是真的？” | Needs attention、Active understanding、搜索筛选、详情抽屉 |
| Collaboration | “你应该怎样和我合作？” | Playbook、支持方式、主动性和长期目标关联 |
| Sources | “你从哪里学习？” | 会话、连接器、同步状态、学习开关、删除影响 |
| Dreaming | “后台如何整理和演化这些理解？” | 模式、有效写入权限、readiness、阶段运行、最近决策 |
| Privacy | “哪些内容可以记住、使用和提及？” | memory mode、敏感策略、引用授权、Dreaming mode、导入导出 |

独立 Dreaming 设置页已删除。普通用户在 `/you?tab=dreaming` 查看模式、有效权限、降级原因、阶段计划和最近运行。

## 5. 核心页面

### 5.1 Overview

顶部状态句只表达一个结论，例如：

- “我会学习，但所有新推断都需要你确认”；
- “Dreaming 正在观察，本周产生 4 条建议，尚未改变任何理解”；
- “有 2 条理解因为你的反馈需要复查”。

下方四张卡：

1. **Needs attention**：candidate、needs_review、conflict、待授权、Dreaming proposal 的去重总数；
2. **Recent changes**：最近确认、纠正、过期、Dreaming 晋升；
3. **Used recently**：最近在哪些回答中使用过个人理解，是否得到正向反馈；
4. **Source health**：来源同步、后台理解失败和最后成功时间。

### 5.2 Memory / Needs attention

Attention 是查询投影，不创建新的 inbox 状态表。按优先级展示：

1. 用户反馈触发的 `needs_review`；
2. 矛盾的 conflict group；
3. 敏感引用授权；
4. Dreaming 推荐晋升；
5. 普通 candidate；
6. 即将过期或长期未审核项。

每张卡必须包含：

- 结论；
- 来源类型：你告诉我的 / 我观察到的 / 我推断的 / 外部来源；
- scope 和敏感等级；
- 最少一条“为什么出现”；
- 最近一次使用及反馈；
- 主操作：确认、纠正、不是这样、稍后；
- Dreaming 卡额外显示分数构成和未自动执行原因。

桌面端布局：

```text
┌──────────────────────────────────────────────────────────────────────┐
│ You                                                                  │
│ Overview   Memory (6)   Collaboration   Sources   Privacy             │
├───────────────────────┬──────────────────────────────────────────────┤
│ Needs attention       │ Detail                                       │
│                       │                                              │
│ [反馈后需复查]        │ “你偏好先看结论，再看实现细节”               │
│ [Dreaming 建议]       │ active · collaboration · global              │
│ [冲突]                │                                              │
│ [候选理解]            │ Why I believe this                           │
│                       │  • 你在 3 次会话中明确提出                   │
│ What I know           │  • 最近使用 2 次，1 次 helpful               │
│ [搜索] [筛选]         │                                              │
│                       │ Dreaming history                             │
│ 理解列表              │  Deep v2 · review · score 0.82               │
│                       │                                              │
│                       │ [不是这样] [纠正] [忘记]                     │
└───────────────────────┴──────────────────────────────────────────────┘
```

移动端先显示列表，点击后以全屏 drawer 打开详情；所有筛选和操作保持一致。

### 5.3 Understanding Detail Drawer

固定响应式抽屉，包含五个区块：

1. **Current belief**：内容、状态、kind、scope、有效期；
2. **Why I believe this**：evidence 时间线、独立来源数、支持/矛盾关系；
3. **Where it was used**：关联 turn、回答摘要、用户反馈；
4. **Dreaming history**：哪些 run 分析过、各版本分数、决策理由；
5. **Version history**：supersession 链、冲突组、纠正历史。

用户纠正不原地覆盖：创建显式 active 新记录，旧记录 archived，并建立 `supersedesRecordId`。

### 5.4 回答反馈

回答底部保留 👍 / 👎。当本轮确实注入了个人理解时：

- 👍：默认记录 response-level helpful，不打扰用户；
- 👎：先询问回答原因；若选择“误解了我 / 使用了错误的个人信息 / 内容已过时 / 不该提及”，再展示本轮使用的理解供用户选中；
- 未选择具体记录时，只保存 response feedback，不能直接降低每条 record 的置信度；
- 选中记录后，保存 record feedback，并立即提供“纠正”或“不要再使用”。

## 6. 记忆生命周期

```text
                       用户确认
candidate ─────────────────────────> active
    │                                   │
    │ 用户拒绝                           │ 负反馈 / 新冲突 / 到期复查
    v                                   v
rejected                           needs_review
                                        │
                         确认仍有效 ─────┤───── 纠正
                                        v
                                      active(new)
                                        │ supersedes
                                        v
                                  archived(old)

active ── 有效期结束/长期未强化 ──> stale
任意可见状态 ── 用户忘记 ──> hard delete content/evidence
```

约束：

- `rejected` 保留非内容型抑制指纹，防止同一推断被后台立即重新创建；
- “忘记”删除内容、evidence 和逐条 feedback，只保留不可反推内容的聚合计数；
- `needs_review` 不进入默认上下文；
- stale 只能在新 evidence 或用户确认后重新激活；
- secret / regulated 永不因 Dreaming 自动激活。

## 7. Dreaming 产品模型

### 7.1 配置模型

最终配置使用单一 `mode`，删除 `enabled` 和隐式 promotion policy：

```json
{
  "userContext": {
    "dreaming": {
      "mode": "observe",
      "timezone": "Asia/Shanghai",
      "phases": {
        "light": {
          "enabled": true,
          "schedule": { "kind": "interval", "everyHours": 6, "minute": 0 },
          "lookbackDays": 2,
          "limit": 100
        },
        "deep": {
          "enabled": true,
          "schedule": { "kind": "daily", "time": "03:00" },
          "minScore": 0.8,
          "minRecallCount": 3,
          "minUniqueQueries": 3,
          "recencyHalfLifeDays": 14,
          "maxAgeDays": 30,
          "limit": 10
        },
        "rem": {
          "enabled": true,
          "schedule": { "kind": "weekly", "weekday": 0, "time": "05:00" },
          "lookbackDays": 30,
          "minPatternStrength": 0.75,
          "limit": 10
        }
      }
    }
  }
}
```

产品与配置只使用结构化 `schedule`。Cron 仅在托管 Automation 注册边界临时编译，不持久化、不回传给用户，也不接受自由输入。

`mode`：

| mode | Light | Deep | REM | 是否改变记录 |
|---|---|---|---|---|
| `off` | 不运行 | 不运行 | 不运行 | 否 |
| `observe` | 运行 | 只记录 decision | 只记录 decision | 否 |
| `review` | 运行 | 生成审核建议 | 生成审核建议 | 仅用户确认后 |
| `automatic` | 运行 | 满足硬门槛可激活 | 始终进入审核 | Deep 可自动改变非敏感记录 |

全局 memory mode 是上限：`off` → Dreaming off，`readOnly` → 最高 observe，`confirmWrite` → 最高 review，`auto` 才允许 automatic。

### 7.2 三阶段

**Light**

- 对最近更新 records 建立一次性观察 signal；
- 标记需要 Deep 重新评估的记录；
- 不生成新内容、不改变状态。

**Deep**

- 只分析 candidate、needs_review 和需要重新评估的 active；
- 先执行硬门槛，再计算可解释分数；
- 产出 activate、review、observe 或 skip decision。

**REM**

- 发现跨记录、跨时间、跨场景的重复模式；
- 生成新的 `derived_insight` proposal；
- v1 无论 automatic 与否都需要用户确认，防止系统自动形成不可接受的人格判断。

### 7.3 Deep 决策

硬门槛：

- record 未 rejected/archived/stale，且在有效期内；
- 无未解决 conflict；
- 非 secret/regulated；
- 至少满足 recall count、query diversity 和独立 evidence 要求；
- 没有 recent incorrect / sensitive feedback；
- scope 可明确解析。

评分保留分量，不只保存总分：

```text
score = relevance * 0.25
      + evidence_strength * 0.25
      + usage_quality * 0.20
      + stability * 0.15
      + recency * 0.15
      - negative_feedback_penalty
      - contradiction_penalty
```

- `score >= 0.85` 且 automatic：Deep 可激活；
- `score >= 0.65`：进入审核；
- 低于 0.65：observe/skip；
- 阈值由离线评测和 shadow 数据调整，不能在线自适应修改安全门槛。

显式用户陈述不走上述评分；它由 memory mode 直接决定 active 或 candidate。

## 8. 技术架构

```text
Turn Coordinator
  ├─ 创建 turnId
  ├─ Context Planner → inject trace(turnId, recordIds)
  ├─ Agent execution
  └─ assistant transcript entry(turnId)

Feedback Service
  ├─ response feedback(traceId/turnId)
  ├─ optional record feedback(recordId)
  └─ remediation → needs_review / correction workflow

Consolidation Service
  ├─ Light run
  ├─ Deep run → decisions
  ├─ REM run → proposals
  └─ apply decision through Memory Lifecycle Service

You Query Service
  ├─ overview projection
  ├─ attention projection
  ├─ record detail projection
  └─ Dreaming run/decision projection
```

状态改变集中在具备生命周期校验的 repository/service 操作中；Gateway、Dreaming、后台 review 和 connector learning 不执行裸 SQL，也不维护第二套状态机。

## 9. 数据模型

### 9.1 `memory_feedback`

替代 trace 内嵌 feedback JSON，区分回答级与记录级反馈：

```sql
CREATE TABLE memory_feedback (
  feedback_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  record_id TEXT,
  level TEXT NOT NULL CHECK (level IN ('response', 'record')),
  rating TEXT NOT NULL CHECK (
    rating IN ('helpful', 'not_helpful', 'mixed', 'irrelevant', 'incorrect', 'outdated', 'sensitive')
  ),
  score REAL,
  reason_code TEXT,
  note TEXT,
  source TEXT NOT NULL CHECK (source IN ('user', 'evaluator', 'system')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (trace_id) REFERENCES memory_trace_events(trace_id) ON DELETE CASCADE,
  FOREIGN KEY (record_id) REFERENCES memory_records(record_id) ON DELETE CASCADE,
  CHECK (
    (level = 'response' AND record_id IS NULL)
    OR (level = 'record' AND record_id IS NOT NULL)
  )
);
```

唯一索引使用 `(trace_id, level, COALESCE(record_id, ''), source)`，同一来源修改反馈时更新原记录。

### 9.2 `dreaming_runs`

```sql
CREATE TABLE dreaming_runs (
  run_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('light', 'deep', 'rem')),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('schedule', 'manual')),
  mode TEXT NOT NULL CHECK (mode IN ('observe', 'review', 'automatic')),
  algorithm_version TEXT NOT NULL,
  config_snapshot_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  reason TEXT,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);
```

### 9.3 `dreaming_decisions`

```sql
CREATE TABLE dreaming_decisions (
  decision_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES dreaming_runs(run_id) ON DELETE CASCADE,
  record_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('observe', 'propose', 'activate', 'skip')),
  reason_code TEXT NOT NULL,
  score REAL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
```

`memory_trace_events` 继续承担运行诊断；product query 不再从自由 JSON trace 推断 Dreaming 决策。

## 10. 稳定关联协议

1. 接收用户消息时生成唯一 `turnId`；
2. context plan、inject trace、assistant transcript entry 携带同一个 `turnId`；
3. Realtime final event 和会话 transcript API 返回 `turnId`；
4. 前端反馈直接提交 `turnId`，服务端查询唯一 inject trace；
5. 找不到唯一 trace 时拒绝写入，不猜测最近一条；
6. record feedback 必须验证 recordId 确实存在于该 trace 的 selected record ids 中。

当前实现已经删除基于 assistant timestamp 的最近 trace 查找逻辑。

## 11. 最终 API

### 11.1 查询

```text
GET  /api/you
GET  /api/you/understanding/:id/history
GET  /api/you/dreaming
GET  /api/you/dreaming/runs/:runId
GET  /api/you/readiness
GET  /api/you/feedback/:turnId
```

### 11.2 命令

```text
POST   /api/you/understanding
PATCH  /api/you/understanding/:id
       { action: confirm | reject | update, content? }
DELETE /api/you/understanding/:id
POST   /api/you/conflicts/:groupId/resolve
PATCH  /api/you/dreaming
       { mode: off | observe | review | automatic }
POST   /api/you/dreaming/runs
       { phase: light | deep | rem }
PUT    /api/you/feedback/:turnId
       { rating, reasonCode?, records?: [{ recordId, rating, note? }] }
```

命令返回变更后的 projection 和 `auditId`。所有批量决策必须逐条返回结果，不以一个 `updatedCount` 隐藏部分失败。

### 11.3 删除的 API 面

前端完成迁移后直接删除：

- `/api/user-context/memories*`；
- `/api/user-context/signals*`；
- `/api/user-context/traces*`；
- `/api/user-context/understanding/response-feedback`；
- `/api/dreaming*`；
- 所有 timestamp-based feedback 入口。

## 12. 后台执行

- 每个 phase 使用数据库 lease，`phase + scheduled_window` 唯一，防止 gateway 重启或多实例重复执行；
- run 开始时固化 config snapshot 和 algorithm version；
- decision 写入后才允许 apply，apply 需要 compare-and-set 当前 record status；
- 同一 record 同一 algorithm version 在证据未变化时不重复产生相同 decision；
- 新 evidence、feedback、状态或有效期变化会更新 `record_revision`，使其重新具备评估资格；
- 手动运行默认只能使用 observe，用户明确选择 review/automatic 时仍受全局 mode 上限约束；
- run 失败不回滚已写的 diagnostics，但未完成 decision 不得 apply。

## 13. 隐私与安全

- secret / regulated 不参与 automatic Dreaming；
- `ask_before_reference` 必须存在未消费授权，context planner 才能选入；
- source disconnect 的 delete 必须沿 evidence 关系删除或重新计算 derived record；
- 外部连接器内容只提供 evidence，不能改变 Dreaming config 或记忆策略；
- detail API 对 source text 做最小化返回，默认只返回摘要；
- export 必须区分 understanding、evidence、usage history，用户可选择导出范围；
- telemetry 默认只上传聚合指标，不上传 statement、evidence 或 query 文本。

## 14. 指标与发布门禁

### 14.1 核心产品指标

| 指标 | 定义 | 目标 |
|---|---|---|
| Attention resolution | 7 天内完成处理的 attention items | ≥ 70% |
| Candidate acceptance | confirmed / decided candidates | 用于校准，不追求越高越好 |
| Context helpful rate | 含个人上下文回答中的 helpful 比率 | 持续提升 |
| Incorrect context rate | incorrect/outdated/sensitive record feedback / attributed uses | < 3% |
| Dreaming precision | 用户确认的 Dreaming proposals / 已决策 proposals | ≥ 80% 后才考虑 automatic |
| Post-promotion helpful rate | 晋升后 30 天内 helpful / attributed uses | 不低于人工确认记录 |
| Scope/sensitivity incident | 越 scope 或未经授权披露 | 必须为 0 |

### 14.2 Automatic 开启门槛

单个安装的当前 KISS 门槛按最近 30 天计算：

- 至少 20 个经过评价的上下文回答，helpful rate ≥ 75%；
- record error rate ≤ 10%，且敏感反馈为 0；
- 至少 10 次 Dreaming 运行，failure rate ≤ 10%；
- 离线 episode suite 的 scope/sensitivity 安全用例必须全部通过发布门禁。

用户可以请求 automatic，但未满足线上门槛时有效模式自动降级为 review，并在 `/you?tab=dreaming` 展示原因。

## 15. 离线评测

Memory episode 格式：

```json
{
  "history": ["evidence events in time order"],
  "currentTask": "user request",
  "expectedRecall": ["record ids"],
  "forbiddenRecall": ["record ids"],
  "expectedLifecycle": ["supersede", "stale"],
  "expectedDreaming": ["review", "skip"],
  "safety": ["scope", "sensitivity"]
}
```

发布必须通过：retrieval Recall@K、forbidden recall、lifecycle correctness、Dreaming precision proxy、scope isolation 和 sensitive disclosure。安全用例失败直接阻断发布，不能用平均分抵消。

## 16. 实施计划

### Milestone A：稳定归因与反馈归一化（完成）

- turnId 贯穿 context、agent、transcript、realtime；
- 新建 `memory_feedback`；
- 聊天 feedback 使用 turnId；
- record-specific feedback 与 remediation；
- 删除 timestamp 猜测逻辑。

验收：并发、retry、queued input 下 100% 归因到正确 inject trace；未选 record 的负反馈不修改 record 状态。

### Milestone B：Dreaming Shadow Ledger（完成）

- 新建 run/decision 表和 repository；
- Dreaming phase 产出结构化 decision；
- `observe` mode；
- `/you` 展示最近 Dreaming 建议和原因；
- 算法版本对比和 shadow 指标。

验收：每个 proposal 能回溯 run、配置、算法版本、分数分量和 evidence；observe 模式不修改任何 record。

### Milestone C：统一 `/you` 产品闭环（完成）

- Overview、Attention、Detail Drawer；
- Dreaming 合并进入 `/you`；
- 保留页面首屏所需的聚合 `/api/you`，将 Dreaming、反馈与 readiness 拆成独立资源；
- 前端迁移到最终 API；
- 删除 `/api/user-context/*` 和 `/api/dreaming/*` 用户 API。

验收：所有理解和 Dreaming 操作只需 `/you`；旧 API、旧设置页、旧 config 字段不存在。

### Milestone D：Review → Automatic（完成）

- review mode proposal 决策；
- 离线 episode runner；
- automatic readiness gate；
- Deep gated activation；
- 自动降级和 kill switch。

验收：未达到门槛不可启用 automatic；REM 在 v1 始终需要确认；任何安全门禁失败立即降级。

## 17. 明确不做

- 不引入新的 Markdown 或文件式记忆；
- 不先上向量数据库，FTS/hybrid retrieval 优化排在可信闭环之后；
- 不让 LLM 自由改写用户档案；
- 不用回答满意度直接等价为具体 record 正误；
- 不为旧 API、旧 config 或旧设置页保留兼容代理；
- 不把 Dreaming 描述为人格分析、心理诊断或无证据自由联想。

## 18. 对现有代码的处理

| 处理 | 现有能力 |
|---|---|
| 直接复用 | `memory_records`、evidence、signals、context injection trace、`/you` 的确认/纠正/冲突/忘记、聊天反馈 UI、质量汇总、Light/Deep/REM 核心算法 |
| 重构 | feedback 从 trace JSON 迁到规范化表；Dreaming 从即时 trace 变成 run/decision ledger；状态修改收口到生命周期 repository/service；`/you` 将高频独立资源拆出 |
| 新增 | turnId 协议、record feedback、attention projection、Dreaming overview/detail、shadow 指标、episode runner、automatic readiness gate |
| 删除 | timestamp 最近 trace 猜测、独立 Dreaming 设置页、`enabled` Dreaming 布尔配置、重复的 `/api/user-context/*` 与 `/api/dreaming/*` 用户 API、route 直接修改 record status |

最高价值的首个开发切片是 **Milestone A + Milestone B 的 observe 模式**。它不会扩大自动写入权限，却能立即获得可靠归因、可解释 Dreaming 和后续优化所需的数据。
