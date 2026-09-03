# ADR 0003: Execution Environments

Status: Accepted

Date: 2026-09-02

Owners: Agent, Projects, Gateway, and Web UI maintainers

## Decision

xopc treats the directory in which an agent edits code as a durable execution environment. A session binds to one environment, and all runtime workspace resolution reads that binding before project or agent defaults.

The implementation supports two environment kinds across local and enrolled remote hosts:

- `local_checkout`: a shared user-owned directory. Retiring the environment never deletes its files.
- `managed_worktree`: an xopc-owned, detached, locked Git worktree. One active subject owns it, and the owning host may delete only its exact managed path.

Coding projects backed by Git default to a managed worktree. Other projects default to the local checkout. Users may override the project default for future sessions.

## Invariants

1. `execution_environments` is the source of truth for identity, host, root, Git base, state, ownership, and optimistic version.
2. `execution_environment_bindings` is the source of truth for which environment a session or run uses. A subject has at most one active binding; a managed worktree has at most one active owner.
3. Runtime code fails closed when a bound root is missing or the environment is not ready. It must not recreate a missing managed worktree as an empty directory or silently fall back to the project checkout.
4. Git worktree mutation is serialized with a repository-scoped lock and verified against the owning Git repository. Remote hosts use a bare mirror cache and locked detached worktrees.
5. Managed deletion accepts only an exact descendant of the configured xopc worktree root. It refuses active bindings, unlocks and removes the Git worktree, prunes metadata, and records failure as environment state.
6. A session must release its environment before moving to another project. A project workspace cannot change, and the project cannot be deleted, while it still owns live environments.
7. A handoff freezes the source, verifies a clean commit, provisions the target, atomically replaces the binding with a higher fencing epoch, and only then retires the source.
8. Task outcome classification reads structured environment fields. The removed `customData.strategy` string heuristic is not a compatibility path.

## Lifecycle

```text
requested -> provisioning -> ready -> stopped -> deleting -> deleted
                         \-> degraded -> provisioning
                         \-> error -> provisioning | deleting
ready <-> busy
```

State changes use optimistic versions and append immutable events so retries and recovery remain observable. `handing_off` fences new workspace calls before target provisioning starts.

## Local product behavior

- Project settings expose “Managed worktree” and “Local checkout”.
- Creating a project session provisions and binds the selected environment before the session is returned.
- A dirty source checkout blocks managed provisioning instead of silently excluding uncommitted changes.
- Session inspection reports `execution_environment` as the workspace source and locks working-directory editing.
- Environment APIs support list, inspect, reconcile, release, and delete operations.

## Remote execution and handoff

Remote placement is explicit project configuration. An execution host enrolls with a signed P-256 identity, negotiates fixed capabilities over the authenticated realtime channel, and executes only the protocol's fixed workspace command allowlist.

- The host clones or fetches the project's configured Git origin into a bare mirror cache and creates an xopc-owned locked worktree at the requested commit.
- Gateway-side paths for remote environments remain opaque. File, search, patch, shell, and managed-job tools route through the bound host; no local fallback is allowed.
- Operation receipts make retries idempotent. Non-idempotent workspace commands fail closed when their outcome is indeterminate after a host-process interruption.
- A handoff is a durable saga in `execution_environment_handoffs`. The binding swap is one SQLite transaction and increments the subject's fencing epoch.
- A disconnect before the swap leaves the saga recoverable. A cleanup failure after the swap leaves the target authoritative and records `cleanup_pending` for reconciliation.
- Active handoffs block manual environment release and deletion.

Dirty and untracked state is not silently copied or dropped. Snapshot-capable hosts package only tracked changes, deletions, and non-ignored untracked files into a checksummed artifact. Gateway relays it in bounded chunks, and the destination verifies SHA-256 and the base commit before applying it. Archives are size-limited, path-validated, decompressed through a byte limit, and removed after source cleanup. Ignored files and Git metadata never enter the artifact.

Handoff API surface:

- `POST /api/sessions/:sessionKey/environment/handoff` starts a move to `targetHostId` (`local` or an enrolled host).
- `GET /api/sessions/:sessionKey/environment/handoff` returns the active saga and its events.
- `GET /api/execution-environment-handoffs/:handoffId` returns durable status and history.
- `POST /api/execution-environment-handoffs/:handoffId/reconcile` resumes an interrupted saga.

## Consequences

- Local code sessions are isolated without copying repositories or inventing a second workspace abstraction.
- Remote execution requires a reachable Git origin for the base commit. Dirty snapshot transfer carries working-tree state, not unreachable commits; commits unavailable to the destination must still be pushed first.
- Existing projects migrate to `local_checkout`; only newly inferred coding Git projects opt into managed worktrees automatically.
