# Verified Computer Use navigation flows

## Existing boundaries

Flow capture is a bounded companion to the existing task history in ComputerRuntime. Documents use the existing private SQLite DurableState store under `computer.verified-flows.v1`; no new database, schema migration, skill installer, tool, Gateway route or execution engine is introduced. Scope is derived from the conversation's configured Agent ID and workspace, never from model-supplied IDs. Other conversations may reuse records only within that same scope. Each document retains its originating desktop endpoint and application ID. New captures also bind the authenticated persistent desktop principal supplied by the endpoint registry. A fresh connection may reuse only flows for that same device principal and app; legacy documents without a principal retain exact endpoint binding.

## Admission and persistence

The user requests remembering a routine; the agent invokes `close {saveFlowAs:"Open Memories"}`. Plain close never saves. Release acknowledgement precedes all persistence. An active/pending operation, read-only session, failure, takeover, uncertain dispatch or unconfirmed release refuses saving. Storage failure is reported after release and never leads to another desktop action.

Capture admits a complete sequence of 1–12 native `activate`/`showMenu` actions. Every action must have its matching completed receipt and a post-action observation of the same app/process/window. Snapshot-scoped references are resolved to a uniquely labelled, enabled native element advertising that action in the observed AX tree. Partial coverage is retained as metadata and does not establish global uniqueness. Web content, typing, setValue, keys, wait, coordinates, ambiguous labels, sensitive-looking labels and incomplete sequences invalidate the entire capture; a successful suffix cannot hide an unsupported or failed prefix. The final action must satisfy the caller's native `selected` expectation or a positive page-specific `text` expectation of 8–160 non-sensitive characters. Selected evidence still requires a complete tree. Partial snapshots can provide positive text observations; they cannot prove absence or uniqueness. Bare actionable-control labels, text already observed before input, field conditions and model success claims do not qualify. This verifies a navigation condition, not an entire business task or remote effect.

Documents contain version/UUID, title, app/endpoint identity, ordered action-kind/role/label hints, historical condition, coverage and timestamps. They contain no task goals, screenshots, raw model output, input values, coordinates, action IDs, window/process identity or element refs. Labels/titles are bounded and checked with the existing memory sensitivity classifier; explicit saving still requires choosing non-sensitive content. Persistence is transactional, exact duplicate documents retain their ID, and at most 32 records per scope are kept. Expiry is thirty days from capture; duplicate saves do not renew old evidence. Reads discard expired or schema-invalid documents.

## Retrieval and use

`flows {}` returns metadata only; `forget_flow {flowId}` deletes a scoped record. Both are local operations and require no desktop lease or inference. Management remains available when desktop control is disabled. Nothing automatically injects these documents into general memory or another Agent's context.

A control `step` may include `flowId` with the current goal and optional current expectation. After a fresh observation, Runtime verifies scope, expiry, application and endpoint before passing the hints to the already pinned GUI model. Hint text is explicitly untrusted data in the user context for GUI-Plus, structured tools and native Responses; it never becomes system instructions, tool arguments or authorization. Historical conditions never replace the current caller's expectation. Model claims remain unverified. No automatic target/model switch occurs when retrieval fails.

Explicit reuse resets adapter continuation/batch state, including when leaving flow-guided planning. The model predicts a new action, grounded with the current observation and refs, under existing read-only policy, local approval, target/freshness checks, budgets, no-progress detection and bounded rescue. Pending approval retains the original goal, expectation and flow ID. Confirmed pre-dispatch UI change may use the existing bounded rescue; unknown/started/completed delivery and native failures never replay a stored step. A mismatched receipt ID is treated as uncertain delivery and closes through the existing release path.

## Validation and evaluation

Tests exercise Runtime with the real Broker and deterministic native/model fixtures: explicit capture after release, no automatic learning, model-claim/takeover exclusion, fresh refs and model calls during reuse, scoped sharing, wrong app/device, missing records, unconfirmed release, storage failure, mismatched receipts and uncertain input without replay. All three model adapters keep hints in untrusted user context while retaining current goals and their existing tool grammar. SQLite tests cover restart persistence, deduplication, deletion, scope isolation, expiry, bounded retention and rejection of tampered executable payloads. Capture tests reject unsupported prefixes, missing verification, truncated/ambiguous/web controls, sensitive labels and target changes.

The existing independent executor/oracle evaluator can compare the same authorized tasks with and without selected flow hints, using its current duration, model-request, action and safety measurements. Saved native condition evidence and a successful capture do not grade a later run. Fixture checks do not establish real-app task success, unattended safety or a reduction in model calls; reuse deliberately retains fresh inference rather than bypassing it.

See [live TextEdit validation](./computer-use-verified-flows-live-validation.md) for the pinned-driver completeness limitation and the three-process capture/reuse/lost-reply check.

See [real hosted GUI-Plus validation](./computer-use-verified-flows-hosted-validation.md) for the additional actual-provider matrix and the bounded native-ref prompt extension.

See [real Gateway/desktop network validation](./computer-use-verified-flows-network-validation.md) for signed enrollment, authenticated HTTP/WebSocket dispatch, frame uploads, restart identity and lost-result timeout/release checks.
