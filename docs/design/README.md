# Product and engineering design documents

This directory contains internal product decisions, engineering designs, RFCs, release runbooks, and documentation process notes. It is kept in the repository for contributors and is excluded from the public VitePress user site.

User documentation belongs at the top level of `docs/` or in a user-facing topic directory such as `docs/channels/`, `docs/how-to/`, or `docs/reference/`.

Before adding a document, use this rule:

- If it helps a user install, configure, use, or troubleshoot xopc, write a user guide.
- If it explains how xopc is built, records a proposed implementation, or coordinates development work, put it in `docs/design/`.
- If it records a durable architecture decision, put it in `docs/adr/`.

See [Documentation information architecture](./documentation-information-architecture.md) for the full writing and placement rules.

Active proposed designs:

- [Scenes product north star and evolution plan](./scenes-product-north-star.md)
- [Scenes technical design and direct cutover plan](./scenes-technical-design.md)
- [Scenes implementation progress and review log](./scenes-implementation-progress.md)
- [Scenes launch plan and release gates](./scenes-launch-plan.md)
- [Realtime voice product requirements](./realtime-voice-prd.md)
- [Realtime voice technical design](./realtime-voice-technical-design.md)
- [Realtime voice WebSocket protocol](./realtime-voice-websocket-protocol.md)

## Maintained reference areas

- [UI design system](./ui-design-system.md): shared visual and interaction rules.
- [Technical architecture](./technical/architecture.md), [storage](./storage-architecture.md) and [Agent capabilities](./agent-native-capability-architecture.md): contributor contracts.
- [Public cloud model services](./xopc-cloud-public-model-services.md) and [image providers](./technical/image-provider-upgrade-plan-2026-10-09.md): current capability contracts and upgrade constraints.
- [Personal AI follow-ups](./personal-agent-proactivity-technical.md): runtime and policy boundaries; user instructions are in the public guide.
- [Computer Use runtime contract](./technical/computer-use-runtime-contract.md): developer diagnostics, packaging and action semantics.
- `prd/`, `reviews/`, `security/` and mobile parity documents in `technical/`: internal requirements and scoped acceptance evidence. Their dated results are not current product availability claims.

Superseded `*-legacy.md` copies of public guides and the old documentation-quality plan have been removed. Git history retains those snapshots. Keep a design when it records a still-needed contract, decision, unfinished scope or acceptance boundary; delete a redundant implementation snapshot once its useful content is maintained elsewhere.
