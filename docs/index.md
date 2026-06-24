---
layout: home

hero:
  name: xopc
  text: Goal Loop OS
  tagline: "A local-first AI assistant that keeps long-term goals moving across terminal, web, desktop, mobile app, and messengers."
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
  - title: 🏠 Local-first by default
    details: "xopc runs on your hardware. Config, workspace files, credentials, and local state live under ~/.xopc/. No mandatory cloud."
    link: /configuration
  - title: 🔑 Bring your own keys. Any model.
    details: "DeepSeek, OpenAI, Anthropic, Google, Ollama, LM Studio, vLLM, Bedrock, Azure — 20+ providers. Run offline or mix cloud and local. Switch models in one config line."
    link: /models
  - title: 📡 One brain, every screen
    details: "The same assistant across TUI, CLI, browser, desktop app, xopc-app on iOS/Android, and messengers. No sync needed. It's all one system."
    link: /channels
  - title: 🧩 Grows with you. Never outgrow it.
    details: "xopc skills install · xopc extensions install — extend capabilities with reusable modules, tools, channels, and UI panels without forking core."
    link: /extensions
  - title: ⏰ Cron scheduling
    details: Summaries, reminders, and reports on a timetable. Your agent runs while you focus elsewhere.
    link: /cron
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
