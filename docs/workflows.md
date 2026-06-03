# Dynamic Workflows

xopc workflows let one prompt fan out across many isolated subagents and merge their results back. Use them for tasks that are **decomposable** — repo audits, multi-perspective reviews, fan-out research, large refactors — where running one big assistant turn would either lose track or pollute the conversation with intermediate tool output.

A workflow is a small deterministic JavaScript script. The model writes it, the `workflow` tool runs it in a sandbox, and you see a live progress tree until the synthesised result lands.

## How to run one

You almost never write the script yourself — describe the goal in plain language, the model decides whether a workflow fits. There are three ways a workflow gets triggered:

1. **Implicit (most common)** — say things like *"do a thorough audit of this repo"*, *"research X from multiple angles"*, *"review this plan from several perspectives"*. The model picks `workflow` over a single subagent on its own.
2. **By name** — once you have saved workflows, just reference one: *"/audit_repo"*, *"run the audit_repo workflow"*, *"do a research workflow on bun vs node startup"*. In the TUI, typing `/<name>` is automatically rewritten into the correct prompt, so `/audit_repo` always triggers `audit_repo`.
3. **Inline** — you can hand the model an explicit script, but that is power-user territory.

When a workflow starts, the TUI and gateway show a progress tree that grows as subagents fan out:

```
◆ workflow: audit_repo (7/12 done, 3 running)
  ✓ Inventory 1/1
    #1 ✓ repo inventory
  ▶ Review 4/6 · 2 running
    #2 ✓ bugs review
    #3 ✓ perf review
    #4 ✓ security review
    #5 ✓ tests review
    #6 ● style review
    #7 ● docs review
  ▶ Synthesize 0/1
    #8 ● report synthesis
```

Press `Esc` (TUI) or run `/abort` to cancel. In-flight subagents are aborted and surface as `skipped`.

## The `/workflows` command

| Command | What it does |
|---|---|
| `/workflows` | List built-in + user workflows with their descriptions. |
| `/workflow list` | Alias of `/workflows`. |
| `/workflow view <name>` | Show a workflow's source script (truncated past 200 lines). |
| `/workflow save <name>` | Save the script of the most recently successful workflow in this session to `~/.xopc/workflows/<name>.js`. |
| `/<name>` | TUI shortcut. Rewritten into *"Run the `<name>` workflow"* and sent to the assistant. |

The list and view commands are read-only and just return text. To actually run a workflow, the assistant has to call the `workflow` tool — that happens automatically via the rewrites described above.

## Built-in workflows

| Name | What it does | Args |
|---|---|---|
| `audit_repo` | Fan-out repository audit (bugs / perf / security / tests / style), then a synthesised report. | none |
| `multi_perspective_review` | Review a target through 4 lenses (User / Operator / Skeptic / Maintainer), then an adversarial judge. | `{ target: string }` |
| `research` | Multi-angle research sweep with a cited synthesis. | `{ question: string }` |

Inspect any of them with `/workflow view <name>`.

## Saved workflows

Two ways to save:

- **`/workflow save <name>`** — capture the script of the most recent successful workflow in this session. If you saved it under a different name than the original `meta.name`, the meta field is rewritten to match so the file is addressable as `/<name>`. Memory is per-process: a restart clears it, so save while it's still fresh.
- **Manual** — drop a `.js` file at `~/.xopc/workflows/<name>.js`. The filename must match `meta.name` (e.g. `audit_repo.js` → `meta.name: 'audit_repo'`).

Both paths land in the same dir. `/workflows` reflects new files immediately. User workflows always win on name collision with a built-in, so you can override `audit_repo` with your own tuned version.

## Writing your own

A workflow is plain JavaScript with a strict header. The first statement must be a literal `export const meta = { ... }` so the catalog can index the file without executing it.

```js
export const meta = {
  name: 'release_notes',
  description: 'Draft release notes from the last N commits.',
  whenToUse: 'User asks for release notes, changelog, or "what changed since".',
  phases: [{ title: 'Collect' }, { title: 'Draft' }],
}

const since = args && typeof args === 'object' && args.since ? String(args.since) : 'origin/main'

phase('Collect')
const log = await agent(
  `Run \`git log ${since}..HEAD --oneline\` and return the raw output.`,
  { label: 'git log' },
)

phase('Draft')
return await agent(
  'Draft release notes from this git log. Group by feat/fix/chore. Keep it short.\n\n' + log,
  {
    label: 'draft notes',
    schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        sections: {
          type: 'object',
          properties: {
            feat: { type: 'array', items: { type: 'string' } },
            fix:  { type: 'array', items: { type: 'string' } },
            chore: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      required: ['summary'],
    },
  },
)
```

### Available globals

| Global | Description |
|---|---|
| `agent(prompt, opts?)` | Spawn one fresh subagent. Returns its final assistant text — or, when `opts.schema` is provided, a validated object. Failures resolve to `null`; the workflow keeps going. |
| `parallel(thunks)` | Run an array of `() => agent(...)` thunks concurrently. Results are returned in input order. Must be thunks, not promises — the limiter only sees thunks. |
| `pipeline(items, ...stages)` | Run each item through sequential stages while different items fan out. Each stage receives `(prev, original, index)`. A stage that throws drops that item to `null`. |
| `phase(title)` | Mark the current progress group. Subsequent `agent()` calls are bucketed under it. Phases can be created in loops or conditionals — empty phases never render. |
| `log(message)` | Append a workflow-level log line. Shown under the progress tree. |
| `args` | Whatever JSON was passed to the workflow tool's `args` parameter. |
| `cwd` / `process.cwd()` | Working directory shown to subagents. |
| `budget` | `{ total, spent(), remaining() }`. `total` is `null` unless a token budget was configured. |

### `agent()` options

```ts
agent(prompt, {
  label?: string,            // short text shown in the progress tree
  phase?: string,            // override the current phase()
  schema?: JsonSchema,       // when set, return value is validated against this
  toolset?: string[],        // subagent tool allowlist (default DEFAULT_DELEGATE_TOOLS)
  maxIterations?: number,    // subagent tool-iteration cap (default 30)
  model?: string,            // currently a hint; subagents default to the parent model
})
```

### Determinism rules

The sandbox intentionally rejects a few APIs so workflow runs stay reproducible (and so future resume / journaling can be added without breaking existing scripts):

- `Date.now()`, `new Date()`, `Math.random()`
- `require`, `import`, dynamic `eval`
- `fs`, network APIs, anything not in the globals table

If you need a timestamp, pass it in via `args` and stamp results after the workflow returns. If you need randomness, vary the prompt by index.

### Failures

Every `agent()`, `parallel()` entry, and `pipeline()` item that throws resolves to `null` (the failure is logged). Always filter or check before synthesising:

```js
const live = findings.filter(Boolean)
if (!live.length) return { ok: false, reason: 'no findings' }
```

## Combining with cronjob

The `cronjob` tool runs prompts on a schedule. A scheduled prompt that names a saved workflow turns into a recurring fan-out:

> `/cronjob 0 9 * * 1 "Run the audit_repo workflow and summarise the top 3 risks."`

The cron fire writes the prompt as a user turn, the assistant calls `workflow({name:'audit_repo'})`, and the synthesised result is delivered to the configured channel. See [Scheduled Tasks (Cron)](cron.md) for the full cron surface.

## Combining with todo

Workflows can produce checklists for the `todo` tool. The simplest pattern is to ask the model to convert a workflow result into todos as a follow-up turn:

> "Run the multi_perspective_review workflow on this plan, then turn the confirmed risks into a todo list."

If you want a workflow itself to produce a `todo`-shaped output, return a structured object whose `topRisks` (or similar) array can be fed straight into `todo({merge:true, todos:[...]})`. The synthesis agent is the natural place to shape it.

## Progress visibility per surface

| Surface | What you see during a run |
|---|---|
| TUI (`xopc tui --local`) | Live progress tree, updated on every snapshot change. |
| Gateway console | Live WorkflowCard — progress tree streams in via SSE `tool_update`, the result summary lands when `tool_end` fires, and inline cancel / save actions are wired to the active turn. |
| Telegram | **Live, edit-in-place.** A single message is sent at the start and edited every 5 s (default), with key events — phase change, new error, completion — bypassing the throttle for prompt visibility. |
| Feishu / Lark | **Live, edit-in-place.** Same edit-in-place flow as Telegram (`im.v1.message.update`); 5 s default throttle. |
| WeChat | **Final result only** by design. WeChat (personal/ilink bots) does not expose an editMessage API for bot replies, so live edits would have to spam the chat with a fresh message per tick. The broker silently drops mid-run snapshots and sends a single summary on completion. |

### Per-channel configuration

Each channel uses sensible defaults; override under `channels.<id>.workflowProgress` when you need to:

```jsonc
{
  "channels": {
    "telegram": {
      "workflowProgress": {
        "enabled": true,      // default true; set false to silence the channel
        "throttleMs": 5000,   // default 5 s — Telegram limits ≈1 edit/sec/chat
        "mode": "edit"        // 'edit' (default), 'append', or 'final-only'
      }
    },
    "feishu": {
      "workflowProgress": {
        "enabled": true,
        "throttleMs": 5000,
        "mode": "edit"        // default; Feishu im.v1.message.update is supported
      }
    },
    "weixin": {
      "workflowProgress": {
        "enabled": true,
        "throttleMs": 60000,
        "mode": "final-only"  // default; WeChat has no editMessage
      }
    }
  }
}
```

All fields are optional; missing fields fall back to the capability's defaults.

### Experimental — WeChat `append` mode

WeChat ships in `final-only` mode by default because the platform exposes no `editMessage` API for bot replies — without it, every "tick" would be a fresh message.

If you'd rather see milestones land as separate WeChat messages (e.g. during a 5-minute audit), flip the channel to `append` mode and lengthen the throttle so the chat doesn't get noisy:

```jsonc
{
  "channels": {
    "weixin": {
      "workflowProgress": {
        "enabled": true,
        "mode": "append",
        "throttleMs": 60000
      }
    }
  }
}
```

What you'll see:

- A header line on every mid-run message — `▾ 工作流进展` — so they're easy to scan vs. unrelated chat.
- A different header on the final message — `✓ 工作流完成` — followed by the result summary.
- Key events (phase change, new error, completion) bypass `throttleMs` and arrive promptly. Normal updates only land at the throttle interval.
- For a 3-minute, 3-phase workflow you'd typically see **3–6 messages** total. Below 60 s throttle and you risk hitting WeChat's anti-spam.

This is experimental — defaults will not change unless real-world usage confirms the cadence works for users.

## Configuration

All settings live under `agents.defaults.workflow` in `~/.xopc/xopc.json`. Defaults are tuned for the common case and you usually don't need to touch them:

```jsonc
{
  "agents": {
    "defaults": {
      "workflow": {
        "enabled": true,           // set to false to drop the workflow tool entirely
        "maxConcurrency": 16,      // upper bound on parallel subagents per workflow run
        "maxSubagents": 1000,      // hard cap on total subagents in one run (runaway guard)
        "defaultTimeoutSec": 1800  // wall-clock timeout per workflow run (30 min)
      }
    }
  }
}
```

Subagents inherit the parent agent's primary model. Per-call `agent({ model: '...' })` is currently passed as text guidance only — model overrides per call may move to a real resolver in a later release.

## Limits and what's not in v1

- No journaling / resume — a workflow that aborts mid-run starts over.
- No nested workflows — `agent()` does not have access to `workflow()`.
- No `/workflow save` — to save a one-off script, drop the file manually.
- IM channels show the final result only (see table above).

These are intentional v1 cuts; the runtime keeps determinism (no `Date.now`/`Math.random`) so future journaling can be added cleanly.
