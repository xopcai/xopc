# Content Intake

Content intake is the shared entry for short external text that should become either a note or a chat prompt.

## Product Contract

- The UI stays a small modal with no title.
- The content preview is shown first; actions stay limited to two vertically stacked buttons.
- The modal has no passive dismiss path; handling content means saving it or exploring it in chat.
- Button labels adapt to content type:
  - URL: save link / summarize link
  - Code: save code / explain code
  - Checklist: save checklist / organize checklist
  - Long text: save as note / summarize
  - Plain text: save as note / explore in chat
- Low-value snippets and short verification-code messages are ignored.
- Sensitive-looking tokens, emails, phone numbers, and card-like numbers are hidden in the preview.
  Explicit chat actions still send the original text.
- Checklist snippets are saved as Markdown checklists.
- Clipboard foreground detection is enabled by default and can be disabled from Settings.
- The intake modal is available only after a gateway is configured.

## Technical Contract

- `src/features/content-intake/content-intent.ts` owns classification and prompt wrapping.
- `ContentIntakeModal` owns only presentation and button dispatch.
- `useContentIntakeActions` owns note capture, chat handoff, and toast state.
- `ClipboardIntakeModal` is only a clipboard adapter.
- `/intake` is the route adapter for deep links and native share bridges.
- Android text sharing is configured by `plugins/with-android-share-intake.js`.
- iOS text sharing is configured by `plugins/with-ios-share-intake.js`.

## Supported Sources

- Clipboard foreground checks on app start and resume.
- `/intake?text=...` and `/intake?url=...`.
- `title` is auxiliary metadata only. It is combined with URL text, but `title` alone does not create intake content.
- Android `ACTION_SEND` with `text/plain`; `EXTRA_TEXT` maps to `text`, and `EXTRA_TITLE` maps to `title`.
  The native bridge opens `xopc:///intake` so `/intake` is parsed as a route path, not a URL host.
- iOS Share Extension for plain text and web URLs.
  The extension opens `xopc:///intake?text=...` and leaves save/chat handling to the shared intake route.

## Current Boundary

Native share bridges only pass text and URL content into `/intake`. Images, files, and multi-item batches are intentionally out of scope for this flow.
