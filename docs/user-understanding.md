# User understanding

xopc can maintain a reviewable model of the person it assists. This model is intended to make collaboration more continuous without pretending that every observation is true forever or that every message deserves to become memory.

User understanding is shared across enabled Agents. It is separate from a conversation transcript, a workspace file, and an Agent profile.

## What may be useful to understand

Useful items can include:

- profile facts such as name, time zone, and preferred language;
- goals and longer-running directions;
- important people and relationships;
- active Projects and recurring responsibilities;
- preferences and working habits;
- decisions and their reasons;
- commitments that may need follow-up;
- current focus, pressure, or blockers;
- explicit rules for how xopc should collaborate.

The goal is not maximum collection. xopc should retain only context that is useful, appropriately scoped, and still current.

## Facts, inferences, and rules

xopc should keep three ideas distinct:

| Kind | Meaning | Example |
| --- | --- | --- |
| **Observed or stated fact** | Something the user said directly or an authorized source showed | “The project deadline is October 12.” |
| **Inference** | A conclusion formed from one or more pieces of evidence | “This project may currently be the user's highest priority.” |
| **Collaboration rule** | Explicit instruction governing assistant behavior | “Ask before sending a message to an external recipient.” |

An inference is not an authoritative fact. Evidence, scope, confidence, and age all matter. Explicit collaboration rules take priority over inferred preferences.

## Review what xopc knows

Open **You** or **User context** in the Gateway console. Depending on the current release, you can review:

- profile facts you entered directly;
- inferred understandings waiting for review;
- active understandings;
- explicit collaboration rules;
- connected sources and their permissions;
- source evidence and derivation information;
- background-review and privacy settings.

Use **Confirm** only when an item is accurate, useful, and scoped appropriately. Use **Correct**, **Reject**, or **Delete** when it is wrong, too broad, outdated, or should not be retained.

Correction is part of the product, not an exceptional failure. A corrected item should take precedence over later inference from older evidence.

## Understanding lifecycle

A useful understanding system must decide more than what to remember:

```text
Evidence appears
→ propose an understanding
→ user or policy reviews it
→ activate, correct, reject, or keep pending
→ use only when relevant
→ review for conflict or age
→ refresh, mark stale, or delete
```

Direct statements can still become outdated. Time-bounded focus should expire instead of silently becoming a permanent identity claim. Contradictory items should return to review rather than being resolved invisibly.

## Sources and permissions

Sources are independent. Connecting one does not authorize another.

- Conversations can provide direct statements and corrections.
- Explicitly selected work folders can provide bounded project evidence.
- Connectors can provide source-specific mail, calendar, task, or document context when configured and authorized.
- On supported macOS desktop builds, experimental Work Discovery can separately request read-only access to Apple Notes, Calendar, and Reminders.

Work Discovery uses bounded reads and visible scope. Its native macOS scan holds raw source content only for the model call and does not store that raw content in the xopc database. Derived understanding remains reviewable. Exact source availability varies by release.

Revoking a source should stop future reads. Review derived understanding separately: a user-confirmed conclusion may remain useful after a source is disconnected, while untrusted or unwanted derived items should be removed.

## What should not be remembered

Do not ask xopc to retain passwords, API keys, recovery codes, payment details, government identifiers, health records, or other highly sensitive secrets. Store those in an appropriate password manager or system of record.

Workspace files and Agent profile Markdown are separate from user understanding. Putting information there may make it available to an Agent, but it does not make it a reviewed understanding item.

## Model-provider privacy

Local storage does not mean every model request stays local. The relevant subset of user understanding, conversation content, and authorized source excerpts may be sent to the configured cloud model for a request.

Use a local model when context must remain on-device. Before connecting a cloud provider or a personal source, review the provider's data practices and the xopc settings that control personalization and source access.

xopc should send only context relevant to the current request; it should not attach the entire user model to every prompt.

## Background review

When enabled, background review can identify outdated or contradictory items and place them in a review queue. It should not silently turn an unconfirmed inference into an authoritative profile fact.

Review the queue periodically and disable background processing if you do not want it. Proactive review should prefer a small number of useful decisions over repeated notifications.

For the broader trust model, see [Product philosophy](./product.md). For backup and deletion of the local database, see [Data and file locations](./workspace.md).
