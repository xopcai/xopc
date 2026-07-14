# 快速上手

这页用于查看完整起步地图：安装方式、配置模式、使用入口，以及下一步该读哪篇文档。

如果你还没有真正跑过 xopc，优先从 [PC 桌面端](./desktop-app.md) 开始；偏终端用户看 [5分钟快速入门](./first-5-minutes.md)。

第一次使用只需要跑通 **模型 → Agent → Session**。当工作需要跨会话恢复时，再使用 Project / Goal；需要收集长期材料时使用 Notes / Workspace；需要重复或并行执行时再增加 Workflow / Automation。完整模型见 [持续工作模型](./concepts/loops.md)。

## xopc 有哪些入口

xopc 是一个包，提供多个使用入口：

| 入口 | 启动方式 | 是否需要 gateway |
| --- | --- | --- |
| CLI 单次调用 | `xopc agent -m "..."` | 否 |
| CLI 交互模式 | `xopc agent -i` | 否 |
| 本地 TUI | `xopc` 或 `xopc tui` | 否 |
| PC 桌面端 | GitHub Releases | 内置 gateway |
| 网页控制台 | `xopc gateway`，然后打开终端打印的 URL | 是 |
| Gateway TUI | `xopc tui --gateway` 或 `xopc tui --url ...` | 是 |
| 消息频道 | `channels.*` 下配置 Telegram、微信、飞书/Lark | 是 |

## 环境要求

- CLI 包需要 Node.js **22** 或更新版本。
- 只有从源码构建本仓库时才需要 `pnpm`。
- 至少配置一个模型厂商密钥、本地模型服务，或 OpenAI-compatible endpoint。

## 安装方式

| 方式 | 命令 | 适合 |
| --- | --- | --- |
| 安装脚本 | `curl -fsSL https://xopc.ai/install.sh \| bash` | macOS、Linux、WSL、Termux |
| Windows 安装脚本 | `iex (irm https://xopc.ai/install.ps1)` | PowerShell |
| npm 包 | `npm install -g @xopcai/xopc` | 已安装 Node.js 22+ |
| 国内 npm 镜像 | `npm install -g @xopcai/xopc --registry=https://registry.npmmirror.com` | npmjs 访问较慢 |
| 源码构建 | `pnpm install && pnpm run build` | 开发 xopc 本体 |

## 配置模式

| 目标 | 命令 | 说明 |
| --- | --- | --- |
| 快速本地试用 | `xopc onboard --quick` | 只配置模型凭据，跳过 gateway 和频道 |
| 首次引导配置 | 网页控制台 onboarding 或 `xopc onboard` | 先配置模型，可选补充个人资料，然后进入对话 |
| 只生成基础文件 | `xopc setup` | 只生成配置和工作区骨架 |
| 稍后配置模型 | `xopc providers set-key <provider>` 和 `xopc models set <provider>/<model>` | 见 [配置第一个模型](./how-to/configure-first-model.md) |

默认配置文件是 `~/.xopc/xopc.json`。可用 `XOPC_CONFIG` 或 `XOPC_CONFIG_PATH` 指向其它路径。

## 选择下一步入口

选择一个下一步：

| 需求 | 从这里开始 |
| --- | --- |
| 最省心的开始方式 | [PC 桌面端](./desktop-app.md) |
| 最快终端首次使用 | [5分钟快速入门](./first-5-minutes.md) |
| 浏览器聊天、设置、日志 | [网关](./gateway.md) |
| Telegram bot | [接入 Telegram](./how-to/connect-telegram.md) |
| 手机访问 | [手机端 App](./mobile-app.md) 和 [远程访问](./remote-access.md) |
| 创建另一个专用 agent | [创建第二个 agent](./how-to/create-second-agent.md) |
| 让其它设备访问 gateway | [安全暴露 gateway](./how-to/expose-gateway-safely.md) |
| 设置坏了需要排障 | [诊断设置问题](./how-to/diagnose-broken-setup.md) |

## 核心文档路径

| 主题 | 页面 |
| --- | --- |
| CLI 命令 | [CLI](./cli.md) |
| TUI 行为 | [终端界面](./tui.md) |
| 配置字段 | [配置](./configuration.md) 和 [配置参考](./reference/configuration.md) |
| 模型和厂商 | [模型](./models.md) |
| 消息频道 | [频道](./channels/index.md) |
| 工具 | [工具](./tools.md) |
| 技能 | [技能](./skills.md) |
| 扩展 | [扩展](./extensions.md) |
| 会话路由 | [Session 路由](./routing-system.md) |
| 项目、目标与笔记 | [项目、目标与笔记](./projects-goals-notes.md) |

## 从源码开发

```bash
git clone https://github.com/xopcai/xopc.git
cd xopc
pnpm install
pnpm run dev -- --help
pnpm run dev:init        # 可选：创建隔离的 ~/.xopc-dev 状态目录
pnpm run dev:gateway     # 从源码启动 gateway，使用 ~/.xopc-dev 和 info 日志
pnpm run build
```

如果默认端口已被正式 gateway 占用，可以把参数放到 `--` 后面，例如 `pnpm run dev:gateway -- --port 18791`。

常用检查：

```bash
pnpm test
pnpm run typecheck
pnpm run docs:build
```

## 故障排除

| 现象 | 检查 |
| --- | --- |
| 配置无法加载 | `xopc config validate` |
| 模型调用失败 | `xopc models status` 和对应厂商凭据 |
| gateway 没响应 | `xopc gateway status` 和 `xopc gateway health` |
| 频道不回复 | `xopc channels show <channel>` 和 gateway 日志 |
| 本地问题不明确 | `xopc doctor`，然后 `xopc logs tail` |
