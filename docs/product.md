# Product philosophy

> **xopc lives on your computer—and slowly gets to know you.**

xopc is a local-first personal AI assistant. It builds a reviewable, correctable understanding from the parts of your digital life you choose to share, catches unfinished thoughts, and helps you move genuinely important work forward.

It is not an AI employee waiting for a job description, a coding agent confined to one repository, or a task manager that expects you to organize everything first. Models, Agents, Tasks, Projects, Workflows, and Automations are supporting capabilities. The product is the long-term relationship they make possible.

## The relationship, not just the interface

xopc should not pretend to know someone on the day it is installed. Understanding is earned through an explicit progression:

```text
Meet
→ explore authorized sources
→ form an initial understanding
→ help with real work
→ earn trust
→ become gradually proactive
```

The assistant begins with conversation and safe defaults. The user may then connect a work folder or another source, see what xopc examined, review what it inferred, and correct it. Each useful result and correction makes the next interaction better grounded.

The desired first-value moment is not “xopc can access my files.” It is:

> xopc noticed what I am actually trying to accomplish, showed why it reached that conclusion, and helped me take a credible next step.

## Four product capabilities

### Understand a person

xopc maintains structured, governed understanding rather than treating every piece of data as permanent memory. Useful understanding may include:

- goals, preferences, and working habits;
- important people and relationships;
- active projects and longer-running directions;
- decisions and the reasons behind them;
- commitments that still need attention;
- recent pressures, blockers, and current focus.

Each item has a lifecycle. It may be proposed, confirmed, corrected, rejected, marked stale, or deleted. Direct statements and explicit rules take priority over inference. See [User understanding](./user-understanding.md).

### Hold messy, long-running work

People rarely produce perfectly organized tasks. A useful assistant must be able to receive an incomplete thought, file, link, voice note, message, or piece of evidence and help turn it into something actionable:

```text
Capture
→ connect to a goal or Project
→ add context
→ define the next action
→ identify dependencies and blockers
→ resurface it at a useful time
→ preserve decisions and evidence
→ retain reusable learning
```

Conversation is the natural entry point. A [Task](./concepts/loops.md) becomes the durable commitment when work needs to continue across time. A Project provides related context without creating a competing task state.

### Solve problems with the user

xopc should understand why a result matters, clarify ambiguity, investigate authorized context, make a plan, use tools, verify the result, and leave an inspectable record. Complex work can span multiple conversations, devices, and execution methods without requiring the user to reconstruct the story each time.

### Earn initiative

Initiative is not notification volume. It is the ability to notice a meaningful stalled commitment or new signal, propose a useful response, and stay quiet when interruption would not help.

Authority grows in stages:

```text
Observe only
→ remind
→ propose an action
→ act after confirmation
→ automatically handle explicitly authorized, low-risk work
```

The proactive foundation is evidence-first and suggestion-first. External writes and consequential actions require explicit policy or approval. See [Automations](./automations.md) and [Heartbeat](./heartbeat.md).

## Trust is a product surface

Exploration must remain visible and controlled. Product behavior should follow these rules:

1. Authorize each source separately and allow access to be revoked.
2. Show what is being examined, within what scope, and for what purpose.
3. Preserve evidence lineage for conclusions and recommendations.
4. Distinguish observed facts from inference.
5. Allow confirmation, correction, rejection, deletion, and forgetting.
6. Keep durable state local by default and disclose when selected context will be sent to a cloud model.
7. Require separate authority for sending, deleting, purchasing, or other high-impact actions.
8. Prefer silence over low-value interruption.

Local-first describes ownership and architecture; it does not automatically mean that every model request stays on-device. Use a local model when context must not be sent to an external provider.

## What exists now

The current product includes the foundations of this experience:

| Product need | Current foundation |
| --- | --- |
| Local ownership | Desktop app, self-hosted Gateway, local state, bring-your-own keys, cloud and local models |
| Reviewable understanding | Proposed and active understandings, explicit collaboration rules, confirmation and correction, stale/conflict review |
| Visible work discovery | Bounded, read-only analysis of explicitly selected folders with evidence-backed next steps; optional native context on macOS |
| Durable work | Conversations, Tasks, Projects, Notes, workspaces, evidence, and run history |
| Execution and follow-up | Tools, Skills, Workflows, Automations, and proactive suggestion infrastructure |
| Access surfaces | Desktop, web, CLI, TUI, mobile, Telegram, Weixin, Feishu/Lark, and APIs |

On macOS, the experimental Work Discovery onboarding can request separate operating-system access to Apple Notes, Calendar, and Reminders. It uses bounded, read-only scans and does not store raw native-source content in the xopc database. Availability and exact behavior may vary by release.

## First product horizon

The next product horizon is deliberately narrow:

1. Make the local macOS application the primary experience.
2. Provide one universal capture path for text, voice, files, and links.
3. Build individually authorized understanding from local files, Gmail, and Calendar.
4. Make personal understanding inspectable, traceable, and correctable.
5. Use Projects and Tasks to carry complex work across time.
6. Identify one genuinely important thing each day and help move it forward.
7. Confirm every external action before execution.

This is a direction, not a claim that every part is complete in the current release. Check [Releases](./releases.md) and feature-specific guides for current availability.

## Product measure

Message volume and automatic task count are not the north-star measure. The more important question is:

> After seven days, does the user feel that xopc understands them better than it did on day one—and that it genuinely helped advance something important?

