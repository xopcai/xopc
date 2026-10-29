# Product and engineering design documents

This directory contains internal product decisions, engineering designs, RFCs, release runbooks, and documentation process notes. It is kept in the repository for contributors and is excluded from the public VitePress user site.

User documentation belongs at the top level of `docs/` or in a user-facing topic directory such as `docs/channels/`, `docs/how-to/`, or `docs/reference/`.

Before adding a document, use this rule:

- If it helps a user install, configure, use, or troubleshoot xopc, write a user guide.
- If it explains how xopc is built, records a proposed implementation, or coordinates development work, put it in `docs/design/`.
- If it records a durable architecture decision, put it in `docs/adr/`.

See [Documentation information architecture](./documentation-information-architecture.md) for the full writing and placement rules.

Active proposed designs:

- [对话优先配置：Skill、MCP 与定时任务](./conversation-first-configuration-product-plan-2026-10-28.md)：当前实现与缺口、原 Chat 配置闭环、安全输入，以及第一阶段任务和验收标准。
- [从服务名称到 MCP 连接：技术方案](technical/mcp-name-to-connection-technical-plan-2026-10-28.md)：有来源的服务发现、认证不确定性、有限恢复、接入方式分期及从名称开始的 E2E 门槛。
- [微信对话配置：安全输入、OAuth 回流与原私聊续跑](technical/weixin-conversation-configuration-2026-10-28.md)
- [Browser / Phone 对话配置审查修复](technical/browser-phone-setup-review-fixes-2026-10-28.md)：取消与重置保护、人工步骤弹窗、原对话续跑和真实 E2E 验收边界。
- [Benchmark 驱动 Harness 持续自我迭代](./benchmark-driven-harness-evolution-plan.md)：统一评测证据、并发快速验证、开发者 Dashboard 与执行收敛/可靠交付试点的分阶段建设计划。
- [Personal AI work continuity](./personal-ai-work-continuity-plan.md): result reading, durable handoffs, follow-up revisions, and foreground latency targets.
- [Personal result reading, stage A](./technical/personal-result-reading-stage-a-2026-10-15.md): implementation, access boundaries, cold-read continuation, and verification evidence.
- [Realtime voice product requirements](./realtime-voice-prd.md)
- [Realtime voice technical design](./realtime-voice-technical-design.md)
- [Realtime voice WebSocket protocol](./realtime-voice-websocket-protocol.md)
- [Personal AI voice opening greeting](./personal-ai-voice-opening-greeting.md): connection greeting, client readiness, interruption and reconnect deduplication.

## Maintained reference areas

- [UI design system](./ui-design-system.md): shared visual and interaction rules.
- [交互与表达规范](./interaction-language.md)：统一对象含义、任务状态、配置返回、授权及费用表达；[体验修复与回归摘要](./ux-regression-2026-10-25.md)记录实施和验证边界。
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

## Retention review — 2026-10-29

Removed 31 redundant development artifacts: 28 unreferenced intermediate JSON runs (Personal AI performance, result reading, handoff and tool optimization; provider/settings/navigation checks; a retired local AutoGLM probe), two unreferenced rendering screenshots (including a byte-identical copy of the retained final history screenshot), and the generated chart answer Markdown whose chart specifications remain in the structured report. Final acceptance summaries, failure descriptions and reproduction scripts remain; later retention reviews below describe further artifact cleanup. Previously committed artifacts are recoverable from Git history. This was a documentation cleanup, not a new acceptance run.

Keep current specifications, unfinished scope, security and migration boundaries, final acceptance evidence, and raw records needed for cross-run comparisons. Intermediate numbered runs and generated answers should stay under `/tmp` or `.xopc-evals/` once their useful findings are summarized; a date or lack of incoming links alone does not make a design obsolete.

## Markdown consolidation — 2026-10-29

Nine superseded Markdown documents were removed after retaining their useful decisions, failures and acceptance limits in the references below. This review did not rerun any product, device or account acceptance. Deleted drafts remain recoverable from Git history.

| Removed material | Maintained reference |
| --- | --- |
| Workflow removal assessment and completed implementation plan (2) | [Removal decision and scoped acceptance](technical/workflow-removal-acceptance-2026-10-23.md) |
| Initial workspace verification and screenshot-based Codex parity report (2) | [Workspace acceptance and browser baseline](electron-packaged-acceptance-2026-10-18.md) |
| Early Store lifecycle and real-account acceptance reports (2) | [Complete plugin-chain rerun](plugin-e2e-rerun-2026-10-19.md), [installation contract](plugin-install-authorization-2026-10-19.md) and [permission recovery](plugin-permission-recovery-2026-10-19.md) |
| Initial local Phone Use delivery and screenshot-era V2 proposal (2) | [V2 implementation, baseline and acceptance](technical/phone-use-video-v2.md) and [current workspace contract](phone-use-product-technical-design.md) |
| Phone setup report blocked by the former model's quota (1) | [Setup fixes, current acceptance and historical blocker](technical/browser-phone-setup-review-fixes-2026-10-28.md) |

Completed implementation alone is not a deletion criterion. Architecture contracts, security/migration decisions, unfinished remote Runner/cloud designs, provider native-catalog research and distinct performance comparisons remain where they still carry unique scope or evidence.

历史产物保留说明（2026-10-29）：本页所涉已清理截图、逐次 JSON 与源码快照可从 Git 历史恢复；上文数字和失败限制保留为历史观测，不代表本次重新验收。复跑输出应指定临时目录；旧路径仅记录当次运行位置。

## Further consolidation — 2026-10-29

The later retention pass consolidates 17 more Markdown files: seven recording implementation/audit notes into the [recording contract](note-recording-reliability-phase-one.md), four recording acceptance reports into the [recording acceptance summary](note-web-two-hour-realtime-acceptance-2026-10-16.md), two chart runs into the [chart acceptance](technical/chat-charts-default-agent-acceptance.md), P0/P1 delivery reports into [P2 acceptance](technical/personal-task-delivery-p2-verification-2026-10-14.md), and two earlier desktop/browser reports into [packaged acceptance](electron-packaged-acceptance-2026-10-18.md) and the [browser contract](unified-workspace-and-embedded-browser.md).

Historical screenshots, duplicate per-case results and intermediate run archives were removed. Keep executable consumers' inputs, current work evidence and unique comparison data; old screenshots and raw paths mentioned inside immutable run metadata refer to the original historical run and may require Git-history recovery. Routine future runs should write to `/tmp` or ignored `.xopc-evals/`. This cleanup does not change recorded test outcomes or imply new device/vendor acceptance.

The final snapshot review also removes seven obsolete notes: Accio research and the completed Store catalog audit now live in the [plugin architecture](plugin-ecosystem-compatibility-and-setup.md); voice delivery and two meeting implementation logs are summarized in their maintained technical designs; the retired cross-platform mobile recording review/upload design is replaced by a historical boundary in the [mobile meeting design](mobile-meeting-technical-design.md). Its old bridge/module tests are explicitly not evidence for current native apps. Together with the preceding pass, this turn removed 24 Markdown files and 124 historical assets. All images under this internal design directory were removed; public documentation illustrations and product assets outside it were not part of this cleanup.
