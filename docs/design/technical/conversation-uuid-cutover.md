# 会话 UUID：实现与升级约定

更新：2026-09-16。数据库切换版本：178。本文记录本次实现；验证结果见文末。

## 1. 身份、路由、记录段

一个会话有一个稳定的 UUIDv4 `conversationId`。Agent、渠道、账号、peer、thread、scope 是元数据和路由条件，不再编码到会话身份中。

`transcriptId` 标识一段 transcript。沿用历史 `sessionId` 的原值。reset 保持 conversation ID 不变，归档当前 transcript 并生成新 transcript ID；fork 创建新 conversation ID。旧的 transcript ID 不做重新编号。边界保留安全的历史 opaque token，新建 transcript 仍生成 UUID，不因身份切换强制历史 token 满足 UUID 格式。

| 概念 | 存储 / 代码 |
|---|---|
| 稳定会话身份 | `sessions.conversation_id` |
| 当前记录段 | `sessions.active_transcript_id` |
| 历史记录段 | `transcripts.transcript_id`、`transcripts.conversation_id` |
| 身份生成、存在性检查 | `src/storage/sqlite/conversation-repository.ts` |
| 路由等价规则 | `src/routing/conversation-route.ts` |
| 外部路由→会话 | `conversation_routes(route_key, conversation_id)` |
| 边界 ID 校验 | `packages/gateway-contract/src/conversation-identity.ts` |

领域操作、协议消息和请求字段使用 `conversationId` / `transcriptId`。现有列表和 metadata 对象的通用 `key` 字段保留，值只允许表示同一个 conversation UUID；它不支持旧路由 key，也没有第二份身份或兼容解析。保留 `sessions` 表名、`/api/sessions` 资源名与这一通用列表字段，避免把此次身份解耦扩大为全产品命名重构。这是相对于初稿“连通用 key 字段也移除”的收敛。

pi 的 `SessionManager.sessionId`、模型提供方协议的 `sessionId`、浏览器登录 session、设备授权 session、语音连接 session，以及不可变分享 manifest 自身的字段，保留各自协议的语义，不做同名字符串的无差别替换。

## 2. 路由与创建规则

路由查找键是八个明确字段组成的 JSON tuple：Agent、scope、channel、account、peer kind、peer、thread、业务 scope。不会暴露为 conversation ID。唯一键和 SQLite 写事务保证同一路由复用同一会话。

保留原有四种 DM scope、identityLinks、小写规范化，以及群聊不按 account 分桶的等价规则。Telegram 保留其原实现实际采用的 per-account-channel-peer 行为；不在身份切换中顺便改变聊天合并策略。发送使用明确的路由元数据，不从 UUID 反推平台地址。

手工新聊天、TUI 新聊天和 fork 显式创建新 UUID。Agent 归属在创建时写入，后续 metadata patch 不允许将已有会话改归其他 Agent。查询不存在的会话报错，不猜默认 Agent，也不因为客户端收到 404 而自动重建会话。

路由解析会先建立会话，因此调用方后续初始化必须显式写入项目、来源、隐藏状态等业务元数据，不能再以“会话是否已存在”为判断条件。任务会话、后台项目理解和 SessionStore 保存路径已按此调整。

## 3. 一次性数据库升级

沿用现有 migration runner，在 `178_conversation_uuid.sql` 的同一事务中调用专用 TypeScript 数据迁移；没有增加通用升级调度框架。

1. 文件数据库进入切换前检查其他进程的打开句柄，要求旧 Gateway/CLI 已退出。
2. `VACUUM INTO` 创建权限为 0600 的一致性备份，验证备份 `integrity_check` 并 fsync。
3. 执行版本 178 的 `BEGIN IMMEDIATE`，延迟外键检查。
4. 从 sessions 和 transcripts owner 的并集建立事务临时 `old_key → UUID` 映射。
5. 按旧 key 的历史形态重建路由等价关系；不使用当前配置重新解释历史 scope。
6. 替换结构化引用和登记的控制 JSON，补齐可明确恢复的路由元数据，重命名 conversation / transcript 字段。
7. 重建 transcript FTS，保留内容、entry ID、transcript ID 和 FTS rowid，核对条目数。
8. 校验外键和当前 transcript 归属；删除临时映射，与 schema version 一起提交。

再次启动看到版本 178 即不再迁移。不保留旧 key alias 表、双写字段或运行时旧 ID resolver。旧格式解码器仅存在于升级迁移模块。

旧于 177 的数据库先备份，然后按现有逐版本事务升级，再执行 178。不能把整个历史升级链称为一个事务。

历史上已删除 sessions 但仍保留的 transcripts 获得一致的历史 owner UUID，不重建可见会话。此次没有引入 tombstone，也没有改造既有删除生命周期。

遇到缺失强引用、未登记的 session_key 列、路由冲突、Agent 冲突或无法解析的数据，迁移报错并回滚 178 的事务，不丢弃记录或猜测默认值。报告与备份放在数据库旁，包含版本、结果和迁移数量。

### 引用覆盖

- sessions / transcripts / session_config / inputs / runtime / connection 与 clarification waits。
- task sessions、runs、active conversation state、handoff；workflow、automation、work discovery。
- endpoint、browser tab、execution environment 绑定与 interaction、proactive follow-up。
- context snapshots / evidence / extraction source refs / execution context runs。
- knowledge session scope、source conversation、项目会话摘要复合查找键。
- object links、activity、outbox、command deduplication 的带类型引用。
- 登记的 JSON 控制字段、outbound / agent IPC 待发送消息。
- durable shares、hosted share bindings、command receipts、workflow drafts / definitions / revisions。

迁移只改结构和控制引用。正文、prompt、messages、工具 arguments、transcriptRows 不做全文替换。命令日志的现有绝对路径继续引用原文件；不为改变路径中的旧哈希搬动历史文件。

分享 token、快照内容、transcript/cutoff、公开 URL 和已发布 manifest 保留。更新的是可变分享管理记录中的会话引用。

## 4. 配置与客户端

heartbeat 的 `targetChatId` 历史上允许填写长会话 ID。现有 bootstrap migration 将 Telegram / Weixin 这类配置转换为渠道原生地址，备份原配置后原子替换；不把未提交的 UUID 写入配置。因此数据库回滚时，新配置仍适用于原渠道。渠道与旧路由不一致则阻止启动。

Web、Electron、TUI、MCP、渠道扩展、评测适配器和移动端同步使用新字段。Realtime 消息协议升为 2，浏览器扩展协议升为 5；WebSocket URL 仍使用现有 `/api/realtime/v1/ws`，消息协议版本单独校验。

移动端不迁移旧缓存和草稿：query cache / composer draft 使用新命名空间。Web 的相关持久缓存也换新命名空间。凭据不属于会话缓存，不因此清除。

旧客户端、书签与长 key 深链不做适配。所有在用客户端及扩展随服务端升级。Web 侧栏缺资料时重新获取服务端 metadata；Agent、来源和空会话复用资格均读取显式元数据。

## 5. 失败恢复与发布边界

- 备份或进程检查失败时不开始数据转换。
- 178 提交前失败：SQLite 回滚，旧数据和版本保留，可修复原因后重试。
- 178 已提交：再次启动沿用已提交 UUID，不重复生成。
- 若已产生新数据，不自动恢复旧备份，避免抹掉升级后的写入。
- 如需恢复旧版本，应先停止所有进程，保留失败现场，使用升级前一致性备份和匹配的旧程序；不能混用旧 DB 与新 WAL/SHM。

进程检查在 macOS 使用系统 `lsof`，Linux 使用 `/proc` 的同用户打开句柄，Windows 使用系统 Restart Manager 枚举文件占用进程（不停止进程）。无法验证句柄的环境会明确失败。本次在 macOS 验证，Linux / Windows 仍需对应平台升级演练。检查不替代部署时停止旧程序，也不保证升级期间人为启动旧程序的行为。

升级会有短暂停机。大型数据库的备份、FTS 重建时间和磁盘空间依实际数据决定；后续修复已使用用户授权的本地数据库一致性副本完成演练，原库未执行迁移；尚未进行大型数据库耗时评估。

## 6. 分阶段自审记录

1. **身份与路由：** 分离稳定 ID 和路由 tuple；复核 DM scope、identityLinks、账号、群组、thread 与 reset。修复 Telegram 双次解析导致的多余会话创建。
2. **存储升级：** UUID 映射、列与 JSON 引用、FTS、备份和 rollback；补充 historical owner、分享、receipt、项目摘要及配置目标转换。
3. **运行时与客户端：** 更新全端字段；修复路由预创建后元数据被跳过、TUI `/new` 旧前缀、前端隐式 Agent 推断、工作流会话跳转等问题。
4. **验证：** 隔离临时库测试重复升级、事务回滚、历史内容与 FTS；真实 HTTP 鉴权创建；真实 Gateway 与本地模拟模型端到端调用；全量回归、移动端测试、类型检查及生产构建。

本次验证结果：

- 根目录全量回归：6,765 项通过、1 项失败、3 项跳过。唯一失败是仍把历史 transcript token 限制为 UUID 的旧断言；修正为验证 conversation ID 后，身份与路由相关 11 项定向重测全部通过。未为此再次重复全量运行。
- 移动端：876 项测试通过；服务端、Web、移动端、Gateway contract、浏览器扩展类型检查通过；lint 通过并清理此次产生的未使用导入。
- `pnpm run build` 通过，Electron main/preload 与打包 Gateway 构建通过。Web 仍有 chunk 大小和动态导入的非阻断构建提示。
- 使用最终 `dist` 产物在临时 v177 数据库完成 v178 升级、路由复用、reset、重启和备份唯一性验证；另用真实子进程验证数据库占用时阻止升级，退出后允许备份。

未执行生产数据库迁移、正式发布或真实 iOS/Android 安装升级。

## 7. 设计参考

前期调研关注的是把会话身份与执行、路由分开的做法，而非复制其他产品的 reset 语义：

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)：Thread、Turn、Item 的分层。
- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)：UUID session ID。
- [OpenClaw session schema](https://docs.openclaw.ai/reference/session-management-compaction/schema)：routing key 和 transcript 身份。
- [SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html)、[PRAGMA](https://www.sqlite.org/pragma.html)、[VACUUM](https://www.sqlite.org/lang_vacuum.html)：列变更、事务完整性与一致性备份。

Windows 占用检测接口：[Microsoft Restart Manager](https://learn.microsoft.com/en-us/windows/win32/api/restartmanager/nf-restartmanager-rmgetlist)。

## 8. 本地历史数据迁移修复（2026-09-16）

首次真实启动暴露了此前合成测试遗漏的两个问题：

- workflow 子会话的 key 前缀保存 profile Agent（如 `main`），而旧版 `agent_id` / routing.agentId 可能保存步骤角色（如 `agent-1`）。一次性解码器只针对这一已知格式恢复 profile 归属，保留独立的 `workflow_agent_id`、run ID 和消息；其他无法解释的归属冲突仍回滚。
- 直接遍历 SQLite 查询游标并改写索引字段，可能再次遍历到更新后的行。迁移现在先固定结果集再更新，避免重复转换。新增测试固定目标 UUID 的索引排序，覆盖这一问题。

经授权，对本地 v177 数据库创建只读来源的一致性副本，验证结果：

- 201 张原有逻辑表记录数一致；25 个会话、25 个 transcript、352 条 transcript 记录、174 条 FTS 记录全部保留。
- transcript 记录逐字段一致；transcript ID、内容和 FTS rowid 保留，仅转换所属会话引用。
- SQLite integrity_check / foreign_key_check 通过，重复迁移不改变结果；源码和最终 Node 构建产物均完成同样的副本验证。
- 用户原库的 sessions、transcripts、transcript_entries 与此次失败前自动备份逐行一致，确认失败事务没有丢失这些数据。
- 在另一份副本上通过生产数据库打开路径迁移，并经本机鉴权 HTTP 接口读取全部 25 个历史会话，返回的 transcript 行数全部匹配。
- 新增历史 workflow 角色、索引遍历和异常归属回滚回归；相关 19 项测试、服务端类型检查和针对修改文件的 lint 通过。

这些验证未迁移或覆盖用户原库，未把真实数据加入仓库。运行时没有增加旧 ID 兼容或忽略错误后继续运行的逻辑。

## 9. 跨实例导入来源修复

历史导入会话的 `importedFromSessionKey` 及随导出复制的 `forkedFromSessionKey` 属于来源信息，不能一概要求在本地 sessions / transcripts 中存在。迁移时能解析的来源转换为 `importedFromConversationId` / `forkedFromConversationId`；外部来源原值保存在 `importedFromExternalConversationRef` / `forkedFromExternalConversationRef`，不创建虚构会话，也不将长 key 写入 UUID 字段。消息内容和 transcript ID 保持不变。父会话等强引用仍严格校验并在缺失时回滚。

回归覆盖外部导入及 fork 来源、本地来源映射、重复升级、消息保留，以及缺失强引用时的事务回滚。变更仅在一次性迁移中解释旧字段，没有增加运行时旧 ID 兼容。
