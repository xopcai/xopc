# Getting Started

This guide provides a complete walkthrough for setting up **xopcbot** for the first time.

## 1. Prerequisites

Before you begin, ensure you have:

- **Node.js**: Version **22.0.0** or newer (`node -v`)
- **pnpm**: Recommended package manager (`pnpm --version`)

> **Note:** This project uses `pnpm`. Do NOT use `npm` for package management.

## 2. Installation

### Option 1: Install from npm (Recommended)

```bash
npm install -g @xopcai/xopcbot
```

### Option 2: Build from source

```bash
git clone https://github.com/xopcai/xopcbot.git
cd xopcbot
pnpm install
pnpm run build
```

## 3. Configuration

### Interactive Setup (Recommended)

Use the `onboard` wizard for guided setup:

```bash
xopcbot onboard
# or: pnpm run dev -- onboard
```

The wizard will guide you through:
1. Creating workspace directory (`~/.xopcbot/workspace/`)
2. Generating default `config.json`
3. Selecting an LLM provider and entering API key
4. Configuring messaging channels (Telegram)
5. Setting up Gateway WebUI

### Quick Setup

For minimal setup without interactive prompts:

```bash
xopcbot setup
```

This creates basic config and workspace files only.

### Manual Configuration

Edit `~/.xopcbot/config.json` directly:

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5",
      "max_tokens": 8192,
      "temperature": 0.7
    }
  },
  "providers": {
    "anthropic": "${ANTHROPIC_API_KEY}"
  }
}
```

> **Tip:** Use environment variables for API keys (e.g., `ANTHROPIC_API_KEY`).

## 4. First Interaction

### Single Message Mode

Send a single message and get a response:

```bash
xopcbot agent -m "Explain what an LLM is in one sentence."
# or: pnpm run dev -- agent -m "Explain what an LLM is"
```

### Interactive Mode

Start a continuous conversation:

```bash
xopcbot agent -i
# or: pnpm run dev -- agent -i
```

You'll see a `You:` prompt. Type messages and press Enter. Exit with `Ctrl+C`.

## 5. Running with Channels

### Telegram Setup

1. **Get Bot Token**: Open Telegram, search [@BotFather](https://t.me/BotFather), send `/newbot`

2. **Configure** in `~/.xopcbot/config.json`:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "YOUR_BOT_TOKEN",
      "dmPolicy": "allowlist",
      "allowFrom": [123456789]
    }
  }
}
```

3. **Start Gateway**:

```bash
xopcbot gateway
# or: pnpm run dev -- gateway
```

4. **Chat**: Open Telegram and message your bot

### Web UI

Access the Web UI at `http://localhost:18790` after starting the gateway.

## 6. What's Next?

Explore these guides to unlock more features:

| Guide | Description |
|-------|-------------|
| [CLI Reference](/cli) | All available commands |
| [Configuration](/configuration) | Full config reference |
| [Extensions](/extensions) | Extend functionality |
| [Skills](/skills) | Add domain-specific knowledge |
| [Tools](/tools) | Built-in tools reference |
| [Channels](/channels) | Multi-channel setup |
| [Routing](/routing-system) | Session keys and agent bindings |
| [Models](/models) | LLM provider configuration |

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| `ERR_MODULE_NOT_FOUND` | Run `pnpm install` |
| `Cannot find module '@xopcai/...'` | Run `pnpm run build` |
| Config not loading | Verify `~/.xopcbot/config.json` is valid JSON |
| Bot not responding | Check `TELEGRAM_BOT_TOKEN` and bot status |
| API key errors | Verify environment variables are set |

### Getting Help

- Check [Documentation](/) for detailed guides
- Review [AGENTS.md](https://github.com/xopcai/xopcbot/blob/main/AGENTS.md) for development guide
- View logs: `xopcbot gateway logs --follow`
