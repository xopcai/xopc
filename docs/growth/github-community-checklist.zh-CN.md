# GitHub 社区承接清单

> 用途：当外部渠道开始带流量后，让 GitHub 页面显得可参与、可反馈、有人维护。

## 仓库 About

Description 建议：

```text
Local-first Goal Loop OS for long-term AI work across terminal, web, desktop, mobile app, and messengers.
```

Website:

```text
https://xopc.ai
```

Topics 建议：

```text
ai-agent
agent-os
byok
cli
cron
desktop
extensions
goal-loop-os
local-first
mcp
multi-agent
ollama
self-hosted
telegram
tui
weixin
workflow
```

Social preview:

- Use `docs/public/social-preview.svg` as the source.
- Export to PNG/JPG before uploading if GitHub rejects SVG.
- Confirm the card reads clearly at small size: `xopc`, `Goal Loop OS`, `Local-first`, `github.com/xopcai/xopc`, `github.com/xopcai/xopc-app`.

## Discussions

Create these discussion threads before broad posting:

1. `Show and tell: how are you using xopc?`
2. `Roadmap: local-first goal loops across terminal, web, desktop, mobile app, and messengers`
3. `Q&A: installation, models, gateway, and channels`

Full copy-paste drafts: `docs/growth/discussion-drafts.md`.

Scripted dry-run:

```bash
pnpm run growth:github-community -- --discussions-only
```

Create missing discussions through GitHub API:

```bash
GITHUB_TOKEN=... pnpm run growth:github-community -- --apply --discussions-only
```

Pinned intro for each:

```text
Thanks for trying xopc. This week we are improving first-run setup and collecting feedback from people using AI tools for long-running projects. If the project is useful, a GitHub star helps more developers find it.
```

## Good First Issues

Open 5-6 small issues so new visitors have obvious entry points:

1. `docs: add a First 5 Minutes walkthrough with screenshots`
2. `docs: add an Ollama local model quickstart`
3. `docs: add a Telegram channel setup screenshot flow`
4. `docs: add a troubleshooting FAQ for xopc onboard --quick`
5. `demo: record a 30-second gateway console clip`
6. `demo: record a 30-second xopc-app mobile pairing clip`

Full copy-paste drafts: `docs/growth/good-first-issue-drafts.md`.

Scripted dry-run:

```bash
pnpm run growth:github-community -- --issues-only
```

Create missing issues through GitHub API:

```bash
GITHUB_TOKEN=... pnpm run growth:github-community -- --apply --issues-only
```

Suggested labels:

```text
good first issue
help wanted
type:docs
priority:P3
```

Add one existing area label per issue: `area:cli-tui`, `area:providers`, `area:channels`, or `area:gateway`.

The script skips existing items with the same title. `GITHUB_TOKEN` needs permission to create repository issues and discussions.

## Response SLA During Launch

- First 2 hours after each post: reply within 15 minutes.
- Same day: reply within 2 hours.
- Bugs from new users: either fix immediately or create an issue with reproduction notes.
- Confusing questions: update README FAQ the same day.

## Daily Metrics

Track these in `docs/growth/outreach-tracker.csv`:

- GitHub stars at start/end of day.
- GitHub traffic: views and unique visitors.
- npm downloads.
- Number of comments/replies.
- Number of direct outreach messages sent.
- Number of issues/discussions created from feedback.
