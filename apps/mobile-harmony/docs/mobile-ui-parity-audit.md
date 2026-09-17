# Mobile UI parity correction — 2026-09-17

Status: brand, four-tab shell, primary hubs and first chat/settings correction implemented; full screen parity is **not accepted**.

The existing Harmony preview covers selected API operations, but does not reproduce the existing mobile product. Successful builds, installation and protocol tests are not UI parity evidence.

## Reference and scope

- Existing iOS/Android implementation: `apps/mobile-expo/app/(tabs)/_layout.tsx`, `src/features/`, `src/components/`, and `src/theme/`.
- Product/design rules: `apps/mobile-expo/DESIGN.md`. It explicitly labels some values as future targets; do not silently substitute those for current mobile behavior.
- Approved marks: `assets/brand/concepts/xopc-human-ai-loop-role-{light,dark}.svg`; canonical geometry is also in `assets/brand/xopc-mark.svg`.
- Preserve Gateway authentication, device identity, protocols and user data. This is not authority to replace business storage or clear a paired installation.
- Existing uncommitted Expo and web changes belong to other ongoing work and must not be edited by this correction.

## Evidence-backed gaps

| Surface | Existing mobile reference | Harmony preview deviation | Required correction |
| --- | --- | --- | --- |
| Brand | Human–AI Loop, shared asset generator | Blue square with white X; pairing heading is only text | Shared launcher resource and exact light/dark marks; use marks in onboarding/identity surfaces |
| Root navigation | Four destinations: Chat, Progress, Library, You | Five text buttons: Chat, Tasks, Notes, Files, More | Four-destination shell, native back/detail routing, retained state and keyboard-aware dock |
| Chat | Main conversation root, history drawer, composer and attention tray | Session list root; visible operational buttons; separate fixed-height input | Main conversation semantics, history drawer, progressive actions, composer and stream states |
| Progress | Needs-user decisions, ongoing work, recently closed; task/project/workflow/automation routes | Tasks list plus projects/automations under More | Real attention feed and grouped entry points; do not relabel a task list as Progress |
| Library | Files, Notes, Inbox and recent material | Notes and Files are independent root tabs; no library hub | Hub, recent material and Inbox workflow with real data |
| You/settings | Grouped settings, connection and secondary configuration routes | Language/theme button rows and push/disconnect controls | Grouped rows, values, selectors, secondary screens and consistent hierarchy |
| Notes/tasks/projects/automations | Domain-specific screens and details | One generic WorkspaceView handles several unrelated domains | Reuse low-level primitives, not one generic business form; compare each domain's fields/actions/states |
| Files | Dedicated browser/detail/transfer flows | Basic browser/text/picker preview | Compare navigation, preview types, transfer feedback, loading/error states and menus |
| Visual foundation | Shared semantic tokens, native headers and row/menu primitives | Six color roles and per-view spacing/type/button recipes | A shared ArkUI token/component layer mapped to the accepted mobile baseline |

These findings are from source inspection, not claims that every reference feature has been exercised on a phone.

## Delivery sequence

1. **Brand resources:** remove placeholder, join shared asset generation and add drift checks. Implemented; signed HAP builds. Phone disconnected before update installation.
2. **Baseline and shell:** settle current-mobile versus future-design discrepancies, record route/state matrix, then implement four destinations and shared header/dock/list primitives.
3. **Chat and pairing:** identity surfaces, main chat, history, composer, keyboard/safe areas, streaming, cancel and background restoration.
4. **Progress and Library:** real data and attention/Inbox workflows; domain-specific list/detail screens.
5. **You and remaining routes:** settings, Gateway, files, automation, agents and associated dialogs/states; enumerate any still unsupported reference route explicitly.
6. **Acceptance:** side-by-side matched screenshots and interaction checks for light/dark, loading/empty/error/offline, long text and keyboard. Only mark a page complete after visual and behavioral verification, not merely compilation.

## Brand checks

`node scripts/generate-brand-assets.mjs --target=harmony --check` verifies the generated assets. The Harmony verification command runs it before host tests. `tests/brand-assets.test.ts` checks launcher equivalence with the existing mobile asset, exact concept marks and manifest icon bindings.

The pairing page and chat welcome state now use the exact light/dark `brand_logo` resources.

## First implementation pass — 2026-09-17

- Replaced five root buttons with Chat, Progress, Library and You. Retained tab content and used a `NavPathStack` for details; settings subpages participate in native back navigation.
- Added shared headers, list rows, skeletons and section labels using current Expo light/dark colors. The bottom dock uses the capsule shape and hides when the keyboard is visible.
- Chat restores its Gateway-scoped main conversation. History opens independent detail conversations. Realtime ownership transfers between retained root/detail models; inactive/disposed models cannot unsubscribe the foreground model's run. Main drafts stay in the retained view when navigating away.
- Added a branded chat welcome state and compact composer. Set window keyboard avoidance to `RESIZE` after content load, with a keyboard-area listener and teardown. No keyboard height is hard-coded.
- Progress reads the actual `/api/home` feed and recently closed tasks; retry, acknowledgment and connector decisions use typed requests behind confirmation. Library reads recent files and notes with independent failure states.
- Added workflow list/detail/cancel and automation-run detail/event views. Inbox judgments now use `/api/inbox/judgments`, not the note-detail endpoint; choices, snooze and dismiss require confirmation.
- Grouped connection, notifications, language, appearance and about settings; retained existing push and pairing behavior.
- Files and workspace editing now prompt before discarding changed content when navigating back.

### Evidence and limits

| Check | Result |
| --- | --- |
| Shared brand generator drift check | Passed, 3 assets |
| Harmony host tests | 69 passed across 16 files, including home route/action validation, partial failures, disposal and main/detail isolation |
| Debug HAP / ArkTS compilation | Passed; SDK API exception/capability warnings remain, so this is not a zero-warning compiler claim |
| Project CodeLinter configuration | Zero diagnostics |
| Pura 90 Pro API 26 emulator | Installed without clearing data; launched against existing paired Gateway |
| Runtime inspection | Four destinations; actual Progress data; Library loading; Chinese setting selection; native back from language/appearance; dark chat brand and colors; keyboard opening/closing |
| Screenshots | Local ignored `.test/parity-{progress,library,you-zh,chat-dark,keyboard}.jpeg`; these are not side-by-side parity approval |
| Mate 60 | No physical HDC target during this pass; updated UI has not been installed or accepted on the phone |

No test sent chat input, started/cancelled work, approved a connector, or submitted an Inbox decision to the paired Gateway. Opening the main chat may create the normal empty main conversation when none was saved. Simulator appearance/language changes are restored after checks.

### Remaining parity gates

1. Replace generic task/project/note/automation details with the reference domain-specific layouts, fields, menus and filters; finish automation/workflow result controls and rich artifacts.
2. Complete Inbox capture/organize/undo and exercise judgment success/failure flows against isolated test data.
3. Chat/dock/drawer follow-up is recorded in `chat-parity-checklist.md`: drawer, model/agent/context, palettes, persistent drafts, queues/clarifications and message actions are implemented with paired-emulator evidence. Realtime voice calls, full rich-message/attention/spotlight behavior and physical acceptance remain open; this is not a full-parity claim.
4. Add remaining reference settings routes (agents, voice, sharing, Gateway management and related screens). An absent route must not be represented as completed.
5. Run matched iOS/Android and Harmony screenshots plus interaction journeys for populated/empty/error/offline/loading states, long text, keyboard, light/dark and physical Mate 60. The modified unpaired UI smoke test has not been rerun on this paired simulator, to avoid resetting its data.

The avoid-area skill's FIX / AVOID-04 guidance drove the keyboard correction. Evidence currently covers a phone emulator in portrait with the system IME. Landscape, alternate IMEs, physical keyboard and foldable/tablet adaptation remain unverified; initialization failures log a bounded warning and retain system defaults rather than applying guessed offsets.
