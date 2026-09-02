# ADR 0003: Execution Environments

Status: Accepted

Date: 2026-09-02

Owners: Agent, Projects, Gateway, and Web UI maintainers

## Decision

xopc treats the directory in which an agent edits code as a durable execution environment. A session binds to one environment, and all runtime workspace resolution reads that binding before project or agent defaults.

The first implementation supports two local kinds:

- `local_checkout`: a shared user-owned directory. Retiring the environment never deletes its files.
- `managed_worktree`: an xopc-owned, detached, locked Git worktree. One active subject owns it, and xopc may delete only its exact path under the managed worktree root.

Coding projects backed by Git default to a managed worktree. Other projects default to the local checkout. Users may override the project default for future sessions.

## Invariants

1. `execution_environments` is the source of truth for identity, host, root, Git base, state, ownership, and optimistic version.
2. `execution_environment_bindings` is the source of truth for which environment a session or run uses. A subject has at most one active binding; a managed worktree has at most one active owner.
3. Runtime code fails closed when a bound root is missing or the environment is not ready. It must not recreate a missing managed worktree as an empty directory or silently fall back to the project checkout.
4. Git worktree mutation is serialized with a repository-scoped lock and verified against `git worktree list --porcelain -z`.
5. Managed deletion accepts only an exact descendant of the configured xopc worktree root. It refuses active bindings, unlocks and removes the Git worktree, prunes metadata, and records failure as environment state.
6. A session must release its environment before moving to another project. A project workspace cannot change, and the project cannot be deleted, while it still owns live environments.
7. Task outcome classification reads structured environment fields. The removed `customData.strategy` string heuristic is not a compatibility path.

## Lifecycle

```text
requested -> provisioning -> ready -> stopped -> deleting -> deleted
                         \-> degraded -> provisioning
                         \-> error -> provisioning | deleting
ready <-> busy
```

Snapshot and handoff states are reserved for remote execution. State changes use optimistic versions and append immutable events so retries and recovery remain observable.

## Local product behavior

- Project settings expose “Managed worktree” and “Local checkout”.
- Creating a project session provisions and binds the selected environment before the session is returned.
- A dirty source checkout blocks managed provisioning instead of silently excluding uncommitted changes. The API returns a structured conflict and identifies `local_checkout` as the explicit fallback.
- Session inspection reports `execution_environment` as the workspace source and locks working-directory editing.
- Environment APIs support list, inspect, reconcile, release, and delete operations.

## Remote phase boundary

Remote execution and local-to-remote handoff are intentionally not inferred from host names, paths, or session metadata. They require an authenticated Agent Host protocol and a resumable handoff operation.

Before implementing that phase, the following contract must be selected:

- repository acquisition: existing checkout on the host, clone from origin, or transferred Git snapshot;
- dirty and untracked data: reject, synthesize a transferable snapshot, or require a user commit;
- trust: host enrollment, scoped credentials, command policy, and secret ownership;
- handoff atomicity: source freeze, snapshot, destination provision and verify, binding compare-and-swap, then source cleanup;
- failure recovery: durable operation steps, idempotency keys, heartbeats, leases, and compensation rules.

The recommended next step is a narrow outbound-connected Agent Host with capability negotiation, followed by clean-commit remote provisioning. Dirty-state transfer should be a later explicit snapshot feature rather than an implicit file copy.

## Consequences

- Local code sessions are isolated without copying repositories or inventing a second workspace abstraction.
- The environment model already carries `hostId` and handoff states, but no remote behavior exists until the host and transfer contracts are accepted.
- Existing projects migrate to `local_checkout`; only newly inferred coding Git projects opt into managed worktrees automatically.
