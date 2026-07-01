# Documentation Quality Plan

This page tracks how xopc documentation should improve from "feature notes" into user-facing product documentation.

## Current Diagnosis

xopc already has broad documentation coverage, but quality is uneven:

- Some pages still mix user guidance, internal design notes, and historical behavior.
- The first-run path now points users to model setup first, an optional personal profile, and then a local or Web chat.
- High-priority task guides now exist for model setup, Telegram, gateway exposure, second agents, and broken setup diagnosis.
- English and Chinese pages can drift, so high-priority user guides should stay paired.
- CLI docs can drift from `xopc --help` and default command behavior as commands are added or renamed.

## Documentation Model

Use the Diataxis split:

| Type | Use for | xopc examples |
| --- | --- | --- |
| Tutorial | Learning by doing with one reliable path | First 5 Minutes, first local TUI chat |
| How-to guide | Completing a concrete user task | Connect Telegram, expose gateway through Tailscale, configure a model |
| Reference | Looking up exact facts while working | CLI commands, `xopc.json`, API routes, template files |
| Explanation | Understanding trade-offs and mental models | Local-first model, gateway architecture, agent routing |

Do not mix these in one page unless the boundary is explicit. A reference page can link to how-to guides; it should not become a tutorial.

## Target Information Architecture

Recommended top-level groups:

| Group | Purpose | Candidate pages |
| --- | --- | --- |
| Start | Get a first successful chat | First 5 Minutes, Getting Started, install paths |
| Use xopc | Work from the main surfaces | TUI, Web console, Desktop, Mobile, Channels, Sessions, Goals |
| Operate xopc | Run and maintain the system | Gateway, remote access, providers/models, logs, doctor, updates |
| Extend xopc | Add capabilities | Agents, skills, extensions, MCP, tools, cron, workflows |
| Reference | Exact lookup | CLI, configuration, API, disk layout, templates |

## First-Pass Fixes Completed

- Added `pnpm run docs:check` to validate Markdown JSON blocks and the CLI command overview.
- Updated the CLI command overview to match current `xopc --help`.
- Fixed copyable config examples in English and Chinese high-traffic pages.
- Updated the Chinese configuration page to the current manifest-first agent model.
- Added task guides for first model setup, Telegram, safe gateway exposure, second agents, and diagnostics.
- Added a stricter configuration reference page for current top-level sections and manifest-first agent shape.

## Backlog

High priority:

- Add task pages for:
  - How to configure Feishu/Lark
  - How to configure Weixin
  - How to set up outbound MCP tools
  - How to configure voice input/output
  - How to install and audit skills
- Decide whether MCP has a public root CLI command. Until then, avoid listing it in the root CLI overview.

Medium priority:

- Generate CLI command tables from command metadata or root/subcommand `--help`.
- Add screenshot-backed Web console guides for settings, models, logs, channels, and agents.
- Turn the long extension page into separate user/developer paths.
- Reduce architecture-first content in the default sidebar.

Quality gates:

- `pnpm run docs:check`
- `pnpm run docs:build`
- Smoke commands: `xopc --help`, `xopc gateway --help`, `xopc agents --help`, `xopc models --help`
- JSON examples should parse and should not repeat keys.
- English content should be updated first, then Chinese pages should be synchronized before release.
