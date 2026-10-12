# Codex streaming text animation research

Research date: 2026-10-13. Scope: read-only inspection of the installed Codex frontend and xopc WebUI; no production UI changes.

## Findings

The installed Codex frontend creates the soft streaming edge primarily through opacity animations on text segments. The inspected Markdown text animation does not use a moving gradient mask. Newly mounted segments fade in while earlier segments remain fully readable. Several segments can be fading simultaneously, creating the visual impression of a soft trailing edge.

The implementation combines:

1. Adaptive buffering of incoming text, separate from the authoritative response content.
2. Word-oriented segmentation and per-segment opacity animation.
3. Stable segment identity and animation timing across Markdown updates.
4. Cached parsing of stable Markdown prefixes while the tail changes.

These findings describe this installed bundle, not a documented API or a guarantee for other Codex versions. Feature flags and message phase affect the active rendering path. Runtime DOM/computed styles were not inspected.

## Evidence in the installed application

Archive: `/Applications/ChatGPT.app/Contents/Resources/app.asar`. Running framework version observed: `154.0.8037.98`. The following paths are archive members, not standalone workspace files. The original application was not modified or extracted into the repository.

| Bundle member under `webview/assets/` | Evidence |
| --- | --- |
| `sites-end-resource-4e42d32ab50d.js` | Assistant message rendering passes adaptive buffering with a conversation/message stream id for non-commentary messages. Commentary uses the same Markdown renderer without that buffering prop. |
| `app-initial-f9b16fbf8fc7.js` | Shared streaming Markdown renderer, adaptive buffer, segmenter, stable key reconciliation, animation timeline, prefix parse cache. |
| `app-initial-341eb5dd9ad5.css` | Text fade keyframes interpolate opacity from 0 to 1, use `animation-fill-mode: both`, and a default easing of `cubic-bezier(.37,.55,.86,.88)`. Adaptive streaming overrides fade duration. Reduced motion removes delay and duration. |
| `app-shared-6fb15e58cd7f.css` | `--animation-duration-streaming-text: .7s`; basic transition duration is `.15s`. |
| `streaming-text-269f1ad4a27e.js` | A separate reusable animated-text wrapper defaults to 24ms segment spacing and an 800ms delay cap. This is not evidence that live assistant messages use those defaults. |

### Adaptive buffering

The buffer initializes already-present content as visible, so opening an existing response does not replay its whole history. It estimates incoming character rate using a weighted update (10% new estimate, 90% previous estimate), then adjusts its drain rate according to outstanding text. A 50ms timer drives draining; `requestAnimationFrame` publishes changes to React subscribers. This is adaptive paced output, not a guaranteed 60fps character animation.

When streaming ends, the buffer immediately publishes the complete source. A stream-id change or non-prefix content replacement resets buffer state. Thus smoothing does not intentionally hold the final response behind a long typing queue.

On the adaptive path, explicit segment delay is set to zero. The softness comes from the paced arrival of segments combined with their 700ms fade, rather than adding a fixed delay to every word in a long response.

### Segmentation and identity

The renderer uses `Intl.Segmenter` with word granularity for non-ASCII text, with fallback segmentation. ASCII text has a specialized alphanumeric-run splitter. Whitespace and punctuation attach to neighboring segments. Segments become inline spans inside Markdown text, preserving rich text structure.

Key reconciliation reuses keys for equal segments and for an existing segment whose text grows by suffix. Animation start times persist in maps; completed segment keys are tracked in a settled set. Already-faded content therefore does not need to fade again when the Markdown tail changes.

The shared renderer also supports staggered fades. Some assistant paths pass 16ms segment spacing and a 96ms maximum delay conditionally; the separate animated-text wrapper uses different defaults. These values should not be conflated with the adaptive streaming path.

### Public documentation boundary

[Official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server) documents the streamed `item/agentMessage/delta` event, but does not establish the frontend animation implementation or its timing. Animation findings above come from local bundle inspection.

## Current xopc behavior

| Source | Current behavior |
| --- | --- |
| `web/src/features/chat/session/use-frame-chat-session.ts` | Coalesces live updates with animation frames and a 50ms background fallback. |
| `web/src/features/chat/messages/use-progressive-streaming-markdown.ts` | Schedules progressive text commits, preserves initial snapshots, flushes final content. |
| `web/src/components/markdown/streaming-markdown-scheduler.ts` | Base commit intervals: plain 32ms, long text 48ms, list 40ms, table 72ms, code 64ms; adapts to parsing cost. |
| `web/src/features/chat/messages/message-content-renderer.tsx` | Renders stable Markdown blocks plus a changing tail. |
| `web/src/components/markdown/markdown-view.tsx` | Parses and sanitizes Markdown into HTML, renders with `dangerouslySetInnerHTML`. |
| `web/src/components/markdown/markdown.css` | Streaming classes currently control layout, not opacity reveal. |

The progressive scheduler chooses commit size from total pending document length divided by 16, bounded to 6–512 UTF-16 code units. As the response becomes longer, individual commits can grow larger even when the unrendered backlog is small. Together with fully opaque insertion, this can make output look like abrupt batches. This is a code-based explanation, not a measured performance finding.

## Recommended xopc approach

Keep the existing transport, response store, block layout, and Markdown sanitization. Add presentation-only segment fading to actively appended assistant text. Start with 500–700ms opacity fades and zero extra stagger on the live path; tune visually using Chinese and English responses.

The critical integration issue is DOM identity: changing `dangerouslySetInnerHTML` replaces the rendered descendants. Adding a fade class to every span in regenerated HTML would replay old text animations. A robust implementation needs a reconciled React representation of sanitized Markdown text nodes, or an equally deliberate incremental DOM strategy, with stable segment keys and completed-animation state. Preserve link handlers, code highlighting, file previews, Mermaid, and security sanitization.

Do not apply a permanent bottom gradient to the entire message. It would dim existing content during pauses, behave inconsistently across wrapped lines, and affect code or tables indiscriminately. A moving geometry-based mask is possible but unnecessary to reproduce the inspected behavior.

Suggested implementation order:

1. Build a stable segmented text rendering path for streaming assistant Markdown, keeping completed blocks memoized.
2. Fade only newly appended segments; opening history, reconnecting, and changing conversations must show the existing snapshot immediately.
3. Preserve the current scheduler initially. If output remains uneven, change pacing based on backlog and observed arrival rate rather than total document length; avoid stacking independent typing queues.
4. Honor reduced motion and flush final content without truncating text. Let already-started fades settle without replaying the full response.
5. Verify Chinese segmentation, emoji graphemes, Markdown structure changes, code fences, tables, abort/completion, background tabs, selection/copy, and long responses.

Acceptance target: the reading area stays steady; softness is confined to recently appended text; the final text and rich Markdown behavior remain unchanged. Implementation and visual verification remain future work.
