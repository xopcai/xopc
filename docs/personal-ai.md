# Meet Loopi, your personal Agent

Loopi is the personal Agent inside xopc. Start with a conversation, clarify a goal, or delegate something to do while you keep talking. You can also go directly to the workspace to handle files and projects. Both use the same xopc installation.

## Before you begin

Install the [desktop app](./desktop-app.md) or open the Gateway console, connect a working [model](./how-to/configure-first-model.md), and keep the Gateway running. Voice and external services require separate configuration. Loopi is included; you do not need another application or account just for Loopi.

## Start your conversation

1. Open the personal Agent from the sidebar (`#/personal`). Its default name is **Loopi**; an existing installation may show a name you chose.
2. Complete the setup shown on the page and choose an available model if requested.
3. Share a little context: `I work independently. Keep replies concise, ask when the goal is unclear, and help me finish one useful thing at a time.`
4. Bring a real question or small task. If you only want to discuss, say so.

The first check is a visible reply in the personal conversation. Confirm that the assistant understood your request before granting access to additional material.

## Make it yours

Click the avatar or **Response preferences** in the page header. You can change the name, appearance, tone, response length, and whether it should listen, untangle a problem, or suggest solutions. Model and voice selection are available in the preferences panel.

**Updates** controls how much task progress Loopi discusses. **Proactive messages** controls contact about followed topics, including quiet hours. These are separate preferences; use the [follow-up guide](./personal-agent-proactivity.md) to choose the latter.

Use the [user-understanding controls](./user-understanding.md) to review, correct, or delete durable understanding. Changing tone is not the same as correcting a remembered fact.

## Delegate when you are ready

Try: `Turn our plan into a one-page Markdown file. Include the goal, three next actions, and open questions. Tell me when the file is ready.`

Open **Activity** to inspect delegated tasks. Continue discussing another topic, then review the delivered file and ask for changes. See [Task delegation and delivery](./task-delegation.md).

Loopi can read short local text, recall earlier conversation details, and inspect notes, projects and automation state. After work returns, you can ask about a particular section, PDF page, spreadsheet cell or source in the saved result without starting the work again. Supported document text is prepared in the background; if a cold read needs preparation, the question continues automatically after it is ready. Visual interpretation, new processing and complete bulk review still use specialist execution. For supported connected apps, Loopi checks the connection and account before submitting a read-only request; saved-result reads retain account access checks and do not refresh external data.

In the Web chat, use **Ask about** beside a returned result or file to attach that exact result to your next message. File previews and downloads remain available while text is being prepared. Extracted text can omit layout, images or spreadsheet recalculation; Loopi should keep those limitations visible.

The personal conversation uses a fixed set of local and coordination tools. MCP tools, Codemode and dynamic external discovery run through specialist Agents with their own configuration. Configuring MCP does not give the personal conversation direct access to those tools. A separate ordinary conversation with the same Agent follows its configured tool permissions.

For ordinary delegated work, Loopi submits a complete Task brief and returns immediately after local persistence. The Gateway allocates one Specialist in the background. The independent `task-router` Agent inherits the global chat model unless separately configured; it compares candidate profiles but does not execute business tools. Assignment and execution status return to the originating conversation, and verified results use the existing Task result delivery flow. Explicitly requested Agents and Skills are preserved. Connected-app requests retain their account connection and authorization flow.

The personal model sees submission and existing-task coordination commands. Specialist discovery, matching and direct executor creation are not advertised, and the specialist directory is not injected into its prompt. Describe needed capabilities in the brief; the background router resolves execution conditions. Explicitly named executors can be supplied by ID or unique display name, and explicitly requested Skills are preserved without foreground discovery.

Allocation is durable across Gateway restarts. Before execution, allocation failures can be retried on the same Task with `personal_task(command="retry_allocation", taskId=...)`; answering a router question also resumes allocation. This does not rerun an execution that has already started. The initial router review budget is 24 eligible candidates; larger candidate sets report a clear blocker rather than silently omitting candidates.

## If something is missing

| Problem | Next step |
| --- | --- |
| Personal Agent setup cannot finish | Check the model credential, available model, and Gateway connection |
| The name is different | Review the saved profile; Loopi is the default name, not a separate installation |
| A voice call is unavailable | Configure and test [Voice](./voice.md); text chat does not establish speech availability |
| An unexpected follow-up arrives | Review Proactive messages and the explanation attached to the topic |
| It has the wrong background | Correct the user understanding and clarify the current conversation |

Core state stays in your local xopc installation. Selected cloud providers process the context sent to them. See [Data and file locations](./workspace.md) and [Product philosophy](./product.md).

### Personal tool coordination

Ordinary Tasks support `personal_task(cancel)` from the main conversation. Cancellation closes the Task and stops further allocation; `executionStopConfirmed` must be interpreted separately from accepted cancellation. Connected-app Requests use `personal_request` without selecting an executor in the main model; the Task Router assigns one within the selected account permissions after authorization. Task, Request, Attention and selection queries return paginated, bounded excerpts. See [tool optimization and verification](https://github.com/xopcai/xopc/blob/main/docs/design/technical/personal-tools-optimization-2026-10-14.md).

Task handoffs retain the original request separately from the Agent’s interpretation, pin selected input versions, and allow scoped, paginated reads by the executor. Necessary references to earlier results, notes, Tasks or files can be passed as `personal_task.sourceRefs`; their authorization and version resolution happen after submission. Background allocation checks required operations, tool policies, registration, model configuration, Skills and account permissions, then checks readiness again before execution. See [handoff and capability verification](https://github.com/xopcai/xopc/blob/main/docs/design/technical/personal-task-handoff-stage-b-2026-10-15.md).

Completed ordinary Tasks can now be revised in the same Task, with the original result retained. `personal_task(get, section="revision")` returns the exact baseline and expected version for atomic `revise`; execution stays in the background. Result cards show the result revision, and `personal_result` can still read prior revisions. Final delivery uses an explicit artifact selection, rather than every file published during the run. Saved text can be delivered independently if composition or foreground availability delays it. See [revision and final delivery](https://github.com/xopcai/xopc/blob/main/docs/design/technical/personal-task-revision-stage-c-2026-10-15.md).
