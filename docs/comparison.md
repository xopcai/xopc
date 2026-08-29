# Where xopc fits

xopc sits between a personal knowledge system, a long-running work manager, and an agent runtime—but its product is not any one of those parts. It is a local-first personal AI assistant that develops a reviewable understanding of one person and helps that person move important work forward over time.

This page explains product boundaries rather than ranking vendors.

## How adjacent products differ

| Product category | Usually optimized for | Where xopc differs |
| --- | --- | --- |
| **General chat assistant** | Answering the current request in a conversation | xopc preserves governed understanding, Projects, Tasks, decisions, and run history so work can continue across time and surfaces. |
| **Coding agent** | Reading, changing, and verifying work inside a codebase | xopc can support coding, but its scope is the person's wider goals, relationships, commitments, files, messages, and recurring work. A coding agent can remain one execution tool. |
| **AI employee or role agent** | Performing a defined organizational role or queue of delegated jobs | xopc is centered on one person's changing intentions. It starts without pretending to know the user and earns initiative through correction and explicit authority. |
| **Task manager** | Storing tasks the user has already clarified and organized | xopc accepts incomplete thoughts and evidence, helps discover the relevant goal and context, and turns them into the next credible action. |
| **Automation platform** | Connecting triggers, integrations, and deterministic actions | xopc connects automation to personal context, Task state, evidence, and an authority ladder. Automation is an execution capability, not the product identity. |
| **Personal knowledge system** | Capturing, linking, and retrieving information | xopc distinguishes fact from inference, governs what should be remembered or forgotten, and uses trusted understanding to help act. |

## The defining differences

### A relationship that improves over time

xopc begins with safe defaults and no claim to know the user. Understanding grows from authorized sources, shared work, and explicit correction. The useful unit is not only a message or task completion, but whether the next interaction begins from better grounded context.

### Intent, not only tasks

The input may be a clear request, a vague thought, a file, a link, or a signal from connected work. xopc helps connect it to a goal or Project, define a Task when durable execution is needed, identify blockers, and preserve decisions and evidence.

### Local-first ownership

Configuration, state, conversations, logs, Agent files, and workspaces live under the xopc state directory by default. The user chooses models, providers, remote access, sources, tools, and capability boundaries.

Local-first does not mean cloud models receive no data. Relevant context is sent to a selected cloud provider when required for a request. Users can choose local models for work that must stay on-device.

### Reviewable understanding

Facts, inferences, and collaboration rules are distinct. The user can inspect, confirm, correct, reject, or delete understanding. Old and contradictory items can return to review rather than silently shaping behavior forever.

### Initiative that must be earned

xopc's intended progression is observation, reminder, proposal, confirmed execution, then explicitly authorized low-risk automation. High-impact external actions do not become acceptable merely because the model is confident.

### One assistant across surfaces

Desktop, web, terminal, mobile, and messaging channels can reach the same Agents, Conversations, Projects, Tasks, and user understanding. Surfaces do not need to become separate assistants that forget one another.

## Choose xopc when

- you want one personal assistant to become more useful across months, not only one session;
- you want understanding and memory to be visible and correctable;
- you want to begin with messy input rather than maintaining a perfect task system;
- you want Tasks and Projects to preserve important work and its evidence;
- you want to bring your own cloud keys or local models;
- you want a self-hosted, MIT-licensed system that can be extended;
- you want proactive help to remain suggestion-first and permission-aware.

## Choose a narrower tool first when

- you only need code changes inside one repository;
- you only need stateless answers or document generation;
- you already have clearly structured tasks and do not want AI to interpret context;
- you want a fully managed enterprise work platform instead of a local system;
- you do not want to operate models, credentials, storage, updates, or remote access.

Narrower tools and xopc can coexist. xopc can retain the personal intent and durable context while a specialized tool performs one part of the execution.

See [Product philosophy](./product.md), [User understanding](./user-understanding.md), and [The Task Loop](./concepts/loops.md).
