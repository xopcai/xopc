# Terminal interface

The terminal interface is a full-screen local Chat client. Run it when you want interactive xopc without opening the desktop or browser console.

## Start

```bash
xopc
```

This is the same as:

```bash
xopc tui
```

It uses the current xopc profile, default Agent, model configuration, and local Session store.

## Resume work

```bash
xopc resume
xopc resume <session-key>
```

Use `xopc session list` if you do not know the key.

## Connect to a Gateway

Use Gateway mode when the Sessions and Agents live on another running xopc instance:

```bash
xopc tui --gateway
xopc tui --url <gateway-url>
```

Provide the Gateway token through the supported prompt or option. Do not include it in shared shell history.

## TUI or interactive CLI?

| Mode | Best for |
| --- | --- |
| `xopc` / `xopc tui` | Full-screen conversation with live progress |
| `xopc agent -i` | Simple line-oriented interactive use |
| `xopc agent -m "…"` | One request from a script or shell |

## Troubleshooting

- TUI exits immediately: run `xopc doctor` and `xopc models status`.
- Text display is broken: use a UTF-8 terminal and a font with the required characters.
- Wrong Agent or Sessions: check `xopc profile list`, `xopc config path`, and the Gateway URL.
- Remote progress disconnects: verify the tunnel/network and run `xopc gateway health` on the host.

## Conversation controls

- `Shift+Tab` or `/plan [on|off]`: switch planning mode. Plan allows inspection, questions and commands inside a read-only OS sandbox, and blocks writes, publishing and implementation delegation.
- `/permissions`: choose read-only, a workspace sandbox with command networking on/off, or the configured Agent policy. macOS uses sandbox-exec and Linux requires bubblewrap; unavailable sandbox support fails explicitly. Stop active runs, background jobs and subagents before changing it.
- `/answer`: reopen a pending question or approval. Approval choices explicitly distinguish Allow and Deny.
- `/ps [id]`, `/stop <id|all>`, `/stdin <id> <text>`: inspect and control this conversation's background processes. Jobs created with tty:true use a real terminal; other jobs use a pipe. `/terminal <id>` attaches to a PTY, and Ctrl+] detaches without stopping it.
- `/subagents [id]`, `/subagents stop <id>`: watch delegated work, open its saved transcript, steer, stop or resume it.
- `/diff`: inspect staged, unstaged and untracked changes. `/review` starts the existing review flow.
- `/side [question]`: open a temporary side conversation. Enter on its answer asks a follow-up; Escape closes it.
- `/raw`: browse the persisted transcript as JSON. `/copy` copies the last answer; `/copy code` chooses a fenced code block.
- `/rename <name>`, `/archive`, `/delete`: manage the current conversation. Archive and delete ask for confirmation.
- `/new` starts another conversation; `/clear` also clears the view; `/reset` replaces the transcript within the same conversation.
- `/pwd` shows the execution host and workspace. `/skills`, `/mcp`, `/plugins` expose available capabilities; MCP supports probes, tools and sign-in; plugins support marketplace browsing, capability review, installation, updates, setup and account authorization.

Use `Ctrl+R` to search prompt history, `Ctrl+O` to copy the last answer, and `Ctrl+L` to clear the view. `/hotkeys` shows configured bindings.

Attach local PNG, JPEG, GIF or WebP files with `xopc tui --image <files...>` or `/attach <path>`. `/attachments` lists them; `/attachments <number>` removes one and `/attachments clear` removes all. Attachment paths refer to the machine running the terminal, including in Gateway mode.

Removed aliases such as `/quit`, `/btw`, `/aside`, `/clone`, and `/name` are rejected. Use `/exit`, `/side`, `/fork`, and `/rename`. `/models`, `/switch`, and `/session` were also removed; use `/model list`, `/model <provider/model>` and `/status`. Goal is outside this alignment scope.

`/archived` opens archived transcripts or restores a conversation. `/search <text>` searches transcript content and jumps to a selected result. In output and diff viewers, `/` searches, `n`/`N` moves between matches, `g` jumps to a line, and `[`/`]` navigates diff files.

`/mcp [probe|tools|login|logout] <server>` exposes connection actions. `/plugins` opens the installed/marketplace menu; `/plugins install <source>` reviews capabilities before installation. Plugin configuration files are read from the terminal's machine.

`/cd <path>` changes the workspace on the execution host, subject to project locks. `/worktree [list|create [base]|use <id>|remove <id>]` manages project worktrees; changes require idle execution. In Gateway mode, `!` and `!!` run locally using the local launch directory.

Sandbox networking controls command processes; it does not disable model API requests or independent MCP/web tools. Domain-level dynamic network approvals are not implemented. Windows native sandboxing is unavailable. Completed process logs survive restart; live OS processes do not.
