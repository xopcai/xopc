# CLI Command Reference

xopc provides a rich set of CLI commands for management, conversation, and configuration.

## Usage

### Install from npm (recommended)

```bash
npm install -g @xopcai/xopc
xopc <command>
```

### Run from source (development)

```bash
git clone https://github.com/xopcai/xopc.git
cd xopc
pnpm install

pnpm run dev -- <command>
```

> **Note:** Examples in this document use `xopc`. If running from source, replace with `pnpm run dev --`.

---

## Command Overview

| Command | Description |
|---------|-------------|
| `setup` | Initialize config and workspace |
| `onboard` | Interactive setup wizard |
| `agents` | Manage multi-agent entries in config (`list`, add, delete) |
| `agent` | Chat with Agent |
| `tui` | Full-screen terminal UI (gateway or `--local` embedded) — see [TUI](./tui.md) |
| `gateway` | Start REST gateway |
| `cron` | Manage scheduled tasks |
| `extension` | Manage extensions |
| `skills` | Manage skills |
| `config` | View/edit configuration |
| `image` | Image understanding / generation defaults (`status`, `set-understanding`, `set-generation`, fallbacks, `providers`) |
| `session` | Manage sessions |

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
- Creates workspace directory with bootstrap files

---

## onboard

Interactive setup wizard for xopc (gateway defaults: `127.0.0.1:18790`, token auth; no prompts for bind/port/token).

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
# Full interactive setup (default)
xopc onboard

# Configure LLM model only
xopc onboard --model

# Configure channels only
xopc onboard --channels
```

**Features:**
- Auto-detects if workspace needs setup
- Configure LLM provider and model
- Configure messaging channels (Telegram, Weixin QR via channel menu, …)
- Apply gateway defaults with auto-generated token when missing
- At the end (interactive): choose **Terminal UI (embedded)** or **Gateway (background)** or exit

---

## agents

Manage **`agents.list`** in `config.json`. Paths for workspace and `~/.xopc/agents/<id>/` follow the merged config — there is no separate env-based agent registry.

| Subcommand | Description |
|------------|-------------|
| `agents list` | Print configured agents and the resolved default agent id (`--json` supported). |
| `agents add <name>` | **Requires** `--workspace <dir>`. Appends/updates `agents.list`, creates dirs, seeds Markdown bootstrap. Optional: `--model`, `--agent-dir`. |
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

Interactive terminal UI for chatting with the agent (streaming, tools, thinking). Built on `@mariozechner/pi-tui`.

**Quick start:**

```bash
xopc tui                              # gateway mode (default URL in CLI; override with --url)
xopc tui --local                      # embedded AgentService, no gateway
xopc tui --url http://localhost:18790 --token <token>
xopc tui -s <sessionKey> -m "Hello"   # resume session + optional first message
```

| Option | Description |
|--------|-------------|
| `--url <url>` | Gateway base URL |
| `--token <token>` | Gateway bearer token |
| `-s, --session <key>` | Session key (default: `cli:tui`) |
| `-m, --message <text>` | Send once after connect |
| `--local` | Embedded mode (no gateway) |
| `--thinking <level>` | Thinking level override |

Full behavior, slash commands, and keyboard shortcuts: **[Terminal UI (tui)](./tui.md)**.

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
| `-h, --host` | Bind address (default: 0.0.0.0) |
| `--token` | Auth token |
| `--no-hot-reload` | Disable config hot reload |
| `--force` | Force kill existing process on port |
| `--background` | Start in background mode |

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
| `gateway install` | Install as system service |
| `gateway uninstall` | Remove system service |
| `gateway service-start` | Start via system service |
| `gateway service-status` | Check service status |

**Examples:**

```bash
# Check status
xopc gateway status

# Stop gateway (graceful)
xopc gateway stop

# Force stop
xopc gateway stop --force

# Restart gateway
xopc gateway restart

# View last 50 lines
xopc gateway logs

# Follow logs in real-time
xopc gateway logs --follow

# Generate new token
xopc gateway token --generate

# Install as system service
xopc gateway install

# Uninstall system service
xopc gateway uninstall
```

---

## cron

Manage scheduled tasks.

### Add Task

```bash
xopc cron add --schedule "0 9 * * *" --message "Good morning!"
```

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `--schedule` | Cron expression |
| `--message` | Message to send |
| `--name` | Task name (optional) |

**Examples:**

```bash
# Daily at 9am
xopc cron add --schedule "0 9 * * *" --message "Daily update"

# Weekdays at 6pm
xopc cron add --schedule "0 18 * * 1-5" --message "Time to wrap up!"

# Hourly reminder
xopc cron add --schedule "0 * * * *" --message "Hourly reminder" --name hourly
```

### Remove Task

```bash
xopc cron remove <task-id>
```

### Enable/Disable

```bash
xopc cron enable <task-id>
xopc cron disable <task-id>
```

### Trigger Task

```bash
xopc cron trigger <task-id>
```

---

## extension

Manage extensions. Supports three-tier storage: workspace → global → bundled.

### List Extensions

```bash
xopc extension list
```

### Install Extension

```bash
# Install from npm to workspace (default)
xopc extension install xopc-extension-telegram

# Install to global (shared across projects)
xopc extension install xopc-extension-telegram --global

# Install from local directory
xopc extension install ./my-local-extension

# Set timeout (default 120 seconds)
xopc extension install slow-extension --timeout 300000
```

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `--global` | Install to global directory |
| `--timeout <ms>` | Installation timeout |

### Remove Extension

```bash
xopc extension remove <extension-id>
# Or
xopc extension uninstall <extension-id>
```

### View Extension Details

```bash
xopc extension info <extension-id>
```

### Create Extension

```bash
xopc extension create <extension-id> [options]
```

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `--name <name>` | Extension display name |
| `--description <desc>` | Extension description |
| `--kind <kind>` | Extension type: `channel`, `provider`, `memory`, `tool`, `utility` |

**Examples:**

```bash
# Create a tool extension
xopc extension create weather-tool --name "Weather Tool" --kind tool

# Create a channel extension
xopc extension create discord-channel --name "Discord Channel" --kind channel
```

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
xopc config --show
```

### Validate Configuration

```bash
xopc config --validate
```

### Edit Configuration

```bash
xopc config --edit
```

---

## image

Manage **`agents.defaults.imageModel`**, **`imageGenerationModel`**, **`mediaMaxMb`**, and their fallback lists without editing JSON paths by hand.

```bash
xopc image status
xopc image status --json
xopc image set-understanding openai/gpt-4o
xopc image set-generation openai/gpt-image-1
xopc image add-fallback understanding anthropic/claude-sonnet-4-5
xopc image add-fallback generation dashscope/wan2.6-t2i
xopc image remove-fallback understanding 0
xopc image providers
xopc image set-max-size 10
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
  cron)
    shift
    xopc cron "$@"
    ;;
  extension)
    shift
    xopc extension "$@"
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
    echo "Usage: bot {chat|shell|start|cron|extension|skills|session}"
    ;;
esac
```

**Usage:**
```bash
bot chat Hello!
bot start
bot cron list
bot extension list
bot skills list
bot session list
```
