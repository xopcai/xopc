# Getting Started

This guide provides a complete walkthrough for setting up **xopcbot** for the first time. We'll cover installation, configuration, and running the agent in different modes.

## 1. Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: You need version **22.0.0** or newer. You can check your version with `node -v`.
- **npm** or **pnpm**: Your preferred package manager.

## 2. Installation

Clone the repository from GitHub and install the dependencies.

```bash
git clone https://github.com/xopcai/xopcbot.git
cd xopcbot
npm install
# or: pnpm install
```

## 3. Configuration

The easiest way to set up your configuration is with the interactive `configure` command.

```bash
npm run dev -- configure
# or: pnpm run dev -- configure
```

This command will:
1.  Create the necessary directories (`~/.xopcbot/` and `~/.xopcbot/workspace/`).
2.  Generate a default `config.json` file at `~/.xopcbot/config.json`.
3.  Prompt you to select an LLM provider and enter your API key.

Your API key will be securely stored in the configuration file.

## 4. First Interaction (CLI)

Once configured, you can immediately start interacting with your agent through the command line.

#### Single Message Mode

Use the `-m` flag to send a single message and receive a response.

```bash
npm run dev -- agent -m "Explain what an LLM is in one sentence."
# or: pnpm run dev -- agent -m "Explain what an LLM is in one sentence."
```

#### Interactive Mode

For a continuous conversation, use the `-i` flag to enter interactive mode.

```bash
npm run dev -- agent -i
# or: pnpm run dev -- agent -i
```

You'll be presented with a `You:` prompt. Type your messages and press Enter. To exit, press `Ctrl+C`.

## 5. Running with Channels (Gateway Mode)

To connect your agent to messaging platforms like Telegram, you need to run it in **Gateway Mode**.

#### a. Configure Your Channel

First, edit your `~/.xopcbot/config.json` file and add the required information for your channel. For Telegram, you need your bot token.

```jsonc
// ~/.xopcbot/config.json
{
  // ... other config ...
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "123456:ABC-DEF1234567890", // <-- Add your bot token here
      "allowFrom": ["your_telegram_user_id"] // Optional: Restrict access
    }
  }
}
```

See the [Channels documentation](channels.md) for more details.

#### b. Start the Gateway

Run the `gateway` command. This starts a long-running process that connects to your configured channels and listens for messages.

```bash
npm run dev -- gateway
# or: pnpm run dev -- gateway
```

You can now open your Telegram client and start a conversation with your bot. Any messages you send will be processed by the agent.

## What's Next?

You now have a fully functional xopcbot! Here are a few suggestions for what to explore next:

- **[CLI Reference](cli.md)**: Discover all the available commands to manage your bot.
- **[Configuration](configuration.md)**: Learn about all the settings you can tweak in `config.json`.
- **[Plugins](plugins.md)**: Explore how to extend your agent's capabilities with plugins.
