# 开始使用 xopc

xopc 让你在桌面、终端、浏览器、手机和消息应用中使用同一套本地运行的 AI 助手。第一次使用只需完成三件事：安装一个客户端、连接一个模型、发送一条测试消息。

## 选择开始方式

| 你的偏好 | 从这里开始 |
| --- | --- |
| 像普通应用一样安装使用 | [桌面应用](./desktop-app.md) |
| 主要使用终端 | [终端快速开始](./first-5-minutes.md) |
| 使用容器自托管 | [Docker](./docker.md) |

对大多数人来说，桌面应用最简单。终端版和 Docker 使用相同的配置，可以以后再添加。

## 准备内容

- 一个受支持的模型账号和 API Key，或者 Ollama 等本地模型服务。
- 只有安装命令行版本时才需要 Node.js 22 或更高版本。
- 只有选择容器安装时才需要 Docker。

第一次聊天前不需要配置消息通道、工具、额外 Agent 或远程访问。

## 完成第一次可用配置

1. 选择上面的一种方式安装并打开 xopc。
2. 添加一个模型服务商。桌面或网页控制台按模型设置页面操作；终端运行 `xopc onboard --quick`。
3. 打开 **聊天**，或者在终端运行 `xopc`。
4. 发送：`请回复“xopc 已就绪”，并告诉我你正在使用哪个模型。`

助手正常回复，并且没有凭据或连接错误，就表示基础设置完成。

如果没有成功，先运行 `xopc doctor`，再查看[故障排查](./how-to/diagnose-broken-setup.md)。

## 按需要认识核心功能

| 功能 | 用途 | 指南 |
| --- | --- | --- |
| Session | 可以从任一已连接客户端继续的对话 | [聊天与会话](./session.md) |
| Agent | 有独立角色、模型、工具和工作区的助手 | [Agent](./routing-system.md) |
| Project 与 Task | 有明确结果、状态和下一步的长期工作 | [Project、Task 与笔记](./projects-tasks-notes.md) |
| Workflow | 可重复使用的多步骤工作流程 | [工作流](./workflows.md) |
| Automation | 按时间、Webhook 或手动触发工作 | [自动化](./automations.md) |
| Channel | 从 Telegram、微信或飞书使用同一个助手 | [消息通道](./channels/index.md) |

只把 xopc 当作普通聊天助手时，不需要创建 Project、Workflow 或 Automation。工作需要持续或重复时再添加即可。

## 推荐的下一步

1. 添加第二个模型前，先了解[模型与服务商](./models.md)。
2. 阅读[数据与文件位置](./workspace.md)，了解哪些内容保存在本地。
3. 只有其它设备需要访问 Gateway 时才配置[远程访问](./remote-access.md)。
4. 本地聊天正常后再连接[消息通道](./channels/index.md)。

## 配置保存在哪里

xopc 默认将状态保存在 `~/.xopc/`，主配置文件是 `~/.xopc/xopc.json`。建议使用命令查看，不必手动寻找文件：

```bash
xopc config path
xopc config validate
xopc config show
```

`config show` 会隐藏已识别的敏感值。不要把 API Key、Gateway Token 或机器人 Token 放入 Issue 或截图。
