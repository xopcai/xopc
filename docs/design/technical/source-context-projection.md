# Source context in model history

`projectSourceContextsForLlm` runs when loading session history and again at the
embedded provider request boundary. It makes copies for the model; SQLite input
snapshots, transcript rows, and chat display retain their original data. JSON exports
can still recover the original snapshots from their `transcriptRows` field.

- Device snapshots keep only the latest full snapshot per endpoint. Older messages
  keep a source-device marker. Each request rechecks environment, power, availability,
  and location-reference freshness using the existing device rules.
- Application context, browser page captures, and browser tab observations deduplicate
  identical content within each source kind. Capture IDs, sequences, timestamps, and
  envelope hashes do not prevent deduplication. Application resource revisions,
  selections (including drafts), page content, and page URLs remain part of identity;
  changed content stays available for comparison until it expires.
- Historical application/browser bodies expire after 30 minutes. They become
  `source_context_ref` markers with their source ID, version, and capture time.
  The latest user message's snapshots are exempt so an ongoing request can still
  analyze its explicitly supplied data. Retention does not imply a live page or
  current authorization. Duplicate markers point to the retained snapshot.
- New application/browser envelopes carry capture time in their text so expiry
  works after provider conversion removes metadata. Old envelopes use a matching
  source-summary capture time, falling back to the message timestamp. Without a
  trustworthy time, the projection deduplicates but does not invent an expiry.
- Explicit Note/file/task/session/result/assertion references share a retained body
  only when kind, source ID, version, and text all match. Distinct versions and
  excerpts remain separate; these explicit references have no time-based expiry.
  Small bodies stay unchanged when a reference would not meaningfully save space.
- `projectRepeatedReadResults` shares exact successful, complete `read_file` and
  `web_fetch` responses, including across user turns. Both the original request
  arguments and response details/content must match. Every receipt, tool-call ID,
  timestamp, and error status is retained. A retained full body must be in the last
  three user turns, which normal budget pruning protects. Failures, missing
  completeness metadata, excerpts, mixed media, commands, and arbitrary MCP/action
  results keep their existing semantics. This projection runs on loaded history
  and every provider request, independently of coding verification settings.
- Earlier browser screenshots continue to use the existing visual projection.
  Source boundaries and user text are preserved. Ambiguous envelopes containing
  literal prompt delimiters in a quoted source are left intact.

The 30-minute historical retention window is defined by
`HISTORICAL_SOURCE_CONTEXT_TTL_MS` in
`src/agent/source-context/source-context-projection.ts`.

## Other context paths checked

- User memory and task execution guidance are built as dynamic system context for
  each run. The profile extension rebuilds one current system message and removes
  historical profile-update projections from model input.
- Startup memory injection is currently disabled. Audit/context rows, routine
  allocation status, connection/personal request status, and clarification answer
  receipts are already excluded from normal model history.
- Task-result deliveries commit once per delivery ID; notification retries do not
  append another transcript row. Their history representation is already a bounded
  excerpt with result/artifact references.
- Command receipts, changed observations, user/assistant conversation, and voice
  transcripts carry temporal or conversational meaning even when words match.
  They are not deduplicated by text. Existing context-budget pruning and compaction
  still govern large historical tool responses and images.
