# Follow task progress

xopc shows live status while an Agent uses tools or completes a long request. Progress messages help you tell the difference between active work, waiting for your input, and a failure.

## What the states mean

| State | Meaning |
| --- | --- |
| Thinking | The model is preparing the next action |
| Searching or reading | The Agent is gathering information |
| Writing or executing | A tool is changing files or running a command |
| Waiting | The Agent needs your decision, permission, or missing information |
| Completed | The requested result was returned |
| Failed | The current action stopped with an error |

Different clients display these states differently. The Gateway console shows the richest detail; messaging channels may show compact text or updated draft messages.

## When progress appears stuck

1. Check whether the Agent is waiting for a confirmation outside the visible area.
2. Open the run or tool details in the Gateway console.
3. Look at the latest log entry.
4. Cancel only if no useful work is advancing or the action is unsafe.
5. Retry after fixing the first error, not every later symptom.

Long-running work can periodically report that it is still active. This does not guarantee success; inspect the final result and verification evidence.

## Channel streaming

Channels that support streaming can update a message while work continues. If partial updates are distracting or unreliable on a channel, select complete-message mode in that channel's settings.

Progress summaries should not expose raw secrets or full tool payloads. If sensitive data appears, stop the run, rotate affected credentials, and review the Agent and channel permissions.
