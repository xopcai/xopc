# ADR 0003: Local Execution Environments

Status: Accepted

Date: 2026-09-03

Owners: Agent, Projects, Gateway, and Web UI maintainers

## Decision

A project session uses one local execution environment:

- `local_checkout`: the user's existing directory, which may be shared by sessions. xopc never deletes its files.
- `managed_worktree`: an isolated, detached, locked Git worktree owned by xopc and bound to at most one session.

New coding projects backed by Git default to managed worktrees. Other projects and existing projects use the local checkout unless the user changes the project setting. The setting applies to future sessions.

Tools use the bound local directory directly. This feature has no remote host registry, execution transport, cross-host handoff, or workspace snapshot format. Bindings belong to sessions, not hypothetical future run types.

## Invariants

1. The session binding is authoritative for workspace resolution. Missing or non-ready environments fail closed: never recreate an empty directory or silently fall back to the project checkout.
2. Environment changes use optimistic versions; binding changes are transactional. Managed worktrees have one active session owner.
3. Git mutations use a repository-scoped lock. Creation resolves an exact starting commit and verifies Git's worktree registration.
4. Creation rejects a dirty source checkout rather than silently excluding uncommitted changes.
5. Cleanup refuses active bindings and paths outside xopc's managed worktree directory. An existing directory without the expected Git registration is never deleted.
6. Cleanup uses Git's non-forced removal. Uncommitted work is retained, and detached commits must be saved on a branch before removal. A failed cleanup remains visible and can be retried.
7. A project workspace cannot change, and its project cannot be deleted, while live environments remain.

## Lifecycle

`requested -> provisioning -> ready -> deleting -> deleted`

Creation or deletion failures are recorded as `error`. Inspection can mark missing or unregistered worktrees `degraded`; reconciliation can restore a healthy worktree to `ready`. New commits inside a healthy worktree are expected, not drift.

State changes append diagnostic events. There are no busy, snapshotting, handoff, or stopped states: agent run activity remains owned by the existing session runtime.

## Product behavior

- Project settings choose managed worktree or local checkout.
- Session creation provisions and binds the environment before returning the session.
- Session inspection shows the effective directory and locks working-directory editing.
- Environment APIs list, inspect, reconcile, release, and delete local environments.
- Releasing a session can retain its worktree with `keepManaged=true`. Otherwise cleanup is attempted conservatively; failure preserves the worktree for inspection and later cleanup.
- Ignored dependencies and local setup files are not copied into new worktrees; setup remains an explicit local development step.

Remote execution and moving an existing session between hosts are out of scope. They are not retained behind feature flags or compatibility paths.
