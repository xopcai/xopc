<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center"><a href="https://xopc.ai">xopc</a></h1>

<p align="center">
  <strong>让重要的事持续向前。</strong><br />
  开源、本地优先的个人 AI，记住你的上下文，与你一起推进工作。<br />
  和 Ada 理清想法、交办任务，或直接在工作空间处理文件与项目，<br />
  查看并继续打磨成果。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@xopcai/xopc"><img src="https://img.shields.io/npm/v/@xopcai/xopc" alt="npm version"></a>
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="MIT License">
  <a href="https://github.com/xopcai/xopc/stargazers"><img src="https://img.shields.io/github/stars/xopcai/xopc?style=flat-square" alt="GitHub Stars"></a>
</p>

<p align="center">
  <a href="https://xopc.ai/zh#download"><strong>下载桌面应用 →</strong></a> ·
  <a href="https://xopcai.github.io/xopc/zh/">使用文档</a> ·
  <a href="https://xopc.ai/zh/learn">观看演示与实战教程</a>
</p>

<p align="center">
  <a href="https://xopcai.github.io/xopc/xopc-desktop.mp4">
    <img src="docs/public/xopc-desktop-preview.gif" alt="xopc 桌面应用演示" width="960">
  </a>
</p>

## 两种方式，从同一个 xopc 开始

**先和 Ada 聊聊。** Ada 是 xopc 中的个人 Agent，无需单独安装。告诉它你的背景、回复偏好和想做的事；需要时交办任务，继续对话，再回来查看结果。[认识 Ada](https://xopcai.github.io/xopc/zh/personal-ai)。

**直接进入工作空间。** 带入文件和目标，处理资料、分析数据、修改代码或制作汇报。把对话、成果与项目留在一起，稍后接着做。[工作空间指南](https://xopcai.github.io/xopc/zh/workspace-guide)。

适合独立工作者、创作者、开发者，以及希望减少重复解释和执行负担的人。

## 先完成一件实际的事

| 你想做什么 | 可以这样开始 | 检查什么 |
| --- | --- | --- |
| 继续上次的项目 | “结合这个项目的笔记与任务，告诉我目前卡在哪里，先给出下一步建议。” | 背景来源、未决事项和下一步 |
| 把资料做成报告 | “把这些销售文件整理为汇总表，保留来源、计算依据和异常项。” | 保存的文件、汇总数字和异常项 |
| 交办后继续聊 | “把本周计划整理成一页文件，做好后告诉我；我们继续讨论下周的重点。” | 任务卡、实际文件和修改结果 |

资料处理需要相应文件访问权限、工具或技能；语音、图像、浏览器和外部服务也需要各自配置。[交办与接收结果](https://xopcai.github.io/xopc/zh/task-delegation) · [实战教程](https://xopc.ai/zh/learn)。

## 核心能力

| 能力 | 用途 |
| --- | --- |
| **上下文与记忆** | 保存会话、项目背景和可查看、纠正、删除的用户理解 |
| **委派与交付** | 交办任务、处理补充问题、接收成果，并按验收条件检查结果 |
| **文件与项目** | 处理授权资料，保留文件、笔记、执行记录和下一步 |
| **持续跟进** | 关注指定主题；用 Workflow 重复流程，用 Automation 定时或按事件启动 |
| **工具与连接** | 技能、MCP、连接器、浏览器自动化、图像和语音；按需启用 |
| **多端访问** | 桌面、网页、终端、手机，以及 Telegram、微信、飞书/Lark |

[电脑控制](https://xopcai.github.io/xopc/zh/computer-use)目前是 macOS 桌面预览能力，需要兼容的 GUI 模型和系统权限。移动端能力随平台与版本变化，Agent 仍在连接的电脑上运行。

<a id="desktop-app"></a>
<a id="get-started"></a>
<a id="quick-start"></a>

## 快速开始

### 桌面应用

1. [下载 xopc](https://xopc.ai/zh#download)，选择 macOS、Windows 或 Linux。
2. 连接 XOPC Cloud、自己的模型 API Key，或本地模型服务。
3. 打开个人 Agent 或聊天，先发送一个小请求，再带入真实资料。

[桌面安装说明](https://xopcai.github.io/xopc/zh/desktop-app) · [模型设置](https://xopcai.github.io/xopc/zh/how-to/configure-first-model)。

### 终端安装

macOS、Linux、WSL：

```bash
curl -fsSL https://xopc.ai/install.sh | bash
xopc onboard --quick
xopc
```

Windows PowerShell：

```powershell
irm https://xopc.ai/install.ps1 | iex
xopc onboard --quick
xopc
```

已具备 Node.js **22.22.3+** 时，也可执行 `pnpm add -g @xopcai/xopc`。[终端快速开始](https://xopcai.github.io/xopc/zh/first-5-minutes)包含镜像与排障说明。

### 在手机上继续

[下载渠道与连接步骤](https://xopcai.github.io/xopc/zh/mobile-app)。扫码并在电脑上批准配对后，查看进展、发送指令；保持电脑唤醒且 xopc 正在运行。

## 数据与控制

核心状态默认存储在本机 `~/.xopc/`。可使用云模型或本地模型；选择云服务时，相关请求上下文、图片或音频会由对应提供商处理。连接 XOPC Cloud 不会自动上传整个本地数据库或工作空间。

数据源、工具和频道按需授权。执行确认取决于工具策略和你的授权范围；浏览器控制不会为每次点击弹出确认。先明确任务范围，涉及发送、删除、购买或账号变更时，要求先展示结果并等待你确认。[隐私与记忆](https://xopcai.github.io/xopc/zh/user-understanding) · [浏览器自动化](https://xopcai.github.io/xopc/zh/browser-automations)。

## 找到对应指南

| 你想做什么 | 指南 |
| --- | --- |
| 设置个人助手 | [认识 Ada](https://xopcai.github.io/xopc/zh/personal-ai) |
| 交办并修改成果 | [任务交付](https://xopcai.github.io/xopc/zh/task-delegation) |
| 处理文件与项目 | [工作空间](https://xopcai.github.io/xopc/zh/workspace-guide) |
| 检查结果与重试 | [任务验收](https://xopcai.github.io/xopc/zh/task-review) |
| 保存可重复的网页操作 | [浏览器录制与自动化](https://xopcai.github.io/xopc/zh/browser-automations) |
| 增加服务和能力 | [模型](https://xopcai.github.io/xopc/zh/models) · [技能](https://xopcai.github.io/xopc/zh/skills) · [MCP](https://xopcai.github.io/xopc/zh/mcp) · [连接器](https://xopcai.github.io/xopc/zh/connectors/) |
| 配置实例与扩展 | [配置](https://xopcai.github.io/xopc/zh/configuration) · [扩展](https://xopcai.github.io/xopc/zh/extensions) · [XOPC Platform](https://xopcai.github.io/xopc/zh/platform) |
| 查看更新 | [近期变化](https://xopcai.github.io/xopc/zh/whats-new) · [GitHub Releases](https://github.com/xopcai/xopc/releases) |

## 社区交流

欢迎加入 xopc 社区，交流使用经验、分享作品，并一起参与项目建设。

| 渠道 | 适合内容 |
| --- | --- |
| [GitHub Discussions](https://github.com/xopcai/xopc/discussions) | 技术问答、想法讨论和长期可检索的信息 |
| [Discord](https://discord.gg/ZmK8FzZHG) | 实时交流、作品展示和贡献者协作 |
| [微信群](https://xopcai.github.io/xopc/zh/community#wechat) | 中文交流、上手帮助和版本动态 |
| [GitHub Issues](https://github.com/xopcai/xopc/issues) | 已确认的 Bug 和可执行的功能建议 |

参与前请阅读[社区指南](https://xopcai.github.io/xopc/zh/community)和[行为准则](./CODE_OF_CONDUCT.md)。安全漏洞请通过 [GitHub Security Advisories](https://github.com/xopcai/xopc/security/advisories/new) 私下提交，不要发布到公开讨论区或交流群。

---

## 常见问题

**xopc 是云服务吗？** — xopc 应用运行在你的机器上，配置与状态默认保存在 **`~/.xopc/`**。它可以保持独立运行，也可以显式连接 XOPC Cloud 或企业自己的平台；连接不会自动迁移本地数据库。

**“本地优先”是否意味着数据绝不会离开电脑？** — 不一定。如果选择云端模型，与当前请求相关的对话和上下文会发送给对应模型服务商；需要完全留在本机的工作，请使用本地模型并检查数据源和工具权限。

**xopc 会自动记住关于我的一切吗？** — 不会。用户理解可以被查看、确认、纠正和删除；未经确认的推断不应该被当作权威事实。密码、密钥和其他高度敏感信息不应交给记忆系统。

**必须使用付费云端模型吗？** — 不必须。自带 API Key 或用本地模型（Ollama、LM Studio、vLLM）。

**最快怎么试用？** — [桌面端](#快速开始) 适合 GUI 用户，终端用户执行 `xopc onboard --quick && xopc`。

**它和普通聊天 UI 有什么区别？** — 聊天只是入口。xopc 会把对你的理解、长期目标、项目、Task、决定和执行记录保留下来，让同一个助手可以跨越时间和入口继续工作。

**能在手机或即时通讯里用吗？** — 可以。用 [移动端 App](https://xopcai.github.io/xopc/zh/mobile-app) 扫码连接，或配置 Telegram、微信、飞书/Lark。

**还有问题？** — 去 [GitHub Discussions](https://github.com/xopcai/xopc/discussions/categories/q-a) 提问。

---

## 安全

xopc 会接触个人上下文，也可能获得执行工具，因此能力边界与模型选择同样重要：

- 只启用当前需要的数据源、工具和频道；
- 使用云端模型前，确认可以发送给服务商的上下文范围；
- 来自即时通讯的消息一律视为**不可信输入**，私聊建议使用 **pairing（配对）** 或 **allowlist（白名单）**；
- 保持 gateway 监听地址、访问 token 和 API Key 私密；
- 对发送、删除、购买以及其他高影响动作保留人工确认。

详见[用户理解与隐私](./docs/user-understanding.md)、[频道安全](https://xopcai.github.io/xopc/zh/channels)和[配置参考](https://xopcai.github.io/xopc/zh/configuration)。

---

## 参与贡献

```bash
pnpm install && pnpm run dev
pnpm run dev:gateway            # 开发 gateway 使用 ~/.xopc-dev + info 日志
pnpm run build && pnpm run test:all && pnpm run lint
```

**[AGENTS.md](./AGENTS.md)** · **[CONTRIBUTING.md](./CONTRIBUTING.md)**（英文）

**反馈：** [Bug 反馈](https://github.com/xopcai/xopc/issues/new?template=bug_report.yml) · [功能建议](https://github.com/xopcai/xopc/issues/new?template=feature_request.yml) · [Q&A 讨论](https://github.com/xopcai/xopc/discussions/categories/q-a) · [安全漏洞反馈](https://github.com/xopcai/xopc/security/advisories/new)（请勿公开发布漏洞细节）

**技术栈：** TypeScript、Node.js ≥ 22.22.3、pnpm workspace。内置 LLM 层 `@earendil-works/pi-ai`，React 网关控制台，Electron 桌面端。

## 致谢

- 大模型接入：[@earendil-works/pi-ai](https://github.com/earendil-works/pi-mono) · 运行时：[@earendil-works/pi-agent-core](https://github.com/earendil-works/pi-mono)
- 用户理解：受 [OpenWiki](https://github.com/langchain-ai/openwiki) 从证据沉淀知识的思想启发，在 XOPC 中重新实现为带治理合成和逐轮上下文规划的原生能力，详见[用户理解](./docs/user-understanding.md)
- 灵感来自 [openclaw/openclaw](https://github.com/openclaw/openclaw) 与 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

---

<p align="center"><sub>由 <a href="https://github.com/xopcai">xopcai</a> 维护 · <a href="https://xopc.ai">xopc.ai</a></sub></p>
