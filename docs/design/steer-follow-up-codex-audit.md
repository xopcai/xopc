# Steer / follow-up interaction audit

Date: 2026-11-02

## Scope and reference

Reviewed the gateway console (including the Electron renderer), input coordinator,
embedded steering, browser extension, and native mobile send/queue entry points.
Native mobile observations are source review, not device acceptance.

Official reference:

- [Prompting: steering and queuing](https://learn.chatgpt.com/docs/prompting)
  distinguishes adding guidance to the current run from saving a message for the
  next run. Desktop supports a default follow-up behavior and a shortcut to use
  the other behavior for one message. Queued messages support edit, reorder,
  send, and delete above the composer.
- [Desktop settings](https://learn.chatgpt.com/docs/reference/settings) documents
  follow-up behavior and configurable Enter submission.
- The Enter-to-steer / Tab-to-queue mapping in the prompting documentation is
  explicitly for Codex CLI. Do not apply it to the desktop app without evidence.

The exact current desktop alternate shortcut is not specified by these pages.
Computer Use refused access to `com.openai.codex`; no desktop shortcut or visual
parity is claimed from direct inspection. The mappings below describe xopc.

## Required product exception

**Keep Personal mode's default follow-up interrupt behavior.** This was explicitly
confirmed by the user during this audit. A default Personal follow-up requests
priority execution, stopping the active reply when permitted by the runtime.
Explicit defer and cooperative steer remain distinct actions. Do not replace this
with queue-by-default or steer-by-default when aligning other interactions.

Source: `web/src/features/chat/composer/use-composer-actions.ts`,
`src/gateway/service/agent-runner.ts`,
`src/gateway/service/session-input-coordinator.ts`.

## Current keyboard contract

| Context | Enter | Alt+Enter | Cmd/Ctrl+Enter | Shift+Enter | Escape |
| --- | --- | --- | --- | --- | --- |
| Standard active run | Queue follow-up | Cooperative steer draft | Steer first queued message, otherwise draft | Newline | No global stop binding here |
| Personal active run | Priority follow-up / interrupt | Cooperative steer draft | Steer first queued message, otherwise draft | Newline | No global stop binding here |
| Idle | Send | Ignored | Ignored | Newline | Dismiss empty suggestion |
| Editing queued input | Save edit | Ignored | Ignored | Newline | Cancel edit |
| Editing latest user turn | Submit replacement when permitted | Ignored | Ignored | Newline | Cancel edit |

Cmd/Ctrl+Enter follows the user's explicitly requested queue-first contract. It
preserves any draft when steering an existing row, including rows with attachments
and references. Key repeat does not steer additional rows. This
shortcut takes precedence over pickers while a run is active, outside edit mode.
Stop-and-send remains an explicit button/menu action without this shortcut.

Picker handling has precedence over normal submission; empty-state suggestions
accept Tab/Enter when eligible. Tab otherwise keeps browser focus navigation.
IME events now bypass all composer shortcuts and picker handling, including the
keyCode 229 fallback. Blocked/stopping states are also guarded by composer actions.

## Fixed during this audit

1. **Lost drafts on stop-and-send rejection.** The page previously discarded the
   submission promise, and `interruptDraft` cleared the editor before acceptance.
   The promise now reaches the action; rejection or a no-op retains text,
   attachments, and references. Late acceptance cannot clear a newer draft,
   another conversation, or an edit. Repeated interrupt submissions are guarded.
2. **IME shortcuts ran before composition checks.** Picker dispatch, history,
   Escape, and Shift+Enter could act on IME input. A guard now runs before all
   keyboard actions using composition state, native isComposing, and keyCode 229.
3. **Incorrect shortcut reference.** Settings previously described Cmd/Ctrl+Enter
   as force-send in edit mode even though edit mode ignores it, and omitted
   Alt+Enter. Both English and Chinese descriptions now match the implementation.
4. **Personal action labels implied queuing.** The primary active-run action was
   labeled as queueing even though its default requests interruption. Its label
   and composer placeholder now explain the retained Personal behavior.
5. **Cmd/Ctrl+Enter stopped the run.** It now cooperatively steers the first queued
   message, even with an empty composer. When the queue is empty, it steers the
   draft. Settings and both language bundles describe this mapping.
6. **Rich messages could not steer.** Drafts and queued messages now support
   attachments, references, and messages containing only these. The gateway sends
   frozen source text and images through the existing attachment pipeline. Image
   bytes are restored into model requests after authoritative transcript reload;
   persisted messages retain media references and source metadata. Automatic
   device/application context still requires the active endpoint identity.
7. **Steer entry points share one action.** Per the user's final toolbar preference,
   standalone steer and queue icons are omitted from the input toolbar; keyboard
   submission remains available. The Personal overflow menu includes steer even
   with an empty draft. The menu and Cmd/Ctrl+Enter share `steerCurrentReply` in the
   composer action hook: queue first, otherwise draft, with edit, voice, blocked,
   idle, and pending-steer guards. Personal's primary interrupting action remains.

## Remaining alignment work

| Priority | Finding | Required outcome |
| --- | --- | --- |
| P1 | Standard composer has a fixed queue default; desktop follow-up behavior is not configurable. | Add a persistent standard-mode Queue/Steer preference and a one-message alternate action. Preserve Personal's explicit exception. Verify the actual desktop shortcut before choosing the mapping. |
| P1 | Busy slash-palette commands clear the editor and references immediately without awaiting `onAddPendingFollowUp`. | Retain the draft on rejection and protect newer drafts on late acceptance, matching normal follow-up submission. See `palette-item-handlers.ts`. |
| P2 | Current runtime steering uses pi `session.steer`; dispatcher documents delivery after tool work and before a subsequent LLM call. | Do not describe it as immediate interruption of generation. Verify behavior during model streaming, tool calls, and turn completion against the chosen Codex baseline. |
| P2 | Browser extension handles Cmd/Ctrl+Enter as abort then send, but does not provide the web draft's Alt+Enter steer action. | Share the send intent contract and surface the same named actions. Keep extension tab references intact. |
| P2 | iOS has explicit next/steer send paths, but `QueuedInputsCard` exposes only edit/cancel. | Add queue reorder and send/steer controls with version checks and consistent disabled states. |
| P2 | Harmony has an explicit `send('steer')` control and separate queue sheet; full keyboard and queue parity is not established. | Verify external keyboard handling, queue control, composition, and failure recovery on device. |
| P2 | Android's inspected conversation submission paths hard-code `delivery: next`. | Expose an explicit delivery intent and corresponding steer UI before claiming mobile parity. |
| P2 | The web composer supports Shift+Enter but lacks the desktop's configurable Enter submission policy. | If send-key preferences are included in parity, keep them separate from follow-up delivery and test their combined behavior. |

## Existing behavior to retain

- Queue rows are durable gateway inputs, not only renderer state.
- Queue edit, deletion, drag/keyboard reordering, and explicit steer/send use row
  identity and versions. Editing pauses the queue through the control protocol.
- Cooperative steer targets a captured run ID; a stale request must not steer a
  later run. Ambiguous delivery is retained for recovery instead of blind replay.
- A new steer request that cannot reach the captured run falls back to next
  delivery; explicit row-steer failure is represented as interrupted/retry.
- Stop, queue pause, queue resume, and stopping confirmation are separate states.
- Personal explicit defer passes `interrupt: false`; cooperative steer additionally
  passes `delivery: steer`. The default interrupt behavior stays intact.

## Acceptance matrix for completing parity

Exercise button, keyboard, and menu submission for idle, model streaming, tool
execution, stopping, paused queue, edit-follow-up, edit-latest-turn, and reconnect.
For each, include plain text, attachment-only, reference-only, rich text,
IME confirmation, key repeat, and network failure. Verify accepted input identity,
effective delivery, draft preservation, FIFO ordering, and no duplicate turn.

Repeat with a conversation switch during acceptance, concurrent queue changes from
another device, completion racing with steer, and a run replacing the captured
target. Confirm Personal default still interrupts while explicit defer waits and
explicit steer does not abort the active run.

Initial verification: 9 test files / 101 tests passed, covering the web composer and queue
controls plus gateway input-coordinator/control tests. Web TypeScript checking,
lint of the changed production TypeScript files, and `git diff --check` passed.
Rich-steering follow-up verification: 9 files / 130 tests passed, including the
real AgentSession against a local HTTP model fixture, verifying file references,
two images in the provider request, and metadata-only SQLite persistence. Core
and web TypeScript checks passed. This does not establish live Codex desktop,
external-provider, browser extension, or native device parity.
