# From Chat to Loops

"Turn goals into loops" does not mean you need to design a workflow system before you can use xopc.

Most people should start with a normal chat. Ask questions, think through a decision, summarize a project, or capture what happened today. The loop appears gradually as xopc keeps the useful context and helps you return to the next step.

## The path

You do not need a perfect system on day one. xopc is designed to become more useful as you keep using it.

| Stage | What you do | What xopc starts to do |
| --- | --- | --- |
| **Chat** | Ask questions, think through work, make decisions. | Gives you a local AI assistant that uses your model keys and local state. |
| **Project** | Ask it to keep track of one active goal. | Carries the goal, current state, blockers, and next actions across sessions. |
| **Notes & ideas** | Drop rough notes, progress updates, links, and feedback as they happen. | Turns scattered inputs into context the assistant can reuse. |
| **Connectors** | Pair the mobile app by QR code, or use the same assistant on desktop, terminal, messengers, and gateway APIs. | Lets you chat and capture notes from anywhere while the agent and data stay in your xopc runtime. |
| **Automations** | Schedule reviews, reminders, summaries, and workflow runs. | Keeps important work resurfacing and closes the loop without you starting every turn manually. |

## A simple first prompt

```text
Help me keep this project moving. Track the goal, current status, blockers, decisions, and next actions. When I send updates, summarize what changed and suggest the next step.
```

Use it for a side project, writing plan, product idea, customer follow-up, learning plan, or personal checklist. Once the habit works in chat, add channels and automations only where they reduce friction.

### What to look for after the first prompt

- The assistant should treat the work as something you will continue, not just a one-shot question.
- Your local state and config live under `~/.xopc/` by default.
- You can keep feeding short notes, links, blockers, and decisions in the same chat.
- You can add Web, mobile QR pairing, messenger, connector, and automation paths later when they reduce friction.

## What a loop looks like

1. You give xopc a goal and the current state.
2. xopc helps identify the next action.
3. You act outside or inside xopc.
4. You send back the result, a blocker, or a new idea.
5. xopc updates the context and helps choose the next move.
6. Automations repeat the review, reminder, or summary when needed.

The value comes from repetition. A single chat can answer a question. A loop keeps the project visible, current, and easier to resume.

## Mobile as a private remote control

Many useful notes do not happen while you are sitting at your computer. The xopc mobile app is meant for those moments: capture a thought, send a project update, record a blocker, or continue a conversation from iOS or Android.

The important distinction is that the mobile app is not a separate cloud brain. xopc still runs on your computer or self-managed host. The app pairs with your gateway by QR code and talks to that runtime. Your long-term project context stays in your xopc environment instead of being moved into a hosted chat account.

## Your timeline

| When | What to add |
| --- | --- |
| **Day 1** | Chat locally, configure one model, ask xopc to track a real project. |
| **This week** | Feed it notes, blockers, decisions, links, and progress updates. |
| **When it sticks** | Add the surfaces you actually use: desktop, terminal, browser, mobile QR pairing, Telegram, WeChat, or Feishu/Lark. |
| **As work repeats** | Add automations for reviews, reminders, summaries, and workflow runs. |

## Start by what you want

| Goal | Start here |
| --- | --- |
| I want a private AI assistant on my computer | [First 5 Minutes](../first-5-minutes.md) |
| I want to understand how chat becomes a data flywheel | This page |
| I want to know how xopc differs from Codex, Claude Code, Qoder, and WorkBuddy | [Comparison](../comparison.md) |
| I want the same assistant in Telegram, WeChat, or Feishu/Lark | [Channels](../channels/index.md) |
| I want scheduled reviews, reminders, and summaries | [Automations](../automations.md) |
| I want multiple agents for work, code, and personal contexts | [Routing system](../routing-system.md) |
| I want to extend xopc with tools, channels, or reusable skills | [Skills](../skills.md) and [Extensions](../extensions.md) |
