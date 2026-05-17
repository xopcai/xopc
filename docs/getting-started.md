# Getting Started

Install **xopc**, add at least one LLM provider key, then use the **CLI**, **TUI**, **gateway** (browser console), or the **Electron** app. This page walks through a first install from scratch.

## Terminal demo

[![asciinema](https://asciinema.org/a/PlH1sYqOiV3malzu.svg)](https://asciinema.org/a/PlH1sYqOiV3malzu)

## 1. Prerequisites

- **Node.js** **22** or newer (`node -v`)
- **pnpm**: required only when [building from source](#option-2-build-from-source) in this repo (`pnpm --version`)

End users can install the published CLI with **`npm install -g @xopcai/xopc`** (or `pnpm add -g`).

## 2. Installation

### Option 1: Install from npm (Recommended)

```bash
npm install -g @xopcai/xopc
```

### Option 2: Build from source

```bash
git clone https://github.com/xopcai/xopc.git
cd xopc
pnpm install
pnpm run build
```

## 3. Configuration

### Interactive Setup (Recommended)

Use the `onboard` wizard for guided setup:

```bash
xopc onboard
# or: pnpm run dev -- onboard
```

The wizard will guide you through:
1. Creating the primary Markdown workspace directory (typically `~/.xopc/workspace/main/` when using default config)
2. Generating default **`~/.xopc/xopc.json`**
3. Choosing an LLM provider and API key (**DeepSeek** is a good default for many setups)
4. Optional messaging channels (**Telegram**, **WeChat (Weixin)**, **Feishu/Lark**)
5. Gateway Web console (and optional **`xopc tui`** vs gateway choice at the end)

### Quick Setup

For minimal setup without interactive prompts:

```bash
xopc setup
```

This creates basic config and workspace files only.

### Manual Configuration

Edit `~/.xopc/xopc.json` directly:

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

## 4. First chat (CLI or TUI)

### One-shot (`agent`)

```bash
xopc agent -m "Explain what an LLM is in one sentence."
# from a dev clone: pnpm run dev -- agent -m "…"
```

### Interactive TTY (`agent -i`)

```bash
xopc agent -i
# from a dev clone: pnpm run dev -- agent -i
```

You’ll see a `You:` prompt. **Ctrl+C** to exit.

### Full-screen TUI (no gateway required)

```bash
xopc tui --local
```

See [Terminal UI (TUI)](./tui.md) for gateway-connected mode (`xopc tui`) and session flags.

## 5. Gateway, background mode, and channels

### Telegram (example)

1. **Get Bot Token**: Open Telegram, search [@BotFather](https://t.me/BotFather), send `/newbot`

2. **Configure** in `~/.xopc/xopc.json`:

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

3. **Start the gateway** (foreground — logs show the URL and token):

```bash
xopc gateway
# from a dev clone: pnpm run dev -- gateway
```

4. **Chat** in Telegram, or open the **Web console** in a browser (default port is often **18790** unless you changed `gateway.port`).

### Run the gateway in the background

```bash
xopc gateway --background
```

Then use **`xopc gateway status`**, **`xopc gateway stop`**, **`xopc gateway restart`**, and **`xopc gateway logs`** as needed. See [Gateway](./gateway.md).

### Web console URL

After `xopc gateway`, open the URL printed in the terminal (commonly `http://localhost:18790` if that is your configured port).

### Other bundled channels

**WeChat** and **Feishu/Lark** are configured under **`channels.*`** in the same JSON file. See [Channels](./channels/index.md).

## 6. Electron desktop (optional)

Prebuilt **macOS / Windows / Linux** installers are published on **[GitHub Releases](https://github.com/xopcai/xopc/releases)** when available. They bundle the gateway and the same React console as the browser UI.

<video controls playsinline width="100%" style="max-width: 960px; border-radius: 8px;">
  <source src="https://xopc.ai/xopc-demo.mp4" type="video/mp4" />
</video>

To build locally from a clone:

```bash
pnpm install
pnpm run electron:build   # outputs under dist/release/
```

## 7. What's Next?

Explore these guides to unlock more features:

| Guide | Description |
|-------|-------------|
| [CLI Reference](/cli) | All available commands |
| [Configuration](/configuration) | Full config reference |
| [Extensions](/extensions) | Extend functionality |
| [Skills](/skills) | Add domain-specific knowledge |
| [Tools](/tools) | Built-in tools reference |
| [Channels](/channels) | Telegram, WeChat, Feishu, web chat |
| [TUI](/tui) | Full-screen terminal UI |
| [Routing](/routing-system) | Session keys and agent bindings |
| [Models](/models) | LLM provider configuration |

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| `ERR_MODULE_NOT_FOUND` | Run `pnpm install` |
| `Cannot find module '@xopcai/...'` | Run `pnpm run build` |
| Config not loading | Verify `~/.xopc/xopc.json` is valid JSON |
| Bot not responding | Check `TELEGRAM_BOT_TOKEN` and bot status |
| API key errors | Verify environment variables are set |

### Getting Help

- Check [Documentation](/) for detailed guides
- Review [AGENTS.md](https://github.com/xopcai/xopc/blob/main/AGENTS.md) for development guide
- View logs: `xopc gateway logs --follow`
