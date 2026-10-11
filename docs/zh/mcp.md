# MCP 服务

xopc 使用 pi 原生 MCP 扩展处理出站连接、工具发现、资源读取、OAuth 与调用。服务配置位于 `mcp.servers`；能力中心可编辑自定义服务，启用的 Agent Plugin MCP 服务也会加入同一原生注册表。

只支持 stdio 与 Streamable HTTP。`exposure` 支持 `codemode`（默认）、`deferred`、`direct`、`hidden`；`timeout` 使用秒。HTTP 服务使用 `type: "http"`，预注册 OAuth 客户端使用 `oauth` 对象。

在 Gateway 主机运行 `xopc mcp list --json`、`xopc mcp login <server>`、`xopc mcp logout <server>`。网页只管理配置与静态密钥；旧网页 OAuth/远程回调、SSE、独立能力探测和 MCP 资源附件已删除。

完整配置、发现模式、登录方式及不兼容变更见 [MCP 配置与迁移指南](../cli/mcp.md)。入站 `xopc mcp capabilities --allow-capability <id>` 桥接继续保留。
