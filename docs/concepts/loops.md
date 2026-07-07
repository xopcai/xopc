# From Chat to Loops

“Turn goals into loops” does not mean you need to design a workflow system before you can use xopc.

Most people should start with a normal chat. Ask questions, think through a decision, summarize a project, or capture what happened today. The loop appears gradually as xopc keeps the useful context and helps you return to the next step.

## The path

| Stage | What you do | What changes |
| --- | --- | --- |
| Chat | Ask questions and make decisions in a local assistant. | You get a private place to think and act with your own model setup. |
| Project | Ask xopc to follow one goal over time. | The assistant starts carrying the goal, current state, blockers, and next actions. |
| Notes and ideas | Add rough notes, progress updates, links, and feedback whenever they happen. | Your scattered inputs become reusable working context. |
| Connectors | Pair the mobile app by QR code, or use the same assistant from desktop, terminal, browser, messengers, or gateway APIs. | You can keep talking and capturing notes from anywhere while the agent and data stay in your xopc runtime. |
| Automations | Schedule reviews, reminders, summaries, and workflow runs. | xopc brings the work back at the right time instead of waiting for you to remember. |

## What a loop looks like

1. You give xopc a goal and the current state.
2. xopc helps identify the next action.
3. You act outside or inside xopc.
4. You send back the result, a blocker, or a new idea.
5. xopc updates the context and helps choose the next move.
6. Automations repeat the review, reminder, or summary when needed.

The value comes from repetition. A single chat can answer a question. A loop keeps the project visible, current, and easier to resume.

## Mobile is a private remote control

Many useful notes do not happen while you are sitting at your computer. The xopc mobile app is meant for those moments: capture a thought, send a project update, record a blocker, or continue a conversation from iOS or Android.

The important distinction is that the mobile app is not a separate cloud brain. xopc still runs on your computer or self-managed host. The app pairs with your gateway by QR code and talks to that runtime. Your long-term project context stays in your xopc environment instead of being moved into a hosted chat account.

## A simple first prompt

```text
Help me keep this project moving. Track the goal, current status, blockers, decisions, and next actions. After each update from me, summarize what changed and suggest the next step.
```

Use it for a side project, writing plan, product idea, customer follow-up, learning plan, or personal operations checklist. Once the habit works in chat, add channels and automations only where they reduce friction.
