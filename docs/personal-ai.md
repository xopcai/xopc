# Meet Ada, your personal Agent

Ada is the personal Agent inside xopc. Start with a conversation, clarify a goal, or delegate something to do while you keep talking. You can also go directly to the workspace to handle files and projects. Both use the same xopc installation.

## Before you begin

Install the [desktop app](./desktop-app.md) or open the Gateway console, connect a working [model](./how-to/configure-first-model.md), and keep the Gateway running. Voice and external services require separate configuration. Ada is included; you do not need another application or account just for Ada.

## Start your conversation

1. Open the personal Agent from the sidebar (`#/personal`). Its default name is **Ada**; an existing installation may show a name you chose.
2. Complete the setup shown on the page and choose an available model if requested.
3. Share a little context: `I work independently. Keep replies concise, ask when the goal is unclear, and help me finish one useful thing at a time.`
4. Bring a real question or small task. If you only want to discuss, say so.

The first check is a visible reply in the personal conversation. Confirm that the assistant understood your request before granting access to additional material.

## Make it yours

Click the avatar or **Response preferences** in the page header. You can change the name, appearance, tone, response length, and whether it should listen, untangle a problem, or suggest solutions. Model and voice selection are available in the preferences panel.

**Updates** controls how much task progress Ada discusses. **Proactive messages** controls contact about followed topics, including quiet hours. These are separate preferences; use the [follow-up guide](./personal-agent-proactivity.md) to choose the latter.

Use the [user-understanding controls](./user-understanding.md) to review, correct, or delete durable understanding. Changing tone is not the same as correcting a remembered fact.

## Delegate when you are ready

Try: `Turn our plan into a one-page Markdown file. Include the goal, three next actions, and open questions. Tell me when the file is ready.`

Open **Activity** to inspect delegated tasks. Continue discussing another topic, then review the delivered file and ask for changes. See [Task delegation and delivery](./task-delegation.md).

Ada can read short local text, recall earlier conversation details, and inspect notes, projects and automation state. Large documents and specialist work are delegated. For supported connected apps, Ada checks the connection and account before submitting a read-only request; results return to the originating chat after execution.

The personal conversation uses a fixed set of local and coordination tools. MCP tools, Codemode and dynamic external discovery run through specialist Agents with their own configuration. Configuring MCP does not give the personal conversation direct access to those tools. A separate ordinary conversation with the same Agent follows its configured tool permissions.

For ordinary delegated work, Ada submits a complete Task brief and returns immediately after local persistence. The Gateway allocates one Specialist in the background. The independent `task-router` Agent inherits the global chat model unless separately configured; it compares candidate profiles but does not execute business tools. Assignment and execution status return to the originating conversation, and verified results use the existing Task result delivery flow. Explicitly requested Agents and Skills are preserved. Connected-app requests retain their account connection and authorization flow.

Allocation is durable across Gateway restarts. Before execution, allocation failures can be retried on the same Task with `personal_task(command="retry_allocation", taskId=...)`; answering a router question also resumes allocation. This does not rerun an execution that has already started. The initial router review budget is 24 eligible candidates; larger candidate sets report a clear blocker rather than silently omitting candidates.

## If something is missing

| Problem | Next step |
| --- | --- |
| Personal Agent setup cannot finish | Check the model credential, available model, and Gateway connection |
| The name is different | Review the saved profile; Ada is the default name, not a separate installation |
| A voice call is unavailable | Configure and test [Voice](./voice.md); text chat does not establish speech availability |
| An unexpected follow-up arrives | Review Proactive messages and the explanation attached to the topic |
| It has the wrong background | Correct the user understanding and clarify the current conversation |

Core state stays in your local xopc installation. Selected cloud providers process the context sent to them. See [Data and file locations](./workspace.md) and [Product philosophy](./product.md).
