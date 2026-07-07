---
layout: home

hero:
  name: xopc
  text: Turn goals into loops.
  tagline: "Start with chat. Keep projects alive. Capture notes from your phone. Let automations turn repeated follow-up into a private, local-first data flywheel."
  image:
    light: /logo.svg
    dark: /logo-dark.svg
    alt: xopc
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/xopcai/xopc

features:
  - title: 🔁 Goal loops, not one-shot chats
    details: "Start with a normal conversation, then grow into projects, notes, connectors, and automations as the work gets more valuable."
    link: /concepts/loops
  - title: 🏠 Local-first by default
    details: "xopc runs on your hardware. Config, workspace files, credentials, and local state live under ~/.xopc/. No mandatory cloud."
    link: /configuration
  - title: 🔑 Bring your own keys. Any model.
    details: "DeepSeek, OpenAI, Anthropic, Google, Ollama, LM Studio, vLLM, Bedrock, Azure — 20+ providers. Run offline or mix cloud and local. Switch models in one config line."
    link: /models
  - title: 📡 One assistant, every surface
    details: "The same assistant across TUI, CLI, browser, desktop app, mobile app on iOS/Android, and messengers. No sync needed. It's all one system."
    link: /desktop-app
  - title: 🧩 Grows with you. Never outgrow it.
    details: "xopc skills install · xopc extensions install — extend capabilities with reusable modules, tools, channels, and UI panels without forking core."
    link: /extensions
  - title: ⏰ Automations
    details: Scheduled, manual, and webhook-triggered agent or workflow runs. Your agent keeps moving while you focus elsewhere.
    link: /automations
  - title: 🔀 Dynamic workflows
    details: Fan out subagents from deterministic scripts — repo audits, multi-perspective reviews, and parallel research with live progress.
    link: /workflows
  - title: 🤖 Multi-agent routing
    details: Route different contexts to different agents — each with its own model, workspace, tools, and system prompt.
    link: /routing-system
  - title: 🌐 HTTP/SSE gateway
    details: REST JSON APIs plus Server-Sent Events for streaming; the same React console in browser and Electron.
    link: /gateway
  - title: 🛠️ Type-safe tools
    details: TypeBox schemas for built-in and custom tools — web search, browser (Playwright, opt-in), file ops, and more.
    link: /tools
  - title: 🎙️ Voice & vision
    details: STT/TTS where configured (Telegram, gateway). Images — vision plus generation when wired up.
    link: /voice
---

## How xopc grows with you

You do not need to build a workflow system on day one. xopc starts useful as a local chat assistant, then becomes more valuable as you keep giving it project context.

| Stage | Start with | Add when it helps |
| --- | --- | --- |
| Chat | Ask questions, think through work, make decisions | Your own model keys and local state |
| Project | Ask xopc to follow one goal over time | Goal state, blockers, decisions, next actions |
| Notes | Drop updates, links, ideas, and feedback | Reusable context for future turns |
| Connectors | Pair the mobile app by QR code, or use desktop, terminal, browser, messengers, gateway APIs | Signals from where your work already happens, while the agent and data stay in your xopc runtime |
| Automations | Schedule reviews, reminders, summaries, workflows | A loop that keeps work visible without manual restarts |

Read the concept guide: [From Chat to Loops](./concepts/loops.md).

## Start by what you want

| Goal | Start here |
| --- | --- |
| I want a private AI assistant on my computer | [First 5 Minutes](./first-5-minutes.md) |
| I want to understand how chat becomes a data flywheel | [From Chat to Loops](./concepts/loops.md) |
| I want to know how xopc differs from Codex, Claude Code, Qoder, and WorkBuddy | [Comparison](./comparison.md) |
| I want the same assistant in Telegram, WeChat, or Feishu/Lark | [Channels](./channels/index.md) |
| I want scheduled reviews, reminders, and summaries | [Automations](./automations.md) |
| I want multiple agents for work, code, and personal contexts | [Routing system](./routing-system.md) |
| I want to extend xopc with tools, channels, or reusable skills | [Skills](./skills.md) and [Extensions](./extensions.md) |
