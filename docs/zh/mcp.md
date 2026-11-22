# MCP 服务

xopc 使用 pi 原生 MCP 扩展处理出站连接、工具发现、资源读取、OAuth 与调用。服务配置位于 `mcp.servers`；能力中心可编辑自定义服务，启用的 Agent Plugin MCP 服务也会加入同一原生注册表。

支持 stdio、Streamable HTTP 和旧版 SSE。`exposure` 支持 `codemode`（默认）、`deferred`、`direct`、`hidden`，`timeout` 使用秒。Streamable HTTP 服务使用 `type: "http"`，旧版 SSE 使用 `type: "sse"`，预注册 OAuth 客户端使用 `oauth` 对象。

在 Gateway 主机运行 `xopc mcp list --json`、`xopc mcp login <server>`、`xopc mcp logout <server>`。网页支持配置、静态密钥与浏览器授权，授权和远程回调复用 pi 原生流程。

完整配置、发现模式、登录方式及不兼容变更见 [MCP 配置与迁移指南](./cli/mcp.md)。

## 移动端配置

打开「能力中心 → 连接 → 添加自定义 MCP」。在服务链接的高级设置中选择旧版 SSE，或在 JSON 中使用 `type: "sse"`。内网地址在 Gateway 所在网络访问，`localhost` 指向 Gateway 主机。使用自定义内网域名时，可在高级设置选择「Gateway 内网」，或在导入 JSON 时指定 `"network": "private"`。

使用服务链接添加时，认证方式默认是「自动探测」，也可以手动选择 OAuth 浏览器授权、Bearer Token、API Key、自定义请求头或无需认证。选择 API Key 后，填写密钥并使用默认的 `X-API-Key` 或服务商指定的请求头名称。探测发现服务需要凭据时，可在认证页面选择对应方式。

### 远程连接鉴权规范

- 市场连接由包声明鉴权方式。需要 API Key、Token 或个人 MCP 地址时，先打开配置面板中的服务商链接，按字段说明获取并粘贴凭据。旧连接可在详情的更多选项中选择「查看服务商配置说明」。OAuth 连接安装后选择「连接账号」。市场连接与自定义 MCP 共用 Gateway 验证流程。远程连接启用且通过验证后，移动端才提供「通过对话使用」。
- OAuth 负责生成 `Authorization` 请求头。自定义连接可通过「OAuth 客户端设置」或 JSON 导入添加其他请求头。市场连接使用包声明的附加请求头。手动填写 `Authorization` 时，使用 Bearer Token 或自定义请求头方式。
- 公共客户端可使用服务商支持的注册方式。如果服务商拒绝动态注册，在「OAuth 客户端设置」填写服务商认可的客户端 ID。服务商颁发了客户端密钥时才填写。如果服务商要求固定回调地址，注册 `http://127.0.0.1:<端口>/callback` 并填写对应端口。手机浏览器无法连回 Gateway 时，可使用「浏览器最后打开的地址」提交回调。
- 授权和工具发现成功后，保存连接才会提交草稿中的凭据。重新授权使用同一流程。Gateway 将客户端密钥与请求头的值保存在凭据库中。

使用「命令启动」填写 Gateway 主机上的程序和参数。启用该入口需要 Gateway 管理员设置 `xopc config set gateway.mobileMcpAllowStdio true`。请在「运行并检查」前审阅程序、参数和工作目录。环境变量的值只在确认添加时写入 Gateway 凭据库。连接检查通过后，点「添加连接」提交草稿。

## WebUI 配置

在能力中心的连接器页面添加自定义 MCP，可选择在线服务、Gateway 主机命令或导入 JSON。认证支持自动检测、浏览器登录、Bearer Token、API Key 请求头及自定义请求头。「测试连接」使用归属当前用户、10 分钟后过期的草稿，不更改已保存配置；测试成功后再明确选择「添加连接」或「保存更改」。保存时校验原配置版本，仅合并当前服务，不覆盖其他 MCP。测试失败、取消或修改字段都不会替换旧连接；草稿过期、Gateway 重启或版本冲突后需要重新测试。OAuth 测试凭证仅保存在内存中，提交时才以独立的原生凭证标识发布。停用项也可测试，并选择保留停用或「启用并保存」。命令、文件路径和 localhost 地址均相对于 Gateway 所在机器。浏览器授权复用 pi 原生 OAuth，在支持时提供远程回调地址输入。

## 让外部客户端连接 xopc

Gateway 授权允许 MCP 客户端搜索项目、任务和笔记，或向已配置的 xopc Agent 委派工作。授权默认为整个个人工作区的只读权限。可用 `--allow-capability` 限制客户端可调用的操作。委派和其他写操作需要读写授权。

本机客户端使用 `xopc mcp grant` 签发连接授权，再配置客户端运行 `xopc mcp serve --stdio`。远程客户端可使用 Gateway 的可选 Streamable HTTP 入口，需要外部 OAuth 签发方和独立的 Gateway 授权。客户端可按权限查看自己的委派运行、回答澄清、调整或取消执行，以及获取已发布的成果。[本机与远程配置](./cli/mcp.md#入站-mcp)
