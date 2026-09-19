# Understanding and memory

xopc automatically maintains useful user understanding and scoped work memory. Ordinary memories do not require individual approval. Open **You** to inspect recent updates, see their sources, edit them, or delete them.

## What is remembered

- Explicit ordinary facts and preferences are saved directly.
- Observations and inferences remain distinguishable from statements made by you. Only sufficiently supported, ordinary, low- or medium-consequence assumptions can influence personalization.
- Project facts, decisions, lessons, and open questions stay in work memory with their original scope. Raw source records remain in the source index.
- Short-lived context has a validity or review window. Uncertain or outdated information is quietly withheld instead of becoming a task for you to approve.
- Automatic memory does not authorize actions. Inferred collaboration rules remain disabled until explicitly enabled. Sensitive inferences are not admitted to the user model.

The ordinary `writePolicy` supports `allow` (default) and `deny`. On upgrade, the previous ordinary `confirm` policy is migrated once to `allow`; `deny` and sensitive-write settings are preserved. There is no runtime fallback for the old ordinary confirmation policy.

## Editing and deletion

Edit an understanding or work-memory item in **You**. Explicit edits take priority over subsequent source refreshes. You can also tell the assistant to correct or forget an existing user understanding in conversation.

Deleting an understanding removes its revision chain, linked evidence associations, search entries, and matching maintenance/context audit entries. Cached discovery candidates are removed without deleting the rest of the discovery result. Deleting work memory also removes linked compaction-derived records. Minimal hashed suppression keys prevent the same slot, canonical key, or normalized text from being automatically recreated. They contain no original memory text. An explicit new remember command can restore a deleted user understanding.

Deletion operates on the structured memory store. It does not erase original conversations, source files, connector records, backups, or text already delivered in an answer. Semantic paraphrases with different identities are not guaranteed to match a suppression fingerprint; manage the source or use a temporary conversation when information must not be learned again.

## Automatic upkeep

The existing system automations maintain memory without model-driven full-history rewrites:

- Hourly maintenance retires expired or overdue assertions and knowledge and closes expired priority windows.
- Daily reconciliation checks contradictions and promotes eligible candidates with independent owner evidence. Identical content and repeated source-item identities do not count as separate evidence. Runtime-generated evidence cannot promote an assertion.
- Fresh supporting source observations can renew an inferred understanding's review window. Reading or recalling a memory never increases its confidence or resets its age.
- Weekly maintenance archives stale work memory after the retention period.

Daily and weekly defaults are 03:00 and Sunday 04:00 in the configured maintenance time zone (otherwise the host time zone). Jobs are bounded, idempotent, and auditable.

## Use in a conversation

Every turn selects a bounded set of relevant context after scope, validity, sensitivity, and authority checks. Automatically activated inferences are still labeled as working assumptions, never as user-confirmed facts. Current instructions take precedence. Due memories are excluded immediately, even before the maintenance job runs.

Relevant sources and context-selection audits remain inspectable. Helpful/irrelevant feedback affects retrieval priority, not factual confidence.

Conversations, work folders, and connectors retain separate access controls. Local-only processing policy and temporary conversations continue to apply. Backup and state locations are described in [Data and file locations](./workspace.md).
