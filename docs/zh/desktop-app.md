# 桌面应用

桌面应用是本地运行 xopc 最简单的方式。它包含 Gateway 控制台，会在需要时启动本地服务，并允许你在不常驻终端的情况下管理模型、Agent、消息通道、日志和更新。

![xopc 桌面应用演示](/xopc-desktop.gif)

## 安装

1. 打开 [GitHub Releases](https://github.com/xopcai/xopc/releases)。
2. 下载适合当前电脑的最新安装包。
3. 安装并启动 **xopc**。

| 平台 | 安装包 |
| --- | --- |
| macOS | `.dmg` |
| Windows | 与 x64 或 ARM64 系统匹配的 `.exe` |
| Linux | `.AppImage` 或 `.deb` |

macOS 用户将 xopc 拖入“应用程序”；Windows 用户运行安装器；Linux 用户安装 `.deb`，或为 `.AppImage` 添加执行权限。

## 第一次运行

<!-- 截图占位：/screenshots/desktop-first-run.png -->

1. 等待本地 Gateway 就绪。
2. 按模型设置页面连接一个服务商。
3. 打开 **聊天**，保留默认 Agent。
4. 发送：`请回复“xopc 已就绪”，并告诉我你正在使用哪个模型。`

<!-- 截图占位：/screenshots/first-chat.png -->

正常收到回复后，基础配置就完成了。消息通道、远程访问、浏览器自动化和更多 Agent 建议一次只添加一项。

服务商选择和凭据方式见[配置模型](./how-to/configure-first-model.md)。

## 常用功能入口

| 你想做什么 | 打开 |
| --- | --- |
| 开始或继续对话 | **聊天** |
| 创建和编辑助手 | **Agent** |
| 组织持续工作 | **Project** 或 **Task** |
| 连接 Telegram、微信或飞书 | **消息通道** |
| 创建重复执行的工作 | **Workflow** 或 **Automation** |
| 排查运行问题 | **设置 → 日志** |
| 配对其它设备 | **设置 → 远程访问** |
| 检查更新 | **设置 → Gateway** |

桌面应用和终端命令默认使用同一套 xopc 数据。你可以先在应用中开始，之后直接运行 `xopc`、`xopc agent` 或 `xopc gateway`，无需重新配置。

## 数据与隐私

xopc 默认把配置、本地数据库、Agent 和工作区保存在 `~/.xopc/`。除非使用本地模型，否则模型请求仍会发送给你选择的模型服务商。

备份和路径说明见[数据与文件位置](./workspace.md)。截图中不要出现密钥、Token、私人对话或个人路径。

## 故障排查

| 现象 | 处理方式 |
| --- | --- |
| Gateway 无法启动 | 关闭其它 xopc 窗口后重试，并检查配置端口是否已被占用 |
| 模型设置失败 | 重新输入凭据、确认模型，再查看[配置模型](./how-to/configure-first-model.md) |
| 窗口打开但内容空白 | 重启应用；Windows 上请安装最新显卡驱动 |
| 消息通道或手机无法连接 | 先确认本地聊天正常，再查看[消息通道](./channels/index.md)或[远程访问](./remote-access.md) |

仍然无法解决时，在终端运行 `xopc doctor`，并查看[故障排查](./how-to/diagnose-broken-setup.md)。
