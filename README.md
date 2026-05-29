<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center"><a href="https://xopc.ai">xopc</a></h1>

<p align="center">
  <strong>The OPC workstation that grows with you.</strong><br />
  A self-hosted, local-first AI for one-person companies — terminal, browser, desktop, mobile, and messengers. One brain everywhere.<br />
  Bring your own keys. Extend without forking.
</p>

<p align="center">
  <sub><em>OPC = one-person company — a workstation that scales with you.</em></sub>
</p>

<p align="center">
  <a href="https://xopc.ai"><img src="https://img.shields.io/badge/website-xopc.ai-0ea5e9?style=flat-square" alt="xopc.ai"></a>
  <a href="https://www.npmjs.com/package/@xopcai/xopc"><img src="https://img.shields.io/npm/v/@xopcai/xopc?label=npm&amp;color=teal" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node.js-%E2%89%A522-339933?logo=nodedotjs&amp;logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License">
  <img src="https://img.shields.io/badge/LLM_providers-20%2B-5865F2" alt="LLM providers">
</p>

<p align="center">
  <a href="https://xopc.ai"><strong>xopc.ai</strong></a> ·
  <a href="https://xopcai.github.io/xopc/">Documentation</a> ·
  <a href="#get-started">Get started</a> ·
  <a href="https://github.com/xopcai/xopc/releases">Releases</a>
</p>

<p align="center">
  <img src="docs/public/xopc-tui.gif" alt="xopc terminal UI demo" width="720">
</p>

---

<a id="get-started"></a>
<a id="quick-start"></a>

## Get started

Install, onboard, and chat — three commands:

```bash
npm install -g @xopcai/xopc
xopc onboard          # faster: xopc onboard --quick
xopc tui --local
```

> **New here?** Start with **`xopc tui --local`** (embedded agent, no gateway). Run **`xopc gateway`** when you want the **web console** or **messengers** (Telegram, WeChat, Feishu).

**Requirements:** Node.js **≥ 22**. Use **pnpm** when developing from a git clone.

**China / slow `registry.npmjs.org`:** add `--registry=https://registry.npmmirror.com` to `npm install`, or `npm config set registry https://registry.npmmirror.com`.

### More commands

```bash
xopc agent -i                              # classic interactive CLI
xopc agent -m "Summarize the last 5 commits" # one-shot

xopc gateway                               # local web server + React console (URL in logs)
xopc gateway --background                  # detached; xopc gateway stop | status | logs
```

**From source:**

```bash
git clone https://github.com/xopcai/xopc.git && cd xopc
pnpm install && pnpm run dev -- agent -i
pnpm run build    # Node + web console → dist/
```

---

## Why xopc

- 🏠 **Your machine** — Data and config under **`~/.xopc/`**. No mandatory cloud or surprise bills.
- 🔑 **Bring your own keys** — DeepSeek (recommended), OpenAI, Anthropic, Ollama, LM Studio, vLLM, and **20+** providers. Mix cloud and local; switch models in one config line. See **[Models](https://xopcai.github.io/xopc/models)**.
- 📱 **One brain, every screen** — Same assistant in terminal, browser, desktop, phone, and IM. No sync layer — one system.
- 🧩 **Grows with you** — **`xopc skills install`** · **`xopc extensions install`** for tools, channels, and UI panels; multi-agent routing per context.
- ⏰ **Proactive** — **Cron** for scheduled summaries and reminders; **multi-agent** routing with isolated workspaces, tools, and prompts.

---

## Where to chat

| Surface | How | Best for |
| --- | --- | --- |
| **TUI** | `xopc tui --local` (or `xopc tui --url …`) | Full keyboard, streaming, lowest friction to try |
| **CLI** | `xopc agent -i` / `xopc agent -m "…"` | Scripts and minimal TTY |
| **Web** | `xopc gateway` → open console URL | Chat, settings, logs in the browser |
| **Desktop** | [GitHub Releases](#desktop-app) or `pnpm run electron:build` | Native app (macOS, Windows, Linux) |
| **Mobile** | Pair with your gateway ([remote access](https://xopcai.github.io/xopc/remote-access)) | Assistant on the go |
| **Messengers** | `channels.*` + gateway | Telegram, WeChat, Feishu/Lark |

---

## Channels

Configure under **`channels.*`** in **`~/.xopc/xopc.json`**. IM bots need a running gateway; WeChat login runs on the gateway host.

| Channel | Config | Notes |
| --- | --- | --- |
| **Telegram** | `channels.telegram` | Multi-account, streaming, policies |
| **WeChat** | `channels.weixin` | QR login on gateway host |
| **Feishu / Lark** | `channels.feishu` | Bot / webhook per docs |

Full reference: **[Channels](https://xopcai.github.io/xopc/channels)** · **[Configuration](https://xopcai.github.io/xopc/configuration)**.

---

## Extensions & skills

```bash
xopc skills install <name>       # SKILL.md domains
xopc extensions install <pkg>    # tools, channels, UI panels
xopc extensions dev ./my-extension
```

Guides: **[Extensions](https://xopcai.github.io/xopc/extensions)** · **[Skills](https://xopcai.github.io/xopc/skills)**. Gateway UI extensions: **`@xopcai/xopc/extension-ui-sdk`** (`packages/extension-ui-sdk/`).

---

## Configuration

Default: **`~/.xopc/xopc.json`**.

```json
{
  "agents": {
    "defaults": {
      "model": "deepseek/deepseek-chat",
      "max_tokens": 8192
    }
  },
  "providers": {
    "deepseek": "${DEEPSEEK_API_KEY}",
    "openai": "${OPENAI_API_KEY}"
  }
}
```

Add **`channels.telegram`**, **`channels.weixin`**, or **`channels.feishu`** when you need IM — see **[configuration](https://xopcai.github.io/xopc/configuration)**.

Optional tools (e.g. browser) stay **off until enabled**; use Playwright Chromium if you turn on browser tools.

---

## Documentation

| Guide | Description |
| --- | --- |
| [Getting started](https://xopcai.github.io/xopc/getting-started) | Install, onboard, first chat |
| [Configuration](https://xopcai.github.io/xopc/configuration) | `xopc.json` reference |
| [CLI](https://xopcai.github.io/xopc/cli) | Commands and flags |
| [Channels](https://xopcai.github.io/xopc/channels) | Telegram, WeChat, Feishu |
| [Architecture](https://xopcai.github.io/xopc/architecture) | How pieces fit together |

Also: [Tools](https://xopcai.github.io/xopc/tools) · [Voice](https://xopcai.github.io/xopc/voice) · [Remote access](https://xopcai.github.io/xopc/remote-access)

---

<a id="desktop-app"></a>
<a id="electron-desktop"></a>

## Desktop app

1. Download from **[GitHub Releases](https://github.com/xopcai/xopc/releases)** (`.dmg` / `.exe` / `.AppImage` / `.deb`).
2. Or use **`xopc gateway`** + the npm CLI until a build exists for your OS.

**Build from source:** `pnpm install && pnpm run electron:build` → `dist/release/`

---

## Security

Treat inbound IM messages as **untrusted**. Prefer **pairing** or **allowlist** for DMs. Keep gateway bind addresses and tokens secret — **[Channels](https://xopcai.github.io/xopc/channels)**.

---

## Contributing

```bash
pnpm install && pnpm run dev    # CLI via tsx
pnpm run build && pnpm test && pnpm run lint
```

**[AGENTS.md](./AGENTS.md)** · **[CONTRIBUTING.md](./CONTRIBUTING.md)**

**Issues:** [bug](https://github.com/xopcai/xopc/issues/new?template=bug_report.yml) · [feature](https://github.com/xopcai/xopc/issues/new?template=feature_request.yml) · [Q&A Discussions](https://github.com/xopcai/xopc/discussions/categories/q-a) · [security advisory](https://github.com/xopcai/xopc/security/advisories/new) (not public issues)

---

## Credits

- LLM layer: [@earendil-works/pi-ai](https://github.com/earendil-works/pi-mono) · Agent runtime: [@earendil-works/pi-agent-core](https://github.com/earendil-works/pi-mono)
- Inspired by [openclaw/openclaw](https://github.com/openclaw/openclaw) and [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

---

<p align="center"><sub>Made with care by <a href="https://github.com/xopcai">xopcai</a> · <a href="https://xopc.ai">xopc.ai</a></sub></p>
