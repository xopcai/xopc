---
layout: home

hero:
  name: xopc
  text: Turn goals into loops.
  tagline: "Keep what matters moving. A self-hosted, local-first personal AI runtime connecting models, agents, durable state, workflows, automations, and every surface you use. You own the data, keys, and environment."
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
  - title: 🧠 Durable state, not one-shot context
    details: "Persistent sessions, projects, goals, notes, workspaces, and run history give long-running work an explicit place to resume and inspect."
    link: /concepts/loops
  - title: 🏠 Local-first by default
    details: "xopc runs on your hardware. Config, workspace files, credentials, and local state live under ~/.xopc/. No mandatory cloud."
    link: /configuration
  - title: 🔑 Bring your own keys. Any model.
    details: "DeepSeek, OpenAI, Anthropic, Google, Ollama, LM Studio, vLLM, Bedrock, Azure — 20+ providers. Run offline or mix cloud and local. Switch models in one config line."
    link: /models
  - title: 📡 One runtime, every surface
    details: "TUI, CLI, browser, desktop, iOS/Android, and messengers connect to the same agents, sessions, and project state."
    link: /desktop-app
  - title: 🧩 Explicit agent boundaries
    details: "Configure identity, model roles, workspace, tool policy, skills, and boundaries per agent; user understanding and memory stay shared across all agents."
    link: /extensions
  - title: ⏰ Triggerable automations
    details: Run agents or workflows on schedules, manually, or from webhooks, with visible run results and failures.
    link: /automations
  - title: 🌐 Browser automations
    details: Teach the assistant a web task once, then run the verified steps again from the console, chat, or a schedule.
    link: /browser-workflows
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

[![xopc desktop app demo](/xopc-desktop.gif)](./desktop-app.md)

## xopc manages a work runtime

Most chat products organize everything around one conversation. xopc gives long-running work several explicit, connected objects:

| Object | What it keeps | How it continues |
| --- | --- | --- |
| Agent | Identity, responsibilities, model roles, tools, skills, and boundaries | Give each kind of work a deliberate capability envelope; all agents share user context |
| Session | Transcript, context, and run events | Resume from terminal, web, desktop, mobile, or a messenger |
| Project / Goal | Brief, status, blockers, next actions, and linked activity | See what needs attention without mining chat history |
| Note / Workspace | Quick inputs, attachments, and durable files | Collect source material and retain reusable context and artifacts |
| Workflow / Automation | Multi-agent execution, triggers, run state, and results | Execute complex work and run it again on time or on an event |

The point is not that “AI remembers everything automatically.” Important state has a clear home, execution and triggers are observable, and you can tell where to resume. Read [The Continuous Work Model](./concepts/loops.md).

## Start by what you want

| Goal | Start here |
| --- | --- |
| I want a private AI assistant on my computer | [PC Desktop App](./desktop-app.md) |
| I want to understand how xopc stores state, executes work, and triggers follow-up | [The Continuous Work Model](./concepts/loops.md) |
| I want to organize long-running work with projects, goals, and notes | [Projects, Goals, and Notes](./projects-goals-notes.md) |
| I want to know how xopc differs from Codex, Claude Code, Qoder, and WorkBuddy | [Comparison](./comparison.md) |
| I want the same assistant in Telegram, WeChat, or Feishu/Lark | [Channels](./channels/index.md) |
| I want scheduled reviews, reminders, and summaries | [Automations](./automations.md) |
| I want the assistant to repeat a task on a website | [Browser automations](./browser-workflows.md) |
| I want multiple agents for work, code, and personal contexts | [Routing system](./routing-system.md) |
| I want to extend xopc with tools, channels, or reusable skills | [Skills](./skills.md) and [Extensions](./extensions.md) |
