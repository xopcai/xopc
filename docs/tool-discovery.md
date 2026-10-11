# Tool discovery

xopc 使用 pi 1.1.0 的工具注册、ToolSearch 和 Codemode。MCP 由公开 `createMcpExtension` 完整接管，已删除自建客户端、传输、OAuth 和目录运行时。

## 注册与上下文

Device、Extension、Memory 的主机契约被适配为 pi ToolDefinition。默认 deferred，搜索后才向模型声明；设备绑定和权限验证保留在执行适配器中。CLI 和 Composio 继续使用其业务连接网关。

MCP 服务由 `mcp.servers` 与启用的 Agent Plugin 配置投影到 pi，不读取第二份项目配置。pi 异步连接并处理工具列表更新、资源和协议调用。默认 exposure 为 codemode；也可以选择 deferred、direct、hidden，并用 toolExposure 控制单个工具。

| 入口 | 发现 | 执行 |
| --- | --- | --- |
| MCP deferred | 原生 tool_search | 原生工具直接调用 |
| MCP codemode | searchTools / describeTool / ALL_TOOLS | 原生 MCP 工具，结果为 MCP 响应封装 |
| Device / Extension / Memory | 原生 tool_search 或脚本发现 | 主机适配器，继续验证业务身份、契约和权限 |
| CLI / Composio | 业务工具网关 | 业务连接与操作流程 |

模型无需预先接收全部外部工具 schema。工具载入后才进入下一次模型请求。MCP 注册和调用不再经过 `xopc_tool_search/describe/execute`，这些入口不接受 MCP source。

## 生命周期

每个 pooled AgentSession 安装一个原生 MCP 扩展。会话重置、配置变更、退出和 TTL 淘汰先取消当前工作，发送公开的 session_shutdown 事件并清理扩展。Gateway 退出会等待清理完成。

Device 连接/绑定变更仍使主机会话失效，以避免使用旧设备契约。MCP 列表刷新和重连则遵循 pi 原生行为，不再通过自建目录管理器取消整轮。

本地 deferred 工具按契约恢复载入状态。MCP 工具冷启动后重新注册并搜索；不保留旧 MCP 自动载入兼容逻辑。

## 行为边界

脚本使用 pi QuickJS 执行器，xopc 保留业务工具授权、嵌套调用审计和脚本资源预算。MCP 的可见性和结构化结果遵循 pi；不再承诺 xopc MCP 专属只读认证或严格结果 schema 校验。Device 的输出校验继续生效。

管理与不兼容变更见 [MCP](./cli/mcp.md)。
