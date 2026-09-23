# Agent SQLite 一次性切换方案

## 结论

在 Agent 主要通过 Gateway UI、REST、CLI 和 Agent 对话管理的产品形态下，Agent 已经是运行期产品对象，不再是部署期静态配置。新版本应一次性将 Agent 注册表、默认策略和 Agent 路由引用从 `xopc.json` 切换到 SQLite。

最终版本只保留一套 SQLite 运行路径：

- 不双写 JSON 与 SQLite。
- 不在运行期回退读取 `config.agents`。
- 不构造包含旧 `agents` 字段的兼容 Config。
- 旧 JSON 只由一次性升级迁移器读取；迁移成功后立即从 `xopc.json` 删除。
- 历史迁移器必须保留，以支持用户直接从旧版本升级；它不属于运行期兼容逻辑。

升级安全是硬约束。当前 Gateway 在构造阶段先调用 `loadConfig()`，SQLite 到 `startRuntime()` 才打开。若直接从新 `ConfigSchema` 删除 `agents`，旧用户会在数据库迁移前因严格 schema 校验失败。实现必须先调整启动顺序，再删除旧 schema。

## 范围

### 迁入 SQLite

- `agents.default`
- `agents.defaults`
- `agents.list`
- `bindings`：它直接引用 Agent，必须与 Agent 删除、停用和改默认值保持一致
- `tui.defaultAgent`：迁为按 surface 保存的 Agent 偏好
- Agent revision、生命周期、创建与更新时间
- Agent 工作区初始化和清理任务

### 继续保留在文件系统

- `SOUL.md`
- `IDENTITY.md`
- `AGENTS.md`
- `TOOLS.md`
- `HEARTBEAT.md`
- Agent workspace 内容
- Agent 私有认证文件

结构化名称和 `profile.instructions` 以 SQLite 为准。Profile Markdown 是附加上下文，不反向覆盖结构化字段。创建时可以把名称写入初始 `IDENTITY.md`，后续不能把其中的 `Name` 当作数据库字段的事实来源。

### 继续保留在 `xopc.json`

- Gateway、channel、provider、browser、computer、MCP、extension 等启动和基础设施配置
- 不直接构成 Agent 注册表的全局应用设置

JSON 可以作为 Agent 的导入、导出和备份格式，但不再是运行时事实来源。

## 数据模型

建议下一个 SQLite schema 版本增加以下表。版本号以合并时最新版本顺延；以当前仓库为基准是 v205。

### `agent_catalog_settings`

单行表：

| 字段 | 说明 |
| --- | --- |
| `singleton_id` | 固定为 1 |
| `default_agent_id` | 全局默认 Agent |
| `defaults_json` | 通过 `AgentDefaultsSchema` 校验的默认模型、Skill、工具、workflow、runtime |
| `revision` | 乐观并发版本，每次修改递增 |
| `created_at` / `updated_at` | 毫秒时间戳 |

`default_agent_id` 必须指向未删除且启用的 Agent。由于 SQLite 不适合用部分条件外键表达该约束，由同一个写事务中的 Repository 校验。

### `agents`

| 字段 | 说明 |
| --- | --- |
| `id` | 现有规范化 Agent id，主键且不可改名 |
| `enabled` | 是否可以被新 Session、路由或执行选择 |
| `workspace_override` | 可空；为空时按现有默认规则派生 |
| `profile_json` | `AgentProfileSchema` 数据 |
| `overrides_json` | models、skills、tools、workflows、runtime 的显式覆盖 |
| `provisioning_state` | `pending`、`ready`、`error` |
| `provisioning_error` | 最近一次目录初始化错误的有界摘要 |
| `revision` | Agent 级乐观并发版本 |
| `created_at` / `updated_at` | 毫秒时间戳 |
| `deleted_at` | 软删除时间；历史 Session 仍可保留原 Agent id |

`profile_json` 和 `overrides_json` 采用 `CHECK(json_valid(...))`，读写时仍必须经过现有 Zod schema。不要把每个 tool/model 字段拆成列；这些字段的演进速度高于关系查询需求。

不要给 `sessions.agent_id`、历史 workflow run 等现有审计数据增加级联外键。删除 Agent 不应破坏历史记录。

### `agent_bindings`

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `agent_id` | 目标 Agent |
| `position` | 保留现有 first-match 顺序 |
| `rule_json` | 除 `agentId` 外的现有 binding rule |
| `revision` | 乐观并发版本 |
| `created_at` / `updated_at` | 毫秒时间戳 |

对活动 Agent 使用外键或 Repository 校验。Agent 删除默认被活动 binding 阻止；显式请求可在同一事务中删除 bindings 后软删除 Agent。

### `agent_surface_defaults`

保存 `tui` 等 surface 的默认 Agent：

```text
surface TEXT PRIMARY KEY
agent_id TEXT NOT NULL
revision INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

未设置 surface 默认值时使用 `agent_catalog_settings.default_agent_id`。

### `agent_provisioning_jobs`

Agent 数据库记录与目录初始化无法处于同一个 SQLite 事务，必须采用持久化 post-commit job，而不是内存回调：

```text
agent_id TEXT PRIMARY KEY
operation TEXT NOT NULL       -- provision | purge
state TEXT NOT NULL           -- pending | running | failed
attempts INTEGER NOT NULL
last_error TEXT
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

创建事务同时插入 Agent 和 provisioning job。事务提交后同步尝试 drain；进程崩溃时，下次启动继续 drain。只有 `provisioning_state=ready` 的 Agent 才能用于新 Session。

## 运行时架构

新增三个明确层次：

```text
UI / REST / CLI / xopc_use
             |
             v
      AgentAdminService
             |
       AgentRepository
             |
          SQLite
```

### `AgentRepository`

提供同步、事务友好的持久化原语：

- `getCatalogSnapshot()`
- `listAgents()` / `getAgent(id)`
- `createAgent(input)`
- `updateAgent(id, expectedRevision, patch)`
- `setDefaultAgent(id, expectedCatalogRevision)`
- `updateDefaults(expectedCatalogRevision, defaults)`
- `disableAgent(id, expectedRevision)`
- `deleteAgent(id, expectedRevision, bindingPolicy)`
- `replaceBindings(...)`
- `getSurfaceDefault(surface)` / `setSurfaceDefault(...)`

所有写操作使用 `runSqliteWriteTransaction()`。Repository 返回显式 revision conflict，不做 last-write-wins。

### `AgentAdminService`

负责业务规则和文件副作用：

- Agent id 校验和派生
- 默认 Agent、binding、TUI 默认值的删除阻塞规则
- Zod 校验和 effective config 解析
- provisioning job 入队与恢复
- Profile Markdown 初始化
- purge 的安全路径检查
- 变更事件发布

REST、CLI 和 `xopc_use` 不得各自复制创建、更新和删除流程。

### `AgentCatalogSnapshot`

运行时不再接收伪造的 `Config.agents`。新增独立快照：

```ts
interface AgentCatalogSnapshot {
  revision: number;
  defaultAgentId: string;
  defaults: AgentDefaults;
  agents: AgentEntry[];
  bindings: BindingRule[];
  surfaceDefaults: Record<string, string>;
}
```

以下函数改为接收 `AgentCatalogSnapshot` 或 `AgentCatalogReader`，而不是整个 `Config`：

- effective Agent 配置解析
- Agent 是否存在和默认 Agent 解析
- workspace 路径解析
- 路由与 binding 匹配
- project、automation、workflow 的 Agent 合法性检查
- readiness、model intent、image/computer model 配置

纯路径函数如 Agent home、profile、inbox 路径只需要 `agentId` 和 state root，应删除无意义的 `Config` 参数。

### 变更通知

删除 `ConfigHotReloader` 对 `agents.list` 和 `agents.defaults` 的处理。Agent 写事务成功后发布：

```text
agents.changed {
  catalogRevision,
  agentIds,
  fields,
  source
}
```

`AgentService` 根据事件刷新 catalog snapshot，并只驱逐受影响 Agent 的新运行配置。已有正在执行的 turn 使用开始时捕获的快照，下一 turn 使用新 revision。

## `xopc_use` 与 API

Agent 应作为正式 capability domain 接入，而不是在 `xopc_use` 中直接改数据库：

- `xopc.agents.list`
- `xopc.agents.get`
- `xopc.agents.create`
- `xopc.agents.update`
- `xopc.agents.set_default`
- `xopc.agents.disable`
- `xopc.agents.delete`
- `xopc.agents.purge`

建议新增 `agents.read`、`agents.write`、`agents.purge` scopes，避免使用宽泛的 `gateway.admin`。

所有写 capability 要求稳定的 `idempotencyKey`。因为 Agent 行本身与 `capability_operations` 位于同一数据库，创建、更新和操作回执可以处于同一个事务。目录初始化通过持久化 provisioning job 恢复。

`create` 必须一次接受完整的 profile、workspace、models、skills、tools、workflows 和 runtime 覆盖，不能先创建一个继承全部全局权限的临时 Agent，再 PATCH 权限。响应同时返回 explicit override 和 effective config，便于对话展示继承后的实际权限。

`purge` 是独立高风险操作：先软删除数据库对象，再由持久化 job 删除 Agent home；workspace 只有在明确请求且通过安全路径检查后才删除。

现有 `/api/agents` 路由继续保留 URL，但内部只调用相同 capability/Service。CLI `xopc agents` 也调用同一 Service。UI 不需要感知存储迁移。

## 一次性升级迁移

### 启动顺序

所有真实入口必须统一执行：

```text
1. 解析 state/config 路径，但不执行 ConfigSchema.parse
2. 获取 bootstrap migration lock
3. 打开 SQLite，并执行 schema migration
4. 执行 Agent 跨存储 cutover
5. 执行其余 raw/config migrations
6. 使用不含 agents/bindings 的新 ConfigSchema 严格解析 xopc.json
7. 构造 Gateway/CLI runtime
```

Gateway、TUI、agent CLI 和普通 CLI 必须从同一个 bootstrap coordinator 进入。Commander 根 `preAction` 可覆盖普通 CLI；Gateway fast path 和桌面启动入口必须显式调用同一 coordinator。`--help` 和 `--version` 不触碰用户状态。

GatewayService 构造函数中当前的 `loadConfig()` 不再负责升级。Service 只接受已经完成 bootstrap 的 `Config`、数据库连接和 `AgentCatalog`，防止测试或其它入口绕过迁移顺序。

### 跨 SQLite/文件的 crash-safe 协议

SQLite 与 `xopc.json` 无法共享事务，因此使用“数据库先提交、配置后原子替换”的可恢复协议。

1. 获取按 state root 唯一的 bootstrap migration lock，拒绝并行迁移。
2. 读取原始 JSON，不经过新 `ConfigSchema`。
3. 用只存在于迁移目录的 `LegacyAgentsConfigSchema` 校验 `agents`、`bindings` 和 `tui.defaultAgent`。
4. 计算迁移载荷的 canonical SHA-256。
5. 创建并验证：
   - `xopc.json.pre-agent-sqlite-v1.bak`
   - `xopc.db.pre-agent-sqlite-v1-<timestamp>.bak`
6. 在一个 `BEGIN IMMEDIATE` 事务中：
   - 导入 catalog settings、agents、bindings、surface defaults；
   - 插入缺失的 provisioning jobs；
   - 写入 `application_migrations`，状态为 `db_committed`，记录 digest 和备份路径。
7. 提交数据库事务。
8. 从内存中的原始配置删除 `agents`、`bindings`、`tui.defaultAgent`，使用原子文件替换写回。
9. 重新读取文件并用新 `ConfigSchema` 校验。
10. 在短事务中把 migration marker 更新为 `completed`。
11. drain provisioning jobs；失败只使对应 Agent 进入 `error`，不能回滚已经安全导入的目录外数据。

恢复规则：

| 崩溃位置 | 下次启动行为 |
| --- | --- |
| 数据库事务提交前 | JSON 未变，重新迁移 |
| 数据库已提交、JSON 尚未替换 | marker 与 digest 匹配，只重做 JSON 清理 |
| JSON 原子替换期间 | 文件系统只会看到旧文件或完整新文件，按对应状态恢复 |
| JSON 已清理、marker 未完成 | 校验数据库导入结果后把 marker 标记完成 |
| provisioning 期间 | 从 job 表继续执行 |

迁移器必须幂等。发现 marker 已完成且 JSON 又出现旧字段时不能静默覆盖数据库，应进入 migration-blocked 维护状态并展示恢复指引，因为这通常表示用户用旧版本重新写过配置。

### 升级失败体验

不要让未捕获异常形成无限 crash loop：

- bootstrap 返回结构化 `ready | blocked` 结果。
- `blocked` 时不启动 Agent、channel 或 automation runtime。
- Gateway 启动最小维护面，只暴露本地健康检查、迁移状态、备份路径和重试接口；远程监听和 channel 保持关闭。
- Desktop/CLI 显示一条可操作错误，包括失败阶段、原文件未被删除的说明、备份位置和 `xopc doctor --repair-agent-catalog`。
- 禁止失败后用空的 `main` Agent 覆盖用户数据。

如果产品不接受维护模式，最低要求是进程以明确的迁移错误退出并由 supervisor 停止重启；不能吞掉错误后使用默认 Agent 启动。

## 新安装与删除语义

新安装打开空数据库后，由 `ensureAgentCatalogInitialized()` 在事务中创建：

- 默认的 `main` Agent
- 默认 catalog settings
- `main` 的 provisioning job

这不是 legacy fallback，而是新系统的初始化路径。

删除分为三种动作：

- `disable`：禁止新路由，保留全部记录和文件。
- `delete`：软删除 Agent；活动 binding、全局默认和 surface 默认会阻止删除，或者由显式策略在同一事务中重绑。
- `purge`：软删除后异步清理 Agent home；workspace 删除必须单独显式请求。

历史 Session、TaskRun、workflow 和 automation 可以继续显示已删除 Agent 的 id。重新执行前必须选择仍然可用的 Agent。

## 需要删除的旧实现

最终变更中删除，而不是标记 deprecated：

- `ConfigSchema.agents`
- `ConfigSchema.bindings`
- `tui.defaultAgent`
- `commands/agents.config.ts` 中对 `Config.agents` 的增删改逻辑
- `agent-scope.ts` 中从 Config 读取列表/default/workspace 的逻辑
- `config/agent-profile.ts` 中依赖 `Config.agents` 的 resolver
- `ConfigHotReloader` 的 `agents.list` / `agents.defaults` 分支
- `GatewayConfigCoordinator` 中 Agent config reload 回调
- Gateway Agent REST 路由中的 `saveConfig(nextConfig)`
- CLI `agents` 命令中的 `loadConfig()` / `saveConfig()` Agent 写入
- starter Agent 对 `xopc.json` 的写入
- 所有 `config.agents`、`cfg.agents` 和 `agents.list` 运行期引用

迁移模块中的 `LegacyAgentsConfigSchema` 和 cutover 代码必须保留，直到明确提高最低可升级版本；除此之外不得存在 legacy 读取路径。

## 实施顺序

这是一版发布中的一次性切换，不是双写灰度。代码提交可分阶段，但最终合并态只能有 SQLite 路径。

1. 增加 SQLite 表、Repository、catalog snapshot 和 provisioning job。
2. 增加 bootstrap coordinator、跨存储 migration marker、锁和备份。
3. 将 resolver、routing、workspace、model intent 和 AgentManager 改为依赖 catalog。
4. 将 REST、全局默认设置、CLI、starter Agent 改为调用 `AgentAdminService`。
5. 增加 `xopc.agents.*` capabilities 和 `xopc_use` 的 `agent` mode。
6. 将 bindings 和 TUI 默认 Agent 切换到 SQLite。
7. 删除 Config schema 和全部旧配置读写逻辑。
8. 更新文档、导入导出与 doctor 检查。
9. 最后运行静态搜索门禁，确保生产代码不存在 `config.agents`、`cfg.agents`、`agents.list`。

## 验证矩阵

### 迁移与 crash recovery

- 单 Agent 和多 Agent 的旧配置升级。
- 自定义 default、global defaults、workspace、models、skills、tools、workflow、runtime。
- bindings 顺序与 TUI default 保持不变。
- 中文 display name 和派生 id。
- 在数据库提交前、提交后、JSON 替换前后、marker 完成前注入崩溃。
- 每个崩溃点重启两次，结果相同且无重复 Agent/binding/job。
- 配置只读、磁盘空间不足、数据库 busy、备份失败。
- 两个进程同时尝试升级，只有一个执行迁移。
- 已完成迁移后旧字段重新出现，进入 blocked 状态而不是覆盖 SQLite。

### 运行行为

- 新安装只创建一个 ready 的 `main`。
- REST、CLI、UI、`xopc_use` 创建出的 effective config 完全一致。
- expected revision 冲突返回 409/`REVISION_CONFLICT`。
- 创建期间 Agent 不可被路由；provisioning 完成后立即可用。
- 修改默认值、Agent overrides 后，下一 turn 使用新 revision。
- disable/delete 不影响历史 Session 读取。
- purge 不能删除 state root、home root 或未明确授权的 workspace。

### 工程门禁

- root typecheck、build、vitest。
- web lint、type-check、build。
- SQLite 从保留的最老 schema 逐版本升级到新版本。
- `xopc doctor --deep` 检查 catalog default、bindings、surface defaults、provisioning jobs 和历史引用。
- 静态检查确保生产代码不再引用旧 Agent Config 字段。

## 验收标准

- 旧用户升级后无需手工编辑 JSON 或运行迁移命令。
- 成功迁移后 `xopc.json` 不包含 `agents`、`bindings`、`tui.defaultAgent`。
- Agent 的唯一运行时事实来源是 SQLite。
- 任意迁移阶段断电后都可以自动继续，不产生重复、空 Agent 或配置丢失。
- UI、CLI、REST、Agent 对话使用同一个写服务、同一套校验、revision 和幂等语义。
- 生产代码没有 legacy fallback 或双写路径。
