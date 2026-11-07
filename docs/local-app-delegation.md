# Restricted Local App Agent delegation

Local Apps can declare `xopc.agent.delegate` using the same pinned capability bindings and SDK
`capability.describe` / `capability.call` used for notes and tasks. The host owns its implementation.
No `agent.send`, session access or general Agent toolset is exposed. There is no new API family.

## Authorization

The application must be installed, enabled and granted the current release's UI permissions.
`resourceScopes.agentDelegate` defaults to `false`, including grants written before this capability
existed. The host permission dialog has a separate unchecked delegation checkbox explaining provider
disclosure, cost and execution limits. A declared binding alone does not approve execution.

Each call intersects caller scopes, the installed release's pinned binding, grant revision and resource
policy. The app cannot supply an Agent ID, model, provider URL, credentials, session ID, tools or callback.
The host uses its configured default Agent's primary chat model, without inheriting that Agent's
instructions, skills, workspace, hooks, history or memory. Changing the host's default model changes
the provider used by subsequent calls; applications cannot choose it.
Existing provider usage restrictions still apply: a provider requiring an interactive user turn is
not silently treated as background-capable. There is no automatic model or provider fallback.

References are explicit: at most three `xopc.notes.get` or `xopc.tasks.get` records. Each read must also
be declared by the same release and is executed through the existing production capability dispatcher,
including the narrow extension output and approved notes/tasks read scope. There is no implicit search,
context gathering or model-directed tool use. Reference access is checked before inference, while it
runs and before returning results, including receipt replays. The host does not resolve an inaccessible
reference. Content already held by an app cannot be recalled or assigned reliable provenance.

## Execution boundary

- One model inference; no tool loop, nested delegation, browser, shell, filesystem, MCP, outbound
  message, configuration write or production mutation.
- Only the supplied instruction, optional context and host-resolved references enter the request.
  Context may be sent to the configured external model provider. The permission checkbox explicitly
  authorizes this disclosure and potential provider cost; the model is not treated as an authorization boundary.
- Instruction: 8,000 characters; app context: 16,000; complete supplied payload: 24,000 characters.
  Oversized context is rejected, not silently shortened. Model output is at most 1,024 requested tokens
  and 8,192 returned characters; the response reports `completed` or `length`.
- Thirty-second execution deadline, one active provider call per app and four across the Gateway.
  Per-app budgets allow twenty submissions per one-hour window and persist across Gateway restarts
  and regrants. Provider failures also consume submissions; replays do not.
- Revocation, disable, release changes, changed reference access, ended browser/device sessions or request cancellation abort the call
  and withhold its result. Cancellation cannot recall data already sent or guarantee the provider stopped
  billing. An uncooperative provider retains its capacity slot until its request settles.

The SDK allows 35 seconds for the host's delegation response while ordinary requests retain their
10-second default. Explicit SDK timeout overrides still apply. Closing/replacing a frame or switching
Gateway identity aborts its delegation transport.

Returned text is a suggestion, never a command or host UI action. Apps may offer a subsequent save
operation through their separately declared and approved write capabilities; delegation cannot grant
or widen those permissions. Tool requests returned by a provider are rejected and never executed.

Preview sessions omit this capability in every mode. Sample data and isolated write acceptance never
make billable model calls; real read-only preview cannot opt into delegation. Preview code should show
an unavailable state or use declarative example content to test presentation.

## SDK use

Declare `xopc.agent.delegate` and any referenced `get` capability with the current catalog's
`majorVersion` and `descriptorDigest`. Do not hardcode a digest or invent grants.

```ts
const descriptor = await client.capability.describe('xopc.agent.delegate');
const result = await client.capability.call(descriptor.id, {
  majorVersion: descriptor.majorVersion,
  descriptorDigest: descriptor.descriptorDigest,
  idempotencyKey: stableIntentId,
  input: {
    instruction: 'Summarize this note and suggest next steps. Do not change it.',
    context: 'Keep the answer brief.',
    sources: [{ capabilityId: 'xopc.notes.get', id: approvedNoteId }],
  },
});
output.textContent = result.data.text;
```

The `idempotencyKey` is required because inference can incur external cost. The existing external
operation receipt records a successful result and replays it without resubmission. Identity includes
the caller, app, release and grant revision. A changed intent or authorization cannot replay a former
result. Unknown provider outcomes use the existing `OUTCOME_UNKNOWN` behavior: retain the key and
inspect the original operation; do not automatically issue a new key, retry or switch providers.
Receipts retain the returned text in trusted host storage. The bounded Local App access audit records
operation identity/outcome without instructions, context, credentials or result bodies; normal model
usage accounting applies.

## Verification

```sh
pnpm exec vitest run src/local-apps/__tests__/delegation.test.ts
pnpm -C web run build
pnpm exec tsx scripts/local-app-delegation-browser-smoke.mts
```

The browser smoke starts a real authenticated Gateway and Chrome, bundles an app with the actual SDK,
and runs the production provider transport against a local scripted OpenAI-compatible SSE endpoint.
It verifies preview/default denial, real host permission review, approved reference disclosure,
absence of tools/history, stable-key replay, escalation rejection and in-flight revocation. This
tests execution and security integration without paid provider usage; it does not assess model quality.
