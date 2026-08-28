# 扩展

扩展可以为 xopc 添加消息通道、工具、服务商、后台服务或 Gateway 页面。扩展会在本地 xopc 环境中运行，因此只安装你信任的扩展。

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
