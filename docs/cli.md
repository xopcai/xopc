# CLI Command Reference

xopcbot provides a rich set of CLI commands for management, conversation, and configuration.

## Usage

### Install from npm (recommended)

```bash
npm install -g @xopcai/xopcbot
xopcbot <command>
```

### Run from source (development)

```bash
git clone https://github.com/xopcai/xopcbot.git
cd xopcbot
pnpm install

pnpm run dev -- <command>
```

> **Note:** Examples in this document use `xopcbot`. If running from source, replace with `pnpm run dev --`.

---

## Command Overview

| Command | Description |
|---------|-------------|
| `setup` | Initialize config and workspace |
| `onboard` | Interactive setup wizard |
| `agent` | Chat with Agent |
| `gateway` | Start REST gateway |
| `cron` | Manage scheduled tasks |
| `extension` | Manage extensions |
| `skills` | Manage skills |
| `config` | View/edit configuration |
| `session` | Manage sessions |

---

## setup

Initialize config file and workspace directory only.

```bash
xopcbot setup
```

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `--workspace <path>` | Workspace directory path |

**Examples:**

```bash
# Create default config and workspace
xopcbot setup

# Custom workspace path
xopcbot setup --workspace ~/my-workspace
```

**What it does:**
- Creates `~/.xopcbot/config.json` (if not exists)
- Creates workspace directory with bootstrap files

---

## onboard

Interactive setup wizard for xopcbot.

```bash
xopcbot onboard
```

**Options:**

| Option | Description |
|--------|-------------|
| `--model` | Configure LLM provider and model only |
| `--channels` | Configure messaging channels only |
| `--gateway` | Configure gateway WebUI only |
| `--all` | Configure everything (default) |

**Examples:**

```bash
# Full interactive setup (default)
xopcbot onboard

# Configure LLM model only
xopcbot onboard --model

# Configure channels only
xopcbot onboard --channels
```

**Features:**
- Auto-detects if workspace needs setup
- Configure LLM provider and model
- Configure messaging channels (Telegram)
- Configure gateway WebUI with auto-generated token

---

## agent

Chat with Agent.

### Single Message

```bash
xopcbot agent -m "Hello, world!"
```

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `-m, --message` | Message to send |
| `-s, --session` | Session key (default: default) |
| `-i, --interactive` | Interactive mode |

### Interactive Mode

```bash
xopcbot agent -i
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
xopcbot agent -m "Continue our discussion" -s my-session
```

---

## gateway

Start REST API gateway.

### Foreground Mode (Default)

```bash
xopcbot gateway --port 18790
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
xopcbot gateway --force
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
xopcbot gateway status

# Stop gateway (graceful)
xopcbot gateway stop

# Force stop
xopcbot gateway stop --force

# Restart gateway
xopcbot gateway restart

# View last 50 lines
xopcbot gateway logs

# Follow logs in real-time
xopcbot gateway logs --follow

# Generate new token
xopcbot gateway token --generate

# Install as system service
xopcbot gateway install

# Uninstall system service
xopcbot gateway uninstall
```

---

## cron

Manage scheduled tasks.

### Add Task

```bash
xopcbot cron add --schedule "0 9 * * *" --message "Good morning!"
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
xopcbot cron add --schedule "0 9 * * *" --message "Daily update"

# Weekdays at 6pm
xopcbot cron add --schedule "0 18 * * 1-5" --message "Time to wrap up!"

# Hourly reminder
xopcbot cron add --schedule "0 * * * *" --message "Hourly reminder" --name hourly
```

### Remove Task

```bash
xopcbot cron remove <task-id>
```

### Enable/Disable

```bash
xopcbot cron enable <task-id>
xopcbot cron disable <task-id>
```

### Trigger Task

```bash
xopcbot cron trigger <task-id>
```

---

## extension

Manage extensions. Supports three-tier storage: workspace → global → bundled.

### List Extensions

```bash
xopcbot extension list
```

### Install Extension

```bash
# Install from npm to workspace (default)
xopcbot extension install xopcbot-extension-telegram

# Install to global (shared across projects)
xopcbot extension install xopcbot-extension-telegram --global

# Install from local directory
xopcbot extension install ./my-local-extension

# Set timeout (default 120 seconds)
xopcbot extension install slow-extension --timeout 300000
```

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `--global` | Install to global directory |
| `--timeout <ms>` | Installation timeout |

### Remove Extension

```bash
xopcbot extension remove <extension-id>
# Or
xopcbot extension uninstall <extension-id>
```

### View Extension Details

```bash
xopcbot extension info <extension-id>
```

### Create Extension

```bash
xopcbot extension create <extension-id> [options]
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
xopcbot extension create weather-tool --name "Weather Tool" --kind tool

# Create a channel extension
xopcbot extension create discord-channel --name "Discord Channel" --kind channel
```

---

## skills

Manage skills (install, enable, configure, test).

### List Skills

```bash
xopcbot skills list
xopcbot skills list -v          # Verbose output
xopcbot skills list --json      # JSON format
```

### Install Skill Dependencies

```bash
xopcbot skills install <skill-name>
xopcbot skills install <skill-name> -i <install-id>   # Specify installer
xopcbot skills install <skill-name> --dry-run         # Dry run
```

### Enable/Disable Skills

```bash
xopcbot skills enable <skill-name>
xopcbot skills disable <skill-name>
```

### View Skill Status

```bash
xopcbot skills status
xopcbot skills status <skill-name>
xopcbot skills status --json
```

### Security Audit

```bash
xopcbot skills audit
xopcbot skills audit <skill-name>
xopcbot skills audit <skill-name> --deep    # Verbose output
```

### Configure Skill

```bash
xopcbot skills config <skill-name> --show
xopcbot skills config <skill-name> --api-key=KEY
xopcbot skills config <skill-name> --env KEY=value
```

### Test Skill

```bash
# Test all skills
xopcbot skills test

# Test specific skill
xopcbot skills test <skill-name>

# Verbose output
xopcbot skills test --verbose

# JSON format
xopcbot skills test --format json

# Skip specific tests
xopcbot skills test --skip-security
xopcbot skills test --skip-examples
```

---

## session

Manage conversation sessions.

### List Sessions

```bash
# List all sessions
xopcbot session list

# Filter by status
xopcbot session list --status active
xopcbot session list --status archived
xopcbot session list --status pinned

# Search by name or content
xopcbot session list --query "project"

# Sort and limit
xopcbot session list --sort updatedAt --order desc --limit 50
```

### View Session Details

```bash
# Show session info and recent messages
xopcbot session info telegram:123456

# Search within a session
xopcbot session grep telegram:123456 "API design"
```

### Manage Sessions

```bash
# Rename a session
xopcbot session rename telegram:123456 "Project Discussion"

# Add tags
xopcbot session tag telegram:123456 work important

# Remove tags
xopcbot session untag telegram:123456 important

# Archive a session
xopcbot session archive telegram:123456

# Unarchive a session
xopcbot session unarchive telegram:123456

# Pin a session
xopcbot session pin telegram:123456

# Unpin a session
xopcbot session unpin telegram:123456

# Delete a session
xopcbot session delete telegram:123456

# Export session to JSON
xopcbot session export telegram:123456 --format json --output backup.json
```

### Statistics

```bash
xopcbot session stats
```

---

## config

View and edit configuration (non-interactive).

### Show Configuration

```bash
xopcbot config --show
```

### Validate Configuration

```bash
xopcbot config --validate
```

### Edit Configuration

```bash
xopcbot config --edit
```

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
xopcbot --help
xopcbot agent --help
xopcbot gateway --help
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
    xopcbot agent -m "${*:2}"
    ;;
  shell)
    xopcbot agent -i
    ;;
  start)
    xopcbot gateway --port 18790
    ;;
  cron)
    shift
    xopcbot cron "$@"
    ;;
  extension)
    shift
    xopcbot extension "$@"
    ;;
  skills)
    shift
    xopcbot skills "$@"
    ;;
  session)
    shift
    xopcbot session "$@"
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
