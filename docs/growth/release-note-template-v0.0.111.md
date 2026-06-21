# v0.0.111 Release Note Draft

> Goal: publish a growth-ready release that improves first-run conversion and gives new visitors a clear reason to star the repo.

## Title

```text
v0.0.111: clearer first run for local-first goal loops
```

## GitHub Release Body

```markdown
This release tightens the first-run path for people trying xopc from GitHub, npm, or a shared demo.

If xopc helps you keep long-term AI work moving, please star the repo:
https://github.com/xopcai/xopc

### What changed

- Added `xopc onboard --quick` for the shortest guided setup path: configure the model, then launch locally.
- Updated README and Chinese README with a clearer product promise, concrete use cases, and a 3-minute local try path.
- Added a lightweight GitHub star hint after onboarding completes.
- Updated getting-started docs so quick onboarding and minimal file setup are clearly separated.

### Try it

```bash
curl -fsSL https://xopc.ai/install.sh | bash
xopc onboard --quick
xopc tui --local
```

### What xopc is for

xopc is a local-first Goal Loop OS: one AI assistant that keeps long-term goals moving across terminal, web, desktop, mobile app, and messengers.

It is built for long-running projects, solo builders, and AI workflows that need BYOK, local-first storage, workflows, cron, skills/extensions, and multi-agent routing.
```

## npm Changelog Summary

```text
Adds xopc onboard --quick and clarifies the first-run path for local-first goal loops.
```

## Post-Release Checklist

- Publish release.
- Confirm `npm view @xopcai/xopc version` returns the new version.
- Confirm GitHub README renders the new first screen.
- Post the X thread from `docs/growth/launch-kit.zh-CN.md`.
- Send the release link to the first 10 direct contacts.
