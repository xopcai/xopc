# Comparison

This page compares xopc with adjacent AI agent products using public product positioning checked on July 7, 2026. The goal is not to rank tools. It is to help you choose the right layer.

## Short version

Use **Codex** or **Claude Code** when your main job is software development inside a codebase. Use **WorkBuddy** when your main job is office deliverables like reports, decks, spreadsheets, or research packages. Use **Qoder/QoderWork** when you want a commercial agentic coding and work suite.

Use **xopc** when you want a self-hosted, local-first assistant that keeps long-running goals alive across models, channels, automations, workflows, and surfaces.

## Comparison table

| Product | Public positioning | Strong fit | xopc advantage |
| --- | --- | --- | --- |
| **Codex** | OpenAI's coding agent for software development across CLI, IDE, app, and cloud tasks. | Writing, reviewing, debugging, and automating development work in repos. | xopc is broader than coding: local state under `~/.xopc/`, BYOK/local models, gateway APIs, scheduled loops, desktop/web/mobile, and messengers share one assistant. |
| **Claude Code** | Anthropic's agentic coding system that reads codebases, edits files, runs tests, and works through git/toolchains. | Project-level engineering work and coding task handoff. | xopc is a personal AI runtime for long-running work, not only repo execution. Goals, sessions, agents, channels, skills, workflows, and automations can all connect around the same local state. |
| **Qoder / QoderWork** | Agentic platform covering autonomous development desktop, QoderWork, QoderWake, Qoder CLI, plugins, and cloud agents. | Commercial coding and work-agent suite with multi-agent collaboration and desktop/work scenarios. | xopc is MIT open source and hackable. You own the runtime, config, data directory, model choices, gateway, and extension surface. |
| **WorkBuddy** | Full-scenario AI agent desktop workstation for workplace roles, planning and executing tasks that produce verifiable outputs. | Office work such as reports, presentations, spreadsheets, data analysis, deep research, and batch file processing. | xopc is better when you want self-hosted operation, BYOK providers, local/cloud model mixing, messenger channels, and long-term project memory instead of a packaged office agent. |

## Where xopc is different

### 1. Goal loops, not just task execution

Many agents execute a task. xopc is built around ongoing loops: direction, action, feedback, and recalibration. That makes it a better fit for side projects, personal operating systems, long-running research, independent businesses, and recurring review rhythms.

### 2. Local-first ownership

xopc keeps config, local state, sessions, logs, agent files, and workspaces under your xopc state directory by default. You can run the gateway yourself, expose it through your own remote-access layer, and choose what leaves your machine.

### 3. Bring your own models

xopc is designed for provider freedom. Use cloud APIs, local model servers, OpenAI-compatible endpoints, Ollama, LM Studio, vLLM, and other configured providers. Your default assistant is not tied to one vendor account.

### 4. One assistant, many surfaces

The same assistant can be available from CLI, TUI, browser, desktop, mobile, Telegram, WeChat, and Feishu/Lark. You do not need a separate bot, a separate web app, and a separate terminal assistant that all forget each other.

### 5. Automations and workflows as first-class product behavior

xopc supports scheduled runs, reminders, summaries, visual workflow runs, and multi-agent routing. This is where the "loop" becomes practical: important work can resurface without waiting for you to open a chat.

## Choose xopc if

- You want a private, self-hosted AI assistant on your own machine.
- You want long-term context for goals, projects, sessions, and recurring work.
- You want the same assistant in terminal, desktop, web, mobile, and messengers.
- You want to bring your own API keys or local models.
- You want a hackable MIT-licensed system instead of a closed product surface.
- You want automations and workflows, not only chat.

## Choose another tool first if

- You only need a coding agent inside one repository.
- Your team already standardizes on Codex or Claude Code for engineering workflows.
- You primarily need office deliverables from a packaged commercial workbench.
- You want a fully managed enterprise agent platform instead of a self-hosted system.

## Public sources

- [OpenAI Codex](https://developers.openai.com/codex)
- [Codex CLI](https://developers.openai.com/codex/cli)
- [Anthropic Claude Code](https://www.anthropic.com/product/claude-code)
- [Claude Code GitHub repository](https://github.com/anthropics/claude-code)
- [Qoder](https://qoder.com/)
- [Tencent WorkBuddy overview](https://www.workbuddy.ai/docs/workbuddy/Overview)
