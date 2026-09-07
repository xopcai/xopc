# Durable storage boundaries

## Decision

The Gateway owns one local SQLite database. All application-owned structured execution and history state belongs in that database. Files remain the authoritative representation for user workspaces, editable Agent profiles, executable packages, and binary assets. Authentication material and device-specific settings have separate storage lifecycles.

A cloud server or NAS runs the Gateway next to its database on a local persistent filesystem. Clients use Gateway APIs; they never open the database through a network share. This change establishes a consistent storage boundary; it does not implement cloud upload, offline multi-device replication, or failover.

Existing file records are not imported. There is no dual-write, fallback read, file-format compatibility parser, or runtime conversion for the stores moved below. Schema registration creates empty tables using the repository's existing SQL schema runner. That DDL is not a historical-data import. Older unrelated schema steps are outside this change.

## Ownership matrix

| Data | Authority | Reason |
| --- | --- | --- |
| Sessions, transcripts, current notes, tasks, automation and understanding records | Existing SQLite repositories | Existing business state |
| Workflow events | `workflow_events` | Ordered durable event history |
| Workflow current definitions, immutable revisions, drafts | SQLite `durable_state`, separate namespaces | Small versioned documents; transactional revision checks |
| Workflow list/index | Existing `workflow_runs` | Query projection; rebuildable from events |
| Workflow full view | Computed from SQLite events | No separate JSON snapshot to become stale |
| Note history | `note_snapshots` | Parent linkage, stable version identity, retention and deletion |
| Channel outbound messages | `durable_messages`, queue `outbound` | Durable enqueue and acknowledgement |
| Agent IPC | `durable_messages`, queue `agent-ipc` | Atomic claims, lease recovery and acknowledgement |
| Share and site records, counters | SQLite `durable_state` | Immediate persistence; no process-local authoritative maps |
| Hosted share bindings | SQLite `durable_state` | Per-binding records and transactional reconciliation |
| Extension UI KV | SQLite `durable_state` | Exact namespace isolation; follows active database |
| Composio trigger archive | SQLite `durable_state` | Unique event identity across the entire retained history |
| Telegram and Weixin cursors | SQLite `durable_state` | Durable per-account consumption position |
| Command receipts | SQLite `durable_state` | Durable status and bounded output preview |
| Full command output, diagnostic/audit logs | Files | Append-oriented, separately retained diagnostic artifacts |
| Attachments, media, avatars, share resources, application releases | Files | Binary content and independently managed resources |
| Workspace, project worktrees, Agent profile Markdown | Files | User-owned editable data; may live outside the state directory |
| `xopc.json`, `models.json`, skill configuration | Files | Explicit boot/user configuration; not a second execution-state store |
| API/OAuth credentials, channel auth/context tokens, pairing authorization and trust | Existing security stores | Secrets and machine/account authorization need explicit export and reauthorization policies |
| Browser profile, desktop preferences, Web preferences | Device-local stores | Device lifecycle and local UI state |
| Mobile unsent drafts and pending offline operations | Mobile storage | Must remain local until acknowledged by Gateway; not disposable cache |
| Downloaded runtimes/models, generated caches, lock/PID/socket files | Local files | Rebuildable or tied to a live process; never restore as active execution state |

Security stores are intentionally not folded into the general-purpose document table. Keeping them separate does not imply automatic encryption; a future backup/export must encrypt them and define whether they can be reused on another device.

## Schema and access rules

### Domain tables

- `workflow_events`: `(agent_id, run_id, sequence)` primary key; unique event UUID; JSON envelope. Allocate the next sequence and append inside `BEGIN IMMEDIATE`. Readers order by sequence. Agent/run identities do not contain host paths.
- `note_snapshots`: `(note_id, timestamp)` primary key; foreign key to `notes(note_id)` with `ON DELETE CASCADE`. Allocate `max(clock, previous + 1)` inside a transaction so two snapshots in the same millisecond cannot overwrite each other.
- `durable_messages`: stable sequence, queue, logical scope, message ID, envelope, enqueue time, processed time and lease identity/expiry. `(queue, scope, id)` is unique. Duplicate enqueue does not overwrite an existing message or requeue one already processed.

### Small structured documents

`durable_state` has `(namespace, scope, key)` uniqueness and validated JSON payloads. `DurableState<T>` implements fresh reads, per-record writes, deletion and synchronous transactional read/modify/write. Returned objects are detached values; mutating a returned object never writes implicitly.

The current namespaces are:

- `workflow-definitions`, `workflow-revisions`, `workflow-drafts`
- `shares`, `site-shares`, `hosted-share-bindings`
- `extension-ui`
- `composio-events`
- `telegram-offsets`, `weixin-cursors`
- `command-receipts`

Do not use the table as an unbounded replacement for domain indexes. Large event streams and queues have dedicated tables. Add domain columns/indexes when document fields become primary query predicates. Connector history listing is bounded in SQL. Credentials must not be placed in extension/runtime namespaces by core code.

### Transactions

- Workflow save checks the expected revision, inserts its historical revision, and updates the current definition in one transaction. Stale writers receive a conflict.
- Workflow draft compare-and-save is transactional.
- Note snapshot timestamp allocation and insertion are transactional; parent deletion removes snapshots.
- Share view consumption validates the current persisted record and increments the counter in one transaction. Counters no longer wait for a debounce timer.
- Hosted binding reconciliation runs in a transaction.
- Connector archive deduplication uses the primary document identity, not a scan of the last 500 events.
- Telegram cursors never move backward for the same bot; changing bot identity starts a separate consumption position for the account.

## Execution and restart semantics

SQLite uses WAL, foreign keys, a bounded lock timeout and `synchronous=FULL`. Checkpoint code checks the returned busy flag rather than treating absence of an exception as success. Failed connection setup closes the connection and its timer.

Detected NFS, SMB/CIFS and SSHFS mounts are rejected before creating a database file. Filesystem detection cannot certify every possible remote filesystem; the deployment contract remains local persistent storage.

IPC watchers claim a message with a renewable lease. Only successful handling marks it processed. A failed handler releases the claim; an abandoned claim becomes eligible after expiry. A stale owner's acknowledgement cannot finish a newer claim. Polling observes writes made by other local processes without depending on filesystem-watch events.

This is **at-least-once processing**, not exactly-once external execution. If a process sends a message and crashes before acknowledgement, delivery may repeat. Receivers and external actions that support idempotency should use the durable message/action ID. Moving the queue into SQLite does not make an external API call and a database commit atomic.

The outbound queue retains its existing enqueue/send/ack behavior. It is scoped by Agent identity rather than an absolute internal directory. Gateway ownership must still ensure one outbound replay loop; this change does not introduce active-active Gateway replicas.

Command receipts do not resurrect OS processes. A receipt whose process ownership is missing is reported as interrupted; execution is not silently restarted.

## Files, backup and future cloud support

A complete recovery set contains:

1. A consistent SQLite snapshot.
2. Referenced attachment/media/share/application files.
3. Main configuration and editable Agent profiles.
4. All configured external workspaces, if the user includes project content.
5. A separately encrypted, explicitly selected security export.

Database snapshots alone do not establish a point-in-time snapshot of mutable workspace files. A full backup must coordinate writes or use versioned immutable artifacts and a manifest. Restoring a database also does not recover mobile operations that never reached the Gateway.

The next cloud-facing boundary should be a backup transport and asset manifest, not a network-mounted SQLite file. A manifest should include stable asset IDs, checksums, sizes, logical paths and the associated database snapshot identity. Upload immutable asset objects before publishing the completed manifest. Retention must keep assets reachable from retained snapshots; garbage collection should tolerate failed uploads and partial backups.

Multi-device online access uses one authoritative Gateway. Offline editing needs explicit operation IDs, server acknowledgements, version conflicts and deletion tombstones. Device secrets and local path trust must not be blindly copied as part of such synchronization.

## Removed file-store behavior

The changed modules no longer read or write Workflow JSON/JSONL, note-history JSON, outbound queue JSON, IPC inbox files, share registry JSON, hosted binding JSON, extension `storage.json`, Composio JSONL, cursor JSON or command receipt JSON. Obsolete Workflow/notes file-path helpers and the no-op notes `flush` API are removed. Current files are not deleted from the user's machine.

The extension namespace sanitizer previously merged different names and wrote under a hard-coded home directory; exact SQLite namespaces remove both problems. TUI scoped-model settings still belong to the device/config plane, but resolve the active state directory at access time.

## Validation

Behavior tests cover database reopen, transaction rollback, separate scopes, concurrent Workflow sequence allocation, stale revision conflicts, same-millisecond note versions, cascade deletion, detached extension values, connector deduplication beyond 500 events, share view limits across store instances, expired lease replacement, failed IPC retries, cursor monotonicity and network filesystem rejection. Existing Workflow, notes, share, command and public-route regression suites remain part of validation.
