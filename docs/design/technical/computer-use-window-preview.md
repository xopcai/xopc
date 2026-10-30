# Local Computer Use window preview

The chat transcript displays an ephemeral window preview for the active Computer
session. It supports compact view, an expanded dialog, hiding/pausing the preview,
retrying capture, and stopping control before handing the application back to the
user. Pixels are not persisted as messages or sent to the agent model.

## Implementation boundary

The implementation uses Electron 45's native desktop-capture backend rather than
adding another streaming ABI to Cua Driver. The existing Cua driver proves the
exact process and window identity. Electron selects only a source whose documented
`window:ID:0` identifier equals that native window ID/handle. No title matching,
desktop fallback, or current-process capture is permitted. The source format is
documented in [Electron's source contract](https://www.electronjs.org/docs/latest/api/structures/desktop-capturer-source).

The video track and JPEG encoding live in a private sandboxed, isolated,
nonpersistent BrowserWindow. Its static local document has a restrictive CSP and
no renderer Node integration. The private preload receives one host-selected
source, with audio disabled. Only that worker's main frame can obtain the
`display-capture` permission; other permissions and navigation are denied.

Offscreen rendering is enabled explicitly. A hidden ordinary BrowserWindow was
observed delivering only approximately one encoded frame per second even with
background throttling disabled. Offscreen rendering restored the configured
cadence without bringing the worker or target to the foreground.

## Authorization and ownership

`ComputerBroker.previewAuthority()` returns an internal view of the active
authorized session. It includes conversation/run/session identity, the broker
epoch, target identity and the session cancellation signal. It is never serialized
to the renderer. `validatePreview()` checks that the same grant is still active
and calls the driver's metadata-only `validatePreviewTarget()`.

`ComputerPreviewManager` derives an opaque preview ID and target epoch. A viewer
can subscribe only to the current conversation and optional run. The Electron IPC
entry points use the same main-window/main-frame guard as existing Computer IPC.
Neither the UI nor the media port accepts PID, native window ID, launch path or
input commands. The source ID is disclosed only to the private capture worker.

Target/session/run changes retire the old subscription. Each media restart also
increments a stream epoch; presentation accepts only matching target and stream
epochs and increasing frame sequences. A subscription-specific stop request is
validated again against the current session before calling Broker stop.

## Independent pipelines

```text
Authorized Broker session
  ├─ Cua input / explicit observations → agent
  └─ PreviewManager → native video track → OffscreenCanvas JPEG
                   → MessagePortMain → main preload → chat Canvas
```

Preview never calls `observe`, reads an AX tree, uploads a frame to the Gateway,
creates a model observation ID or modifies cached element tokens. Native target
proof runs before capture and every two seconds while streaming, independently
of the input queue. A target failure closes the preview; control remains subject
to its existing independent guards.

Compact mode requests a longest edge of 640 pixels and up to 8 fps. Expanded mode
requests 1280 pixels and up to 15 fps. Stable JPEG hashes reduce encoding checks
to 2 fps; the hash controls cadence only and never suppresses a changed frame on
the assumption of equality. No image bytes are kept in React/Zustand state.

## Backpressure and cleanup

The capture worker encodes one frame at a time and waits for an acknowledgement
before scheduling another. The host forwards a bounded binary payload (at most
2 MiB, dimensions at most 1600 per edge) to the viewer. Acknowledgement follows
decode/presentation. A stalled viewer stops capture after 1500 ms instead of
allowing an unbounded queue or retaining indefinitely stalled decode callbacks.

ArrayBuffer transfer lists are deliberately not used when sending pixels to the
main-side port. Electron's documented transfer list is for ports; real validation
of an ArrayBuffer transfer produced an empty frame envelope. Ordinary structured
clone of binary data works. See [MessagePortMain](https://www.electronjs.org/docs/latest/api/message-port-main).

Hiding the card, leaving the viewport or hiding the document pauses the capture
worker without stopping authorized control. The expanded dialog retains the same
subscription. Resume creates a fresh stream epoch. Cancellation also reaches a
backend still starting, so rapid pause/resume cannot leave an orphan worker.

Session revocation, stopping control, renderer disconnection, lock/suspend, and
host shutdown close the worker and ports. Renderer pixels are discarded on target
or conversation changes. Native capture failure produces an unavailable status,
never a silently substituted window or a stale frame marked live.

## Build and verification

The preload build emits `computer-preview.cjs` and `computer-preview.html` beside
the main preload. Local reproduction:

```sh
pnpm exec tsx scripts/verify-computer-preview-live.mts
```

The opt-in test creates and later terminates a disposable native fixture, uses the
checksum-verified local Cua driver, and exercises the actual main preload/IPC,
JPEG decode and canvas presentation. It verifies compact/expanded capture,
pause/unsubscribe, and concurrent batches of five inputs using independent native
state as the oracle. It does not control personal applications.

For reproducibility while another checkout task rebuilds the local candidate,
`XOPC_PREVIEW_DRIVER_SHA=<cached-sha256>` selects and verifies a previously built
candidate without changing the shared manifest. Evidence records the tested hash.

Fresh acceptance reports are written under `.cache/computer-preview-live/`.
This is local desktop preview. Remote media transport and Windows physical-device
acceptance remain separate work; the Windows adapter is implemented through
Electron's native window-handle capture but has not been certified on this Mac.
The small acceptance sample does not establish P95 latency or long-run memory/CPU
budgets. ScreenCaptureKit/Space transitions can still make native observation
unavailable; such failures stop the test without replaying input.
