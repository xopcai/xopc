# MCP

xopc 使用 pi 1.1.0 的公开 `createMcpExtension` 连接出站 MCP 服务。pi 负责连接、协议调用、工具注册、取消、重连、目录更新、资源读取和 OAuth；xopc 仅投影配置及已有的密钥引用，并管理 AgentSession 的生命周期。

## 在对话中连接

本地 owner Web Chat 可直接说：“连接这个 HTTP MCP 服务，查一下我的资料”，或“只连接，先不要读取数据”。系统检查服务后，按需提供安全 Token 输入页或原生 OAuth 授权入口。密钥只填在安全页面，不发送到聊天；授权完成后返回原会话继续原请求。

也可以要求查看、停用、重新启用或移除自定义连接。移除本地配置不等于撤销远端授权。明确的配置请求无需再次确认；保存、待重启生效和实际读取成功分别报告。服务地址中的 `localhost` 指 Gateway 所在主机。

当前对话入口支持 HTTP MCP；任意 stdio 包安装、原生移动端和其他渠道授权回流需要各自实现。验收范围及本地 OAuth 测试服务见[实施记录](https://github.com/xopcai/xopc/blob/main/docs/design/technical/conversation-configuration-implementation-2026-10-28.md)。

## 配置

在 `xopc.json` 的 `mcp.servers` 中配置服务，也可以在能力中心编辑自定义 MCP。启用的 Agent Plugin MCP 服务会自动加入，服务 ID 在插件详情中显示。

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/workspace"],
        "exposure": "codemode",
        "timeout": 60
      },
      "docs": {
        "type": "http",
        "url": "https://example.com/mcp",
        "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" },
        "exposure": "deferred",
        "description": "Search product documentation"
      }
    }
  }
}
```

`type` 可以省略，由 `command` 或 `url` 决定。`http` 和 `streamable-http` 均表示 Streamable HTTP。只支持 stdio 和 Streamable HTTP；不支持旧 HTTP+SSE。服务名只允许字母、数字、下划线和连字符；`a-b` 与 `a_b` 会发生冲突。

使用 pi 原生字段：`command`、`args`、`env`、`cwd`、`url`、`headers`、`oauth`、`auth.provider`、`timeout`、`enabled`、`description`、`exposure`、`toolExposure`。`timeout` 单位为秒，默认为 60，进度通知会重置超时。环境变量和命令表达式的解析由 pi 完成。受信任的主机配置可以使用 pi 支持的 `!command` 值。

## 工具发现与调用

工具名称为 `mcp__<server>__<tool>`，同名冲突处理由 pi 负责。

| exposure | 行为 |
| --- | --- |
| `codemode`，默认 | 工具不直接声明给模型；脚本通过 `searchTools()`、`describeTool()` 等发现并调用 |
| `deferred` | `tool_search` 搜索并加载后，模型可以直接调用 |
| `direct` | 工具直接声明给模型，也能在脚本中调用 |
| `hidden` | 工具不可调用 |

`toolExposure` 使用原始服务工具名或包含 `*` 的模式覆盖个别工具。默认不会把全部 MCP 工具 schema 放进上下文。服务摘要由 pi 注入，连接后按需要等待和发现工具。

MCP 配置有 `codemode` 工具时会启用脚本能力；Agent 的 Codemode 开关控制额外的本地读取试点。xopc 保留脚本预算、业务工具权限和审计。MCP 的可见性由原生 exposure 控制，普通 Agent 策略可以使用完整的原生工具名。

pi 的 MCP 脚本结果是 MCP 响应封装，结构化数据位于 `.structuredContent`：

```javascript
const result = await tools.mcp__docs__lookup({ query: "installation" });
text(result.structuredContent);
```

资源通过 pi 的 `list_mcp_resources`、`list_mcp_resource_templates`、`read_mcp_resource` 工具使用。xopc 不再提供独立的 Web 资源浏览与 `@MCP` 附件。

xopc 的本地 Device、Extension、Memory 工具也使用 pi 工具注册和发现。设备绑定、用户确认与设备调用审计仍属于 xopc 业务层。CLI、Composio 的业务连接流程保留。

能力中心 → 连接器 → 自定义集成中，已保存的 MCP 服务可点击「查看工具」探测工具，支持刷新、按名称或描述搜索，以及展开参数 schema。探测使用短生命周期的 pi 原生会话，不发起模型请求；连接失败或需要授权时会显示诊断信息。

## OAuth 与诊断

在运行 Gateway 的主机上执行：

```bash
xopc mcp list
xopc mcp login docs
xopc mcp logout docs
```

这些命令直接调用 pi 的公开 CLI 入口，不维护另一套 OAuth 客户端。HTTP 服务未设置 Authorization header 时，pi 在收到 401 后使用 OAuth。固定客户端配置使用 `oauth`：

```json
{
  "url": "https://example.com/mcp",
  "oauth": { "clientId": "registered-client", "callbackPort": 8765 }
}
```

默认 pi 状态目录为 `~/.xopc/pi`，遵循 `XOPC_STATE_DIR`；可以用专属于 xopc 的 `PI_CODING_AGENT_DIR` 覆盖。OAuth 凭据由 pi 保存在 `mcp-auth.json`，日志为 `mcp.log`。

CLI 会在该目录写入权限为 0600 的 `mcp.json` 配置投影；它可能包含解析后的密钥，仅用于原生 CLI，不是第二个配置来源。请通过 xopc 配置编辑服务。CLI 不覆盖用户自行维护的 pi `mcp.json`。运行中的会话会在下次调用使用 pi 的新凭据。

Web 自定义连接采用「输入地址 → 检查 → 按需授权 → 验证工具」流程，自动生成服务器名称。检查到 OAuth 元数据后可点击「登录并连接」，授权成功会自动验证工具；只有返回 401 而未提供 OAuth 元数据的服务会提示填写 Token。Client ID、Headers、超时和工具使用方式收在高级设置，也支持粘贴单个服务器配置或 `mcpServers` JSON（多个服务可选择其中一个）。本地命令支持带引号的参数或 JSON 参数数组。

Web 授权通过原生 pi MCP 扩展完成，凭据与 CLI 共用。浏览器和 Gateway 不在同一机器时，可以在「已授权，但连接仍在等待？」中粘贴完整回调地址；原生 pi 校验 state、交换令牌并保存凭据。关闭连接窗口会取消等待中的授权。插件卸载不会自动清除 pi 凭据；需要时先执行 `xopc mcp logout <插件服务ID>`。从管理页单独发起的配置不会自动恢复先前的聊天任务；从对话发起的受支持流程会绑定并恢复原目标。

## 不兼容变更

以下旧配置和功能已删除，不提供运行时兼容：

- `transport`、`workingDirectory`、`connectionTimeoutMs`、`requestTimeoutMs`、`auth.type=oauth`、`sessionIdleTtlMs`。
- `runtime.toolDiscovery` 试点开关；MCP 始终使用原生发现，按服务 exposure 控制。
- `mcp:<server>:<tool>` 策略别名，以及 MCP 经 `xopc_tool_*` 网关调用的路径。使用原生工具名。
- 旧版独立 Gateway MCP 运行时及能力探测、MCP Prompts 管理和 MCP 专属只读认证/严格结果 schema 校验。
- 旧 OAuth 凭据格式。原文件不会被自动删除，需要在 pi 中重新登录。

旧 `/sse` 端点不会自动转换为 `/mcp`，必须使用服务实际提供的 Streamable HTTP 地址。原生 MCP 工具会随会话重新注册，冷启动后 deferred 工具需要重新搜索。旧聊天记录的资源附件仍可显示，但不能作为新输入重新发送。

## 入站 MCP

Gateway 可通过 stdio 向 Codex 等本机 MCP 客户端提供项目、任务、笔记和自动化工具。Gateway 需要已运行，并可从同一主机的 `127.0.0.1` 访问。连接授权覆盖整个个人工作区，可用精确能力 ID 限制工具。

```sh
xopc mcp grant                 # 只读
xopc mcp grant --write         # 读写
xopc mcp grant --allow-capability xopc.notes.list xopc.notes.get
```

授权命令返回 JSON，包含 `connectionId` 和只在创建时返回的 `token`。将 token 通过环境变量 `XOPC_MCP_TOKEN` 传给客户端启动的 stdio 进程。以下是 Codex `config.toml` 的配置示例。

```toml
[mcp_servers.xopc]
command = "xopc"
args = ["mcp", "serve", "--stdio"]
env_vars = ["XOPC_MCP_TOKEN"]
```

`xopc` 需位于客户端的 PATH 中，也可填写其绝对路径。如果 Gateway 用 `--port` 覆盖配置端口，在 args 中追加 `"--port", "<port>"`。用 `xopc mcp revoke <connectionId>` 撤销单个连接，下一次发现或调用即时生效。

| 领域 | 读取 | 写入 |
| --- | --- | --- |
| 项目 | 列表、详情、里程碑、进展 | 创建、更新、置顶、创建和更新里程碑、记录进展 |
| 任务 | 列表、详情、运行历史和结果摘要 | 捕获任务、更新元数据、排序、更新依赖 |
| 笔记 | 列表、全文、历史、快照、项目汇总 | 创建、快速捕获、追加、更新、从快照恢复 |
| 自动化 | 列表、详情、运行状态和历史 |  |
| 工作区 | 一次搜索项目、任务和笔记 |  |
| Agent 委派 | 可用 Agent、运行状态、游标事件、最终答复和发布产物 | 带引用或回调的委派、追加指令、回答澄清、取消 |

MCP 工具名使用下划线，例如 `xopc_notes_get`。CLI 授权使用带点的能力 ID，例如 `xopc.notes.get`。写工具要求调用方提供 `idempotencyKey`。遇到结果不明时，使用相同参数和同一个 key 重试。更新类操作按工具契约提供当前版本。任务创建支持 backlog 和 ready，执行权限需单独设计。

### 远程 Streamable HTTP 和 OAuth

在 `xopc.json` 设置 `gateway.mcp` 后，Gateway 会提供 `/mcp` 和 `/.well-known/oauth-protected-resource/mcp`。远程入口和 stdio 共用 42 个工具，包括 23 个读工具和 19 个写工具。默认授予整个个人工作区的读取权限。

```json
{
  "gateway": {
    "mcp": {
      "resource": "https://gateway.example.com/mcp",
      "issuer": "https://login.example.com/",
      "jwksUrl": "https://login.example.com/.well-known/jwks.json"
    }
  }
}
```

- 配置外部 OAuth 授权服务器，使用 Authorization Code + PKCE S256，并为 Codex 预注册客户端及其实际 loopback 回调。授权服务器根据客户端请求，用 `mcp.read` 和可选的 `mcp.write` scope 签发 [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068.html) JWT access token，令牌的 `aud` 包含完整的 Gateway resource URL，`iss` 与配置完全一致。Gateway 用 `sub` 与 `client_id` 绑定本地连接。
- 对外使用 HTTPS。反向代理保留 canonical `Host`、`Authorization`、MCP 协议头和 `WWW-Authenticate`。代理与 Gateway 同机时可用 loopback 回源。跨主机 HTTP 回源需要在 `gateway.trustedProxies` 配置实际代理地址。纯 HTTP resource 仅适用于本机 loopback 验证。
- OAuth 登录和 Gateway 数据授权各自独立。先从签发方确认该用户的 `sub` 和注册应用的 `client_id`，在运行 Gateway 的主机上建立授权。数据范围为整个个人工作区。写入需要 Gateway 授予 `--write`，且 OAuth access token 同时包含 `mcp.read` 和 `mcp.write`。

```sh
xopc mcp remote grant --subject '<oauth-sub>' --client-id '<registered-client-id>'
xopc mcp remote list
xopc mcp remote revoke '<connection-id>'
```

需要写入时，在 `grant` 追加 `--write`。如果已有该客户端的只读授权，先撤销该授权，再签发读写授权。可在 `grant` 追加例如 `--allow-capability xopc.projects.list xopc.projects.get`。同一资源、issuer、subject 和 client ID 同时只有一个有效授权。撤销后，现有客户端的下一次请求立即被 Gateway 拒绝，即使 access token 仍在有效期内。

```sh
codex mcp add xopc-remote --url https://gateway.example.com/mcp --oauth-client-id '<registered-client-id>'
codex mcp login xopc-remote --scopes mcp.read
# For a read/write grant
codex mcp login xopc-remote --scopes mcp.read,mcp.write
```

如果 `codex mcp add` 已取得所需 scope，可直接调用工具。已有授权按签发时的工具清单生效。使用新增工具时，重新签发对应连接授权。两种传输的写工具都要求同一写入意图使用稳定的 `idempotencyKey`。登录、续期和 token 签发由外部授权服务器与客户端处理。Gateway 支持 `2025-11-25` 兼容模式和 `2026-07-28` 无状态请求。

### Agent 委派

1. 调用 `xopc_agent_runs_agents` 查看可用 Agent 和工作区默认 Agent。
2. 用 `xopc_agent_runs_start` 传入 `title`、`prompt` 和稳定的 `idempotencyKey`。可选 `agentId` 和 `projectId`。省略 Agent 时使用项目的默认 Agent，或工作区默认 Agent。可用 `references: [{kind, id}]` 引用至多 8 个现有项目、任务、笔记或工作区文件，类型分别为 `project`、`task`、`note`、`file`。Gateway 保存引用，并在任务简报里附上标识、标题和适用的短摘录。提交返回 `taskId`、`runId` 和排队回执，Gateway 在后台执行。
3. 用 `xopc_agent_runs_get({runId})` 查询当前状态。运行有终态回执时返回 `result`，包含摘要、核验状态和适用的后续行动。
4. 用 `xopc_agent_runs_steer({runId, message, idempotencyKey})` 给正在执行的 Agent 补充或调整指令。返回 `inputId` 表示 Gateway 已受理。用 `xopc_agent_runs_get({runId, steerInputId: inputId})` 查询 `pending`、`delivered` 或 `interrupted`。消息绑定当时的执行轮次。轮次先结束时，消息会标记为中断。
5. 用 `xopc_agent_runs_cancel({runId, idempotencyKey})` 取消。Gateway 先保存取消结果，再通知本机正在执行的 Agent 停止。`executionStopConfirmed: false` 表示取消回执只确认了任务终态。
6. 用 `xopc_agent_runs_events({runId, afterSequence, waitMs})` 增量读取运行事件。首次从 `0` 开始，后续传回 `nextSequence`。可等待至多 10 秒。MCP 连接中断后可以从上次游标继续。
7. `get` 返回 `clarification` 时，调用 `xopc_agent_runs_respond` 并传入 `runId`、`clarificationId`、`expectedVersion` 和 `idempotencyKey`。单题传 `response: {text}` 或 `response: {choiceId}`，多题按返回的题目 ID 传 `schemaVersion: 2` 和 `answers`。答复排入原运行继续执行。审批和设备确认仍由 Gateway 的原交互入口处理。
8. 用 `xopc_agent_runs_result({runId})` 获取最终答复、回执和已发布产物。按 `nextTextOffset` 和 `nextArtifactOffset` 独立翻页。历史运行可能只有 `receipt_summary`。对 `canRead: true` 的产物，调用 `xopc_agent_runs_artifact_read({runId, artifactId})` 获取 Base64 字节。逐页传 `nextOffset` 和首次返回的 `revision`，参数分别为 `offset` 与 `expectedRevision`。结果可包含工作区文件标识 `workspaceFileId`，可在新委派中作为文件引用。

委派使用已配置的 xopc Agent 和该 Agent 的有效工具策略。项目与任务数据的授权覆盖整个个人工作区。通过原连接操作自己提交的委派。远程提交、追加指令、回答澄清和取消都需要读写授权及 OAuth 写权限。提交结果不明时用原参数和原 key 重试。现有连接只包含签发时的工具，如需使用新增工具，可签发新的连接。新连接的运行归属独立，已有运行仍通过原连接访问。

#### 委派回调

在 Gateway 配置 `gateway.mcpCallback.url` 为接收方 HTTPS 地址，`gateway.mcpCallback.secretEnv` 指向 Gateway 进程中的签名密钥环境变量。提交时传 `callback: true` 为该运行启用回调。

Gateway 在运行等待输入、成功、失败或取消时 POST 事件。请求体包含 `eventId`、`runId`、`type`、`sequence` 和毫秒时间戳 `occurredAt`。接收方使用 `X-Xopc-Timestamp`（Unix 秒）、原始请求体和签名密钥核验 `X-Xopc-Signature`。签名格式为 `sha256=<hex>`，签名输入为 `<timestamp>.<raw request body>`。以 `X-Xopc-Event-Id` 去重，并返回 2xx 确认。Gateway 持久化投递进度，对每个事件最多尝试 5 次。接收方也可以通过 `events` 和 `result` 核对状态和结果。

参考：[pi 原生 MCP 文档](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/mcp.md)。

微信私聊可发起绑定原目标的安全配置请求。需要独立账号私聊路由、明确批准的发送者，以及手机可访问的 HTTPS Gateway 地址。owner 在安全页核准具体服务与私聊身份后，再填写 Token 或授权；结果自动发回原微信会话。此入口不授予通用管理权限，范围与验收状态见[微信对话配置记录](https://github.com/xopcai/xopc/blob/main/docs/design/technical/weixin-conversation-configuration-2026-10-28.md)。
