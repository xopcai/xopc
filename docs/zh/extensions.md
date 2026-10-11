# 扩展

扩展可以为 xopc 添加消息通道、工具、服务商、后台服务或 Gateway 页面。扩展会在本地 xopc 环境中运行，因此只安装你信任的扩展。

## Agent Plugin

同一个「扩展」入口现在也管理 [Agent Plugins 1.0](https://agent-plugins.org/specification)：以 `plugin.json` 声明的安装包，可包含 `skills/*/SKILL.md` 和 `mcp.json`。只发现 skills 的直接子目录；不会把安装包当成原生 JavaScript 扩展导入。存在原生 `xopc.extension.json` 时按原生扩展处理，不做格式降级兼容。

```bash
xopc extensions inspect ./my-plugin
xopc extensions install ./my-plugin --yes
xopc extensions enable plugin:my-plugin
xopc mcp list
# 使用 list 或插件详情中显示的服务 ID
xopc mcp login <server-id>
xopc extensions verify plugin:my-plugin
xopc extensions update plugin:my-plugin
xopc extensions rollback plugin:my-plugin
xopc extensions disable plugin:my-plugin
xopc extensions remove plugin:my-plugin
```

支持 Gateway 主机上的目录、ZIP、HTTPS ZIP 直链，以及 `store:包名[@版本]`。界面中的路径是 **Gateway 本地路径**，不是上传浏览器所在电脑的目录。HTTPS 下载不接受重定向。首次安装需要确认能力且**默认停用**；非交互 CLI 必须传 `--yes`。更新新增或改变程序执行、网络访问能力时需要再次确认。检查安装包不会启动服务或执行安装脚本。

启用后使用 `xopc mcp list` 运行 pi 原生诊断。需要 OAuth 的 HTTP 服务在 Gateway 主机运行 `xopc mcp login <server-id>`，浏览器与回调由 pi 处理。插件详情可配置 HTTP header 或 stdio 环境变量中的静态密钥。旧网页 OAuth、远程回调粘贴、插件自动连接恢复和 SSE 已删除，详见 [MCP](./mcp.md)。

静态密钥保存在 xopc 凭据存储中，在配置投影时解析。OAuth 凭据由 pi 保存于 xopc 状态目录的 `pi/` 子目录，不写入安装包或 `xopc.json`。预注册客户端使用原生 `oauth` 配置；旧 OAuth 凭据不迁移。

插件启停由安装记录管理，不使用 `extensions.disabled`。MCP 服务 ID 为 `plugin_<规范化包名>_<稳定散列>`，在插件详情中显示。更新、回滚原子切换版本，保留 `PLUGIN_DATA`；修改已安装文件会阻止激活。本地 stdio 程序及 HTTP 连接遵循 pi 的原生行为，插件 ZIP 下载保留宿主下载校验。

卸载删除该包所有已安装版本，默认保留数据和本地凭据。可通过 `--remove-data`、`--remove-credentials` 或界面复选框明确删除；remove-credentials 只清理宿主静态密钥；需要清理原生 OAuth 时，请在卸载前运行 `xopc mcp logout <server-id>`。删除本地凭据不等于撤销服务商侧授权。历史版本保留至卸载，支持回滚上一版本。当前是单 owner 连接模型，不按聊天用户分别授权。市场 SHA 校验、安装包完整性检查不代表发布者签名认证。

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
