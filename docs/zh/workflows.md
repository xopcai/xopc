# 动态工作流（Workflow）

xopc 工作流让一次提示可以扇出到多个隔离的子 Agent，再合并结果。适合**可分解**的任务——仓库审计、多视角评审、并行调研、大型重构——若只靠一轮大对话，容易丢上下文或被中间工具输出污染会话。

工作流是一段小型、确定性的 JavaScript 脚本。模型编写脚本，`workflow` 工具在沙箱中执行，你会看到实时进度树，直到合成结果落地。

每次工作流**运行**都会获得独立的 Chat 会话（`sessionType: workflow`）。进度、转录与最终结果都在该会话中，不会混进触发它的那条对话。

## 如何运行

通常不必手写脚本——用自然语言描述目标，由模型判断是否适合工作流。常见触发方式：

| 触发方式 | 行为 |
|---|---|
| **Chat（隐式）** | 例如「全面审计这个仓库」「从多个角度调研 X」。助手调用 `workflow` 工具，在**独立会话**中异步启动运行，并链接回当前 Chat。 |
| **Chat（按名称）** | 「运行 audit_repo 工作流」；TUI 中输入 `/audit_repo`（会重写为对应提示）。 |
| **网关 Workflows 页** | 打开 `#/workflows`，选择模板并启动；控制台会跳转到 `#/chat/<sessionKey>` 查看实时进度。 |
| **Cron（workflowRun）** | 在 `#/settings/cron` 中选择任务类型 **工作流运行**，无需助手轮次。 |
| **REST API** | `POST /api/workflows/runs`，传入 `definitionId`（返回 `{ runId, sessionKey }`）。 |

高级用户也可通过 `workflow` 工具的 `script` 参数传入内联脚本。

启动后，TUI 与网关 Chat 会话会显示随子 Agent 扇出而增长的进度树：

```
◆ workflow: audit_repo (7/12 done, 3 running)
  ✓ Inventory 1/1
    #1 ✓ repo inventory
  ▶ Review 4/6 · 2 running
    #2 ✓ bugs review
    #3 ✓ perf review
    #4 ✓ security review
    #5 ✓ tests review
    #6 ● style review
    #7 ● docs review
  ▶ Synthesize 0/1
    #8 ● report synthesis
```

按 `Esc`（TUI）或执行 `/abort` 可取消；进行中的子 Agent 会被中止并标记为 `skipped`。

## 网关控制台

### Workflows 看板（`#/workflows`）

Workflows 页以看板形式展示**运行记录**（不是模板列表）：

| 列 | 运行状态 |
|---|---|
| **排队中** | `queued` |
| **进行中** | `running` |
| **已完成** | `succeeded` — 最近 7 天、最多 20 条（默认折叠） |
| **需关注** | `failed`、`timeout`、`cancelled` |

可用 `?wf=<definitionId>` 按工作流模板筛选。启动、重试或点击运行卡片会进入对应的 Chat 会话。

### 运行专用 Chat 会话

每次运行打开（或重新打开）`#/chat/<sessionKey>`：

- **工作流横幅**与实时 **WorkflowCard** 通过 SSE 推送进度。
- 会话转录包含目标说明、子 Agent 树更新与最终结果。
- 若从其他 Chat 启动，**父会话**链接卡片可跳回来源对话。

在看板或 WorkflowCard 上可取消、重试（在支持的情况下）。

## `/workflows` 命令

| 命令 | 作用 |
|---|---|
| `/workflows` | 列出内置与用户工作流及描述。 |
| `/workflow list` | 同 `/workflows`。 |
| `/workflow view <name>` | 查看工作流源码（超过 200 行会截断）。 |
| `/workflow save <name>` | 将本会话最近一次成功运行的工作流脚本保存到 `~/.xopc/workflows/<name>.js`。 |
| `/<name>` | TUI 快捷方式，重写为「运行 `<name>` 工作流」并发送给助手。 |

列表与查看为只读。实际执行需助手调用 `workflow` 工具——上述重写与 Chat 触发会自动完成。

## 内置工作流

| 名称 | 说明 | 参数 |
|---|---|---|
| `audit_repo` | 仓库扇出审计（bugs / perf / security / tests / style），再合成报告。 | 无 |
| `multi_perspective_review` | 从 User / Operator / Skeptic / Maintainer 四视角评审目标，再由对抗性 judge 汇总。 | `{ target: string }` |
| `research` | 多角度调研并给出带引用的 synthesis。 | `{ question: string }` |

用 `/workflow view <name>` 查看源码。

## 保存的工作流

两种保存方式：

- **`/workflow save <name>`** — 捕获本会话最近一次成功运行的脚本。若名称与原 `meta.name` 不同，会改写 meta 以便以 `/<name>` 寻址。记忆为进程内状态，重启后清空，请及时保存。
- **手动** — 将 `.js` 文件放到 `~/.xopc/workflows/<name>.js`。文件名须与 `meta.name` 一致（如 `audit_repo.js` → `meta.name: 'audit_repo'`）。

两者目录相同；`/workflows` 会立即反映新文件。用户工作流与内置同名时**用户优先**，可覆盖内置 `audit_repo`。

## 编写自定义工作流

工作流为普通 JavaScript，但文件头有严格约定。第一条语句必须是字面量 `export const meta = { ... }`，以便目录在不执行脚本的情况下索引。

```js
export const meta = {
  name: 'release_notes',
  description: 'Draft release notes from the last N commits.',
  whenToUse: 'User asks for release notes, changelog, or "what changed since".',
  phases: [{ title: 'Collect' }, { title: 'Draft' }],
}

const since = args && typeof args === 'object' && args.since ? String(args.since) : 'origin/main'

phase('Collect')
const log = await agent(
  `Run \`git log ${since}..HEAD --oneline\` and return the raw output.`,
  { label: 'git log' },
)

phase('Draft')
return await agent(
  'Draft release notes from this git log. Group by feat/fix/chore. Keep it short.\n\n' + log,
  {
    label: 'draft notes',
    schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        sections: {
          type: 'object',
          properties: {
            feat: { type: 'array', items: { type: 'string' } },
            fix:  { type: 'array', items: { type: 'string' } },
            chore: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      required: ['summary'],
    },
  },
)
```

### 可用全局变量

| 全局 | 说明 |
|---|---|
| `agent(prompt, opts?)` | 启动一个全新子 Agent。返回最终 assistant 文本；若提供 `opts.schema` 则返回校验后的对象。失败解析为 `null`，工作流继续。 |
| `parallel(thunks)` | 并发执行 `() => agent(...)` 数组。结果顺序与输入一致。必须是 thunk，不能是已创建的 Promise。 |
| `pipeline(items, ...stages)` | 每项顺序经过各 stage，不同 item 可并行。stage 签名为 `(prev, original, index)`；抛错则该项为 `null`。 |
| `phase(title)` | 标记当前进度分组。后续 `agent()` 归入该 phase。可在循环/条件中创建；空 phase 不渲染。 |
| `log(message)` | 追加工作流级日志，显示在进度树下。 |
| `args` | 传给 `workflow` 工具 `args` 的 JSON。 |
| `cwd` / `process.cwd()` | 子 Agent 可见的工作目录。 |
| `budget` | `{ total, spent(), remaining() }`。未配置 token 预算时 `total` 为 `null`。 |

### `agent()` 选项

```ts
agent(prompt, {
  label?: string,            // 进度树中的短标签
  phase?: string,            // 覆盖当前 phase()
  schema?: JsonSchema,       // 设置则返回值按 schema 校验
  toolset?: string[],        // 子 Agent 工具白名单
  maxIterations?: number,    // 子 Agent 工具迭代上限（默认 30）
  model?: string,            // provider/model 或配置的角色 id（如 small、@large）
})
```

### 确定性规则

沙箱拒绝部分 API，以保证可复现（并为未来 resume / 日志留空间）：

- `Date.now()`、`new Date()`、`Math.random()`
- `require`、`import`、动态 `eval`
- `fs`、网络 API 及全局表外的能力

需要时间戳时通过 `args` 传入，在工作流返回后再写入结果。需要随机性时用 index 等方式变化 prompt。

### 失败处理

`agent()`、`parallel()` 项、`pipeline()` 项抛错时解析为 `null`（失败会记录）。合成前务必过滤或检查：

```js
const live = findings.filter(Boolean)
if (!live.length) return { ok: false, reason: 'no findings' }
```

## 与 Cron 结合

两种模式：

1. **直接工作流运行（推荐）** — 在 `#/settings/cron` 将任务类型设为 **工作流运行**，选择已保存的定义、可选目标文案与投递频道。执行器直接调用 `WorkflowRunService`，无需助手轮次。
2. **定时消息 + 助手** — **消息**类定时任务可让 Agent 按名称运行工作流；助手会像普通 Chat 一样调用 `workflow` 工具。

详见 [定时任务](cron.md)。

## 与 todo 结合

工作流结果可转为 `todo` 清单。最简单是在后续一轮让模型把结果变成 todos：

> 「对这份计划运行 multi_perspective_review 工作流，再把确认的风险写成 todo。」

若希望工作流直接产出 todo 形状，可在 synthesis 阶段返回结构化对象（如 `topRisks` 数组），供 `todo({ merge: true, todos: [...] })` 使用。

## 各端进度可见性

| 端 | 运行中可见内容 |
|---|---|
| TUI（`xopc tui --local`） | 实时进度树，快照变化即更新。 |
| 网关控制台 | 独立工作流 Chat 会话 — WorkflowCard 经 SSE 推送；`#/workflows` 看板显示运行状态；卡片或看板可取消/重试。 |
| Telegram | **实时原地编辑**。开始时发一条消息，默认每 5 s 编辑一次；阶段变化、新错误、完成等关键事件会绕过节流。 |
| 飞书 / Lark | **实时原地编辑**。与 Telegram 相同（`im.v1.message.update`）；默认 5 s 节流。 |
| 微信 | **仅最终结果**。个人/ilink 机器人无 editMessage，中间快照被丢弃，完成时发一条摘要。 |

### 各频道配置

各频道有合理默认值；可在 `channels.<id>.workflowProgress` 覆盖：

```jsonc
{
  "channels": {
    "telegram": {
      "workflowProgress": {
        "enabled": true,
        "throttleMs": 5000,
        "mode": "edit"
      }
    },
    "feishu": {
      "workflowProgress": {
        "enabled": true,
        "throttleMs": 5000,
        "mode": "edit"
      }
    },
    "weixin": {
      "workflowProgress": {
        "enabled": true,
        "throttleMs": 60000,
        "mode": "final-only"
      }
    }
  }
}
```

字段均可选；缺省使用各频道能力默认值。

### 实验性 — 微信 `append` 模式

微信默认 `final-only`，因平台不支持 bot 消息编辑；否则每次 tick 都会是新消息。

若希望里程碑以多条微信消息出现（例如 5 分钟审计），可改为 `append` 并加大节流：

```jsonc
{
  "channels": {
    "weixin": {
      "workflowProgress": {
        "enabled": true,
        "mode": "append",
        "throttleMs": 60000
      }
    }
  }
}
```

效果简述：

- 运行中消息带 `▾ 工作流进展` 标题，便于与闲聊区分。
- 最终消息带 `✓ 工作流完成` 与结果摘要。
- 关键事件绕过 `throttleMs`；普通更新按节流间隔。
- 约 3 分钟、3 阶段的工作流通常共 **3–6 条**消息；节流低于 60 s 可能触发反垃圾策略。

此为实验能力；默认不变，除非实际使用验证节奏可接受。

## 配置

运行限制在 `agents.defaults.workflow`。类型化模型角色（`agents.defaults.models`）让脚本引用 `small` / `large` 而非硬编码 `provider/model`。按 Agent 覆盖写在 `agents.list[].models`（同 `id` 覆盖 defaults）。

```jsonc
{
  "agents": {
    "defaults": {
      "model": { "primary": "anthropic/claude-sonnet-4" },
      "models": [
        {
          "id": "small",
          "description": "Fast/cheap for fan-out subtasks",
          "model": "deepseek/deepseek-v4-flash"
        },
        {
          "id": "large",
          "description": "High quality for synthesis",
          "model": "anthropic/claude-sonnet-4"
        }
      ],
      "workflow": {
        "enabled": true,
        "maxConcurrency": 16,
        "maxSubagents": 1000,
        "defaultTimeoutSec": 1800
      }
    },
    "list": [
      {
        "id": "research",
        "models": [{ "id": "small", "model": "openai/gpt-4o-mini" }]
      }
    ]
  }
}
```

未指定 override 时，子 Agent 继承父 Agent 主模型。单次 `agent({ model: '...' })` 与 `meta.phases[].model` 在运行时解析为：

- **`provider/model`** — 如 `openai/gpt-4o-mini`
- **角色 id** — 如 `small` 或 `@large`，映射自上述配置

示例：

```js
export const meta = {
  name: 'audit_repo',
  phases: [
    { title: 'Review', model: 'small' },
    { title: 'Synthesize', model: 'large' },
  ],
}

phase('Review')
await agent('Review for bugs…', { model: 'small', label: 'bugs' })
```

## REST API（网关）

需认证的 `/api/workflows/` 路由（Bearer token 与其他网关 API 相同）：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/definitions` | 列出内置与用户工作流定义 |
| `GET` | `/definitions/:id` | 加载单个定义（脚本 + meta） |
| `POST` | `/definitions` | 保存用户工作流脚本 |
| `POST` | `/definitions/validate` | 校验脚本但不保存 |
| `DELETE` | `/definitions/:id` | 删除用户工作流（不可删内置） |
| `GET` | `/stats` | 运行统计 |
| `POST` | `/runs` | 启动运行 → `{ runId, sessionKey }`（202） |
| `GET` | `/runs` | 最近运行摘要列表 |
| `GET` | `/runs/:runId` | 完整运行视图（树、状态、指标） |
| `POST` | `/runs/:runId/cancel` | 取消进行中的运行 |
| `POST` | `/runs/:runId/retry` | 重试失败/已取消运行 → 新 `{ runId, sessionKey }` |

可选查询参数 `agentId` 将运行限定到 `agents.list` 中的某个 Agent。

## 限制与 v1 未包含项

- 无日志 / 断点续跑 — 中途中止需重新开始（可用 **重试** 发起新运行）。
- 无嵌套工作流 — `agent()` 内无法调用 `workflow()`。
- 微信 IM 默认**仅最终结果**（见上表）；Telegram 与飞书支持实时编辑。

运行时保持确定性（禁用 `Date.now`/`Math.random`），以便未来干净地加入 journaling。
