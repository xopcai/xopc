# MCP

xopc 使用 pi 1.1.0 的公开 `createMcpExtension` 连接出站 MCP 服务。pi 负责连接、协议调用、工具注册、取消、重连、目录更新、资源读取和 OAuth；xopc 仅投影配置及已有的密钥引用，并管理 AgentSession 的生命周期。

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

Web、移动端 OAuth 弹窗、远程回调粘贴和自动恢复原任务的 MCP 连接流程已移除。需要浏览器登录的服务在 Gateway 主机完成授权。插件静态密钥仍能在 Web 配置。插件卸载不会自动清除 pi 凭据；需要时先执行 `xopc mcp logout <插件服务ID>`。

## 不兼容变更

以下旧配置和功能已删除，不提供运行时兼容：

- `transport`、`workingDirectory`、`connectionTimeoutMs`、`requestTimeoutMs`、`auth.type=oauth`、`sessionIdleTtlMs`。
- `runtime.toolDiscovery` 试点开关；MCP 始终使用原生发现，按服务 exposure 控制。
- `mcp:<server>:<tool>` 策略别名，以及 MCP 经 `xopc_tool_*` 网关调用的路径。使用原生工具名。
- 独立 Gateway MCP 能力探测、MCP Prompts 管理和 MCP 专属只读认证/严格结果 schema 校验。
- 旧 OAuth 凭据格式。原文件不会被自动删除，需要在 pi 中重新登录。

旧 `/sse` 端点不会自动转换为 `/mcp`，必须使用服务实际提供的 Streamable HTTP 地址。原生 MCP 工具会随会话重新注册，冷启动后 deferred 工具需要重新搜索。旧聊天记录的资源附件仍可显示，但不能作为新输入重新发送。

## 入站 MCP

`xopc mcp capabilities --allow-capability <精确ID...>` 仍使用官方 MCP SDK 将明确允许的 Gateway 能力暴露给外部客户端。出站 pi 客户端的替换不影响这个入站服务。

参考：[pi 原生 MCP 文档](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/mcp.md)。
