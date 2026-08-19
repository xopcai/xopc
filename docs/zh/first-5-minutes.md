# 5分钟快速入门

这篇文档帮你用最短终端路径从「在 GitHub 上看到 xopc」到「本地开聊」。

对大多数用户来说，[PC 桌面端](./desktop-app.md) 是最省心的开始方式：安装应用，在界面里完成模型设置，然后直接在内置控制台聊天。偏终端，或当前平台暂时没有桌面发布包时，再按本文流程走。

## 1. 安装

macOS、Linux、WSL2、Termux：

```bash
curl -fsSL https://xopc.ai/install.sh | bash
```

如果已经有 Node.js 22+：

```bash
npm install -g @xopcai/xopc
```

Windows PowerShell：

```powershell
iex (irm https://xopc.ai/install.ps1)
```

## 2. 先只配置模型

```bash
xopc onboard --quick
```

`--quick` 是最短配置流程：选择模型服务商并保存凭据。网关、频道、技能和额外 agent 都可以之后再配。

你可以使用云端模型 API Key，也可以配置 Ollama、LM Studio、vLLM 等本地或自部署模型服务。

## 3. 启动本地 TUI

```bash
xopc
```

这会直接打开本地终端界面，等同于 `xopc tui`，不需要先启动网关。

你应该看到一个全屏终端聊天界面。如果它立刻退出，先运行 `xopc doctor`，再用 `xopc models status` 检查模型状态。

## 4. 完成一次可继续的任务

xopc 不要求你先搭一套复杂流程。先在当前 Session 中完成一个真实任务，并留下可继续的状态。

粘贴这句：

```text
我要推进这个项目：<一句话描述>。请先帮我澄清目标和成功标准，再基于当前信息完成可以立即执行的部分。结束前请总结已完成事项、未决问题和下一步。
```

观察重点：

- 当前 Session 会保留对话与工具运行上下文，本地状态和配置默认保存在 `~/.xopc/`。
- 如果它只是一次临时任务，到这里已经足够。
- 如果需要跨多次会话持续推进，让 xopc 创建 Task；只有多个 Task 需要共享上下文时才增加 Project。
- 如果需要长期材料或重复执行，再增加 Notes / Workspace、Workflow 或 Automation；不需要第一天全部配置好。

## 5. 只增加真正需要的部件

本地聊天跑通后，只在真正有用的地方继续扩展：

| 下一步 | 什么时候加 | 从哪里开始 |
| --- | --- | --- |
| 持续推进一个结果 | 状态和下一步需要跨会话保存 | 在 Gateway 控制台使用 Home 与 Tasks |
| 随手记录材料 | 想法和进展经常不在终端里发生 | 使用 Web / 手机端 Notes，支持文字、语音和附件 |
| 引入外部信号 | 工作已经分散在别的入口或系统里 | 使用频道、gateway API、扩展或 MCP |
| 自动跟进 | 复盘、摘要、提醒会重复发生 | 使用 [自动化](./automations.md) 和 [工作流](./workflows.md) |

常用入口：

| 入口 | 命令 | 适合 |
| --- | --- | --- |
| PC 桌面端 | GitHub Releases | 最省心的开始方式；原生应用 + 内嵌 gateway |
| CLI | `xopc agent -i` | 最小终端聊天 |
| 网页控制台 | `xopc gateway` | 在浏览器中聊天、改设置、看日志 |
| 手机端 | [移动端 App](https://github.com/xopcai/xopc/tree/main/apps/mobile-expo) + 网关扫码配对 | 不在电脑前也能记录文字、语音、图片、附件和项目进展；Agent 仍运行在你的电脑或本地环境里，见 [手机端 App](./mobile-app.md) |
| 即时通讯 | 启动网关后打开 `频道` 页面 | Telegram、微信、飞书/Lark |

完整说明见 [快速开始](./getting-started.md)。要理解 Conversation、Task、Project、Workflow 与 Automation 如何协作，继续看 [Task 闭环](./concepts/loops.md)。
