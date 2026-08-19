# CLI Command Reference

xopc provides a rich set of CLI commands for management, conversation, and configuration.

## Usage

### Install from npm (recommended)

```bash
npm install -g @xopcai/xopc
xopc              # opens the local TUI
xopc <command>
```

### Run from source (development)

```bash
git clone https://github.com/xopcai/xopc.git
cd xopc
pnpm install

pnpm run dev --          # opens the local TUI
pnpm run dev -- <command>
pnpm run dev:init        # initialize isolated dev state in ~/.xopc-dev
pnpm run dev:gateway     # start gateway with ~/.xopc-dev and info logs
```

`dev:init` / `dev:gateway` set `XOPC_STATE_DIR`, `XOPC_CONFIG(_PATH)`, `XOPC_LOG_DIR`, and `XOPC_LOG_LEVEL=info` so source-run gateway work does not touch the normal `~/.xopc` state. Pass gateway options after `--`, for example `pnpm run dev:gateway -- --port 18791`.

> **Note:** Examples in this document use `xopc`. If running from source, replace with `pnpm run dev --`.

---

## Command Overview

| Command | Description |
|---------|-------------|
| `init` | Initialize xopc state directories, config, and agent workspace |
| `setup` | Initialize config and workspace |
| `profile` | Manage isolated state profiles |
| `onboard` | Interactive setup wizard |
| `channels` | Channel catalog/config management and DM pairing approval (`channels pairing approve`) |
| `auth` | Manage authentication credentials |
| `agent` | Chat with Agent |
| `tui` | Full-screen terminal UI (embedded by default; gateway optional) — see [TUI](./tui.md) |
| `resume` | Resume a previous TUI session directly or choose one interactively |
| `tunnel` | Manage FRP remote access tunnel |
| `gateway` | Start REST gateway |
| `session` | Manage sessions |
| `doctor` | Check installation health and diagnose common issues |
| `update` | Check for and install xopc updates (extension sync + gateway restart) — see [Updates](./update.md) |
| `logs` | Manage and query logs |
| `project` | Manage long-running projects |
| `config` | View/edit configuration |
| `image` | Inspect image runtime behavior and provider availability |
| `models` | List and manage models and model auth |
| `providers` | Manage LLM provider credentials |
| `voice` | Configure text-to-speech output |
| `search` | Manage web-search providers |
| `skills` | Manage skills |
| `tailscale` | Show Tailscale status for gateway remote access |
| `browser` | Browser automation commands |
| `agents` | Manage multi-agent entries in config (`list`, `add`, `delete`) |
| `extensions` | Manage extensions |
| `connectors` | Browse and install verified connector capabilities from xopc-store |

MCP server management is documented in [MCP](./mcp.md). It is currently not shown as a root command in `xopc --help`; use the gateway settings and MCP configuration docs for supported setup paths.

### Subcommand index

Use `xopc <command> --help` for option-level details. This table tracks the commands currently exposed by `xopc --help`.

| Command | Supported subcommands |
|---------|-----------------------|
| `init` | No subcommands |
| `setup` | No subcommands |
| `profile` | `list`, `create`, `delete`, `switch` |
| `onboard` | No subcommands |
| `channels` | `list`, `show`, `enable`, `disable`, `config`, `pairing` |
| `auth` | `list`, `set`, `get`, `remove`, `login`, `logout`, `profiles`, `clear`, `providers` |
| `agent` | No subcommands |
| `tui` | No subcommands |
| `resume` | No subcommands |
| `tunnel` | `prefetch`, `consent`, `secret`, `start`, `stop`, `status`, `qr`, `broker` |
| `gateway` | `token`, `status`, `health`, `call`, `probe`, `stop`, `restart`, `logs`, `service`, `ssh-tunnel` |
| `session` | `list`, `info`, `delete`, `delete-many`, `rename`, `tag`, `untag`, `archive`, `unarchive`, `pin`, `unpin`, `search`, `grep`, `export`, `stats`, `cleanup` |
| `doctor` | No subcommands |
| `update` | No subcommands |
| `logs` | `list`, `query`, `stats`, `tail`, `clean`, `rotate` |
| `project` | `list`, `new`, `show`, `update`, `archive`, `attach-session`, `detach-session`, `sessions`, `tasks` |
| `config` | `get`, `set`, `unset`, `show`, `validate`, `token`, `path` |
| `image` | `status`, `providers` |
| `models` | `list`, `status`, `set`, `auth` (`list`, `login`, `paste-api-key`, `logout`) |
| `providers` | `list`, `set-key`, `unset-key`, `schema` |
| `voice` | `status`, `enable`, `disable`, `schema` |
| `search` | `list`, `add`, `remove`, `schema` |
| `skills` | `list`, `install`, `enable`, `disable`, `status`, `audit`, `config`, `hub`, `test` |
| `tailscale` | `status` |
| `browser` | `open`, `state`, `click`, `type`, `screenshot`, `validate`, `run`, `doctor`, `close`, `cloakbrowser`, `extension` |
| `agents` | `list`, `add`, `delete` |
| `extensions` | `list`, `inspect`, `freeze`, `health`, `verify`, `doctor`, `audit`, `pack`, `create`, `dev`, `install`, `search`, `publish`, `update` |
| `connectors` | `list`, `install` |

---

## setup

Initialize config file and workspace directory only.

```bash
xopc setup
```

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `--workspace <path>` | Workspace directory path |

**Examples:**

```bash
# Create default config and workspace
xopc setup

# Custom workspace path
xopc setup --workspace ~/my-workspace
```

**What it does:**
- Creates `~/.xopc/xopc.json` (if not exists)
- Creates workspace directory with profile Markdown templates

For full state directory layout (agents, logs, profile seeds), use **`xopc init`** instead.

---

## init

Initialize the full xopc state tree (config, `agents/<id>/`, logs, profile Markdown seeds).

```bash
xopc init
xopc init --agent-id coder
xopc init --force
```

| Option | Description |
|--------|-------------|
| `--force` | Re-run initialization steps |
| `--skip-workspace` | Skip profile Markdown seed files |
| `--agent-id <id>` | Agent id to initialize (default: `main`) |

---

## profile

Manage isolated state profiles (`~/.xopc` for `default`, `~/.xopc-<name>` otherwise). Switching profiles sets `XOPC_PROFILE` in your shell.

```bash
xopc profile list
xopc profile create staging
xopc profile switch staging
xopc profile delete staging --force
```

---

## onboard

Interactive setup wizard for xopc. The first-run path focuses on model credentials and the default chat model; the Web console can optionally collect a personal profile before opening chat. Gateway defaults remain `127.0.0.1:18790` with token auth and no prompts for bind/port/token.

```bash
xopc onboard
```

**Options:**

| Option | Description |
|--------|-------------|
| `--model` | Configure LLM provider and model only |
| `--channels` | Configure messaging channels only |
| `--gateway` | Apply default gateway settings (quiet) |
| `--all` | Configure everything (default) |

**Examples:**

```bash
# Guided first-run setup (default)
xopc onboard

# Configure LLM model only
xopc onboard --model

# Configure channels only
xopc onboard --channels
```

**Features:**
- Auto-detects if workspace needs setup
- Configure LLM provider and model
- Keeps default agent setup internal; users do not need to create or select an agent before chatting
- Leaves messaging channels, skills, and extra agents for later settings
- Applies gateway defaults with auto-generated token when missing
- At the end (interactive): choose **Terminal UI (embedded)** or **Gateway (OS service)** or exit

---

## channels

Manage messaging channel catalog entries, config blocks, and **DM pairing approval** on the machine where you run the CLI. For QR or credential flows, use the channel-specific docs and gateway console when available.

### Channel catalog and config

```bash
xopc channels list
xopc channels show telegram
xopc channels enable telegram
xopc channels disable telegram
xopc channels config set-json telegram '{"enabled":true}'
```

See channel docs under [Channels](./channels/index.md) for what each integration expects.

### channels pairing approve

When **`dmPolicy`** is **`pairing`** for Telegram, Feishu, or Weixin, unknown users get a **one-time pairing code** in chat. The bot owner approves it on the host:

```bash
xopc channels pairing approve --channel telegram --account default AB12CD34
xopc channels pairing approve --channel feishu --account default AB12CD34
xopc channels pairing approve --channel feishu AB12CD34
xopc channels pairing approve --channel weixin AB12CD34
```

- **`--channel`**: `telegram` \| `feishu` \| `weixin` (required).
- **`--account`**: config account id (default: `default` when omitted).
- **`<code>`**: 8-character code from the user’s DM.

On success, the sender id is appended to the channel **allowFrom credential file** (merged with config `allowFrom` at runtime). File layout is documented in [Channels — DM pairing](./channels/index.md#dm-pairing).

---

## agents

Manage **`agents.list`** in `config.json`. Paths for workspace and `~/.xopc/agents/<id>/` follow the merged config — there is no separate env-based agent registry.

| Subcommand | Description |
|------------|-------------|
| `agents list` | Print configured agents and the resolved default agent id (`--json` supported). |
| `agents add <name>` | **Requires** `--workspace <dir>`. Uses `<name>` as the id/name seed, appends/updates `agents.list`, creates dirs, and seeds Markdown profile files including `profile/IDENTITY.md`. Optional: `--model`, `--agent-dir`. |
| `agents delete <id>` | Removes the agent from `list` and strips matching **`bindings`**. Add **`--purge`** to delete on-disk agent home and workspace (not allowed for `main`). |

Examples:

```bash
xopc agents list
xopc agents add coder --workspace ~/xopc-workspaces/coder --model anthropic/claude-sonnet-4-5
xopc agents delete coder
xopc agents delete coder --purge
```

---

## agent

Chat with Agent.

### Single Message

```bash
xopc agent -m "Hello, world!"
```

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `-m, --message` | Message to send |
| `-s, --session` | Session key (default: default) |
| `-i, --interactive` | Interactive mode |

### Interactive Mode

```bash
xopc agent -i
```

**Usage:**
```
> Hello!
Bot: Hello! How can I help?

> List files
Bot: File listing...

> quit
```

### Specify Session

```bash
xopc agent -m "Continue our discussion" -s my-session
```

---

## tui

Interactive terminal UI for chatting with the agent (streaming, tools, thinking). Built on `@earendil-works/pi-tui`.

**Quick start:**

```bash
xopc                                  # same as xopc tui; embedded mode
xopc tui                              # embedded AgentService, no gateway
xopc tui --gateway                    # force gateway mode
xopc tui --url http://localhost:18790 --token <token>
xopc tui --agent coder                # start a fresh TUI session with coder
xopc tui --set-default-agent coder    # persist the TUI default agent
xopc tui -s <sessionKey> -m "Hello"   # resume session + optional first message
```

Note: if both `--local` and any gateway flag (`--gateway`, `--url`, `--token`) are provided, local mode wins.

| Option | Description |
|--------|-------------|
| `--url <url>` | Gateway base URL |
| `--token <token>` | Gateway bearer token |
| `--gateway` | Force gateway mode |
| `-s, --session <key>` | Session key to resume (omitted: start a fresh `agent:{currentAgent}:tui-<uuid>` session) |
| `--agent <id>` | Agent id for a fresh TUI session; overrides `tui.defaultAgent` for this launch |
| `--set-default-agent <id>` | Persist `tui.defaultAgent` and exit |
| `-m, --message <text>` | Send once after connect |
| `--local` | Embedded mode (no gateway) |
| `--thinking <level>` | Thinking level override |

Full behavior, slash commands, and keyboard shortcuts: **[Terminal UI (tui)](./tui.md)**.

---

## resume

Resume a previous TUI session. Without a session key, XOPC opens the interactive session picker.

```bash
xopc resume
xopc resume agent:main:tui-...
xopc resume --gateway --url http://host:18790
```

| Option | Description |
|--------|-------------|
| `[sessionKey]` | Session key to resume directly; omit it to open the session picker |
| `--url <url>` | Gateway URL |
| `--token <token>` | Gateway bearer token |
| `--password-env <name>` | Environment variable containing the gateway password |
| `--workdir <dir>` | Workspace directory for the resumed session |
| `--no-cwd` | Do not use the launch directory as the resumed session workspace |
| `--local` | Run in embedded mode |
| `--gateway` | Force gateway mode |
| `--theme <name>` | Theme: `auto`, `dark`, `light`, or a custom theme name |
| `--thinking <level>` | Thinking level override |

---

## gateway

Start REST API gateway.

### Foreground Mode (Default)

```bash
xopc gateway --port 18790
```

The gateway runs in foreground mode by default. Press `Ctrl+C` to stop.

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `-p, --port` | Port number (default: 18790) |
| `--bind <mode>` | Bind mode: `loopback`, `lan`, `auto`, `custom`, `tailnet` (default from config) |
| `--token` | Auth token |
| `--no-hot-reload` | Disable config hot reload |
| `--force` | Force kill existing process on port |

For an OS-managed gateway, use **`xopc gateway service install`** (see [Gateway](./gateway.md)).

### Force Start

If port is already in use:

```bash
xopc gateway --force
```

This will:
1. Send SIGTERM to processes on the port
2. Wait 700ms for graceful shutdown
3. Send SIGKILL if still running
4. Start new gateway instance

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `gateway status` | Check gateway status |
| `gateway stop` | Stop running gateway |
| `gateway restart` | Restart gateway |
| `gateway logs` | View gateway logs |
| `gateway token` | View/generate auth token |
| `gateway service` | Install/start/stop OS service (`install`, `start`, `stop`, `restart`, `uninstall`) |

**Examples:**

```bash
# Check status
xopc gateway status

# Stop gateway (graceful)
xopc gateway stop

# Restart gateway
xopc gateway restart

# View last 50 lines
xopc gateway logs

# Follow logs in real-time
xopc gateway logs --follow

# Generate new token
xopc gateway token --generate

# Install and start as system service
xopc gateway service install
xopc gateway service start
```

---

## automations

Automations are managed through the Gateway console at `#/automations` or the REST API under `/api/automations` and `/api/automation-runs`. There is no top-level `xopc automations` command.

See [Automations](./automations.md) for trigger, action, reliability, and API details.

---

## extensions

Manage extensions. Installed extensions live under `~/.xopc/extensions`; discovery still follows workspace → global → bundled priority.

### List Extensions

```bash
xopc extensions list
xopc extensions list --json
```

### Install Extension

```bash
# Install from npm (always under ~/.xopc/extensions)
xopc extensions install npm:xopc-extension-telegram

# Install from local directory
xopc extensions install ./my-local-extension

# Install from xopc-store
xopc extensions install store:telegram
```

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `-f, --force` | Replace an existing store/local install |
| `-y, --yes` | Skip the Store install confirmation prompt |

Install sources are explicit: `store:<id>`, `npm:<package>`, or an existing local directory. Store releases must publish SHA-256 metadata; the CLI verifies it before staging and import-checking the extension.

### Health, Audit, and Verify

```bash
xopc extensions health
xopc extensions audit
xopc extensions verify [extension-id]
```

### Search, Update, and Freeze

```bash
xopc extensions search [keyword]
xopc extensions update [extension-id]
xopc extensions freeze
```

`extensions update` refreshes lockfile-managed extensions only. After `xopc update`, the same sync runs automatically — see [Post-update extension sync](./extensions.md#post-update-extension-sync).

---

## update

Check for and install xopc updates. On success: sync lockfile extensions, then restart the gateway (unless disabled). Full guide: [Updates](./update.md).

```bash
xopc update
xopc update --check
xopc update --channel beta
xopc update --yes --json
xopc update --no-restart
```

| Option | Description |
|--------|-------------|
| `--check` | Query registry only; do not install |
| `--yes` | Skip confirmation |
| `--channel <stable\|beta\|dev>` | Override `update.channel` in config |
| `--json` | Machine-readable output (includes `postUpdate`) |
| `--no-restart` | Skip gateway restart after a successful install |

### Develop, Package, and Publish

```bash
xopc extensions dev ./my-local-extension
xopc extensions pack ./my-local-extension
xopc extensions publish ./my-local-extension --dry-run
```

`extensions pack` writes a Store-ready `.zip`, `.sha256`, and `.manifest.json` artifact set. The metadata includes raw `sha256` and SRI `integrity` values.

---

## skills

Manage skills (install, enable, configure, test).

### List Skills

```bash
xopc skills list
xopc skills list -v          # Verbose output
xopc skills list --json      # JSON format
```

### Install Skill Dependencies

```bash
xopc skills install <skill-name>
xopc skills install <skill-name> -i <install-id>   # Specify installer
xopc skills install <skill-name> --dry-run         # Dry run
```

### Enable/Disable Skills

```bash
xopc skills enable <skill-name>
xopc skills disable <skill-name>
```

### View Skill Status

```bash
xopc skills status
xopc skills status <skill-name>
xopc skills status --json
```

### Security Audit

```bash
xopc skills audit
xopc skills audit <skill-name>
xopc skills audit <skill-name> --deep    # Verbose output
```

### Configure Skill

```bash
xopc skills config <skill-name> --show
xopc skills config <skill-name> --api-key=KEY
xopc skills config <skill-name> --env KEY=value
```

### Test Skill

```bash
# Test all skills
xopc skills test

# Test specific skill
xopc skills test <skill-name>

# Verbose output
xopc skills test --verbose

# JSON format
xopc skills test --format json

# Skip specific tests
xopc skills test --skip-security
xopc skills test --skip-examples
```

---

## mcp

Current `xopc --help` does not expose `mcp` as a root command. Manage outbound MCP servers through `mcp.servers` in `xopc.json` and the gateway console when available.

See [MCP](./mcp.md) for configuration and Web UI. [MCP CLI & API](./cli/mcp.md) documents historical commands for installs or development branches that still expose them.

---

## session

Manage conversation sessions.

### List Sessions

```bash
# List all sessions
xopc session list

# Filter by status
xopc session list --status active
xopc session list --status archived
xopc session list --status pinned

# Search by name or content
xopc session list --query "project"

# Sort and limit
xopc session list --sort updatedAt --order desc --limit 50
```

### View Session Details

```bash
# Show session info and recent messages
xopc session info telegram:123456

# Search within a session
xopc session grep telegram:123456 "API design"
```

### Manage Sessions

```bash
# Rename a session
xopc session rename telegram:123456 "Project Discussion"

# Add tags
xopc session tag telegram:123456 work important

# Remove tags
xopc session untag telegram:123456 important

# Archive a session
xopc session archive telegram:123456

# Unarchive a session
xopc session unarchive telegram:123456

# Pin a session
xopc session pin telegram:123456

# Unpin a session
xopc session unpin telegram:123456

# Delete a session
xopc session delete telegram:123456

# Export session to JSON
xopc session export telegram:123456 --format json --output backup.json
```

### Statistics

```bash
xopc session stats
```

---

## config

View and edit configuration (non-interactive).

### Show Configuration

```bash
xopc config show
# legacy alias:
xopc config --show
```

### Validate Configuration

```bash
xopc config validate
# legacy alias:
xopc config --validate
```

Edit values with `xopc config set` / `xopc config unset`, or open the file path from `xopc config path` in your editor.

---

## image

Inspect current image runtime behavior and available image generation providers.

```bash
xopc image status
xopc image status --json
xopc image providers
xopc image providers --json
```

See [Image & vision](image-multimodal.md).

---

## Global Options

### Workspace Path

```bash
--workspace /path/to/workspace
```

### Config File

```bash
--config /path/to/config.json
```

### Verbose Output

```bash
--verbose
```

### Help

```bash
xopc --help
xopc agent --help
xopc gateway --help
```

---

## Exit Codes

| Exit Code | Description |
|-----------|-------------|
| `0` | Success |
| `1` | General error |
| `2` | Invalid arguments |
| `3` | Configuration error |

---

## Quick Scripts

Create a quick script `bot`:

```bash
#!/bin/bash

case "$1" in
  chat)
    xopc agent -m "${*:2}"
    ;;
  shell)
    xopc agent -i
    ;;
  start)
    xopc gateway --port 18790
    ;;
  extensions)
    shift
    xopc extensions "$@"
    ;;
  skills)
    shift
    xopc skills "$@"
    ;;
  session)
    shift
    xopc session "$@"
    ;;
  *)
    echo "Usage: bot {chat|shell|start|extension|skills|session}"
    ;;
esac
```

**Usage:**
```bash
bot chat Hello!
bot start
bot extension list
bot skills list
bot session list
```
