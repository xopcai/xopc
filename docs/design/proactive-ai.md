# Proactive AI

> Status: implemented foundation.

Proactive AI continuously converts user-authorized work changes into a small number of evidence-backed insights and decisions. The user should not need to monitor every project, task, automation, note, or calendar change; xopc observes approved signals, performs bounded background analysis, and asks for attention only when the user can make a useful decision.

## Product outcome

```text
authorized business changes
  -> durable event facts
  -> scenario trigger and signal aggregation
  -> bounded context scan
  -> versioned prompt execution
  -> evidence and value gates
  -> insight record
  -> Inbox decision or digest
  -> user decision
  -> action and feedback events
```

The product is successful when it reduces monitoring work without creating a new notification workload. AI execution is therefore not equivalent to user interruption: most events must end as ignored signals, discarded runs, or quiet records.

## Product principles

1. **One event vocabulary.** Projects, tasks, goals, automations, sessions, notes, and connectors publish the same immutable event envelope. A domain never selects a prompt or sends a proactive notification.
2. **Scenarios own meaning.** A scenario defines which event patterns matter, what context can be read, which prompt revision runs, the expected output, and how much value is required for delivery.
3. **Prompts are configurable but authority is not.** Users can tune analysis intent and delivery preferences for each scenario. They cannot use prompt text to expand data access, tools, budgets, or side-effect permissions.
4. **Evidence before recommendation.** Every non-empty insight references source facts and separates observation, inference, recommendation, and requested decision.
5. **Value before interruption.** Deterministic policy, not the language model alone, chooses discard, record, digest, Inbox, or push.
6. **Background work is durable.** Events, batches, runs, insights, Inbox projections, and deliveries survive gateway restarts and are idempotent.
7. **The user remains the principal.** External writes and consequential actions require explicit policy or approval. The initial release is read-only and suggestion-first.

## Product surfaces

- **Existing decision Inbox:** proactive judgments appear beside other items that need the user. There is no separate Proactive AI page.
- **Judgment card:** shows why now, impact, work already performed, recommendation, and 2-3 choices only when a real user decision remains.
- **Natural-language correction:** the user can tell AI how to judge this kind of event next time; the explicit submission publishes an auditable prompt revision without changing authority.
- **Push:** only high-value judgments are pushed, and the notification opens the exact Inbox item.
- **Internal diagnostics:** event, batch, run, and scenario health remain authenticated operator APIs, not user product navigation.

## Core product objects

| Object | Responsibility | Not responsible for |
|---|---|---|
| Event | Immutable statement that something happened | Prompt choice, notification |
| Signal batch | Relevant event set grouped for one scenario and subject | AI interpretation |
| Scenario | Trigger, context, prompt, execution and delivery policy | Mutable run state |
| Prompt revision | Versioned user intent layered over protected instructions | Permissions or tool policy |
| Run | One durable attempt to analyze one batch | User-facing lifecycle |
| Insight | Structured, evidence-backed analytical result | Delivery retries |
| Inbox item | User attention and decision projection | Source-of-truth analysis |
| Delivery | Per-channel delivery attempt | Insight value calculation |

Detailed technical contracts are in [Proactive AI architecture](./proactive-ai-architecture.md). Initial scenario PRDs, prompts, schemas, and evaluation plans are in [Proactive AI scenarios](./proactive-ai-scenarios.md).

## Initial scope

The first release supports three scenarios:

1. **Project delivery risk:** detect credible schedule, scope, dependency, or ownership risk after meaningful project changes or a fallback periodic scan.
2. **Blocked work:** detect a task that is blocked, missing a decision, or likely to miss a commitment because of dependency state.
3. **Automation failure impact:** determine whether an automation failure affects the user's work and what decision or recovery is needed.

Notes and calendar are context providers in the initial architecture, not independent product silos. Additional scenarios can later subscribe to their events without changing the pipeline.

## Non-goals for the first release

- A general-purpose complex event processing language.
- Arbitrary user-authored executable code in triggers.
- Autonomous external writes or messages.
- Model-generated SQL or unrestricted filesystem scans.
- A separate agent runtime from the existing xopc Agent and Automation infrastructure.
- Push delivery for every successful AI run.

## Architecture acceptance criteria

The implementation maintains these invariants:

- domains publish events without importing proactive scenario code;
- an event can be replayed without duplicate runs, insights, Inbox items, or pushes;
- each run is pinned to immutable event, context, scenario, and prompt versions;
- users can safely preview, test, publish, and roll back per-scenario instructions;
- output validation and evidence checks can reject model output before persistence;
- delivery disposition is deterministic and auditable;
- data authorization is enforced before context loading and again before tool execution;
- the three initial scenarios have measurable offline and online quality criteria;
- legacy proactive paths are removed instead of wrapped in compatibility or dual-write logic.

## Decision record

The architecture deliberately uses SQLite plus leased workers for the local-first product. It does not introduce Kafka, a workflow engine, a vector database, or a rule DSL in phase one. Interfaces preserve those extension points, but operational complexity is added only after measured need.
