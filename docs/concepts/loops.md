# The Continuous Work Model

When xopc talks about a “loop,” it does not mean you must design a complicated workflow first, and it does not promise that a model automatically remembers everything. It describes a more reliable operating model: **state has an explicit home, execution is observable, and follow-up can be triggered again.**

A normal conversation stops after the answer. Continuous work must answer three questions: Where are we now? Who does what next? What time or event starts the work again? xopc uses separate, connected product objects for those jobs.

## What makes a loop

| Component | Role | Good home for |
| --- | --- | --- |
| **Session** | Keeps a continuing conversation and its run events | Discussion, tool results, temporary context |
| **Project** | Groups sessions, goals, workflows, and memory around one topic | Project brief, recent activity, attention items |
| **Goal** | Explicitly tracks a desired outcome and progress | Status, checklist, blockers, and next action |
| **Note / Workspace** | Captures inputs and retains durable material | Text, voice, images, attachments, documents, artifacts |
| **Workflow** | Organizes complex or parallel execution into visible phases | Reviews, research, audits, structured outputs |
| **Automation** | Decides when an agent or workflow runs again | Schedules, manual runs, webhooks, retries, notifications |

You do not need all of them. A temporary question may need only a Session. A long-running effort can add a Project and Goals. Repeated work can then become a Workflow or Automation.

## State, execution, and triggers are different

Keeping them separate avoids vague expectations about “AI memory.”

1. **State** answers “what do we know now?” Sessions retain conversations, goals retain progress, notes and workspaces retain material, and projects group related activity.
2. **Execution** answers “what happens this time?” An agent uses its allowed tools and skills; a workflow organizes multiple steps or subagents into an inspectable run.
3. **Triggers** answer “when does it happen again?” Start manually or let a schedule or webhook launch an automation, then inspect success, failure, and retry history.

A model does not gain infinite memory because a prompt says “remember this.” Put important information in the right object: an outcome to track belongs in a Goal, durable source material belongs in a Note or Workspace, and recurring action belongs in an Automation.

## A real project loop

Consider shipping a product release:

1. Create or select a Project and state the release scope and success criteria.
2. Track “ship the release” as a Goal with a checklist, blockers, and a next action.
3. Implement and test from terminal or web sessions; associate relevant sessions and workflow runs with the project.
4. Capture user feedback, voice thoughts, or screenshots into Notes from mobile.
5. Run a Workflow that fans out code review, documentation checks, and release-note drafting.
6. Use an Automation to summarize unfinished work daily or start checks from a webhook.
7. Return to the project to see its timeline, stale goals, failed runs, and recommended next action.

The loop does not mean the system decides everything for you. It means inputs, decisions, execution, feedback, and the next trigger each have a place you can find.

## Many surfaces, one state

CLI, TUI, web, desktop, mobile, and messenger channels are not separate assistants. They connect to the same xopc gateway and state store. Mobile is useful for capture and remote conversation, terminal for execution, and web for managing projects, agents, automations, and run history.

Remote access does not change ownership: xopc still runs on your computer or self-managed host. You choose the network exposure, token policy, and model providers.

## Start with the smallest useful combination

| Need | Minimum combination | Next step |
| --- | --- | --- |
| Temporary question or one task | Agent + Session | [First 5 Minutes](../first-5-minutes.md) |
| Keep a project moving | Project + Goal + Sessions | Open Projects / Goals in the gateway console |
| Capture material anywhere | Notes + Mobile / Web | [Mobile app](../mobile-app.md) |
| Execute complex multi-step work | Workflow + Agent | [Workflows](../workflows.md) |
| Review on a schedule or react to events | Automation + Agent / Workflow | [Automations](../automations.md) |
| Isolate capabilities by context | Multiple agents + capability presets | [Routing system](../routing-system.md) |

On your first run, get one Agent and one Session working. Add a Project / Goal when work needs to be resumed, and a Workflow / Automation when an action repeats. Complexity should come from a real need, not from installation-day ceremony.
