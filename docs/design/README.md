# Product and engineering design documents

This directory contains internal product decisions, engineering designs, RFCs, release runbooks, and documentation process notes. It is kept in the repository for contributors and is excluded from the public VitePress user site.

User documentation belongs at the top level of `docs/` or in a user-facing topic directory such as `docs/channels/`, `docs/how-to/`, or `docs/reference/`.

Before adding a document, use this rule:

- If it helps a user install, configure, use, or troubleshoot xopc, write a user guide.
- If it explains how xopc is built, records a proposed implementation, or coordinates development work, put it in `docs/design/`.
- If it records a durable architecture decision, put it in `docs/adr/`.

See [Documentation information architecture](./documentation-information-architecture.md) for the full writing and placement rules.

Active proposed designs:

- [Benchmark 驱动 Harness 持续自我迭代](./benchmark-driven-harness-evolution-plan.md)：统一评测证据、并发快速验证、开发者 Dashboard 与执行收敛/可靠交付试点的分阶段建设计划。
- [Personal AI work continuity](./personal-ai-work-continuity-plan.md): result reading, durable handoffs, follow-up revisions, and foreground latency targets.
- [Personal result reading, stage A](./technical/personal-result-reading-stage-a-2026-10-15.md): implementation, access boundaries, cold-read continuation, and verification evidence.
- [Realtime voice product requirements](./realtime-voice-prd.md)
- [Realtime voice technical design](./realtime-voice-technical-design.md)
- [Realtime voice WebSocket protocol](./realtime-voice-websocket-protocol.md)
- [Personal AI voice opening greeting](./personal-ai-voice-opening-greeting.md): connection greeting, client readiness, interruption and reconnect deduplication.

## Maintained reference areas

- [UI design system](./ui-design-system.md): shared visual and interaction rules.
- [Technical architecture](./technical/architecture.md), [storage](./storage-architecture.md) and [Agent capabilities](./agent-native-capability-architecture.md): contributor contracts.
- [Public cloud model services](./xopc-cloud-public-model-services.md) and [image providers](./technical/image-provider-upgrade-plan-2026-10-09.md): current capability contracts and upgrade constraints.
- [Personal AI follow-ups](./personal-agent-proactivity-technical.md): runtime and policy boundaries; user instructions are in the public guide.
- [Computer Use runtime contract](./technical/computer-use-runtime-contract.md): developer diagnostics, packaging and action semantics.
- `prd/`, `reviews/`, `security/` and mobile parity documents in `technical/`: internal requirements and scoped acceptance evidence. Their dated results are not current product availability claims.

Superseded `*-legacy.md` copies of public guides and the old documentation-quality plan have been removed. Git history retains those snapshots. Keep a design when it records a still-needed contract, decision, unfinished scope or acceptance boundary; delete a redundant implementation snapshot once its useful content is maintained elsewhere.

- [Personal AI 阶段 B：任务交接与执行能力校验](./technical/personal-task-handoff-stage-b-2026-10-15.md)
- [Personal AI 阶段 C：同任务修订、成果版本与最终交付](./technical/personal-task-revision-stage-c-2026-10-15.md)
- [Personal AI 阶段 D：链路观测、性能预算与回归门禁](./technical/personal-performance-stage-d-2026-10-15.md)

Removed obsolete documents on 2026-10-24:

- The empty Project/Task/TaskRun RFC; object responsibilities remain in [foreground task orchestration](./foreground-agent-task-orchestration.md).
- The old realtime voice review stub referring to protocol v2; use [persistent voice delivery](./persistent-voice-delivery.md) and the [v3 protocol](./realtime-voice-websocket-protocol.md).
- The two early one-click discussion capture designs describing a 30-minute limit and whole-recording upload; use the [meeting technical design](./voice-meeting-technical-design.md), [recording reliability implementation](./note-recording-reliability-phase-one.md) and [recording roadmap](./note-recording-product-technical-roadmap.md).
- Generated per-case chart answer Markdown; the [matrix acceptance report](./technical/chat-charts-default-agent-acceptance.md), structured results and screenshots retain the validation evidence.
