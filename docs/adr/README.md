# Architecture Decision Records

This directory contains long-lived architectural decisions for xopc. ADRs describe why a structural choice was made, its consequences, and the alternatives that were considered.

## Status vocabulary

- **Proposed**: under review and not yet an implementation constraint.
- **Accepted**: approved and expected to guide implementation.
- **Superseded**: replaced by a later ADR; retain the document and link its replacement.
- **Rejected**: considered but not selected; retain it when the reasoning remains useful.

## Index

| ADR | Status | Decision |
|---|---|---|
| [0002](./0002-local-app-platform.md) | Proposed | Model user-created Local Apps as Projects with immutable releases and capability-scoped runtimes |
| [0003](./0003-execution-environments.md) | Accepted | Use durable execution environments and exclusive bindings for local checkouts and managed Git worktrees |

ADR number 0001 was used by a historical AgentService decomposition record that is no longer part of the active documentation set. Its number is not reused.
