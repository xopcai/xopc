# Automations

An Automation starts an Agent, Workflow, Task, or saved browser task manually, on a schedule, from a webhook, or in response to a product event. Every run keeps its status and result so you can inspect what happened.

Automation is one stage of xopc's initiative model, not permission to act without limits. Begin with observation or a proposed action, test manually, and enable unattended execution only for an explicit, low-risk scope with understood side effects.

## Choose the action

| Action | Use it when |
| --- | --- |
| Agent instruction | The request is best interpreted at run time by one Agent |
| Workflow | The steps are already defined and should run predictably |
| Browser automation | A tested set of website interactions should be repeated |
| Task | An existing Task should start on a one-time or recurring schedule with its durable context |

For deterministic recurring work, prefer a published Workflow or tested browser automation over a broad Agent instruction.
When an Automation starts a Task, the Task's definition, constraints, acceptance criteria, and attached context are carried into the execution session. A Task that is already running, blocked, or closed cannot start another run.

Project-bound Agent and Workflow actions inherit the selected project's scope, instructions, workspace, and other project context. Event-triggered actions also receive the triggering event: Agents and Tasks receive a bounded data block, Workflows receive it through the input context, and browser automations can map matching event payload fields (plus `eventType`, `eventSource`, and `occurredAtMs`) into explicitly declared inputs. Explicit browser inputs always win.

## Create an Automation

<!-- Screenshot placeholder: /screenshots/automation-editor.png -->

1. Open **Automations** in the Gateway console.
2. Choose **Create automation**.
3. Give it a name that describes the result, such as “Weekday 9:00 planning summary”.
4. Choose the action and target.
5. Select a trigger: manual, one-time, interval, cron schedule, or webhook.
6. For a calendar schedule, set the intended time zone explicitly.
7. Configure timeout and retry behavior.
8. Save, then choose **Run now** for a test.

Keep the first run manual. Enable an unattended schedule only after the result and side effects are correct.

Sending, deleting, purchasing, publishing, or changing an external system should retain the applicable confirmation or explicit policy. A schedule does not expand an Agent's authority.

## Monitor runs

The Automations page shows whether an item is active, its next run time, recent results, and consecutive failures. Open a run to see the summary, linked Session or Workflow run, timestamps, and error.

The runtime uses one durable pipeline for every entry point:

`manual / schedule / webhook / product event → event hub → matching automation → action executor → result delivery`

Events carry correlation, causation, trust, deduplication, and chain-depth metadata. Each event-to-automation delivery and each result delivery is persisted independently, so a full executor does not drop triggers, gateway restarts can reconcile terminal work, and a failed result webhook does not change a successful run into a failed run. Action and delivery kinds are registry-based extension points; adding a new executor or destination does not change trigger ingestion.

Authenticated diagnostics are available through `GET /api/automation-events` and `GET /api/automation-deliveries`. The first reports event projection plus per-automation run delivery; the second reports result destinations, attempts, and the latest error. Both endpoints accept `limit`; event diagnostics also accept `type` and `source`, while result diagnostics accept `runId` and `status`.

Terminal failures move to a dead letter state and emit one `automation.attention.required` event. Operators can recover them without editing SQLite:

- `POST /api/automation-events/:eventId/replay` replays failed projection and event-to-run delivery;
- `POST /api/automation-deliveries/:runId/:destinationKey/retry` retries one failed result destination.

Both recovery requests require an `Idempotency-Key` header and a JSON body containing a non-empty `reason`. Metrics include pending work, oldest pending age, active leases, and dead-letter counts.

The next reliability and business-integration contract is defined in [Automation reliability and integration contract](./design/automation-reliability-integration-contract.md).

Use **Pause** when a dependency, credential, or expected input is temporarily unavailable. Pausing preserves the definition and history. Delete only when you no longer need them.

## Reliable schedules

- Confirm the displayed time zone and next run time.
- Give the action a clear success condition.
- Set a realistic timeout.
- Use limited retries for transient failures, not for invalid credentials or bad input.
- Avoid overlapping runs when actions modify the same external data.
- Review failures regularly; do not assume a schedule guarantees success.

## Webhook safety

Treat a webhook URL and secret as credentials. Do not put them in public repositories, screenshots, or logs. Validate any external input before allowing the action to write files, send messages, or change connected services.

Webhook Automations receive `POST /api/automation-hooks/:automationId`. Set the trigger's `secretId`, then provide its secret through `XOPC_AUTOMATION_WEBHOOK_SECRETS`, a JSON object keyed by secret id. Callers must send the secret as `Authorization: Bearer ...` (or `X-Xopc-Webhook-Secret`) and a stable `Idempotency-Key`. Payloads must be JSON objects and are limited to 256 KiB. Secrets shorter than 16 characters are rejected.

Result webhook destinations use the same secret registry and must use HTTPS. Deliveries include a stable `Idempotency-Key`, delivery id, attempt number, timestamp, and `X-Xopc-Signature` HMAC-SHA256 header. The receiver should verify the signature and deduplicate by idempotency key before applying side effects.

## Examples

- summarize open Tasks every weekday morning;
- run a weekly review Workflow each Friday;
- check a saved browser task and report changes;
- trigger a research Workflow from another trusted service.

For the repeatable steps themselves, see [Workflows](./workflows.md). For website interactions, see [Browser automations](./browser-automations.md).
