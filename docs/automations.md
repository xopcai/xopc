# Automations

An Automation starts an Agent, Workflow, or saved browser task manually, on a schedule, or from a webhook. Every run keeps its status and result so you can inspect what happened.

## Choose the action

| Action | Use it when |
| --- | --- |
| Agent instruction | The request is best interpreted at run time by one Agent |
| Workflow | The steps are already defined and should run predictably |
| Browser automation | A tested set of website interactions should be repeated |

For deterministic recurring work, prefer a published Workflow or tested browser automation over a broad Agent instruction.

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

## Monitor runs

The Automations page shows whether an item is active, its next run time, recent results, and consecutive failures. Open a run to see the summary, linked Session or Workflow run, timestamps, and error.

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

## Examples

- summarize open Tasks every weekday morning;
- run a weekly review Workflow each Friday;
- check a saved browser task and report changes;
- trigger a research Workflow from another trusted service.

For the repeatable steps themselves, see [Workflows](./workflows.md). For website interactions, see [Browser automations](./browser-workflows.md).
