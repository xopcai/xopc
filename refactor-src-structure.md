# `src/` Directory Structure Refactor Guide

> **Purpose:** This document guides AI agents and developers in refactoring the `src/` directory to improve clarity, layering, and maintainability. Follow KISS, SOLID, and Occam's Razor principles throughout.
>
> **Scope:** Directory renames, file relocations, and consolidations only. No logic changes.

---

## Current Problems Overview

| Priority | Issue | Principle Violated |
|----------|-------|-------------------|
| 🔴 High | `src/commands/` vs `src/cli/commands/` — same name, different semantics | KISS |
| 🔴 High | `src/extensions/` vs `src/extension-sdk/` — confusingly similar names | KISS |
| 🔴 High | `src/agent/` root has 25 loose `.ts` files alongside 13 subdirectories | SRP |
| 🔴 High | `src/utils/` is a catch-all mixing audio, media, logging, markdown parsing | SRP |
| 🟡 Medium | `src/attachments/` — only 2 files, not worth a top-level directory | Occam's Razor |
| 🟡 Medium | `src/bus/` — only 2 files, belongs in `src/infra/` | Occam's Razor |
| 🟡 Medium | `src/heartbeat/` — only 2 files, belongs in `src/gateway/` | Occam's Razor |
| 🟡 Medium | `src/types/` — 3 files, types should live next to their domain | Occam's Razor |
| 🟡 Medium | `src/markdown/frontmatter.ts` duplicated in `src/utils/frontmatter.ts` | DRY |

---

## Change 1 — Rename `src/commands/` → `src/chat-commands/`

### Why

Both `src/commands/` and `src/cli/commands/` are named `commands`, but they serve completely different purposes:

- `src/commands/` = **in-chat slash commands** (e.g. `/model`, `/session`, `/thinking`) processed at runtime inside a conversation
- `src/cli/commands/` = **CLI subcommands** (e.g. `xopcbot agent`, `xopcbot gateway`) registered via `commander`

This naming collision is the single biggest source of confusion for new contributors.

### Action

```
RENAME: src/commands/ → src/chat-commands/
```

Update all imports referencing `'../commands'`, `'../../commands'`, or `'src/commands'` to point to `src/chat-commands`.

### Files affected

```
src/commands/command-parse.ts
src/commands/context.ts
src/commands/index.ts
src/commands/processor.ts
src/commands/registry.ts
src/commands/session-key.ts
src/commands/types.ts
src/commands/builtins/model.ts
src/commands/builtins/session.ts
src/commands/builtins/system.ts
src/commands/builtins/thinking.ts
src/commands/builtins/tts.ts
```

---

## Change 2 — Merge `src/extension-sdk/` into `src/extensions/sdk/`

### Why

`src/extension-sdk/` contains only 3 files and its name is nearly identical to `src/extensions/`. A new contributor cannot tell them apart at a glance. The SDK helpers are logically part of the extension system.

### Action

```
MOVE: src/extension-sdk/channel-entry.ts   → src/extensions/sdk/channel-entry.ts
MOVE: src/extension-sdk/channel-helpers.ts → src/extensions/sdk/channel-helpers.ts
MOVE: src/extension-sdk/index.ts           → src/extensions/sdk/index.ts
DELETE: src/extension-sdk/ (directory)
```

The public package export `@xopcai/xopcbot/extension-sdk` must be updated in `package.json` exports map to point to the new path.

---

## Change 3 — Tidy `src/agent/` root (25 loose files → grouped into subdirectories)

### Why

`src/agent/` has 25 `.ts` files sitting directly in the root alongside 13 subdirectories. Many of these files already have a natural home in an existing subdirectory.

### Action — move files into existing subdirectories

#### → `src/agent/tools/`

```
MOVE: src/agent/tool-executor.ts        → src/agent/tools/executor.ts
MOVE: src/agent/tool-chain-tracker.ts   → src/agent/tools/chain-tracker.ts
MOVE: src/agent/tool-error-tracker.ts   → src/agent/tools/error-tracker.ts
MOVE: src/agent/tool-usage-analyzer.ts  → src/agent/tools/usage-analyzer.ts
MOVE: src/agent/agent-tools-factory.ts  → src/agent/tools/factory.ts
MOVE: src/agent/error-pattern-matcher.ts → src/agent/tools/error-pattern-matcher.ts
```

#### → `src/agent/session/`

```
MOVE: src/agent/session-tracker.ts → src/agent/session/tracker.ts
```

#### → `src/agent/prompt/`

```
MOVE: src/agent/system-prompt.ts   → src/agent/prompt/system-prompt.ts
MOVE: src/agent/system-reminder.ts → src/agent/prompt/system-reminder.ts
```

#### → `src/agent/lifecycle/`

```
MOVE: src/agent/hook-handler.ts    → src/agent/lifecycle/hook-handler.ts
MOVE: src/agent/progress.ts        → src/agent/lifecycle/progress.ts
MOVE: src/agent/timeout-wrapper.ts → src/agent/lifecycle/timeout-wrapper.ts
MOVE: src/agent/typing.ts          → src/agent/lifecycle/typing.ts
```

#### → `src/agent/models/`

```
MOVE: src/agent/request-limiter.ts → src/agent/models/request-limiter.ts
```

#### → new `src/agent/subagent/`

```
MOVE: src/agent/subagent-manager.ts  → src/agent/subagent/manager.ts
MOVE: src/agent/subagent-registry.ts → src/agent/subagent/registry.ts
```

#### → new `src/agent/context/`

```
MOVE: src/agent/workspace.ts       → src/agent/context/workspace.ts
MOVE: src/agent/project-context.ts → src/agent/context/project-context.ts
MOVE: src/agent/helpers.ts         → src/agent/context/helpers.ts
```

#### Stay in root (core entry points only)

```
src/agent/service.ts              ← core service
src/agent/runner.ts               ← core runner
src/agent/agent-manager.ts        ← manager
src/agent/agent-registry.ts       ← registry
src/agent/index.ts                ← public exports
src/agent/types.ts                ← shared types
src/agent/types.agent-defaults.ts ← agent defaults
```

### Expected result

`src/agent/` root drops from **25 files** to **8 files**, with all domain logic properly grouped.

---

## Change 4 — Slim down `src/utils/` (remove catch-all pattern)

### Why

`src/utils/` currently mixes audio processing, media handling, logging infrastructure, and markdown parsing — four unrelated domains. This is a classic "junk drawer" anti-pattern.

### Action

#### Logger — consolidate into `src/utils/logger/`

The `logger/` subdirectory already exists. Move the root-level logger files into it:

```
MOVE: src/utils/logger.ts       → src/utils/logger/logger.ts  (or merge into logger/index.ts)
MOVE: src/utils/logger.types.ts → src/utils/logger/types.ts
MOVE: src/utils/log-store.ts    → src/utils/logger/log-store.ts
MOVE: src/utils/log-stream.ts   → src/utils/logger/log-stream.ts
```

Update `src/utils/logger/index.ts` to re-export everything so existing import paths `from 'src/utils/logger'` continue to work.

#### Audio — move to `src/tts/`

Audio utilities belong with the TTS domain, not in generic utils:

```
MOVE: src/utils/audio.ts → src/tts/audio.ts
```

#### Media — move to `src/channels/`

Media handling is used by channel inbound/outbound pipelines:

```
MOVE: src/utils/media.ts → src/channels/media.ts
```

#### Frontmatter — deduplicate (see Change 5)

```
REMOVE: src/utils/frontmatter.ts  (after verifying src/markdown/frontmatter.ts covers all usages)
```

#### What remains in `src/utils/`

```
src/utils/helpers.ts   ← only truly cross-cutting generic utilities
src/utils/logger/      ← all logging (consolidated)
src/utils/index.ts
```

> **Note:** If `helpers.ts` grows, split it by domain rather than adding more files to `utils/`.

---

## Change 5 — Deduplicate `frontmatter.ts`

### Why

`src/markdown/frontmatter.ts` and `src/utils/frontmatter.ts` both exist. This is a DRY violation.

### Action

1. Audit all import sites for both files
2. Determine which implementation is more complete
3. Keep `src/markdown/frontmatter.ts` as the canonical location (it belongs to the markdown domain)
4. Update all imports that reference `src/utils/frontmatter` to point to `src/markdown/frontmatter`
5. Delete `src/utils/frontmatter.ts`

---

## Change 6 — Absorb `src/attachments/` into `src/channels/`

### Why

`src/attachments/` contains only `inbound-persist.ts` + its test. Attachment persistence is part of the channel inbound pipeline.

### Action

```
MOVE: src/attachments/inbound-persist.ts → src/channels/attachments/inbound-persist.ts
MOVE: src/attachments/__tests__/         → src/channels/attachments/__tests__/
DELETE: src/attachments/ (directory)
```

---

## Change 7 — Absorb `src/bus/` into `src/infra/`

### Why

`src/bus/` has only `index.ts` + `queue.ts`. The message bus is infrastructure, and `src/infra/` already exists for exactly this kind of primitive (retry, rate-limit, debounce).

### Action

```
MOVE: src/bus/index.ts → src/infra/bus/index.ts
MOVE: src/bus/queue.ts → src/infra/bus/queue.ts
DELETE: src/bus/ (directory)
```

Update all imports from `'src/bus'` → `'src/infra/bus'`.

---

## Change 8 — Absorb `src/heartbeat/` into `src/gateway/`

### Why

`src/heartbeat/` has only `index.ts` + `service.ts`. Heartbeat is a gateway-level concern (keep-alive pings to the HTTP server).

### Action

```
MOVE: src/heartbeat/index.ts   → src/gateway/heartbeat/index.ts
MOVE: src/heartbeat/service.ts → src/gateway/heartbeat/service.ts
DELETE: src/heartbeat/ (directory)
```

---

## Change 9 — Dissolve `src/types/` top-level directory

### Why

`src/types/` has only 3 files and acts as a grab-bag. Types should live next to the domain that owns them.

### Action

```
MOVE: src/types/cli-table3.d.ts → src/cli/types/cli-table3.d.ts
MOVE: src/types/thinking.ts     → src/agent/transcript/thinking.ts
                                   (or merge with existing src/agent/transcript/thinking.ts)
MOVE: src/types/index.ts        → distribute exports to relevant modules
DELETE: src/types/ (directory)
```

---

## Target Top-Level Structure

After all changes, `src/` should have **18 directories** (down from 26):

```
src/
├── acp/              ← ACP protocol (unchanged)
├── agent/            ← Agent core (root tidied to ~8 files)
├── auth/             ← Authentication & OAuth (unchanged)
├── channels/         ← Channel plugins + attachments (absorbed attachments/)
├── chat-commands/    ← ⭐ Renamed from commands/ — in-chat slash commands
├── cli/              ← CLI entry points (unchanged)
├── config/           ← Configuration schema & loader (unchanged)
├── cron/             ← Scheduled jobs (unchanged)
├── daemon/           ← OS daemon / service installer (unchanged)
├── errors/           ← Error definitions (unchanged)
├── extensions/       ← Extension runtime + sdk/ subdirectory (absorbed extension-sdk/)
├── gateway/          ← HTTP/SSE server + heartbeat/ subdirectory (absorbed heartbeat/)
├── infra/            ← Infrastructure primitives + bus/ subdirectory (absorbed bus/)
├── markdown/         ← Markdown processing, canonical frontmatter (unchanged)
├── providers/        ← LLM provider registry (unchanged)
├── routing/          ← Message routing (unchanged)
├── session/          ← Session store (unchanged)
├── stt/              ← Speech-to-text (unchanged)
├── tts/              ← Text-to-speech + audio.ts (absorbed from utils/)
└── utils/            ← Slimmed: logger/ + helpers.ts only
```

**Removed top-level directories:** `attachments/`, `bus/`, `extension-sdk/`, `heartbeat/`, `types/` (5 removed)

---

## Execution Order

Perform changes in this order to minimize broken imports at each step:

1. **Change 5** — Deduplicate `frontmatter.ts` (no directory changes, lowest risk)
2. **Change 1** — Rename `src/commands/` → `src/chat-commands/`
3. **Change 2** — Merge `src/extension-sdk/` → `src/extensions/sdk/`
4. **Change 9** — Dissolve `src/types/`
5. **Change 6** — Absorb `src/attachments/` → `src/channels/attachments/`
6. **Change 7** — Absorb `src/bus/` → `src/infra/bus/`
7. **Change 8** — Absorb `src/heartbeat/` → `src/gateway/heartbeat/`
8. **Change 4** — Slim down `src/utils/`
9. **Change 3** — Tidy `src/agent/` root (largest change, do last)

---

## Constraints for Executing Agents

- **No logic changes.** Only move/rename files and update import paths.
- **Run `pnpm test` after each change group** to catch broken imports early.
- **Update `package.json` exports** if any moved file is a public package entry point (especially `extension-sdk`).
- **Update `AGENTS.md`** "Project Structure" and "When Making Changes" tables after all changes are complete.
- **Do not merge** `src/acp/`, `src/auth/`, `src/config/`, `src/cron/`, `src/daemon/`, `src/markdown/`, `src/providers/`, `src/routing/`, `src/session/`, `src/stt/` — these are well-scoped and should remain as-is.
- After each file move, search for all import references using `grep -r` or `file_grep` before deleting the source.

---

_Generated: 2026-03-25 | Based on full `src/` directory audit_
