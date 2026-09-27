# Compact mobile chat transport

The unpublished separate chat-view implementation was backed up in Git stash and removed.
No display-cache table, migration, new HTTP endpoint, new realtime topic, run registry, or snapshot protocol is required.

## Boundaries

- Harmony requests the existing `/api/sessions/:key/history?view=compact&limit=20`.
- The existing transcript paginator selects 20 user turns using existing row cursors, then the response is filtered. Tool rows do not consume the user-turn limit. Text is not silently truncated; public narration is limited to 160 characters.
- Harmony subscribes to the existing `run:<id>` with `view: compact`. The socket filters live and replay frames before serialization, preserving original sequence numbers and gap recovery.
- Default HTTP and realtime subscribers retain full history/events. Typed product deliveries are an additive tool-end field extracted before large tool-result truncation.
- Raw thinking, tool arguments, tool results, commands and diffs are not sent to compact subscribers. Public assistant narration supplies short progress; it is not a summary of private reasoning.
- Text deltas are delivered immediately. While presentation is unknown, text is displayed incrementally; message-end classification moves narration into a separate compact progress block. Final answers are not buffered server-side.
- Confirmation requests, terminal outcomes, failures, reviews, media and product deliveries remain available. Failed outcomes have an inline message instead of an empty card.
- Existing optimistic input IDs, retry behavior, history prefetch and recovery are reused. No second synchronization path is introduced.

## Limits and deployment

Filtering reduces mobile transfer, parsing and rendering, not the original server-side transcript storage or broker retention. The server still reads the selected raw transcript window. Further storage optimization should follow measured server bottlenecks rather than introducing another cache preemptively.

Deploy the updated Gateway together with the mobile client. The former local test database reached schema 224; this unpublished code retains schema 223 at the user's request. No local database or conversation data was changed. Resolve that test-only database version before restarting the local Gateway; do not reset/delete conversations to do so.

## Verification (2026-09-27)

- Backend targeted suite: 103 tests passed, including full-client regression, compact cursor pagination, real WebSocket replay/live delivery, and HTTP view/page cache validators.
- TypeScript check and targeted ESLint passed; signed Harmony HAP build passed.
- Harmony full suite: 526 passed, three unrelated failures (local signing configuration, existing chat border rule, concurrent notes-layout changes). Compact chat tests passed.
- Updated-device acceptance has not been run for this simplified version. The previous separate implementation's device results do not apply to this build.
