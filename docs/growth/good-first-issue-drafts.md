# Good First Issue Drafts

> Use these to seed the repository before broad launch posts. They are intentionally documentation/demo scoped so newcomers can contribute without understanding the whole runtime.

Suggested label set:

```text
good first issue
help wanted
type:docs
priority:P3
```

Add one area label depending on the issue:

```text
area:cli-tui
area:gateway
area:channels
area:providers
```

## 1. First 5 Minutes Screenshots

Title:

```text
docs: add screenshots to the First 5 Minutes walkthrough
```

Labels:

```text
good first issue
help wanted
type:docs
area:cli-tui
priority:P3
```

Body:

```markdown
## Context

The launch-week docs include a First 5 Minutes walkthrough:

https://xopcai.github.io/xopc/first-5-minutes

It is easier to trust a new developer tool when the first-run path includes real screenshots.

## Scope

Add 2-4 screenshots or short terminal captures that show:

- install command
- `xopc onboard --quick`
- `xopc tui --local`
- a first prompt that starts a long-running project loop

## Acceptance criteria

- Screenshots are readable on desktop and mobile docs pages.
- Secrets, local usernames, and private paths are not visible.
- English and Chinese docs either both get screenshots or share language-neutral images.
- The page still builds with `pnpm run docs:build`.

## Useful links

- Website: https://xopc.ai
- First 5 Minutes: https://xopcai.github.io/xopc/first-5-minutes
- Docs source: `docs/first-5-minutes.md`
```

## 2. Ollama Quickstart

Title:

```text
docs: add an Ollama local model quickstart
```

Labels:

```text
good first issue
help wanted
type:docs
area:providers
priority:P3
```

Body:

```markdown
## Context

xopc supports local and hybrid model setups. A focused Ollama quickstart would help users who want to try xopc without starting with a hosted model provider.

## Scope

Add a short docs section or page that covers:

- installing/running Ollama at a high level
- pulling a small model suitable for a first test
- configuring xopc through `xopc onboard --quick` or config
- running `xopc tui --local`
- common troubleshooting notes

## Acceptance criteria

- The quickstart is linked from Getting Started or provider/model docs.
- It clearly states that model quality depends on the chosen local model.
- It does not require users to expose local services publicly.
- The docs build passes with `pnpm run docs:build`.

## Useful links

- Website: https://xopc.ai
- Getting started: https://xopcai.github.io/xopc/getting-started
- Main repo: https://github.com/xopcai/xopc
```

## 3. Telegram Setup Screenshots

Title:

```text
docs: add a Telegram channel setup screenshot flow
```

Labels:

```text
good first issue
help wanted
type:docs
area:channels
priority:P3
```

Body:

```markdown
## Context

One of xopc's core promises is continuity across terminal, web, desktop, mobile app, and messengers. Telegram is a good first channel to document visually.

## Scope

Add a screenshot-backed setup flow for Telegram:

- creating or selecting a bot token
- adding the token to xopc config
- choosing a DM or group policy
- starting the gateway/channel runtime
- sending a first message

## Acceptance criteria

- Bot tokens and personal chat IDs are redacted.
- The doc explains the difference between local-only use and exposing gateway/channel access.
- The setup flow links to the existing channel configuration docs.
- The docs build passes with `pnpm run docs:build`.

## Useful links

- Website: https://xopc.ai
- Docs: https://xopcai.github.io/xopc/
- Main repo: https://github.com/xopcai/xopc
```

## 4. Onboard Quick Troubleshooting

Title:

```text
docs: add troubleshooting FAQ for xopc onboard --quick
```

Labels:

```text
good first issue
help wanted
type:docs
area:cli-tui
priority:P3
```

Body:

```markdown
## Context

`xopc onboard --quick` is the launch-week low-friction setup path. The docs should answer the questions people hit during first run.

## Scope

Add a short FAQ covering:

- Node.js version issues
- missing provider API keys
- selecting cloud vs local models
- where config is stored
- how to retry onboarding
- how to start the TUI after quick setup

## Acceptance criteria

- FAQ is linked from Getting Started and First 5 Minutes.
- Answers are short and actionable.
- The doc avoids logging or displaying secrets.
- The docs build passes with `pnpm run docs:build`.

## Useful links

- First 5 Minutes: https://xopcai.github.io/xopc/first-5-minutes
- Getting started: https://xopcai.github.io/xopc/getting-started
- Main repo: https://github.com/xopcai/xopc
```

## 5. Gateway Console Demo Clip

Title:

```text
demo: record a 30-second gateway console clip
```

Labels:

```text
good first issue
help wanted
type:docs
area:gateway
priority:P3
```

Body:

```markdown
## Context

The README and launch posts need short demos that explain xopc quickly. A 30-second gateway console clip can show that xopc is not only a CLI tool.

## Scope

Record a short clip showing:

- starting `xopc gateway`
- opening the local Web console
- sending a prompt
- briefly showing settings or logs
- ending on the GitHub URL

## Acceptance criteria

- Clip is 20-40 seconds.
- No secrets, private file paths, or private messages are visible.
- The final frame includes `github.com/xopcai/xopc`.
- The clip can be linked from README or docs without requiring a large binary in the repo.

## Useful links

- Website: https://xopc.ai
- Main repo: https://github.com/xopcai/xopc
- Docs: https://xopcai.github.io/xopc/
```

## 6. Mobile Pairing Demo Clip

Title:

```text
demo: record a 30-second xopc-app mobile pairing clip
```

Labels:

```text
good first issue
help wanted
type:docs
area:gateway
priority:P3
```

Body:

```markdown
## Context

xopc has a standalone mobile client, xopc-app:

https://github.com/xopcai/xopc-app

A short pairing clip would make the mobile story easier to understand in launch posts.

## Scope

Record a short clip showing:

- desktop gateway running
- the pairing QR or base URL/token flow
- xopc-app connecting from a phone or simulator
- sending one message from mobile

## Acceptance criteria

- Clip is 20-40 seconds.
- Tokens, local network secrets, and personal messages are hidden.
- The final frame includes both `github.com/xopcai/xopc` and `github.com/xopcai/xopc-app`.
- The clip can be linked from README, docs, or launch posts.

## Useful links

- Mobile app docs: https://xopcai.github.io/xopc/mobile-app
- Main repo: https://github.com/xopcai/xopc
- Mobile repo: https://github.com/xopcai/xopc-app
```

