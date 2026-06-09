# Contributing to xopc

Thank you for helping improve **xopc**. This document covers how we manage GitHub issues and pull requests. For day-to-day development conventions, see **[AGENTS.md](./AGENTS.md)**.

Issues and comments may be written in **English or Chinese**. Labels and templates use English for automation and search.

---

## Table of contents

- [Before you open an issue](#before-you-open-an-issue)
- [Issue types](#issue-types)
- [Labels](#labels)
- [Triage process](#triage-process)
- [Pull requests](#pull-requests)
- [Security](#security)
- [Maintainers](#maintainers)

---

## Before you open an issue

| Goal | Where to go |
|------|-------------|
| Bug or regression | [**Bug report** template](https://github.com/xopcai/xopc/issues/new?template=bug_report.yml) |
| Feature idea | [**Feature request** template](https://github.com/xopcai/xopc/issues/new?template=feature_request.yml) |
| How do I configure X? / usage help | [Discussions → Q&A](https://github.com/xopcai/xopc/discussions/categories/q-a) |
| Security vulnerability | [Private security advisory](https://github.com/xopcai/xopc/security/advisories/new) — **not** a public issue |

Blank issues are disabled. Choose a template so we get version, entry point (CLI, gateway, channel, …), and reproduction steps.

**Never** include API keys, bot tokens, OAuth secrets, or full `~/.xopc/xopc.json` in public issues.

---

## Issue types

| Label | When to use |
|-------|-------------|
| `type:bug` | Incorrect or broken behavior |
| `type:enhancement` | New feature or meaningful improvement |
| `type:docs` | Documentation only |
| `type:question` | Should usually be a Discussion instead |
| `type:regression` | Worked in an older release, broken now |
| `type:security` | Tracker label only — report via advisory |
| `type:chore` | CI, deps, internal refactors |

Every actionable issue should also have at least one **`area:*`** label after triage (see [Labels](#labels)).

---

## Labels

### Area (`area:*`)

Maps to major parts of the codebase:

| Label | Typical paths / scope |
|-------|------------------------|
| `area:agent` | `src/agent/` |
| `area:gateway` | `src/gateway/` |
| `area:web-ui` | `web/` |
| `area:cli-tui` | `src/cli/` |
| `area:electron` | Electron packaging |
| `area:channels` | `src/channels/`, `extensions/telegram`, `extensions/weixin` |
| `area:session` | `src/session/` |
| `area:providers` | `src/providers/` |
| `area:config` | `src/config/` |
| `area:extensions` | `src/extensions/`, extension SDK |
| `area:skills` | Skills store / SKILL.md |
| `area:voice` | `src/voice/` |
| `area:ci-release` | `.github/workflows/`, release tooling |

### Priority (`priority:P0` … `P3`)

Set by maintainers during triage:

| Label | Meaning |
|-------|---------|
| `priority:P0` | Critical: data loss, cannot start, security |
| `priority:P1` | Major: core user path broken |
| `priority:P2` | Moderate: workaround exists |
| `priority:P3` | Minor: edge case or polish |

### Status (`status:*`)

Use **one** status label at a time:

| Label | Meaning |
|-------|---------|
| `status:needs-triage` | New; not yet reviewed (added automatically on open) |
| `status:needs-info` | Waiting on the reporter |
| `status:confirmed` | Validated; ready to schedule |
| `status:in-progress` | Someone is actively working on it |
| `status:blocked` | Blocked on upstream or a decision |

### Other

- `roadmap` — multi-release or architectural initiative
- `good first issue` / `help wanted` — community-friendly
- `duplicate` / `invalid` / `wontfix` — closure reasons

### Syncing labels on GitHub

After cloning the repo, maintainers can create or update labels from [`.github/labels.json`](./.github/labels.json):

```bash
./scripts/sync-github-labels.sh
```

Requires the [GitHub CLI](https://cli.github.com/) (`gh`) and write access to the repository.

---

## Triage process

### Maintainer checklist (new issues)

1. Confirm it is not a duplicate; close as `duplicate` with a link if it is.
2. Set `type:*` and at least one `area:*`.
3. Set `priority:*` for bugs and urgent enhancements.
4. Replace `status:needs-triage` with `status:needs-info`, `status:confirmed`, or close.
5. For security reports in public issues, ask the reporter to use an advisory and lock/close.

### Response targets

| Priority | First maintainer response | Goal |
|----------|---------------------------|------|
| P0 | Within 24 hours | Hotfix or documented workaround |
| P1 | Within 48 hours | Scheduled fix or clear next step |
| P2 / P3 | Within 1 week | Backlog or `wontfix` with reason |

Issues labeled `status:needs-info` with no activity may be marked stale after **14 days** and closed after **7 more days** (see [stale workflow](./.github/workflows/stale-issues.yml)). Comment to keep them open.

### GitHub Projects (optional)

We recommend a single project board with columns: **Backlog → Ready → In Progress → In Review → Done**, driven by status labels and linked PRs.

---

## Pull requests

1. Fork and branch from `main`.
2. Use **pnpm** only (`pnpm install`, `pnpm test`, `pnpm run lint`). Requires **Node.js ≥ 22**.
3. Reference issues in the PR body: `Fixes #123` or `Closes #123`.
4. Keep PRs focused; mention breaking changes and config updates in the description.
5. Follow **[AGENTS.md](./AGENTS.md)** for code style, logging, and session/transcript rules.

### Install & build mirrors

If `registry.npmjs.org` is slow or unreachable (common in mainland China):

```bash
pnpm config set registry https://registry.npmmirror.com
```

When building Electron (`pnpm run electron:build`), set both variables before `pnpm install`:

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

Both are required for `electron:build` on macOS (DMG packaging needs `electron-builder-binaries`). Use **electron-builder ≥ 26.11.1** so DMG downloads do not incorrectly use `ELECTRON_MIRROR` (older versions 404 on `cdn.npmmirror.com/binaries/electron/dmg-builder@…`).

PRs that touch specific paths may receive automatic `area:*` labels from the [labeler workflow](./.github/workflows/labeler.yml).

---

## Security

Do **not** file public issues for vulnerabilities. Use [GitHub Security Advisories](https://github.com/xopcai/xopc/security/advisories/new) so maintainers can coordinate a fix before disclosure.

---

## Maintainers

- Run `./scripts/sync-github-labels.sh` when [`.github/labels.json`](./.github/labels.json) changes.
- Enable [Discussions](https://github.com/xopcai/xopc/discussions) with a **Q&A** category if not already present.
- Hold a short weekly triage pass: clear `status:needs-triage`, chase `status:needs-info`, align milestones with releases.

---

## License

By contributing, you agree that your contributions will be licensed under the same license as the project ([MIT](./LICENSE)).
