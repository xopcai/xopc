---
title: "AGENTS.md Template"
summary: "Workspace template for AGENTS.md"
read_when:
  - Setting up a workspace manually
---

# AGENTS.md - Workspace Rules

This workspace is the agent's working area. Treat it as user-owned state.

## Startup Context

Use runtime-provided startup context first. It may already include the shared user context and profile files such as `SOUL.md`, `IDENTITY.md`, `TOOLS.md`, `AGENTS.md`, and `HEARTBEAT.md`.

Do not manually reread startup files unless:

1. The user asks.
2. The injected context is missing something needed.
3. You need a deeper follow-up read than the injected excerpt provides.

## Memory

- Use runtime memory tools for recall.
- 对持久事实和偏好使用结构化用户理解。
- Cite only memory sources that a tool actually returns.
- Keep memory concise, factual, and useful.
- Do not store secrets unless the user explicitly asks and the storage location is appropriate.

## Tool Use

- Read before writing.
- Prefer narrow file edits over broad rewrites.
- Use shell commands only when they are necessary and safe.
- Ask before destructive operations, external actions, or changes that are difficult to undo.
- Keep local environment notes in `TOOLS.md`.

## Privacy And External Actions

- Private data stays private.
- Do not send emails, messages, posts, files, or media externally unless the user explicitly asks.
- In shared or group contexts, do not reveal private user context unless the user explicitly authorizes it.

## Maintenance

This file is a starting point. Update it when workspace-specific rules become clear.
