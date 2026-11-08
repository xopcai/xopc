# Local App automation proposals and execution

Local Apps use pinned extension contracts and the existing CapabilityDispatcher. They never receive
Gateway credentials, model keys or a backend runtime for application-supplied code. There is no
bundled business app or demo.

## Propose, simulate, review and adopt

Applications may declare `xopc.automations.simulate`, `xopc.automations.propose` and
`xopc.automations.get_proposal`. The independent `automationProposals` grant defaults to false.

An app can use the separately authorized `xopc.agent.delegate` JSON response to prepare a definition,
validate its own expected shape, then simulate and propose it. Simulation is static validation and
explanation, not execution or proof that an Agent will obey an instruction. It makes no model calls.
A proposal contains a complete create definition or an update patch with the exact current revision.
Updates also require read authority for the existing automation. System actions and managed automation
changes are rejected. Apps cannot call the ordinary create, update or enable capabilities directly.

Proposals are immutable, expire after 24 hours and have a 50-record per-app limit. They are bound to
the originating installed release and grant revision. Revocation, uninstall, release changes or loss
of read scope invalidate pending approval. Submitting a proposal changes no automation and performs
no execution. Stable submission keys prevent duplicate proposals.

`client.automation.reviewProposal(proposalId)` opens a host-owned review using registered frame
identity. The app cannot provide a manifest, grant, approval decision or substitute extension ID.
The review shows simulation findings, complete proposed configuration and the previous configuration
for updates. The server requires the reviewed proposal digest and checks the target revision again.
Only a separately authenticated host review can adopt or reject the proposal.

Adoption defaults to disabled, including updates. Enabling is a separate unchecked choice. The dialog
explains that an adopted schedule is user-owned host automation: its future scheduled runs use normal
host policies, not the application's manual-run budget. Users may instead leave it disabled and
configure it in the existing Automations page. Adoption never expands the app's read or execution
permissions. Closing the review approves nothing.

The first approval decision is durably pinned. Retrying the same decision reconciles the existing
atomic operation receipt, including a crash after an update committed but before its proposal status
was saved. A conflicting decision cannot race it or silently change the enable choice.

## Independent read and execution grants

`automationsRead` defaults to none and supports selected automation IDs, projects or the workspace.
Project selection includes future automations in those projects. Read summaries omit action prompts,
paths, delivery credentials, session IDs and internal state.

`automationsRun` has no workspace-wide or project-wide option. Users expand each configuration and
explicitly approve its identity, definition digest and execution authority. Old grants acquire no
new authority: omitted execution fields default to denial. Definition changes require fresh review;
transient scheduler state and update timestamps do not change the definition digest.

Each approval independently controls:

- Model processing, including disclosure of configured Agent context to the provider.
- Local file tools: `read_file` and `list_dir`.
- Local file changes: `write_file`, `edit_file` and `apply_patch`, requiring tool permission too.
- External result delivery to the destinations in the exact reviewed automation.
- Expiry (at most 30 days), lifetime submissions (at most 100), and model reservation budget in micro-USD.

These bounded app runs support Agent actions. System actions, task commands, disabled automations
and non-runnable managed automations cannot be approved. Shell, browser, MCP, discovery, codemode,
generic capability tools and nested delegation remain unavailable, even when all checkboxes are
selected. File operations retain the existing workspace sandbox. Bare Agent profile access is denied.
Suggest-only and ask-before-apply modes further exclude file mutation tools; they cannot override
host authority.

The configured Agent may still contribute its normal instructions, memory and existing conversation
context. Tool authorization is not a claim that this is a separate OS sandbox. Text-only delegation
remains the separate explicit-context, no-history interface described in [delegation](./local-app-delegation.md).

## Persistent budgets and execution

`xopc.automations.run` accepts only an automation ID and requires a stable idempotency key. The app
cannot substitute instructions, tools, model, Agent, delivery destination or trigger payload. Its run
ownership, authority, lifetime counter and ordinary operation receipt commit together. Replays do not
submit another run or consume another submission. The existing 20-submissions-per-app-per-hour ceiling
also applies. Limits are stored by grant revision and automation, and survive Gateway restarts.
Explicit reauthorization creates a new revision and new counters.

Before every recorded model transport, the host reserves the conservative maximum cost of the model's
full context and output limits, using the highest known base/tier rate. Unknown pricing or missing
model limits are denied. Reservations are never refunded, including failed or uncertain calls. At
most 20 model calls are allowed per run, including auxiliary calls inherited by its execution context.
The reservation budget is a local admission bound based on configured catalog prices, not a guarantee
that the external provider's invoice cannot differ. Non-model external service charges are not covered;
these runs expose no general external tools.

Run authority is rechecked at model calls, tools and result delivery. Expiry, revoke, disable,
uninstall or release/grant replacement aborts active execution and blocks later calls and deliveries.
A provider or tool already in flight may still finish or charge; completed effects cannot be undone.
Old runs created before bounded authority records existed are not retroactively sandboxed.

## Subscribe and recover

Apps can declare `xopc.automations.get_run`, `run_events` and `history`. Only runs submitted by the same
app are visible. They also require current automation read scope. SQL filters ownership and resource
scope before history pagination; there are no global counts or cross-app execution summaries.

`client.automation.watchRun(runId, handler)` opens a host-owned authenticated event stream. It sends
an initial current snapshot and updates after committed run changes, without repeated client status
requests. On reconnect it fetches a fresh snapshot. Multiple SDK listeners share a subscription and
unsubscribe only when the final listener stops. The host bounds subscriptions to four per app and
32 across the Gateway, rechecks authenticated caller/grant/resource authority while connected, and
closes on terminal status or access loss. Frame disposal and Gateway identity changes abort streams.

Snapshots include status, phase, timestamps, a summary up to 32,768 characters, a bounded failure code,
and the latest 100 sanitized events. Event bodies exclude arguments, diagnostic messages and data;
`truncated` reports omitted older events. This is state/progress recovery, not a token stream or an
unbounded audit export. A recreated UI can list `history` and watch a known or latest run again.
No raw conversation, provider error, runtime lease or secret is exposed.

Pending proposal approval is recovered through `get_proposal`; apps cannot approve their own proposals.
`xopc.automations.cancel` requests cancellation only for app-owned runs with an execution approval for
that automation ID. Cancellation remains available after a definition changes or its execution expiry
passes, so work can be stopped. Accepted cancellation and confirmed termination remain distinct.

All automation interfaces, including proposals and subscriptions, are unavailable in every preview
mode. Preview acceptance cannot adopt a schedule, call a provider or dispatch production work.

## SDK example

```ts
const contract = await client.capability.describe('xopc.automations.propose');
const proposal = await client.capability.call(contract.id, {
  majorVersion: contract.majorVersion,
  descriptorDigest: contract.descriptorDigest,
  idempotencyKey: stableProposalIntentId,
  input: { kind: 'create', definition: validatedDefinition },
});
await client.automation.reviewProposal((proposal.data as { id: string }).id);
// Recover the outcome with the separately declared get_proposal capability.

const stop = await client.automation.watchRun(ownedRunId, snapshot => {
  renderValidatedSnapshot(snapshot);
});
// Call stop() when the application no longer needs updates.
```

Host proposal review routes are under `/api/extensions/:id/automation-proposals/:proposalId` (GET)
and its `/review` suffix (POST); both require gateway.admin. Run streams use
`/api/local-app-capabilities/:extensionId/runs/:runId/events` and intersect authenticated caller scopes,
pinned contracts, app grant revision, ownership and resource authorization. Apps use the SDK instead
of calling these HTTP endpoints.

## Verification

Run Local App, capability, usage, execution policy, SDK and lazy-route tests, typecheck and build the
console, then run `scripts/local-app-delegation-browser-smoke.mts`. The smoke uses a real authenticated
Gateway, real browser and actual SDK, with a local scripted model endpoint and disposable app/state.
It verifies host adoption, event subscription, reload recovery, stable replay, scoped execution,
structured output and negative authorization paths without paid provider calls or a permanent demo.
Use an isolated web build with `XOPC_SMOKE_UI_ROOT` when other workspace builds may run concurrently.
