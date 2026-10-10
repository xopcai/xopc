# 开始使用 xopc

开源、本地优先的个人 AI。从桌面应用开始，连接一个模型，让 xopc 记住你的上下文，并帮你找到下一个可信行动。

## 选择模型与开始方式

| 模型方式 | 需要什么 |
| --- | --- |
| XOPC Cloud | 登录账号，选择当前目录中可用的服务 |
| 自带 API Key | 连接支持的提供商并选择模型 |
| 本地模型 | 启动并连接兼容的本地模型服务，例如 Ollama |

模型可用后，打开[个人 Agent](./personal-ai.md)和 Ada 聊聊，或直接[处理文件与项目](./workspace-guide.md)。语音、图像和电脑控制需要分别配置兼容服务，普通聊天设置不会自动启用全部能力。

## 选择开始方式

| 你的偏好 | 从这里开始 |
| --- | --- |
| 像普通应用一样安装使用 | [从 xopc.ai 下载](https://xopc.ai/zh#download) |
| 主要使用终端 | [终端快速开始](./first-5-minutes.md) |
| 使用容器自托管 | [Docker](./docker.md) |

对大多数人来说，桌面应用最简单。安装细节见[桌面应用指南](./desktop-app.md)。终端版和 Docker 使用相同配置，可以以后再添加。

## 准备内容

- XOPC Cloud 账号、受支持服务商的 API Key，或者 Ollama 等本地模型服务。
- 只有安装命令行版本时才需要 Node.js 22.22.3 或更高版本。
- 只有选择容器安装时才需要 Docker。

第一次聊天前不需要配置消息通道、工具、额外 Agent 或远程访问。

## 完成第一次可用配置

1. 从[官网](https://xopc.ai/zh#download)下载、安装并打开 xopc，或选择上面的其它方式。
2. 添加一个模型服务商。桌面或网页控制台按模型设置页面操作；终端运行 `xopc onboard --quick`。
3. 打开 **聊天**，或者在终端运行 `xopc`。
4. 发送：`请回复“xopc 已就绪”，并告诉我你正在使用哪个模型。`

助手正常回复，并且没有凭据或连接错误，就表示基础设置完成。

如果没有成功，先运行 `xopc doctor`，再查看[故障排查](./how-to/diagnose-broken-setup.md)。

## 交给它一件真实的事

连接成功后，先跳过功能探索，直接告诉 xopc 一个重要方向：

```text
这周我最想推进的一件事是 ____。
请帮我澄清想要的结果，并找出最小但可信的下一步。
任何长期记忆都先让我检查。
```

启用用户理解后，普通记忆自动维护，无需逐条批准。打开 **关于你** 查看最近更新与来源，并纠正或删除不准确的内容。详见[用户理解](./user-understanding.md)。

部分桌面版本还提供实验性的 **接入最近的工作** 首次体验。它只分析你明确选择的文件夹，读取范围有上限且只读，并给出带证据的下一步。在 macOS 上，它还可能分别请求 Apple Notes、Calendar 和 Reminders 权限。如果更希望从对话开始，可以直接跳过。

## 按需要认识核心功能

| 功能 | 用途 | 指南 |
| --- | --- | --- |
| 用户理解 | 可审查的目标、偏好、关系、当前重点和协作规则 | [用户理解](./user-understanding.md) |
| Session | 可以从任一已连接客户端继续的对话 | [聊天与会话](./session.md) |
| Agent | 有独立角色、模型、工具和工作区的助手 | [Agent](./routing-system.md) |
| Project 与 Task | 有明确结果、状态和下一步的长期工作 | [Project、Task 与笔记](./projects-tasks-notes.md) |
| Workflow | 可重复使用的多步骤工作流程 | [工作流](./workflows.md) |
| Automation | 按时间、Webhook 或手动触发工作 | [自动化](./automations.md) |
| Channel | 从 Telegram、微信或飞书使用同一个助手 | [消息通道](./channels/index.md) |

只把 xopc 当作普通聊天助手时，不需要创建 Project、Workflow 或 Automation。工作需要持续或重复时再添加即可。

## 推荐的下一步

1. 阅读[产品理念](./product.md)，了解 xopc 的信任和主动性模型。
2. 阅读[数据与文件位置](./workspace.md)，了解哪些内容保存在本地。
3. 添加第二个模型前，先了解[模型与服务商](./models.md)，尤其注意哪些个人上下文可能发送给云端服务商。
4. 只有其它设备需要访问 Gateway 时才配置[远程访问](./remote-access.md)。
5. 本地聊天正常后再连接[消息通道](./channels/index.md)。

## 配置保存在哪里

xopc 默认将状态保存在 `~/.xopc/`，主配置文件是 `~/.xopc/xopc.json`。建议使用命令查看，不必手动寻找文件：

```bash
xopc config path
xopc config validate
xopc config show
```

`config show` 会隐藏已识别的敏感值。不要把 API Key、Gateway Token 或机器人 Token 放入 Issue 或截图。

## 从当前界面开始

[认识 Ada](./personal-ai.md) · [交办与接收结果](./task-delegation.md) · [处理文件与项目](./workspace-guide.md) · [任务验收](./task-review.md)。
