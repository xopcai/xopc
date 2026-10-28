# Personal understanding and work memory

Date: 2026-10-28

The Me page exposes personal understanding and work memory as separate primary tabs. Personal counts continue to include only usable assertions, excluding basics already shown in the profile. Work counts include management records, including records awaiting verification. Primary tab state is stored in the URL and participates in browser history.

## Capture and use

Each assertion, durable goal and collaboration rule has its own intent, independent of the main task. A task may therefore produce both work facts and an ongoing personal preference. Direct ongoing statements do not require a remember command. A one-off task instruction does not establish a durable preference. Project-specific choices retain their project scope.

New behavioral inferences require at least two distinct user expressions. Assistant and tool output cannot ground personal assertions; duplicate user messages do not supply independent support. Subsequent grounded evidence may merge into an existing understanding. The existing confidence, sensitivity and scope checks still determine whether an understanding can be used automatically.

Ongoing communication preferences are represented as personal preference assertions with response applicability. At context selection, confirmed high-consequence assertions take priority, followed by confirmed ongoing response preferences, other confirmed assertions and eligible working assumptions. This keeps response style available even when it has little lexical overlap with a new task. Existing correction, deletion and evidence controls remain available.

## Historical completion

The background learning service finds conversations previously processed by the old extractor, including retained archived transcripts after a reset. It schedules at most three rebuilds per scan through the existing persistent queue. Rebuilds share the configured daily extraction budget, bounded evidence windows, leases, retries, processing policy and owner access checks. New conversations processed with the new version do not need a rebuild.

Rebuilds read original retained user messages, rather than promoting assistant summaries or work memories into personal facts. They write only personal assertions; they do not replay old goal/rule creation, confirmation, work writes or forgetting operations. Deleted preferences cannot be restored by an old remember command. An older replacement cannot overwrite a newer assertion. Completed rebuilds are not repeatedly scheduled by routine configuration changes.

No schema migration or new Gateway route is needed. The behavior starts when a Gateway running this code starts its learning service. It does not synchronously rewrite the user's database during development, and completion depends on the configured understanding model and extraction budget.
