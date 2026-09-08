# Understanding and memory

xopc keeps a reviewable user model and a separate knowledge memory. This separation prevents project details, temporary activity, and model guesses from silently becoming permanent claims about the user.

Open **You** in the Gateway console to see the Agent's current understanding in three views:

- **Your portrait** presents explicit profile fields such as call name, role, pronouns, language, and time zone as directly editable UI. These fields are not mixed into the understanding feed.
- **Shared understanding** groups preferences and rhythm, relationships, current context, and derived insights. Every item can be confirmed, corrected, or retired.
- **Work memory** presents distilled project facts, decisions, lessons, commitments, and open questions. Raw mail, calendar, and document records remain in the source index for retrieval and provenance instead of appearing as memory cards.

The interface describes provenance, confidence, and time horizon in plain language. Storage status names and raw scoring remain implementation details.

## Five kinds of context

| Domain | Purpose | Typical lifetime |
| --- | --- | --- |
| User assertions | Identity, preferences, routines, relationships, capabilities, and current state | Stable, slowly changing, dynamic, or event-bound |
| Goals | Desired outcomes and success criteria | Until achieved, paused, or abandoned |
| Priority windows | What matters now, with explicit start, end, urgency, and review time | Hours to weeks |
| Collaboration rules | Explicit communication, execution, boundary, routine, and proactive rules | Until disabled or replaced |
| Knowledge memory | Project facts, decisions, task lessons, commitments, questions, episodes, and notes | Scope- and retention-dependent |

Each assertion records authority, confidence, importance, actionability, volatility, sensitivity, applicability, validity time, and review time. Confidence describes whether a claim is likely true; importance describes the cost of omitting it. They are intentionally independent.

## Evidence and correction

Direct user statements have the highest authority. Authorized observations may propose candidates. System inference stays distinguishable from user-confirmed facts, and untrusted external content cannot become an authoritative user claim.

Corrections create a new assertion that supersedes the old one while keeping the audit history. Conflicting current claims move to review; the runtime abstains when it cannot resolve them safely.

## Time and maintenance

Maintenance is enabled by default and registered as deterministic system automations:

- an hourly temporal sweep marks expired assertions and knowledge stale and closes expired priority windows;
- a daily reconciliation checks review dates, contradictions, evidence thresholds, and missing search-index rows;
- a weekly knowledge job archives stale knowledge after the configured retention period.

Defaults are 03:00 daily and Sunday at 04:00 weekly in the configured maintenance time zone, or the host time zone when none is set. Runs are idempotent, bounded, recorded in SQLite, and do not use a model to make hidden semantic changes.

## Context sent to an Agent

Every turn builds a bounded execution context from current rules, relevant assertions, active goals and priorities, and task-relevant knowledge. Scope, validity, sensitivity, disclosure policy, authority, relevance, importance, urgency, and token budget all affect selection. The full user model is never attached to every prompt.

Each selection is audited by turn so the console can explain which items influenced an answer. Helpful or irrelevant feedback is stored against that execution-context run.

## Sources and privacy

Conversations, selected work folders, and configured connectors are independent sources. Revoking one stops future reads from that source. Sensitive writes use their own policy, and local-only source content is not sent to a remote extraction model.

Do not store passwords, API keys, recovery codes, payment details, or regulated records as user-model facts. Local storage also does not guarantee local processing: context selected for a request may be sent to the configured model provider unless its processing policy requires local handling.

The user model is stored with the rest of xopc's structured local state. Backup and deletion are covered in [Data and file locations](./workspace.md).
