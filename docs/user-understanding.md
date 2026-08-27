# Personalization and user context

xopc can keep reviewable information about how you prefer to work, such as your name, time zone, collaboration rules, and confirmed preferences. This context is stored locally and only a relevant subset is used for each request.

## Review what xopc knows

Open **You** or **User context** in the Gateway console. Depending on the current version, you can review:

- profile facts you entered directly;
- understandings inferred from conversations and waiting for review;
- active understandings;
- collaboration rules you explicitly set;
- connected sources and their permissions;
- background-review and privacy settings.

## Correct or remove information

Use **Confirm** only when an item is accurate and useful. Use **Correct**, **Reject**, or **Delete** when it is wrong, too broad, outdated, or should not be retained.

Explicit collaboration rules take priority over inferred preferences. Phrase rules as concrete behavior, for example: “Ask before sending a message to an external recipient.”

## What should not be remembered

Do not ask xopc to retain passwords, API keys, recovery codes, payment details, government identifiers, health records, or other highly sensitive secrets. Store those in an appropriate password manager or system of record.

Workspace files and Agent profile Markdown are separate from user context. Putting information there may make it available to an Agent, but it does not make it a reviewed user-understanding item.

## Model-provider privacy

Local storage does not mean every model request stays local. The selected context and conversation content may be sent to the configured cloud model. Use a local model or adjust personalization when a task should not send personal context to an external provider.

## Background review

When enabled, background review can identify outdated or contradictory items and place them in a review queue. It should not silently turn an unconfirmed inference into an authoritative profile fact.

Review the queue periodically and disable background review if you do not want this processing.

For backup and deletion of the local database, see [Data and file locations](./workspace.md).
