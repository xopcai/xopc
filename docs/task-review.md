# Review, accept, or retry a Task

An execution can stop before its result is acceptable. Review the artifacts and evidence, then decide whether the Task meets its completion criteria.

## Before you begin

Open an existing Task with acceptance criteria and a result to inspect. Use [task delegation](./task-delegation.md) or [Projects, Tasks, and Notes](./projects-tasks-notes.md) to establish a clear result first.

## Check the result

1. Open the Task card and expand the review area when the Task awaits review.
2. Inspect the delivered files, execution record, evidence, and remaining work.
3. Compare each acceptance criterion with the actual output. Choose **Mark passed** or **Mark failed**; leave unsupported claims unverified.
4. Choose **Accept task** only when all criteria pass, no waits remain, and the current Task allows closing.

For a report, check the saved file and its numbers. For a code change, inspect the diff and verification results. For an external write, inspect the destination rather than relying on a model's statement.

## Request changes or retry

If the output needs revision, explain the failed criterion and desired correction in the related conversation. If the latest execution failed, inspect its cause before choosing **Retry**. Retry retains that execution's executor.

A retry does not prove an earlier external write failed. Check for completed writes before repeating an action. Cancellation stops further execution; it does not undo completed effects.

## When an action is unavailable

| Situation | Next step |
| --- | --- |
| Accept task is unavailable | Check criteria, pending waits, and current Task state |
| Task changed while you were reviewing | Refresh and inspect the latest execution and result |
| Execution needs information or authorization | Resolve the request before continuing |
| Result has no supporting evidence | Request verifiable output; keep the criterion unverified |
| Retry fails again | Fix the reported access, model, tool, or input issue before another attempt |

Keep the review attached to the original Task so its result and decisions remain together. For scheduled work, also inspect [Automation](./automations.md) run history.
