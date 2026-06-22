# 今日发布 Runbook

> 日期：2026-06-22。当前基线：15 / 100 stars，还差 85。目标是先完成仓库承接，再开始外部分发。

## 0. 先确认指标

```bash
pnpm run growth:snapshot
```

记录到 `docs/growth/outreach-tracker.csv`。

## 1. 部署入口

必须先完成：

- 官网 `https://xopc.ai` 已部署，首屏有安装命令、GitHub Star 引导、xopc-app 入口。
- 文档站已部署，`5分钟快速入门` 和 `手机端 App` 页面可访问。
- GitHub README 首屏已经包含本地优先、Goal Loop OS、多端入口和 star CTA。
- GitHub About 设置为 `https://xopc.ai`，topics/social preview 已更新。

## 2. 创建 GitHub 承接点

先 dry-run：

```bash
pnpm run growth:github-community
```

确认无误后创建缺失项：

```bash
GITHUB_TOKEN=... pnpm run growth:github-community -- --apply
```

如果 Discussions 类别未开启或类别名不匹配，先只创建 Issues：

```bash
GITHUB_TOKEN=... pnpm run growth:github-community -- --apply --issues-only
```

然后手动从 `docs/growth/discussion-drafts.md` 创建 Discussions。

## 3. 发布顺序

### 第一波：低风险自有渠道

1. X/Twitter launch thread：用 `docs/growth/launch-kit.zh-CN.md` 的 launch thread。
2. 朋友圈/微信群：中文短文 + 官网 + GitHub。
3. 10 个直接私信：发给 AI/devtools/self-hosted 方向的开发者。

目标：先拿 10-20 个早期反馈和 star，修掉最明显的理解问题。

### 第二波：开发者社区

1. V2EX：中文产品故事，链接官网和 GitHub。
2. Reddit `r/LocalLLaMA`：本地模型/BYOK 角度。
3. Reddit `r/selfhosted`：本地 gateway + mobile app 角度。

目标：拿到安装问题、定位反馈和真实试用。

### 第三波：高曝光社区

1. Hacker News `Show HN`。
2. X/Twitter demo clip follow-up。
3. V2EX/mobile 或 WeChat follow-up：强调 xopc-app。

目标：在前两波反馈修正后再推高曝光，避免首帖浪费。

## 4. 回复节奏

- 每个帖子发布后前 2 小时：15 分钟内回复。
- 当天：2 小时内回复。
- 每个重复问题：当天更新 README FAQ 或 docs。
- 每个可复现 bug：当天建 issue，贴复现信息和 workaround。
- 每个有价值建议：引导到 Roadmap discussion。

## 5. 当天收盘

```bash
pnpm run growth:snapshot
```

把结果写回 `docs/growth/outreach-tracker.csv`：

- stars 起止数
- GitHub issues/discussions 数
- 每个渠道的评论数
- 安装失败或困惑点 top 3
- 次日要改的 README/docs/onboard 项

