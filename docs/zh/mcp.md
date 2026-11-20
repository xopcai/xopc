# MCP 服务

xopc 使用 pi 原生 MCP 扩展处理出站连接、工具发现、资源读取、OAuth 与调用。服务配置位于 `mcp.servers`；能力中心可编辑自定义服务，启用的 Agent Plugin MCP 服务也会加入同一原生注册表。

支持 stdio、Streamable HTTP 和旧版 SSE。`exposure` 支持 `codemode`（默认）、`deferred`、`direct`、`hidden`，`timeout` 使用秒。Streamable HTTP 服务使用 `type: "http"`，旧版 SSE 使用 `type: "sse"`，预注册 OAuth 客户端使用 `oauth` 对象。

在 Gateway 主机运行 `xopc mcp list --json`、`xopc mcp login <server>`、`xopc mcp logout <server>`。网页支持配置、静态密钥与浏览器授权，授权和远程回调复用 pi 原生流程。

完整配置、发现模式、登录方式及不兼容变更见 [MCP 配置与迁移指南](../cli/mcp.md)。本机客户端可使用 `xopc mcp grant` 创建授权，再通过 `xopc mcp serve --stdio` 调用 Gateway 工具。

## 移动端配置

打开「能力中心 → 连接 → 添加自定义 MCP」。在服务链接的高级设置中选择旧版 SSE，或在 JSON 中使用 `type: "sse"`。内网地址在 Gateway 所在网络访问，`localhost` 指向 Gateway 主机。使用自定义内网域名时，可在高级设置选择「Gateway 内网」，或在导入 JSON 时指定 `"network": "private"`。

使用服务链接添加时，认证方式默认是「自动探测」，也可以手动选择 OAuth 浏览器授权、Bearer Token、API Key、自定义请求头或无需认证。选择 API Key 后，填写密钥并使用默认的 `X-API-Key` 或服务商指定的请求头名称。探测发现服务需要凭据时，可在认证页面选择对应方式。

使用「命令启动」填写 Gateway 主机上的程序和参数。启用该入口需要 Gateway 管理员设置 `xopc config set gateway.mobileMcpAllowStdio true`。请在「运行并检查」前审阅程序、参数和工作目录。环境变量的值只在确认添加时写入 Gateway 凭据库。连接检查通过后，点「添加连接」提交草稿。

## WebUI 配置

在能力中心的连接器页面添加自定义 MCP，可选择在线服务、Gateway 主机命令或导入 JSON。认证支持自动检测、浏览器登录、Bearer Token、API Key 请求头及自定义请求头。「测试连接」使用归属当前用户、10 分钟后过期的草稿，不更改已保存配置；测试成功后再明确选择「添加连接」或「保存更改」。保存时校验原配置版本，仅合并当前服务，不覆盖其他 MCP。测试失败、取消或修改字段都不会替换旧连接；草稿过期、Gateway 重启或版本冲突后需要重新测试。OAuth 测试凭证仅保存在内存中，提交时才以独立的原生凭证标识发布。停用项也可测试，并选择保留停用或「启用并保存」。命令、文件路径和 localhost 地址均相对于 Gateway 所在机器。浏览器授权复用 pi 原生 OAuth，在支持时提供远程回调地址输入。
