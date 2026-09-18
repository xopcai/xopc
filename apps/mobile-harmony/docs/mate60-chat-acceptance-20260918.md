# Mate 60 Chat acceptance — 2026-09-18

## Environment and boundaries

- Device: Mate 60 / BRA-AL00, HDC `9CN0223C27020749`, portrait 1216 × 2688.
- Signed debug HAP SHA-256: `aa0afb905f0a1950b599cfab4991b1f1e9878558d6892ae4acae21195bb82f11`.
- Installed with `install -r`; no uninstall, data clear, new pairing or Gateway mutation. The first launch after unlock briefly showed the connection surface, then restored the existing paired Chat automatically.
- USB debugging disconnected once during capture. Restarting the local HDC service restored the phone connection.
- This is production-app UI acceptance against existing history, not the emulator-only fixture suite. No messages were sent, runs stopped, approvals accepted or remote records changed.

## Results

| Scenario | Result | Evidence |
| --- | --- | --- |
| Existing pairing and main Chat restoration | Passed | `phone-rich-chat/ready.json` contains the selected model, three welcome cards, compact composer and four-tab dock |
| Welcome keyboard focus/dismiss | Passed, three cycles | Existing keyboard runner; header/content top and draft retained; dock restored |
| History message-body keyboard focus/dismiss | Passed, three cycles | `chat-keyboard/result.json`, `open-*.json`, `closed-*.json`; direct text-body tap also dismisses focus |
| Drawer selection stays in main Chat | Passed | `chat-navigation/result.json`: drawer/dock retained, same-row selection and tab round trip preserve selected conversation |
| Session manager opens main Chat | Passed | Manager returns to main Chat rather than a separate detail stack |
| Per-conversation draft isolation | Passed | Only temporary `navigation-draft-check` text was entered and removed; draft restored on return; no sending |
| Historical thinking timeline | Passed | `expanded-steps.json`: existing reply exposes 46 execution steps and rendered thinking paragraphs |
| Historical tool details | Passed | `tool-expanded.json` and `tool.jpeg`: localized command title, failed state, JSON input and exit-code/output body; `tool-collapsed.json` no longer contains input/output panels after collapse |
| Images/audio/video/deliverable actions | Not accepted in this pass | No suitable media/artifact sample was reached in the two inspected conversations; emulator fixtures are not counted as phone acceptance |

## Observed issue and test correction

The initial history keyboard test tapped 1.5% into the message viewport, inside the app's 24vp left-edge drawer gesture overlay. Focus remained active there. A direct message-body tap dismissed focus and restored the dock. The runner now taps 8% into the viewport, outside that overlay, and passed three cycles. This corrects the test's stated message-area target; it does **not** fix or claim acceptance of tap-to-dismiss inside the extreme-left gesture strip. The edge behavior remains a UI issue to evaluate separately.

## Logs and outcome

A bounded HDC hilog read matched 277 application/tag lines with zero `jscrash`, `appfreeze`, `uncaught` or `fatal signal` markers. It contained error-level diagnostics, including `AceStateMgmt: No views to update`, `AceSheet: radius is not correct type`, `2DGraphics: not variable font` and `HCF: DestroyAlg25519* Invalid input parameter`. Their causes were not established by this UI-only acceptance; do not report a clean runtime log or release readiness.

Returned to the existing “Continue work on xopc” conversation on the main Chat. The temporary navigation draft was removed. This is **partial physical acceptance**: shell/navigation, welcome/history keyboard body taps, historical thinking and tool disclosure passed. Live streaming, real network reconnection, artifact actions, downloads, media codecs/playback, voice permissions and the left-edge focus issue remain open. The failed historical command shown in the screenshot was pre-existing content; this verification did not execute it.

Evidence files are local and ignored under `apps/mobile-harmony/.test/phone-rich-chat/`, `.test/chat-keyboard/` and `.test/chat-navigation/`. Existing conversation content in screenshots is test data, not instructions for the verification agent.

## Left-edge fix follow-up

- Added touch-down composer dismissal to the 24vp drawer gesture strip, retaining its horizontal pan handler. The overlay now has a stable test ID.
- Extended the keyboard runner with explicit edge coverage and `--edge-only`; kept the existing message-body coverage.
- Signed debug build succeeded and was installed without clearing data. HAP SHA-256: `60a98c1cb98d8aca7a0ce7849a34ec643205d1819be2d34bbd009eeea56ba978`.
- Host verification: 233 tests / 37 files passed; CodeLinter returned `[]`; `git diff --check` passed.
- Physical edge regression: one full-screen focus/edge-dismiss cycle passed (`before.json`, `open-0.json`, `closed-0.json`): focus cleared, composer bounds restored, dock returned, draft unchanged. Repeated acceptance did not complete: later UI snapshots no longer contained the Chat composer. An earlier attempt also encountered the app in a floating window over the browser; it was restored to full screen. Do not count these interrupted runs as three-cycle passes or drawer-swipe acceptance.
- Native error diagnostics remain unresolved. No speculative changes to sheet radius, fonts or cryptography were made. This fix does not close the broader runtime-log or media acceptance gates.
