# xopc 本周 GitHub Star 破 100 行动计划

> 日期基线：2026-06-22。当前 GitHub stars：15；本周目标：100；需要净增：85。npm last-week downloads：1,988；latest release：v0.0.110。

## 核心判断

本周要从 15 涨到 100，关键不是“多发几条推广”，而是把已有产品可信度、安装流量和开发者传播入口串起来。xopc 已经有 README、中文 README、官网、文档、一键安装、TUI GIF、npm 包、release 和 20+ provider 叙事；短板是首屏价值偏抽象、缺少强场景、缺少可转发素材、缺少对现有安装用户的 star 转化入口。

本周主线：

1. 先把官网和 GitHub 仓库变成“看到就知道为什么试用/为什么 star”的入口。
2. 用 2-3 个具体场景视频/GIF 降低理解成本。
3. 把 npm/install/onboard/CLI 里的现有流量导向官网和 GitHub。
4. 集中 3 天向开发者社区分发，持续回复评论和 issue。

## 本周目标拆解

| 指标 | 目标 |
| --- | --- |
| GitHub stars | 15 -> 100 |
| 新增 stars | +85 |
| 官网访问到试用/Star 转化 | 首屏安装命令、GitHub star CTA、xopc-app 入口 |
| GitHub 访问到 star 转化 | 优先提升 README、安装后提示、社区承接 |
| 安装/试用转化 | npm last-week downloads 1,988 中转化 3%-5% 即可贡献 60-100 stars |
| 外部曝光 | 至少 8 个渠道、20 条有效触达、3 个演示素材 |

## 产品动作

### P0：把首屏从概念改成场景

README 和官网首屏保留 “Goal Loop OS”，但要立刻补一句更具体的定位：

> Run a local-first AI assistant that keeps long-term goals moving across terminal, web, desktop, mobile app, and messengers.

中文：

> 一个本地优先的长期目标 AI 助手：在终端、网页、桌面、移动端和 IM 里持续推进目标、行动与反馈。

首屏应该出现 3 个“我能用它做什么”的场景：

- 个人开发者：每天自动总结项目状态，拆下一步，继续推进长期 side project。
- 独立开发者 / One Person Company：同一个 AI 助手跨 CLI、网页、Telegram/微信、桌面工作。
- AI 工具玩家：本地优先，BYOK，20+ 模型提供商，支持工作流、多 Agent、skills/extensions。

### P0：补强 Star CTA

位置：

- 官网首屏：安装命令上方或旁边放 `Star on GitHub`，同时给移动端用户一个 `xopc-app` 出口。
- README 首屏链接区：`GitHub` / `Star` / `Get started`。
- README `Get started` 后加一句：如果安装成功或觉得方向有用，请 star 支持。
- `xopc onboard` 完成页：显示 GitHub URL 和轻量 star CTA。
- `xopc --version` 或 `xopc doctor` 输出中不加干扰性 CTA，只在成功完成关键路径后出现。

建议文案：

```text
If xopc helps you keep long-term AI work moving, please star the repo:
https://github.com/xopcai/xopc
```

中文：

```text
如果 xopc 对你的长期 AI 工作流有启发，欢迎在 GitHub 点个 Star：
https://github.com/xopcai/xopc
```

### P0：做 3 个短演示素材

必须控制在 20-40 秒，每个只讲一个结果，不讲架构。

1. `xopc tui --local`：安装后 30 秒进入 TUI，发起一个长期目标。
2. Gateway console：浏览器里看聊天、设置、日志，展示本地控制台。
3. IM/channel：Telegram 或微信里继续同一个助手，强调“one brain, every screen”。

素材要求：

- 每个视频都在结尾显示 GitHub URL。
- README 保留 1 个主 GIF，再新增 “Demos” 小节链接 3 个素材。
- 中文社区优先用中文字幕，海外社区用英文字幕。

### P1：降低试用风险

补一个 “Try in 3 minutes” 路径，明确不需要网关、不需要配置 IM：

```bash
curl -fsSL https://xopc.ai/install.sh | bash
xopc onboard --quick
xopc tui --local
```

并说明：

- 数据目录：`~/.xopc/`
- 无强制云端
- 自带 API key
- 可用本地模型

### P1：补充对比叙事

README/官网可以加一段 “When to use xopc”：

- 不只是聊天：适合长期目标和定期反馈。
- 不只是 CLI：同一助手在 CLI、TUI、Web、Desktop、IM。
- 不绑定模型：OpenAI/Anthropic/Google/DeepSeek/Ollama/LM Studio/vLLM 等。
- 不强制云：本地优先，配置和数据在用户机器。

## 技术动作

### T0：确保安装路径当天可用

推广前必须跑通：

```bash
curl -fsSL https://xopc.ai/install.sh | bash
xopc --version
xopc onboard --quick
xopc tui --local
npm install -g @xopcai/xopc
```

至少在 macOS 和 Linux 跑通；Windows PowerShell 路径如果没有机器验证，要在文案里避免过度承诺。

### T0：发布一个 “growth-ready” 小版本

建议本周发布 v0.0.111 或 v0.0.112，内容只做低风险改动：

- onboarding 完成后的 GitHub star CTA。
- README/中文 README 场景化首屏。
- 官网首屏补强具体定位。
- 修复安装或首次运行中的任何摩擦。

发布说明标题要面向用户结果：

> v0.0.111: faster first run, clearer local-first goal loop onboarding

### T1：增加 GitHub 社交预览

GitHub repository social preview 图片要可识别：

- 标题：xopc
- 副标题：Local-first Goal Loop OS for long-term AI work
- 4 个关键词：TUI / Web / Mobile app / Workflows
- 右侧放 TUI 或 Gateway screenshot

这会影响 X、Discord、Slack、微信文章里 GitHub 链接卡片的点击率。

### T1：准备可复现 Demo

新增一个最小 demo 文档或脚本：

- `docs/getting-started.md` 当前已有，补一个 “First 5 minutes”。
- 示例目标：`Help me ship my side project this week. Track decisions, next actions, and blockers.`
- 示例展示：TUI -> Gateway -> IM/channel。

### T2：打开讨论入口

GitHub 当前 public issues 为 0，短期看起来干净，但也可能显得没有社区活动。建议：

- 开 3 个 Discussions：Show and tell、Roadmap、Q&A。
- 开 3 个 good-first-issue：文档改进、channel 示例、provider 示例。
- README 里明确欢迎反馈，不只让用户报 bug。

## 市场推广动作

### 定位一句话

英文：

> xopc is a local-first Goal Loop OS: one AI assistant that keeps long-term goals moving across terminal, web, desktop, mobile app, and messengers.

中文：

> xopc 是一个本地优先的目标循环操作系统：让同一个 AI 助手在终端、网页、桌面和 IM 里持续推进长期目标。

### 主传播角度

不要主打“大而全 AI assistant”，要主打一个差异化问题：

> Chat is too temporary for long-term work. xopc turns goals into loops.

中文：

> 聊天太短，长期目标需要循环系统。xopc 把目标、行动和反馈接成一个持续运转的 AI 工作流。

### 渠道优先级

| 优先级 | 渠道 | 动作 |
| --- | --- | --- |
| P0 | 现有用户/安装流量 | onboarding 完成 CTA、README CTA、release note CTA |
| P0 | X / Twitter | 1 条 launch thread + 3 条 demo clip |
| P0 | Hacker News | Show HN：只在素材和 README 改好后发 |
| P0 | Reddit | r/LocalLLaMA、r/selfhosted、r/commandline，按社区规则发具体 demo |
| P0 | V2EX | 分享“做了一个本地优先长期目标 AI 助手”，避免广告腔 |
| P1 | 掘金 / 开源中国 / 稀土 | 中文技术文章 |
| P1 | 微信朋友圈/群 | 用 30 秒视频 + GitHub 链接，直接求 star |
| P1 | Discord/Telegram AI 群 | 发 demo，不发泛泛介绍 |

### 发布文案模板

英文短帖：

```text
I’m building xopc: a local-first Goal Loop OS for long-term AI work.

Instead of another one-shot chat UI, xopc keeps goals, action, and feedback in one loop across:

- terminal / TUI
- local web console
- desktop
- Telegram / WeChat / Feishu
- workflows, cron, multi-agent routing
- 20+ LLM providers, BYOK, local-first storage

GitHub: https://github.com/xopcai/xopc
```

中文短帖：

```text
我在做 xopc：一个本地优先的长期目标 AI 助手。

它不是再做一个聊天框，而是把目标、行动、反馈接成一个持续循环：

- 终端 / TUI
- 本地网页控制台
- 桌面端
- Telegram / 微信 / 飞书
- 定时任务、工作流、多 Agent
- 20+ 模型提供商，BYOK，数据在本机

GitHub: https://github.com/xopcai/xopc
如果方向对你有启发，欢迎点个 Star。
```

Show HN 标题：

```text
Show HN: xopc – local-first Goal Loop OS for long-term AI work
```

Reddit 标题备选：

```text
I built a local-first AI assistant that runs across terminal, web, desktop, mobile app, and messengers
```

V2EX 标题备选：

```text
做了一个本地优先的长期目标 AI 助手 xopc，支持终端、网页、桌面和微信/Telegram
```

## 每日节奏

### 周一：转化面修好

- 改 README 首屏：一句话定位 + 3 个具体场景 + star CTA。
- 检查 GitHub topics、About、social preview。
- 跑通 macOS/Linux 安装路径。
- 录第一个 TUI 30 秒 GIF。

目标：仓库页能承接流量。

### 周二：技术可信度

- 发布 v0.0.111/v0.0.112。
- release note 写成用户收益，不写内部 changelog。
- 补 “First 5 minutes” 文档。
- 开 Discussions / good-first-issues。

目标：陌生开发者敢试、敢 star。

### 周三：英文首发

- X thread。
- Hacker News Show HN。
- Reddit 1-2 个最匹配社区。
- 全程回复评论，记录高频疑问，立刻补 README FAQ。

目标：拿第一波 25-40 stars。

### 周四：中文首发

- V2EX。
- 掘金/开源中国技术文章。
- 微信朋友圈/微信群发 30 秒视频和 GitHub 链接。
- README.zh-CN 补 FAQ。

目标：再拿 25-40 stars。

### 周五：二次扩散

- 发 “What I learned building xopc” 技术贴。
- 发 Gateway/IM 第二、第三个 demo。
- 私信/定向邀请 30 个真实可能感兴趣的开发者试用。

目标：补齐到 100。

### 周末：复盘和补漏

- 看 GitHub traffic、stars、npm downloads。
- 汇总评论里的前 5 个误解。
- 把最高频问题改成 README/官网首屏内容。
- 发一条进展帖：从 15 到 N stars，本周修了什么。

## 转化漏斗

| 阶段 | 用户心理 | 本周要做的事 |
| --- | --- | --- |
| 看到链接 | 这是什么？ | 首屏一句话 + GIF |
| 停留 10 秒 | 和我有什么关系？ | 3 个具体场景 |
| 准备安装 | 会不会麻烦？ | 3 分钟路径 |
| 安装完成 | 有点意思 | onboarding 成功页 star CTA |
| 看完帖子 | 值不值得收藏？ | 明确请求 star |

## 风险

- 目标激进：15 -> 100 需要约 6.7 倍增长，本周必须做集中发布。
- 概念抽象：Goal Loop OS 是差异点，但冷启动阶段必须翻译成具体场景。
- 产品面太宽：CLI、TUI、Web、Desktop、IM、workflow 都讲会散；传播时每条内容只讲一个 demo。
- 安装失败会直接损失口碑：推广前先验证安装链路。
- 只发中文或只发英文都不够：npm 和 GitHub 是海外入口，微信/V2EX 是中文入口，两边都要打。

## 成功标准

- GitHub stars 达到 100。
- README 首屏能让陌生开发者在 10 秒内理解用途。
- 至少 3 个演示素材可复用。
- 至少 8 个渠道发布或触达。
- 至少 20 个真实开发者反馈或互动。
- 安装路径在 macOS/Linux 跑通，Windows 文案不过度承诺未验证内容。
