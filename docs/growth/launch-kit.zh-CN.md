# xopc 本周 Launch Kit

> 用途：把本周 GitHub stars 从 15 推到 100。官网负责解释和安装，GitHub 负责 star/源码转化，docs 负责深入配置。

## 链接策略

- 官网主入口：`https://xopc.ai`
- GitHub star 入口：`https://github.com/xopcai/xopc`
- 文档入口：`https://xopcai.github.io/xopc/`
- 3 分钟试用页：`https://xopcai.github.io/xopc/first-5-minutes`
- 移动端说明页：`https://xopcai.github.io/xopc/mobile-app`
- 移动端仓库：`https://github.com/xopcai/xopc-app`

外部发帖默认放官网第一链接、GitHub 第二链接。面向开发者社区或开源社区时，GitHub 可以放第一链接，但正文第一段仍要解释 `https://xopc.ai` 是安装入口。

今日执行顺序见 `docs/growth/today-launch-runbook.zh-CN.md`。

## 今日发布前检查

- README 首屏能在 10 秒内说明：本地优先、长期目标、跨终端/网页/桌面/移动端/IM。
- 官网 `https://xopc.ai` 首屏能看到安装命令、GitHub star CTA、xopc-app 入口。
- `First 5 Minutes` 页面可直接作为外部帖子落地页：`https://xopcai.github.io/xopc/first-5-minutes`。
- 移动端帖子可直接落地到：`https://xopcai.github.io/xopc/mobile-app`，并链接 `https://github.com/xopcai/xopc-app`。
- `xopc onboard --quick` 存在，并且 help 能看到。
- `curl -fsSL https://xopc.ai/install.sh | bash` 在至少一台 macOS 或 Linux 上跑通。
- `xopc onboard --quick` 能完成模型最小配置。
- `xopc tui --local` 能启动本地 TUI。
- GitHub About 文案包含：local-first, goal loop, terminal, web, desktop, mobile app, messengers。
- GitHub topics 至少包含：`ai-agent`, `local-first`, `cli`, `tui`, `workflow`, `multi-agent`, `mcp`, `self-hosted`, `telegram`, `weixin`。
- GitHub Social preview 使用 `docs/public/social-preview.svg` 导出的 PNG/JPG。
- GitHub Discussions 已创建 3 个承接帖：Show and tell、Roadmap、Q&A。草稿见 `docs/growth/discussion-drafts.md`。
- GitHub Issues 已创建 5-6 个 `good first issue`：截图、Ollama、Telegram、onboard FAQ、Gateway demo、Mobile pairing demo。草稿见 `docs/growth/good-first-issue-drafts.md`。
- 可先 dry-run：`pnpm run growth:github-community`；确认后用 `GITHUB_TOKEN=... pnpm run growth:github-community -- --apply` 创建缺失项。
- Release note 顶部放一句：If this is useful, please star xopc on GitHub.

## 统一定位

英文一句话：

```text
xopc is a local-first Goal Loop OS: one AI assistant that keeps long-term goals moving across terminal, web, desktop, mobile app, and messengers.
```

中文一句话：

```text
xopc 是一个本地优先的目标循环操作系统：让同一个 AI 助手在终端、网页、桌面、移动端和 IM 里持续推进长期目标。
```

短卖点：

- Goal loops, not one-shot chats.
- Local-first storage under `~/.xopc/`.
- One assistant across TUI, CLI, Web, Desktop, Telegram, WeChat, and Feishu/Lark.
- BYOK with OpenAI, Anthropic, Google, DeepSeek, Ollama, LM Studio, vLLM, and more.
- Workflows, cron, skills/extensions, and multi-agent routing.

中文短卖点：

- 不是一次性聊天，而是长期目标循环。
- 数据和配置默认在 `~/.xopc/`。
- 同一个助手覆盖 TUI、CLI、网页、桌面、Telegram、微信、飞书。
- 自带 API Key，支持云端和本地模型混用。
- 支持工作流、定时任务、skills/extensions、多 Agent 路由。

## 30 秒 Demo 脚本

### Demo 1：TUI 快速试用

目标：证明 3 分钟内能从安装到本地开聊。

镜头：

1. 打开终端。
2. 运行安装命令。
3. 运行 `xopc onboard --quick`。
4. 运行 `xopc tui --local`。
5. 输入：

```text
Help me keep my side project moving this week. Track goals, next actions, and blockers.
```

结尾字幕：

```text
xopc: local-first Goal Loop OS
GitHub: github.com/xopcai/xopc
```

### Demo 2：Web Console

目标：证明它不是只有 CLI，还有本地网页控制台。

镜头：

1. 运行 `xopc gateway`。
2. 打开 Web console。
3. 展示 chat、settings、logs。
4. 强调“same local assistant, browser UI”。

结尾字幕：

```text
Terminal when focused. Web when managing.
Star: github.com/xopcai/xopc
```

### Demo 3：IM Continuity

目标：证明“one brain, every screen”。

镜头：

1. 网页或 TUI 里发起一个目标。
2. Telegram/微信里继续问下一步。
3. 展示同一个系统持续推进目标。

结尾字幕：

```text
One assistant across terminal, web, desktop, mobile app, and messengers.
GitHub: github.com/xopcai/xopc
```

### Demo 4：Mobile app pairing

目标：证明 xopc 不是只能在电脑上用，xopc-app 能通过 gateway 在 iOS/Android 上继续同一个助手。

镜头：

1. 桌面端启动 `xopc gateway`。
2. 打开 Gateway console → Settings → Remote access。
3. 展示 Mobile app pairing QR。
4. 手机打开 xopc-app，扫码或填入 gateway base URL + token。
5. 手机里发送：

```text
Continue my weekly project loop. What should I do next?
```

结尾字幕：

```text
xopc on desktop + mobile
Main repo: github.com/xopcai/xopc
Mobile app: github.com/xopcai/xopc-app
```

## X / Twitter

### Launch Thread

```text
I’m building xopc: a local-first Goal Loop OS for long-term AI work.

Most AI chat is temporary. You ask, get an answer, then the thread fades.

xopc is built around loops: goals, next actions, feedback, and recalibration.

Website: https://xopc.ai
GitHub: https://github.com/xopcai/xopc
```

```text
It runs as one assistant across:

- terminal / TUI
- local web console
- desktop
- Telegram / WeChat / Feishu
- workflows and cron
- multi-agent routing
- skills/extensions

Data and config stay under ~/.xopc by default.
```

```text
You can try the local path in a few minutes:

curl -fsSL https://xopc.ai/install.sh | bash
xopc onboard --quick
xopc tui --local

If this direction is useful, a GitHub star helps more developers find it:
Website: https://xopc.ai
GitHub: https://github.com/xopcai/xopc
```

### Demo Clip Post

```text
Demo: install xopc, configure the model, and start the local TUI.

The idea: long-term goals should not depend on one-off chat threads.

Website: https://xopc.ai
GitHub: https://github.com/xopcai/xopc
```

### Mobile App Post

```text
xopc also has a standalone mobile client: xopc-app.

It connects to your xopc gateway from iOS/Android over LAN, FRP, Tailscale, or your own HTTPS reverse proxy.

The idea is the same: one local-first assistant, now across terminal, web, desktop, mobile app, and messengers.

Main repo: https://github.com/xopcai/xopc
Mobile app: https://github.com/xopcai/xopc-app
Setup: https://xopcai.github.io/xopc/mobile-app
```

## Hacker News

标题：

```text
Show HN: xopc – Local-first Goal Loop OS for long-term AI work
```

正文：

```text
Hi HN,

I’m building xopc, a local-first AI assistant for long-term work.

The core idea is that one-shot chat is a poor fit for goals that need to keep moving over days or weeks. xopc tries to keep goals, next actions, feedback, and recalibration in one loop.

It currently includes:

- CLI and full-screen TUI
- local web console
- desktop build path
- Telegram / WeChat / Feishu channels
- workflows, cron, skills/extensions, and multi-agent routing
- BYOK model setup with OpenAI, Anthropic, Google, DeepSeek, Ollama, LM Studio, vLLM, and others
- local-first config/data under ~/.xopc

Quick local path:

curl -fsSL https://xopc.ai/install.sh | bash
xopc onboard --quick
xopc tui --local

Website: https://xopc.ai
GitHub: https://github.com/xopcai/xopc

I’d appreciate feedback on the product shape, especially from people who use AI tools for long-running projects rather than one-off prompts.
```

## Reddit

### r/LocalLLaMA

```text
Title: I built a local-first AI assistant for long-term goals, with BYOK and local model support

I’m building xopc, a local-first “Goal Loop OS” for long-term AI work.

It is not another hosted chat UI. The focus is keeping goals, next actions, feedback, and recalibration in one loop across terminal, web, desktop, mobile app, and messengers.

Relevant to this community:

- BYOK
- Ollama, LM Studio, vLLM, and cloud providers
- config/data under ~/.xopc
- CLI/TUI first, with web console available locally
- workflows, cron, skills/extensions, multi-agent routing

Quick path:

curl -fsSL https://xopc.ai/install.sh | bash
xopc onboard --quick
xopc tui --local

GitHub: https://github.com/xopcai/xopc

I’m looking for feedback from people running local or mixed local/cloud model setups.
```

### r/selfhosted

```text
Title: xopc: local-first AI assistant across terminal, web, desktop, mobile app, and messengers

I’m building xopc, a local-first AI assistant for long-term goals.

It runs on your machine, stores config/data under ~/.xopc, and can expose a local gateway console when you want a browser UI or channels.

Surfaces:

- CLI / TUI
- local web console
- desktop build
- mobile app via xopc-app
- Telegram / WeChat / Feishu channels

It also supports workflows, cron, skills/extensions, and BYOK model providers.

GitHub: https://github.com/xopcai/xopc
```

### r/selfhosted mobile angle

```text
Title: xopc-app: a mobile client for a self-hosted local-first AI gateway

I’m building xopc, a local-first AI assistant that runs through a gateway on your machine.

The mobile side is xopc-app, a standalone Expo / React Native client for iOS/Android. It connects to your xopc gateway over LAN, FRP, Tailscale, or your own HTTPS reverse proxy, then uses the same gateway token / pairing flow.

Docs: https://xopcai.github.io/xopc/mobile-app
Main repo: https://github.com/xopcai/xopc
Mobile app: https://github.com/xopcai/xopc-app

I’m especially interested in feedback from people who self-host tools and want phone access without turning the whole assistant into a hosted SaaS.
```

## V2EX

标题：

```text
做了一个本地优先的长期目标 AI 助手 xopc，支持终端、网页、桌面和微信/Telegram
```

正文：

```text
我最近在做 xopc，一个本地优先的长期目标 AI 助手。

它想解决的问题不是“再做一个聊天框”，而是让长期目标能持续运转：记录方向、推动下一步、接住反馈、重新校准。

现在已有：

- CLI / 全屏 TUI
- 本地网页控制台
- 桌面构建路径
- xopc-app 移动端（连接 gateway）
- Telegram / 微信 / 飞书频道
- 工作流、定时任务、多 Agent 路由
- skills/extensions
- OpenAI、Anthropic、Google、DeepSeek、Ollama、LM Studio、vLLM 等模型
- 数据和配置默认在 ~/.xopc

快速试用：

curl -fsSL https://xopc.ai/install.sh | bash
xopc onboard --quick
xopc tui --local

GitHub: https://github.com/xopcai/xopc
移动端: https://github.com/xopcai/xopc-app

如果这个方向对你有启发，欢迎点个 Star。也很想听听大家对“长期目标 AI 助手”这个产品形态的意见。
```

## 微信 / 群 / 朋友圈

```text
我在做一个开源项目 xopc：本地优先的长期目标 AI 助手。

不是再做一个聊天框，而是把目标、行动、反馈接成一个持续循环。

现在支持：
终端 / TUI / 网页控制台 / 桌面 / 移动端 xopc-app / Telegram / 微信 / 飞书
也支持工作流、定时任务、多 Agent、20+ 模型提供商。

GitHub: https://github.com/xopcai/xopc
移动端: https://github.com/xopcai/xopc-app

这周想冲到 100 stars，如果你觉得方向有价值，麻烦帮忙点个 Star，也欢迎直接提意见。
```

## 掘金 / 开源中国文章提纲

标题：

```text
为什么我做了一个“长期目标 AI 助手”：xopc 的本地优先 Goal Loop OS 设计
```

结构：

1. 一次性聊天为什么不适合长期项目。
2. Goal Loop：方向、行动、反馈、校准。
3. 为什么要本地优先和 BYOK。
4. 为什么要跨终端、网页、桌面、IM。
5. xopc 当前能力和快速试用。
6. 邀请试用、反馈和 GitHub star。

## 私信触达模板

```text
我在做一个开源 AI assistant 项目 xopc，方向是 local-first + long-term goal loops。

它和普通聊天工具的区别是：面向持续几天/几周的目标，把目标、下一步、反馈、校准接成一个循环，并且同一套助手覆盖 terminal/web/desktop/mobile app/messengers。

GitHub: https://github.com/xopcai/xopc

如果你有 2 分钟，想请你看一下这个方向是否清楚；如果觉得值得收藏，也麻烦点个 Star。
```

## 每日执行配额

周一：

- README/文档/`onboard --quick` 修好。
- 录 TUI demo。
- 找 30 个真实可能感兴趣的人。

周二：

- 发小版本。
- 发 X thread。
- 私信 10 人。

周三：

- 发 Show HN。
- 发 Reddit 1-2 个社区。
- 私信 10 人。

周四：

- 发 V2EX。
- 发中文技术文章。
- 微信/群发 demo。

周五：

- 发第二个 demo。
- 汇总反馈补 README FAQ。
- 私信 10 人。

周末：

- 复盘 stars、GitHub traffic、npm downloads。
- 发进展帖。
- 把评论中最高频误解改进到 README/官网。
