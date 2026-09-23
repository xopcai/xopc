# 扩展

扩展可以为 xopc 添加消息通道、工具、服务商、后台服务或 Gateway 页面。扩展会在本地 xopc 环境中运行，因此只安装你信任的扩展。

## Agent Plugin

同一个「扩展」入口现在也管理 [Agent Plugins 1.0](https://agent-plugins.org/specification)：以 `plugin.json` 声明的安装包，可包含 `skills/*/SKILL.md` 和 `mcp.json`。只发现 skills 的直接子目录；不会把安装包当成原生 JavaScript 扩展导入。存在原生 `xopc.extension.json` 时按原生扩展处理，不做格式降级兼容。

```bash
xopc extensions inspect ./my-plugin
xopc extensions install ./my-plugin --yes
xopc extensions enable plugin:my-plugin
xopc extensions connect plugin:my-plugin --mcp main
xopc extensions verify plugin:my-plugin
xopc extensions update plugin:my-plugin
xopc extensions rollback plugin:my-plugin
xopc extensions disable plugin:my-plugin
xopc extensions remove plugin:my-plugin
```

支持 Gateway 主机上的目录、ZIP、HTTPS ZIP 直链，以及 `store:包名[@版本]`。界面中的路径是 **Gateway 本地路径**，不是上传浏览器所在电脑的目录。HTTPS 下载不接受重定向。首次安装需要确认能力且**默认停用**；非交互 CLI 必须传 `--yes`。更新新增或改变程序执行、网络访问能力时需要再次确认。检查安装包不会启动服务或执行安装脚本。

启用后，在插件详情或「连接器」点击「测试连接」。公开 HTTP MCP 无需登录；需要授权时，OAuth 使用「连接账号」，API Key 使用「设置密钥」（HTTP header 或 stdio 环境变量）。聊天需要尚未连接的插件 MCP 时，xopc 会保留当前目标，并显示与「连接器」一致的连接操作区。OAuth 只在用户点击「连接账号」后发起；xopc 验证返回的工具后会自动继续原任务，无需重新发送提示。远程 Gateway 的 loopback 回调无法从浏览器访问时，可把浏览器地址栏中的完整回调 URL 粘贴到连接操作区。

凭据保存在现有宿主凭据存储中，按 owner、插件、服务及端点隔离，不写入安装包或 `xopc.json`。更新改变端点时不继承旧凭据绑定。支持标准 streamable HTTP OAuth；SSE 使用公开访问或显式 header，stdio 使用环境变量。要求预注册专用 OAuth client 或厂商特有登录流程的服务，可能需要额外宿主集成。

插件启停由安装记录管理，不使用原生扩展的 `extensions.disabled`。MCP 使用保留命名空间 `plugin/<包名>/<服务名>`。更新、回滚通过原子切换版本完成，保留 `PLUGIN_DATA`；修改已安装文件会阻止激活，需重新安装修复。本地 stdio MCP 是受信任程序，**没有进程沙箱**，启用前必须检查命令。HTTP 阻止非 loopback 私网地址及重定向，允许显式配置的 loopback 服务。

卸载删除该包所有已安装版本，默认保留数据和本地凭据。可通过 `--remove-data`、`--remove-credentials` 或界面复选框明确删除；删除本地凭据不等于撤销服务商侧授权。历史版本保留至卸载，支持回滚上一版本。当前是单 owner 连接模型，不按聊天用户分别授权。市场 SHA 校验、安装包完整性检查不代表发布者签名认证。

## 浏览与检查

```bash
xopc extensions list
xopc extensions search <keyword>
xopc extensions inspect <extension>
xopc extensions audit
```

安装前检查源码、发布者、所需权限、依赖、配置字段，以及它是否能访问凭据或本地文件。

## 安装并激活

```bash
xopc extensions install <package-or-path>
xopc extensions inspect <extension>
xopc extensions health
```

也可以使用 Gateway 控制台的 **扩展** 页面。通过该页面或 `extensions.disabled` 配置列表激活、停用已安装扩展。如果扩展包含运行时代码且没有立即出现，请重启 Gateway。

## 配置

优先使用扩展自己的设置页面。没有页面时，按照 `xopc extensions inspect <extension>` 显示的字段和发布者用户指南操作。

敏感信息应保存在扩展支持的凭据或环境变量机制中。复制发布者示例前，先确认它会启用哪些权限和外部服务。

## 更新或停用

```bash
xopc extensions update <extension>
xopc extensions verify <extension>
```

排查启动、消息通道、服务商或工具冲突时，先从 Gateway 扩展页面停用。停用可恢复，并会保留已安装文件和配置。

更新重要扩展前：

1. 阅读发布说明；
2. 备份 xopc 状态；
3. 检查新增权限或必填字段；
4. 更新并重启；
5. 执行小规模健康测试。

## 安全检查清单

- 无人值守系统优先使用已验证来源和固定版本。
- 不要在未检查的情况下安装聊天消息中的包。
- 审计可以运行命令、访问文件、监听网络或读取凭据的扩展。
- 面向外部的消息通道扩展先使用严格访问策略。
- 不再使用扩展时删除相关凭据。

## 故障排查

| 现象 | 检查内容 |
| --- | --- |
| 已安装但界面中没有 | 扩展已启用，并且 Gateway 已重启 |
| 健康检查失败 | 缺少依赖、凭据、平台支持，或与其它扩展冲突 |
| 配置被拒绝 | 使用当前版本字段并运行 `xopc config validate` |
| 更新后功能异常 | 查看发布说明、日志和版本兼容性，调查期间先停用 |

运行 `xopc extensions --help` 查看来源、打包和高级维护命令。扩展开发细节只保留在仓库内部设计文档中，不发布到用户站点。
