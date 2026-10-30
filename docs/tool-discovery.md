# Tool discovery

模型侧统一使用 `tool_search({ query, limit? })`。它聚合 pi 工具目录与外部连接器目录，但不授予权限，也不执行业务操作。默认 limit 为 8，上限为 20；query 最长 2000 字符。两种目录各自排序并预留结果配额，不比较不同算法的分数。limit 限制新加载工具与外部工具引用的总数。

## 搜索结果与执行

| 结果 | 后续动作 |
| --- | --- |
| `loadedTools` | 已激活，下一次模型请求包含 schema，按具体工具名调用 |
| `alreadyLoaded` | 已声明的匹配工具，可直接调用 |
| `externalTools` | CLI / Composio 的工具引用，调用 `xopc_tool_describe` 获取精确契约，再用 `xopc_tool_execute` 执行 |
| `connectionCandidates` / `installCandidates` | 恢复候选，不是执行资格；核实确实需要授权、安装或选择账号后使用 `xopc_require_connection` |
| `sourceErrors` / `unavailableSources` | 某个目录查询失败，不代表能力不存在或账号未连接 |
| `scope` | 本次是否检查原生目录和连接器目录，以及执行身份的范围限制 |

命中外部工具后，主机同时激活允许的 describe / execute 入口，不需要再搜索一次。CLI / Composio 暂不注册为具体的原生工具，不通过 Codemode 执行。旧 `xopc_tool_search` 仅在底层网关工厂保留为隐藏兼容适配器，普通 Agent 工厂不再注册或向模型声明它。旧白名单中的搜索权限可映射到新入口，显式 deny 保留。

Device、Extension、Memory 的主机契约被适配为 pi ToolDefinition，默认 deferred。它们由 pi 目录发现，连接器搜索不会重复查询这些原生来源。执行仍验证业务身份、契约与权限。

MCP 服务由 `mcp.servers` 与启用的 Agent Plugin 配置投影到 pi，不读取第二份项目配置。pi 异步连接并处理工具列表更新、资源和协议调用。默认 exposure 为 codemode；也可以选择 deferred、direct、hidden，并用 toolExposure 控制单个工具。统一搜索保留 pi 的 `reachesTools` 与 MCP 调用前等待机制。

## 授权、账号与契约

搜索返回摘要，不返回凭据。`xopc_tool_describe` 返回精确 schema 与 revision；`xopc_tool_execute` 重新读取契约、比较 revision、校验参数，再由 Provider 检查账号权限、scope 和操作审批。搜索后撤权、契约变化或审批失效均不能继续执行。写操作结果不确定时沿用 Provider 的处理，不自动重试。

Personal worker 的账号范围由主机传入 Provider 的 search / describe，CLI 使用选定账号读取实际契约，不回退到其他账号。CLI revision 同时绑定账号、连接及契约摘要；异步 schema 读取后和最终启动操作前均重新检查主机授权。

授权与账号选择继续由现有连接目标流程负责，保存原任务与进度，完成后自动恢复。恢复时重新发现和读取契约，不将旧 revision 当作当前授权。

每个连接器来源的搜索等待上限为 4 秒；聚合连接器目录（含商店查询）的等待上限为 8 秒。一个来源失败或超时仍保留其他来源的结果；调用取消时停止等待。底层 Provider 暂无通用取消接口，超时不保证终止已经发出的只读目录请求。

## Personal worker 边界

个人主会话不开放工具发现。Personal request worker 可使用同名 `tool_search`，但原生目录发现、原生 MCP、外部工具原生化与 Codemode 仍关闭。

worker 的 search 与 describe 根据持久化请求过滤：只暴露指定连接器、选定账号和主机确认的只读契约；不返回其他账号目录、通用安装候选或其他应用的授权候选。schema 将 `xopcAccountId` 限定为选定账号。执行路径保留更严格的请求身份、账号与只读校验，异步契约读取后也重新检查授权。每次执行捕获 worker 的执行会话、TaskRun、assignmentEpoch 与 transcript，并在最终发出操作前与当前状态比较；替换后又启用原会话也不能恢复旧调用的资格。取消、结束、失去执行身份的 worker 不得继续发现或读取契约。

历史任务在读取 requiredTools 时将 `xopc_tool_search` 转为 `tool_search`，继续执行现有白名单与 deny 检查；不修改历史数据库记录，也不重新开放旧模型入口。

Personal worker 必须具有 Provider 明确给出的 `readOnly: true` 分类，`batchRead` 仅表示批处理资格。本地 batch 配置不能覆盖已知写操作的分类；发现与执行均重复检查，分类也参与契约 revision。

worker 需要重连时使用 `personal_request_connection`，授权留在主会话；不会因统一搜索开放 `xopc_require_connection` 或其他目录。

## 生命周期

每个 pooled AgentSession 安装一个原生 MCP 扩展。会话重置、配置变更、退出和 TTL 淘汰先取消当前工作，发送公开的 session_shutdown 事件并清理扩展。Gateway 退出会等待清理完成。

Device 连接/绑定变更仍使主机会话失效，以避免使用旧设备契约。MCP 列表刷新和重连遵循 pi 原生行为。

本地 deferred 工具（包括搜索时激活的 describe / execute）按契约恢复载入状态。MCP 工具冷启动后重新注册并搜索。搜索串行执行，避免并发激活覆盖；授权和契约校验始终在执行时再次进行。

脚本使用 pi QuickJS 执行器，xopc 保留嵌套调用审计和脚本资源预算。MCP 的可见性和结构化结果遵循 pi；Device 输出校验继续生效。管理行为见 [MCP](./cli/mcp.md)。
