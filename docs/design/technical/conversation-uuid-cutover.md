# 会话 UUID 与升级时一次性迁移方案

状态：技术设计，尚未实现。调研日期：2026-09-16；代码基线：`a53122354`；当前 SQLite schema version：177。

## 1. 决策与范围

将稳定会话身份统一为 `conversationId: UUID`，将当前记录段明确命名为 `transcriptId: UUID`。Agent、渠道和外部聊天对象通过元数据及路由绑定表达，不再从会话 ID 解码。

采用同一个发布版本的硬切换：服务端在升级后的首次启动、开放业务流量前完成一次性数据迁移；全部自有客户端、内置扩展、CLI/TUI/MCP 同步切换。开发工作可以分步合入，但不能发布中间数据模型。

用户已明确移动端仅自己使用，可配合升级，不要求旧客户端兼容或移动端本地数据迁移。本方案据此不建立旧协议适配器、旧 key 查询入口、URL 重定向、双读双写或常驻 alias 表。旧客户端不能继续提交业务请求；新客户端只发送 UUID。

服务端持久数据迁移仍是必须完成的工作。以下两件事必须区分：

- **保留并迁移：** 服务端会话、所有 transcript、项目/任务/工作流关系、会话配置、等待项、队列、知识来源、执行环境和分享关联。
- **不迁移客户端旧状态：** 移动端旧草稿、选中会话、pending-run 缓存；Web 旧会话标签和同类缓存改用新存储版本。旧浏览器书签、已发送的旧内部 deep link、外部自编脚本需要重新打开或更新。持久聊天历史可以从列表访问。

服务端已生成的通知跳转目标应迁移；已经推送到设备上的旧通知无法召回改写。旧移动端未发送草稿不属于服务端历史，升级前若需要保留应先发送或另存。

“不破坏使用”的验收含义：历史和业务关系完整、升级后渠道续聊仍命中原会话、用户可继续原任务；允许计划内重启与客户端同步升级，不承诺旧版本可并行运行或正在执行的外部操作无缝恢复。

## 2. 源码调研结论

### 2.1 当前模型

- `src/storage/sqlite/schema.sql`：`sessions.session_key` 是主键；`sessions.session_id` 是当前 transcript 的唯一 ID；`transcripts` 单独持有各记录段。
- `src/storage/sqlite/session-repository.ts`：创建时用 `randomUUID()` 生成 `sessionId`；reset 归档旧 transcript、生成新 UUID，但不改变 `sessionKey`。删除 session 会保留归档 transcript，因此必须考虑没有 sessions 行的历史 owner。
- `src/gateway/hono/routes/sessions.ts`：Web 新会话先生成 `chat_${randomUUID()}`，再拼成长 key。这一 UUID 是 peer ID，不等于数据库 transcript UUID。
- `src/routing/agent-session-key.ts`、`session-key.ts`、`resolve-route.ts`：key 同时编码 Agent、渠道、账号、peer、thread、scope；DM scope 和 identityLinks 控制合并规则。
- `src/config/agent-profile.ts`、`src/agent/memory/turn-provenance.ts` 等从字符串解析 Agent/会话用途。直接换成 UUID 可能进入默认 Agent 分支，不能只改创建函数。

### 2.2 迁移范围超出 sessions 表

已在隔离的内存 SQLite 中执行 baseline v11 及全部后续 SQL 至 v177，枚举最终 schema，共 206 张表（包含 SQLite/FTS 辅助表）。没有打开用户的 `~/.xopc/xopc.db`。

直接含会话引用的表包括输入队列、等待项、任务、工作流、自动化、浏览器与设备 endpoint 绑定、执行环境、主动跟进。另有 JSON、泛型对象引用及 namespaced durable state，不能靠 `session_key` 列名扫描覆盖。

名称尤其不能作为语义判断：

- `execution_context_runs.session_id` 的调用链在 `src/agent/context/coordinator.ts` 传入的是长 `sessionKey`。
- `knowledge_items.source_session_id`、session 范围的 `scope_id`，相关写入也可能来自长 key；迁移 148 曾合并旧来源字段，必须做取值和来源审计。
- `session_connection_waits.data_json` 序列化整个对象，关系列和 JSON 中的身份必须一起迁移。
- 分享的 `sourceSessionId` 在 `src/share/session-share-service.ts` 来自 transcript snapshot，UUID 值必须保留。
- `browser_sessions.session_id`、`device_access_sessions.session_id`、realtime voice 的 session ID 是其他领域身份，不能改成 conversation ID。

### 2.3 升级基础设施现状

- `src/storage/sqlite/connection.ts` 在公开数据库连接之前运行 `ensureXopcDatabaseSchema`；Gateway、CLI 等多处都会打开 DB，不能只在 HTTP update 接口实现迁移。
- `src/storage/sqlite/migrations/runner.ts` 当前按 SQL 文件顺序执行，每个版本一个 `BEGIN IMMEDIATE` 事务；schema 比二进制新时拒绝启动。当前特殊备份仅针对 v100，不是通用重大迁移保护。
- `src/infra/update-runner.ts` 负责安装/构建和扩展同步，`update-restart.ts` 负责重启；手工包升级、Docker、Electron 替换安装不一定走此 runner。
- Gateway lock 按配置定位，不足以证明同一数据库没有其他 CLI 进程。新版本添加的锁也不会被已经运行的旧进程自动遵守。
- `packages/realtime-protocol` 当前 protocol version 为 1，HTTP contract 未在所有入口统一证明版本一致。

## 3. 最终身份模型

### 3.1 明确命名，不保留别名

| 领域概念 | API/TypeScript | SQLite | 生命周期 |
|---|---|---|---|
| 稳定会话 | `conversationId` | `conversation_id` | 创建后不变；fork 创建新 ID |
| 当前记录段 | `activeTranscriptId` | `active_transcript_id` | reset 后更换 |
| 某一记录段 | `transcriptId` | `transcript_id` | 历史 UUID 保持不变 |
| 执行 | `runId` | 原 run 列 | 不与以上 ID 混用 |
| 消息/entry | 原 `entryId` 等 | 原 entry 列 | 不重新生成 |
| 外部聊天与话题 | `externalPeerId` / `externalThreadId` | 路由字段 | 保留外部平台格式 |

`sessions` 表名及 `/api/sessions` 资源名可以保留，避免无收益地改名整个产品。其身份字段统一更名，不保留 `key`、`sessionKey`、含糊的 conversation-domain `sessionId` 同义字段。领域类型使用 branded string，JSON 边界统一 UUID 校验。

新 conversation 和 transcript 均使用 Node `crypto.randomUUID()`（UUIDv4）。暂不引入 UUIDv7 库：现有 `created_at` 索引负责排序，此次主要目标是身份解耦。数据库唯一约束仍是最终碰撞保护。

不能直接复用 key 尾部的 UUID：CLI、渠道、cron、workflow 的 key 不都包含 UUID，同一 peer 可出现在不同 Agent/账号下。也不复用当前 transcript UUID，以免继续混淆身份和 reset 语义。

### 3.2 最终逻辑结构

以下是字段关系示意，不是可以直接执行的完整 DDL；现有业务字段、约束及索引必须完整保留。

```text
sessions
  conversation_id UUID PK
  agent_id
  active_transcript_id UUID nullable only for deleted historical owners
  parent_conversation_id UUID nullable
  session_type / origin metadata / project_id / existing config and stats
  deleted_at nullable

transcripts
  transcript_id UUID PK                  // original session_id values
  conversation_id UUID
  status / archive_reason / created_at / archived_at / cwd

transcript_entries
  entry_id PK                            // unchanged
  transcript_id UUID FK
  seq / payload_json / existing fields

conversation_routes
  route_kind
  agent_id
  dm_scope
  channel_key
  account_key
  peer_kind
  peer_key
  external_thread_key
  scope_key
  conversation_id UUID FK
  UNIQUE(all routing identity fields above)
```

路由唯一字段全部非 NULL；未参与某个 scope 的维度使用明确的空 sentinel，避免 SQLite 多 NULL 导致唯一性失效。枚举、sentinel 与平台真实 ID 的编码需无歧义。

`sessions` 中已存在 `agent_id`、source 字段和 `routing_json`，不创建另一套平行可写的 routing JSON。稳定归属、来源展示、实际发送地址分别明确 owner：

- `sessions.agent_id` 是会话执行归属；每次 run 明确加载，找不到或停用时返回明确错误，不回退 main。
- `conversation_routes` 决定外部输入归入哪个 conversation，一个 conversation 可以有多条绑定。
- 渠道原始回复地址来自输入 origin/delivery context；跨渠道合并后不能从 conversation 的首个来源推断回复去处。
- externalThread 与父子 agent conversation 不是同一概念。使用显式父 ID、会话用途和父链计算深度，不在 UUID 中拼接 `:thread:` 或 `:subagent:`。

必须保证 active transcript 确实属于该 conversation。可在目标 DDL 中加入 `UNIQUE(conversation_id, transcript_id)` 和延迟检查的复合 FK；若暂保留应用层约束，则必须有同事务校验及 doctor 检查。不要仅用 transcript 存在性代替归属检查。

### 3.3 生命周期

| 操作 | conversationId | transcriptId | 路由绑定 |
|---|---|---|---|
| 新建 Web 会话 | 新 UUID | 新 UUID | Web 不依赖 peer 拼接创建身份 |
| 渠道续聊 | 命中已有 UUID | 当前 UUID | 同一标准化 route 命中原会话 |
| reset / 现有 `/new` 语义 | 不变 | 新 UUID，旧段归档 | 不变 |
| fork | 新 UUID | 新 UUID | 不继承外部输入路由，显式父关系 |
| compaction | 不变 | 不变 | 不变 |
| 修改标题、项目 | 不变 | 不变 | 不变 |
| 删除 | 不复用 | 历史按现有保留规则保存 | 删除活跃路由，不复活旧会话 |

不借此次迁移改变 `/new`、群聊隔离、跨渠道合并、任务分派、分享 cutoff 等产品语义。

历史上删除 sessions 后留下的 transcripts 必须映射到同一个历史 conversation owner。目标可用最小 tombstone session 行表示：`deleted_at` 有值、无 active transcript、不创建路由、不进入会话列表且不能恢复执行。正常删除也遵循相同生命周期。这是历史数据建模，不是 old-key 兼容层。

如果完整删除策略要求删除该 owner，需同时按既有保留策略处理所有 transcript/证据引用；不得因迁移生成 tombstone 改变删除内容的可见性或权限。

## 4. 路由改造

将原来的同步“拼 key”分为三个明确步骤：

1. `resolveAgentRoute(input, config)`：选择 Agent，计算 scope 和规范化 route dimensions，不读取会话 ID。
2. `resolveOrCreateConversation(route)`：SQLite 事务中查唯一绑定；缺失则一次创建会话、transcript 和绑定。
3. `loadConversationContext(conversationId)`：获得 agent、project、workspace、active transcript、parent、purpose，向后传递 typed context。

运行路径不再调用旧 parser。业务模块拿到 ID 后必须查询已存在的会话；除显式 create/route-create 入口外，不允许遇到未知 ID 自动 ensure。

DM scope 的等价性矩阵：

| scope | 唯一性包含 |
|---|---|
| main | Agent、main scope；按既有规则附加 thread/scope |
| per-peer | Agent、identityLinks 后的 peer；按既有规则附加 thread/scope |
| per-channel-peer | 上项 + channel |
| per-account-channel-peer | 上项 + account |
| group/channel | 保持既有 Agent、channel、kind、peer、thread/scope 等价关系 |

当前 group builder 不包含 account。迁移时不能顺便改成按账号分流；既有多个账号归入同一 group 会话的行为应保持。补强账号隔离应另立需求。

当前 peer/thread key 有小写规范化。迁移先保留查找等价性，同时保留原始外部 ID 供平台发送。不能在此次切换中静默改成区分大小写而使下一条消息创建新会话。

反向解析的 `agent:...:main` 默认展示为 CLI，并不证明它只有 CLI 来源。应通过旧 key 的形态重建路由范围，结合 origin/元数据恢复展示字段，不把合并会话错误限制为 CLI。

迁移路由不能简单用“当前 config + 最近一次 origin”重新计算：用户可能改过 scope，旧会话属于更早的路由策略。每条旧 key 先按其原有维度解释，当前配置只决定下一次输入查哪个 route。

定时运行、workflow、subagent、heartbeat 的唯一性分别由对应逻辑 owner/run ID 和专用 route kind 表达。一次性 run 不挂长期外部 route；main/heartbeat 等需要稳定入口时创建专用绑定。父会话不存在时不能凭猜测恢复成可执行会话。

并发创建使用 `BEGIN IMMEDIATE` 与 UNIQUE constraint，在同一事务完成 find-or-create。禁止先提交空 session 再争抢绑定，避免孤儿会话；唯一冲突只重读同一 route，不能合并两个现存 conversation。

## 5. 服务端一次性迁移设计

### 5.1 迁移入口与版本

记本次目标 schema 为 **N**，开发合入时取下一个可用版本，不提前锁死 178。

新增一个有明确版本号的 TypeScript 数据迁移模块，用于 UUID 生成、旧格式解码、类型化 JSON 转换和校验；迁移 runner 显式注册此版本，并与 SQL migration 共用顺序/缺号/重复号检查。

旧 parser 的冻结副本只在该迁移模块中使用，不从新 routing runtime 导入。历史升级代码必须保留以支持跨版本升级，但只在 `schemaVersion < N` 时运行。禁止每次启动扫描旧字段并尝试修补。

新安装继续使用 baseline + migration 链，空库进入 N 时不需要用户数据备份。历史 SQL 文件不追溯修改。Electron/tsdown 打包要包含 TS migration 及需要的 SQL，并在打包产物中测试。

入口统一在 DB bootstrap，且必须在任何 domain constructor、worker、channel、HTTP mutation、自动恢复队列之前完成。只在 updater 中迁移不能覆盖手工安装。

### 5.2 升级状态机

```text
PRECHECK → QUIESCE → VERIFIED_BACKUP → MIGRATING → VALIDATED
         → COMMITTED → STARTUP_HEALTHY → ACCEPT_TRAFFIC
```

PRECHECK 必须检查目标包完整、所有 migration 可发现、磁盘空间、DB/配置路径、当前 schema 和完整性、相连客户端/扩展版本，以及是否有活跃执行或未知 DB owner。

QUIESCE 必须停止接收新输入和新自动化触发，停止 channel polling/webhook 接收，等待已开始的运行结束。不能仅暂停 HTTP 而允许后台 worker 写入。计划升级默认延期直到外部有副作用的运行结束，不自动重放中断支付/发送等工具调用。

对已经崩溃的旧运行保留其 input/run ID 和状态，通过现有 recovery 语义标记 interrupted/需人工确认；只改身份引用，不将不确定外部执行重新变为 queued。待处理输入的 FIFO、clientMessageId、审批版本和队列 lease 语义保持不变。

升级锁按 **数据库 realpath** 定位，覆盖 Gateway、CLI、Electron 子进程、daemon supervisor，不按 config path 单独锁。安装期间禁止 supervisor 拉起旧 worker。新 DB opener 都服从 schema/维护屏障。

**旧进程边界：** 旧版不知道新锁，SQLite 写事务也不能防止旧进程在 COMMIT 后继续写。迁移前必须通过现有进程/服务管理确认旧 Gateway 和独立 CLI DB owner 退出；未知 owner 则延期/拒绝迁移，不能假称已独占。直接 DB 访问的非 xopc 程序不在自动升级保障范围。此跨平台进程排他能力是发布阻断项，不能用一个新 lockfile 宣称已解决。

外部渠道停机时：polling 平台依赖游标保留；webhook 平台应返回可重试状态，前提是平台支持重试；没有缓冲/重试能力的渠道只能提供维护窗口，不能承诺绝对零消息丢失。已持久化 inbound/outbound 必须迁移并保持去重 ID。

### 5.3 备份与整条升级链

现有 runner 每版本一个事务，不能把它称为“整个升级链一个事务”。从旧于 177 的版本升级时，先备份，再执行既有迁移至 N-1，最后运行 N 的原子转换。

备份使用 SQLite 一致性机制（例如 `VACUUM INTO`），不直接复制打开中的 `.db` 并遗漏 WAL。备份需成功结束、flush/fsync、以新连接验证 `integrity_check`/schema、记录大小/摘要/原 app 版本，然后原子记录 ready manifest，权限 0600。备份在写事务外完成；独占维护窗口覆盖备份到切换期间。

必须检查 checkpoint 的 busy 返回值；完成 checkpoint 不是备份已耐久的证明。预留容量覆盖备份、主库、事务 WAL、FTS 副本和索引增长；具体余量用容量测试确定，不承诺固定秒数。

备份失败、磁盘不足、源数据不一致时停止升级，不忽略错误继续生成空会话。无受影响持久数据的新安装可跳过备份。

### 5.4 映射集合

N 事务内创建 TEMP mapping：

```text
old_key → conversation_uuid, owner_kind(active|deleted), resolved_agent, routing_shape
```

映射域至少覆盖：

1. 所有 sessions key，包括隐藏、归档、cron、workflow、subagent。
2. 所有 transcripts owner key，包括 sessions 已删除的历史。
3. 所有迁移 manifest 注册的强引用和历史弱引用。

每个旧 key 生成一次 UUIDv4，UNIQUE 双向检查。事务重试可重新生成尚未提交的 UUID；提交前不向任何客户端/外部系统暴露新 ID，因此不要求失败尝试的 UUID 稳定。

不需要在最终 DB 保存 old-key alias。源备份和隔离的迁移审计文件足以定位旧数据；报告中的映射若保留，只是权限受限的诊断材料，不被运行时读取。

缺失目标的处理必须按引用语义：有 transcript 的已删除 owner 生成 tombstone；本来允许删除的历史弱引用可保留 tombstone/明确 deleted target；活跃队列、执行环境、审批等待的强引用缺 owner 时中止并报告，不能随意 NULL、丢弃记录或创建 main 会话。

不完整 key、Agent 冲突、route collision 需要明确 preflight 报告。优先利用一致的持久元数据恢复；恢复条件不充分时阻断该升级，不凭默认值猜测。

### 5.5 单一 cutover 事务

优先使用列重命名和原位引用值更新，避免整张大表无意义复制；新增约束确实要求重建表时使用 SQLite 官方 create-copy-drop-rename 顺序。

```text
BEGIN IMMEDIATE
  defer_foreign_keys = ON             // only where applicable
  build complete temporary ID map
  validate agent/routing ownership
  convert direct references and typed live JSON
  rename conversation/transcript columns
  create explicit route bindings and historical owners
  migrate generic references, durable queues/state
  recreate FTS with new identity columns
  verify all invariants
  persist schema N + identity contract version + compact migration summary
  drop temporary map
COMMIT
```

若某张表重建需要关闭 `foreign_keys`，必须在 BEGIN **之前**、专用独占连接上设置，事务内显式 `foreign_key_check`，结束后重新开启并检查；不能在事务内设置 OFF 然后假定生效。`defer_foreign_keys` 不会延迟 UNIQUE 或所有 RESTRICT 动作，需逐个审查实际 FK/trigger。不要通过 writable_schema 改表定义。

现有命名转换示例：

- `sessions.session_key` → `conversation_id`，值映射。
- `sessions.session_id` → `active_transcript_id`，UUID 值原样保留。
- `transcripts.session_key` → `conversation_id`，值映射。
- `transcripts.session_id` → `transcript_id`，值原样保留。
- `transcript_entries.session_id` → `transcript_id`，值原样保留。
- `session_inputs.expected_session_id` → `expected_transcript_id`，值原样保留。
- 父子、from/to、active session 的 key 引用 → 对应 conversation 字段。

迁移完成后最终 schema 没有 conversation-domain `session_key`，正常服务不加载冻结 parser。历史 migration SQL 中出现旧名称不属于运行时兼容代码。

## 6. 迁移 manifest：按语义登记，不全局 replace

每个转换项必须登记 table/column 或 namespace、类型判别条件、目标类型、缺失目标策略及校验方式。测试对最终 schema 扫描，发现未登记的候选列必须失败；名称扫描只是发现工具，不能代替类型判定。

### 6.1 关系列

| 对象 | 操作 |
|---|---|
| sessions、session_config、transcripts、transcript_fts | 转 conversation 引用；保留 transcript UUID |
| session_inputs、session_input_runtime | 转 conversation；保留 input/run/clientMessageId、顺序、版本、expected transcript |
| session_connection_waits、session_clarification_waits | 转 conversation；保留 transcript、等待状态和 revision；同步转换 data_json |
| task_sessions、task_runs、task_conversation_state、task_handoff_snapshots | 转 session_key、active/from/to 引用；保留 task_session_id 和 assignment_epoch |
| workflow_runs、automation_runs、work_discovery_runs | 转 session/parent 引用；保留 run 与调度去重身份 |
| endpoint_session_bindings、browser_tab_bindings、execution_environment_bindings | 转 conversation；保留 endpoint/environment/tab ID 及原 workspace 路径 |
| interaction_states、proactive_follow_ups、context_snapshots | 转 conversation；保留状态和用途 |
| session_task_plans、compaction_checkpoints、transcript_entries | 真正 transcript 引用只改明确命名，不换 UUID |
| execution_context_runs.session_id | 按已确认写入链改成 conversation_id |
| context_evidence.session_id、knowledge_items.source_session_id / scope_id | 基于来源类型及值域判定 conversation/transcript；混合历史先审计，歧义阻断 |
| browser_sessions、device_access_sessions | 属于其他领域，保持原样 |

### 6.2 非显式列和 JSON

还必须覆盖：

- `object_links` 的 from/to kind + ID，`activity_events` 的 primary kind + ID、source/payload；只在对象类型是会话时转换。
- `notification_events` 目标及待投递 payload；保留通知 ID、ack 和去重身份。已投递设备通知不保证更新。
- `knowledge_items` 的 session scope、source_json、canonical key；`context_evidence.source_ref`、extraction source_ref 等复合来源地址。明确 grammar 后转换结构化指针，不能替换用户正文中的相似文本。
- `session_inputs` 的 origin/context refs/snapshots/payload，以及任务、workflow 的可恢复控制参数。原文 prompt 不做替换。
- `durable_state` 的 namespace/scope/key/payload：`shares`、`site-shares`、`hosted-share-bindings`、`command-receipts`、`workflow-drafts`、定义/修订中可执行引用，以及 `extension-ui` 已知 schema。
- `durable_messages` 的 outbound 和 agent-ipc：转换 message 中的机器可读会话指针和按会话分区的 scope，保留 message ID、sequence、processed/lease 状态。
- 运行中的缓存不迁移；排空进程后由新 DB 重建。不可重放的持久幂等键不能简单重算：需先识别其读取用途，已消费 receipt 必须依然能防重，未执行 intent 如需改 key 要与产生新 key 的算法一起验证。

未知第三方 namespace 不递归重写。当前用户采用同步升级：扩展必须升级或提供该版本一次性数据转换；如果未知 payload 是活跃会话引用且无法解释，则阻断启用该扩展/升级，不以“全量迁移完成”掩盖缺口。

### 6.3 保留不可变历史

聊天正文、历史 tool 参数/输出、历史审计原文、已导出的文件中出现的长 key 不做全文替换。它们是当时发生事件的内容；迁移不应篡改用户文本或破坏签名/摘要。

新运行不应将历史 tool 参数直接作为恢复指令。恢复需要独立、类型化的控制记录，并在本次事务中迁移。如现有某种回放确实把 transcript 的特定结构字段当作控制参数，必须显式登记字段级迁移或改为读取控制记录；不能留下新 runtime 的 fallback parser。

分享 URL/token、已发布快照、transcript UUID、cutoff 和内容摘要保持原样。可变分享管理记录里的 workspaceContext.sessionKey 转为 conversationId；不可变 manifest 使用它自己的既有格式语义，不视为 live conversation API。不要重新发布分享或改变已分享内容。

历史内部链接只要求在产品当前存储的可变导航字段迁移；用户正文、书签、外部通知里的旧链接允许失效。旧格式外部导入不新增兼容分支，要求用户使用受支持的新导出格式。

### 6.4 FTS 与文件

FTS 虚表不能当普通表逐列 rename。新建新 schema 的 FTS、以同一映射复制/重建、检查 entry_id 和内容对应关系，再事务内替换。明确是否需要保持 FTS rowid；依赖审计若证明外部只使用 entry_id，则不要求 rowid 恒定。

附件、工作目录、git worktree、发布快照的物理路径不因 ID 变化而移动。若发现历史路径由旧 key 派生，新版本直接使用迁移后 DB 内存储的原路径。不要让文件移动和数据库 COMMIT 形成无法原子恢复的跨介质迁移。

配置 schema 中未发现需要批量转换的顶层 sessionKey 配置项；仍需审计当前启用的扩展与可执行 workflow 文件。若存在，优先把机器状态归入 DB；必要的文件变更必须用单独的持久 journal、临时文件及幂等完成步骤，未完成时业务门禁保持关闭，不能只依赖 SQL rollback。

## 7. 客户端与协议硬切换

所有自有客户端在同一发布中更新 contract：Web、Electron 内嵌 UI、移动端、browser extension、TUI、MCP bridge、agent-stream-client、extension-ui-sdk、内置 Telegram/微信/飞书等扩展。

目标接口示例：

```text
GET  /api/sessions/:conversationId
POST /api/sessions/:conversationId/inputs
POST /api/sessions/:conversationId/reset

{ conversationId, activeTranscriptId, agentId, parentConversationId, ... }
input: { expectedTranscriptId, clientMessageId, ... }
```

移除旧 `/api/sessions/resolve` 的多字段猜测行为；如确需从 transcript 找会话，提供命名明确的 transcript 查询，不能将 UUID 先当会话、失败再当 transcript。

UUID 语法错误返回明确 400；合法但未知 ID 返回 404；reset 过期的 expectedTranscriptId 返回 409，不转发至新段。授权仍按 principal/Agent/project/endpoint 关系校验，UUID 不是授权凭据。

实时协议版本递增，session 事件载荷和订阅主题只用 conversation ID。`run:<runId>` 保留。cursor 按新协议/数据 epoch 重新建立，客户端完整同步当前状态，不重播旧 schema 的 event payload。真正 voice/browser/device session ID 不做机械改名。

HTTP/WS bootstrap 暴露 contract/version；旧客户端收到明确升级错误而不是被隐式接受。自有客户端同步发布是上线条件。旧客户端若不能展示新错误仍允许连接失败，不为它新增响应翻译。

移动端不写旧数据→新数据迁移器。会话相关 cache/query key/MMKV namespace 切新版本，旧 pending run/草稿不读取；保留独立的凭据和偏好 namespace。离线旧消息禁止由旧版本稍后上传。用户可清理旧缓存或重装，但不要求重置服务端状态。

Web 同样不保留 key→UUID 的本地映射。升级前完成或保存草稿；升级后旧 hash 不解析为会话，从列表重新进入。不能把旧标签指向随机“默认会话”。

新增/变更 HTTP 路由必须同步更新 `lazy-bundles.ts`、mapping 测试并通过带认证的真实 Gateway 请求验证。

## 8. 正确性验收

### 8.1 COMMIT 前强制校验

1. `integrity_check` 与 `foreign_key_check` 通过；不能认为前者包含后者。
2. sessions/transcript owner 映射一一对应；route→conversation 唯一，无两个不同 owner 静默合并。
3. transcript ID、entry ID、顺序、role、正文、附件引用、创建时间不变。对允许变更的结构字段记录精确白名单差异。
4. 每条活跃 session 的 active transcript 归属正确；所有归档 transcript 可追溯，tombstone 不出现在活跃列表。
5. task/project/workflow/parent/环境/endpoint 的语义关系前后等价；父链无新增环。
6. 所有活跃等待项及队列引用可解析，列与 JSON 一致；expected transcript、revision、去重键、状态没有被错误重置。
7. FTS entry 覆盖率、内容摘要和代表性检索一致，返回目标可打开。
8. 分享数量、token、有效期、权限、transcript/cutoff 和内容摘要不变。
9. manifest 管理的可执行字段不再含旧 key；只在允许的不可变正文/历史审计中出现旧格式。
10. schema/identity contract 版本只在全部断言通过后写入，同一事务提交。

报告至少记录各域迁移数、未解析数、tombstone 数、route collision 数、摘要对比、耗时、备份位置、source/target 版本。日志不输出完整会话正文/凭据。

### 8.2 必须实现的测试矩阵

| 类别 | 场景 |
|---|---|
| 升级路径 | 空库、N-1、有真实历史数据的受支持旧版本跨版本升级、重复启动、新 schema 被旧 binary 拒绝 |
| 路由 | 四种 DM scope、identityLinks、多个 Agent/账号、大小写、群聊、thread、scope、CLI main、cron、workflow、subagent、heartbeat |
| 历史 | 多次 reset、删除后 retained transcript、fork、compaction、分享、搜索、项目配置与 worktree 路径 |
| 可恢复任务 | queued、suspended、审批/clarification/connection waits、任务 handoff、outbound pending、幂等 receipt、旧 expected transcript |
| JSON | 关系列与 JSON 同时存在、嵌套 typed ref、同名异义 sessionId、正文含旧 key 不变、未知 namespace |
| 并发 | 两个 route 首条消息只建一个会话、两个进程同时启动、旧 Gateway/CLI 未退出、维护时自动化触发 |
| 故障 | 备份前/中、每个转换阶段、FTS 替换、COMMIT 前/后 kill、磁盘不足、权限失败、health 超时 |
| 客户端 | 新 Web/移动端/扩展/TUI/MCP 实际续聊，旧协议拒绝，缓存不复活旧 key，凭据仍可登录 |
| 数据异常 | 失效弱引用、活跃强引用缺失、Agent 冲突、路由冲突、非 UUID transcript、父链环、损坏 JSON |
| 规模 | 大 transcript/FTS、长队列；测量维护时间、峰值 WAL/磁盘、备份耗时，避免全库 JSON 一次载入内存 |

数据不一致不能统一通过“跳过坏行”满足数量断言。对历史非 UUID transcript，如果确实存在，先单独设计其所有关联的转换；当前方案基于正常创建路径生成 UUID，不能无证据承诺任意损坏数据均自动修复。

E2E 至少在临时 state dir 起真实带认证 Gateway：读旧会话→迁移→UUID 读历史→发消息→reset→原 conversation 继续→过期 transcript 拒绝→渠道输入命中原会话→恢复等待任务→打开分享/FTS 结果。不得使用真实用户 DB 跑修改实验。

## 9. 回滚与失败恢复

| 失败位置 | 行为 |
|---|---|
| 备份未 ready | 不开始迁移，旧 DB 不变 |
| N 事务内失败/断电 | SQLite rollback/recovery；N 未写入；下次可重新迁移 |
| 更早版本 migration 已提交，N 失败 | 不能只启动旧 binary；整链恢复使用升级前一致性备份 |
| COMMIT 后、流量未开放 | 根据 DB 中的提交记录继续健康验证，不重复迁移；可恢复升级前 DB+旧 binary |
| 已开放流量且产生新写入 | 不自动恢复旧备份，避免丢失新数据；采用修复前进或显式离线恢复流程 |

回滚需要在全部进程停止后恢复数据库，与旧 binary/受影响配置版本配套；WAL/SHM 不能与恢复的 DB 混搭。保留失败 DB 用于诊断，文件替换和目录 fsync 通过持久 journal 防止回滚操作自身断电。

包安装不等于升级成功。updater 状态需等新版本 bootstrap health 回报 schema N、identity contract、新代码版本与业务 ready；迁移期间的 health 表示 maintenance，不作为成功。原有固定重启等待时间应支持迁移进度/更长 deadline，不能迁移中途被 supervisor 反复终止。

旧版本的 schema-too-new 检查对新启动有效，对已经打开 DB 的旧进程无效，不能代替第 5 节排空要求。

## 10. 实施分解与退出条件

1. **身份与引用清单：** 完成 migration manifest、来源判别、route 等价 fixture；逐个登记 generic/JSON/durable 和幂等键，无未确认的活跃消费者。
2. **目标领域/API：** 增加 branded IDs、显式 conversation context、路由事务仓库；删除从 ID 解析 Agent/用途的运行时调用。
3. **离线迁移：** runner TS hook、维护排他、备份报告、单事务转换、校验与恢复；完成各种旧版本 fixture。
4. **全端同步：** 合约、实时协议、Web/mobile/TUI/MCP/extension 更新；旧缓存停止读取，不新增兼容层。
5. **发布演练：** 用脱敏且保留关联拓扑的数据副本演练升级、真实 Gateway E2E、故障注入和回滚；核验 Electron/Docker/CLI 三种包。

发布门槛：所有映射/引用已覆盖；路由等价测试通过；故障不产生半迁移；旧进程确实排空；所有在用客户端和扩展同版本；新版本 smoke 完成前不开启渠道与队列。

明确禁止：直接将 createSession 改为 randomUUID 后依赖默认 Agent；全项目把 sessionId 替换成 conversationId；SQL 全文 REPLACE；长期保留 legacy resolver；以刷新/清空服务端历史代替迁移；把一次性 DB 升级误写成零停机承诺。

## 11. 本次调研验证与剩余证据

已完成：源码路径审计；隔离内存库 replay baseline→v177 并枚举最终 schema；Node v24.16.0 / node:sqlite 的合成事务探针，验证 UUID 主键更新、延迟 FK、列重命名、transcript UUID/正文保持、FTS 替换查询，以及注入异常后原 key/schema/FTS 一起回滚。

探针验证的是迁移机制，不是完整迁移实现。尚未运行目标 N 的端到端迁移，因为尚未编写该实现；未读取/修改用户实际 DB，因而没有实际数据规模、历史污染率或耗时结论。

实现前必须补齐的发布证据：generic JSON/第三方扩展的完整 manifest、实际旧数据取值分类、跨平台旧进程排他、幂等 composite key 消费者、原始渠道投递保障、大库空间/时长及打包产物测试。上述项目是明确的验收任务，不允许上线时以静默 fallback 代替。

## 12. 外部参考

- [Codex CLI](https://learn.chatgpt.com/docs/developer-commands?surface=cli)：会话恢复/分叉使用 UUID。
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)：Thread、Turn、Item 的分层与显式 thread 身份。
- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)：本地 `--session-id` 要求 UUID。
- [OpenClaw session schema](https://docs.openclaw.ai/reference/session-management-compaction/schema)：路由 key 与 transcript 身份分开。不同产品的 reset 语义不能直接套用到 xopc。
- [SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html)：列重命名及必要的表重建顺序。
- [SQLite PRAGMA](https://www.sqlite.org/pragma.html)：foreign_keys/defer_foreign_keys/foreign_key_check 的事务约束。
- [SQLite VACUUM](https://www.sqlite.org/lang_vacuum.html)、[WAL](https://www.sqlite.org/wal.html)：一致性备份、耐久性与 WAL 生命周期。
