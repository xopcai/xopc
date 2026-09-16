# Context compaction and recovery contract

## Ownership

- `context-budget.ts` estimates the complete model input and projects expendable tool/image content. Projection is ephemeral and never rewrites the transcript. Token estimates are approximate; provider rejection remains a recovery trigger.
- `context-recovery.ts` owns the bounded recovery decision: evaluate the projected request, try ordinary compaction, escalate to full-history compaction only when necessary, reload and verify. Minimum message count governs proactive compaction, never hard-limit recovery. Disabled automatic compaction is honored in both entry paths.
- `SessionCompactor` plans and generates a cited handover in bounded chunks. It does not execute tools or mutate storage. Completed changes and tool results remain facts; completed tasks are not reopened.
- Transcript runtimes own authoritative source snapshots and persistence. SQLite uses an append-only boundary with snapshot compare-and-swap. The in-memory runtime preserves the raw branch and interprets the same exact boundary messages. Caller-provided message arrays are not replacements for authoritative history.
- `run-for-session.ts` checks before a turn; `run-turn.ts` checks each actual provider request (including model fallback and repository instructions) and handles one overflow continuation. Each acquired runner reloads the authoritative runtime context.
- `SessionStore` records the post-compaction rules in the boundary's model-visible messages atomically; separate context audit rows remain invisible. Reloading does not append another refresh.

## Invariants

1. Compaction never deletes raw history. A changed or reset transcript rejects a stale result.
2. A recovery uses at most one ordinary compaction and one full-history compaction. Provider continuation is bounded to one attempt. All calls share the parent cancellation/deadline; retries do not start a new root budget.
3. Success requires reloading the stored context and verifying its projected token budget and active-history byte limit. The byte limit is an application history limit, not a guarantee of a provider's HTTP payload limit.
4. Full-history recovery inside a turn retains the latest model-visible user request and attachments verbatim alongside the cited handover. Recovery resumes the existing agent; it does not resubmit the input or replay recorded tool calls. The handover tells the model which operations completed. This prevents harness replay, not arbitrary semantic repetition by a model.
5. Error/aborted assistant tails are removed only from continuation context, including after a storage reload. The original rows remain available for audit.
6. Tool call/result pairs are normalized by the shared transcript projection. All storage backends use this interpretation.
7. Only explicitly constructed refresh messages become model-visible; general audit/context records do not.
8. Required recovery failures propagate to the existing failed-run path. Optional proactive compaction may fail without blocking an otherwise fitting request. `disabled` and `unrecoverable` have stable error codes; provider and storage failures retain their original errors.

## Acceptance matrix

| Scenario | Required outcome | Coverage |
| --- | --- | --- |
| Few messages, insufficient tool pruning | Full recovery, never unconditional pass-through | context-recovery.test.ts |
| Single oversized/interrupted tool turn | Full summary preserves request and attachments | compaction.test.ts, transcript-runtime.test.ts |
| Ordinary compaction leaves oversized history | One full-history attempt, then reload/verify | context-recovery.test.ts, pre-turn-compaction.test.ts |
| Input/system context still too large | Explicit failure, no unbounded retry | context-recovery.test.ts |
| Disabled policy or cancellation | No unauthorized/new compaction work | context-recovery.test.ts |
| Completed file/test facts | Facts and exact identifiers survive; completed TODOs stay closed | context-recovery.test.ts |
| 413 or local budget rejection | Recognized as a recovery trigger | context-overflow.test.ts |
| Partial failed assistant tail | Continuation ends on a valid request/result, raw error retained | context-recovery.test.ts |
| SQLite full boundary and later messages | Exact model history, original rows retained, restore supported | repositories.test.ts |
| In-memory full boundary and later messages | Same exact-context semantics, raw branch retained | transcript-runtime.test.ts |
| Post-compaction rules | Included in persisted model context once per boundary | store.test.ts |

## Limits and follow-up work

This change does not add tokenizer dependencies, background compaction, new storage, automatic conversation reset, tool-output artifact offloading, or new UI event schemas. Current attachments that exceed a provider's body limit cannot necessarily be fixed by historical compaction. They fail through the bounded recovery path with actionable input/attachment guidance. Summary quality is still model-dependent; cited source records remain available for verification.
