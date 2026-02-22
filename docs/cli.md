# CLI Command Reference

xopcbot provides a rich set of CLI commands for management, conversation, and configuration.

## Usage

### Install from npm (recommended)

```bash
# Install globally
npm install -g @xopcai/xopcbot

# Use directly
xopcbot <command>
```

### Run from source (development)

```bash
# Clone and install
git clone https://github.com/xopcai/xopcbot.git
cd xopcbot
pnpm install

# Use pnpm run dev -- prefix
pnpm run dev -- <command>
```

**The examples in this document use `xopcbot` command by default.** If you're running from source, replace `xopcbot` with `pnpm run dev --`.

---

## Command List

| Command | Description |
|---------|-------------|
| `onboard` | Initialize configuration and workspace |
| `agent` | Chat with Agent |
| `gateway` | Start REST gateway |
| `cron` | Manage scheduled tasks |
| `plugin` | Manage plugins |
| `skills` | Manage skills (install, enable, configure, test) |

---

## onboard

Initialize xopcbot configuration.

```bash
xopcbot onboard
```

**Features**:
- Create config directory
- Set default configuration
- Configure LLM provider
- Configure channels (Telegram/WhatsApp)
- Auto-start Gateway (background mode)

**Interactive prompts**:

```
? Select LLM provider: openai
? Enter API key: sk-...
? Enable Telegram? Yes
? Telegram bot token: 123456:...
```

**After completion**:

After onboard completes, Gateway service will auto-start (background mode) and display:
- Gateway access URL
- Token information
- PID information

---

## agent

Chat with Agent.

### Single conversation

```bash
xopcbot agent -m "Hello, world!"
```

**Parameters**:

| Parameter | Description |
|-----------|-------------|
| `-m, --message` | Message to send |
| `-s, --session` | Session key (default: default) |
| `-i, --interactive` | Interactive mode |

### Interactive mode

```bash
xopcbot agent -i
```

**Usage**:

```
> Hello!
Bot: Hello! How can I help?

> List files
Bot: File listing...

> quit
```

### Specify session

```bash
xopcbot agent -m "Continue our discussion" -s my-session
```

---

## gateway

Start REST API gateway.

### Foreground mode

```bash
xopcbot gateway --port 18790
```

**Parameters**:

| Parameter | Description |
|-----------|-------------|
| `-p, --port` | Port number (default: 18790) |
| `-h, --host` | Bind address (default: 0.0.0.0) |
| `--token` | Auth token |
| `--no-hot-reload` | Disable config hot reload |
| `-b, --background` | Run in background mode |
| `--log-file` | Log file path for background mode |

### Background mode

```bash
# Start background gateway
xopcbot gateway --background

# Or shorthand
xopcbot gateway -b
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `gateway status` | Check gateway status |
| `gateway stop` | Stop running gateway |
| `gateway restart` | Restart gateway |
| `gateway logs` | View gateway logs |
| `gateway token` | View/generate auth token |

**Examples**:

```bash
# Check status
xopcbot gateway status

# Stop gateway
xopcbot gateway stop

# Restart gateway (can change config)
xopcbot gateway restart --port 8080

# View last 50 lines
xopcbot gateway logs

# Follow logs in real-time
xopcbot gateway logs --follow

# Generate new token
xopcbot gateway token --generate
```

---

## cron

Manage scheduled tasks.

### Add task

```bash
xopcbot cron add --schedule "0 9 * * *" --message "Good morning!"
```

**Parameters**:

| Parameter | Description |
|-----------|-------------|
| `--schedule` | Cron expression |
| `--message` | Message to send on schedule |
| `--name` | Task name (optional) |

**Examples**:

```bash
# Daily at 9am
xopcbot cron add --schedule "0 9 * * *" --message "Daily update"

# Weekdays at 6pm
xopcbot cron add --schedule "0 18 * * 1-5" --message "Time to wrap up!"

# Hourly reminder
xopcbot cron add --schedule "0 * * * *" --message "Hourly reminder" --name hourly
```

### Remove task

```bash
xopcbot cron remove <task-id>
```

**Example**:

```bash
xopcbot cron remove abc1
```

### Enable/disable

```bash
xopcbot cron enable <task-id>
xopcbot cron disable <task-id>
```

### Trigger task

```bash
xopcbot cron trigger <task-id>
```

---

## plugin

Manage plugins. Supports three-tier storage: workspace (./.plugins/) → global (~/.xopcbot/plugins/) → bundled.

### List plugins

```bash
xopcbot plugin list
```

**Example output**:
```
📦 Installed Plugins

══════════════════════════════════════════════════════════════════════

  📁 Workspace (./.plugins/)
    • My Custom Plugin @ 0.1.0
      ID: my-custom-plugin

  🌐 Global (~/.xopcbot/plugins/)
    • Telegram Channel @ 1.2.0
      ID: telegram-channel

  📦 Bundled (built-in)
    • Discord Channel @ 2.0.0
      ID: discord-channel
```

### Install plugin

**Install from npm to workspace** (default):
```bash
xopcbot plugin install <package-name>

# Examples
xopcbot plugin install xopcbot-plugin-telegram
xopcbot plugin install @scope/my-plugin
xopcbot plugin install my-plugin@1.0.0
```

**Install to global** (shared across projects):
```bash
xopcbot plugin install <package-name> --global

# Example
xopcbot plugin install xopcbot-plugin-telegram --global
```

**Install from local directory**:
```bash
# Install to workspace
xopcbot plugin install ./my-local-plugin

# Install to global
xopcbot plugin install ./my-local-plugin --global
```

**Parameters**:

| Parameter | Description |
|-----------|-------------|
| `--global` | Install to global directory (~/.xopcbot/plugins/) |
| `--timeout <ms>` | Installation timeout (default 120000ms) |

**Installation flow**:
1. Download/copy plugin files
2. Validate `xopcbot.plugin.json` manifest
3. Install dependencies (if `package.json` has dependencies)
4. Copy to target directory (workspace/.plugins/ or ~/.xopcbot/plugins/)

**Three-tier storage explanation**:
- Workspace (./.plugins/): Project private, highest priority
- Global (~/.xopcbot/plugins/): User-level shared
- Bundled: Built-in plugins, lowest priority

### Remove plugin

```bash
xopcbot plugin remove <plugin-id>
# Or
xopcbot plugin uninstall <plugin-id>
```

**Example**:
```bash
xopcbot plugin remove telegram-channel
```

**Note**:
- First tries to remove from workspace, then global if not found
- After removal, if enabled, also need to delete from config file

### View plugin details

```bash
xopcbot plugin info <plugin-id>
```

**Example**:
```bash
xopcbot plugin info telegram-channel
```

**Output**:
```
📦 Plugin: Telegram Channel

  ID: telegram-channel
  Version: 1.2.0
  Kind: channel
  Description: Telegram channel integration
  Path: /home/user/.xopcbot/workspace/.plugins/telegram-channel
```

### Create plugin

Create new plugin scaffold.

```bash
xopcbot plugin create <plugin-id> [options]
```

**Parameters**:

| Parameter | Description |
|-----------|-------------|
| `--name <name>` | Plugin display name |
| `--description <desc>` | Plugin description |
| `--kind <kind>` | Plugin type: `channel`, `provider`, `memory`, `tool`, `utility` |

**Examples**:

```bash
# Create a tool plugin
xopcbot plugin create weather-tool --name "Weather Tool" --kind tool

# Create a channel plugin
xopcbot plugin create discord-channel --name "Discord Channel" --kind channel

# Create a memory plugin
xopcbot plugin create redis-memory --name "Redis Memory" --kind memory
```

**Generated files**:
```
.plugins/
└── my-plugin/
    ├── package.json          # npm config
    ├── index.ts              # Plugin entry (TypeScript)
    ├── xopcbot.plugin.json   # Plugin manifest
    └── README.md             # Documentation template
```

**Note**: Created plugins use TypeScript, loaded via [jiti](https://github.com/unjs/jiti) without precompilation.

---

## Global Options

### Workspace path

```bash
--workspace /path/to/workspace
```

### Config file

```bash
--config /path/to/config.json
```

### Verbose output

```bash
--verbose
```

### Help

```bash
xopcbot --help
xopcbot agent --help
xopcbot gateway --help
xopcbot plugin --help
```

---

## skills

CLI commands for managing skills.

### List skills

```bash
xopcbot skills list
xopcbot skills list -v          # Verbose output
xopcbot skills list --json      # JSON format
```

### Install skill dependencies

```bash
xopcbot skills install <skill-name>
xopcbot skills install <skill-name> -i <install-id>   # Specify installer
xopcbot skills install <skill-name> --dry-run         # Dry run
```

### Enable/disable skills

```bash
xopcbot skills enable <skill-name>
xopcbot skills disable <skill-name>
```

### View skill status

```bash
xopcbot skills status
xopcbot skills status <skill-name>
xopcbot skills status --json
```

### Security audit

```bash
xopcbot skills audit
xopcbot skills audit <skill-name>
xopcbot skills audit <skill-name> --deep    # Verbose output
```

### Configure skill

```bash
xopcbot skills config <skill-name> --show
xopcbot skills config <skill-name> --api-key=KEY
xopcbot skills config <skill-name> --env KEY=value
```

### Test skill

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

# Validate SKILL.md file
xopcbot skills test validate ./skills/weather/SKILL.md

# Check dependencies
xopcbot skills test check-deps

# Security audit
xopcbot skills test security --deep
```

**Test output formats**:

| Format | Description |
|--------|-------------|
| `text` | Human-readable text output (default) |
| `json` | JSON format for machine parsing |
| `tap` | TAP format for CI/CD integration |

**Test types**:

| Test | Description |
|------|-------------|
| SKILL.md format | Validate YAML frontmatter and required fields |
| Dependency check | Check if declared binaries are available |
| Security scan | Scan for dangerous code patterns |
| Metadata integrity | Check optional fields like emoji, homepage |
| Example validation | Validate code block syntax |

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
  plugin)
    shift
    xopcbot plugin "$@"
    ;;
  skills)
    shift
    xopcbot skills "$@"
    ;;
  *)
    echo "Usage: bot {chat|shell|start|cron|plugin|skills}"
    ;;
esac
```

Usage:

```bash
bot chat Hello!
bot start
bot cron list
bot plugin list
bot plugin install xopcbot-plugin-telegram
bot skills list
bot skills test weather
```

---

## Exit Codes

| Exit Code | Description |
|-----------|-------------|
| `0` | Success |
| `1` | General error |
| `2` | Invalid arguments |
| `3` | Configuration error |
