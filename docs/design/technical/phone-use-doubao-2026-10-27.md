# Doubao Phone Use live verification — 2026-10-27

Final acceptance: **both local BYOK and managed Cloud passed real Android tasks**
through an authenticated Gateway. Evidence is retained outside the repository in
`~/.xopc/reports/phone-use-doubao-2026-10-27/`.

## Configured paths

- Local BYOK: `volcengine-ark/doubao-seed-2-1-pro-260915`, using the Ark
  `https://ark.cn-beijing.volces.com/api/v3` endpoint and
  `doubao-seed-phone-v1` protocol. The key is stored in the Gateway credential
  system. This is the configured global Phone Use primary, with no fallback.
- Managed Cloud: `xopc-cloud/phone-doubao`, published in xopc-platform with one
  fixed Ark target, an encrypted provider key, and the same native protocol.
  Existing `xopc-cloud/phone` remains AutoGLM.
- The independent Cloud product inherits the existing `phone` pricing/access
  policy. Its new upstream pool is bounded to 10 requests/minute,
  50 requests/day and 200,000 tokens/day. Review these preview limits before
  broader use; provider catalog price placeholders do not imply free inference.

## Live results

Ark initially returned `ModelNotOpen`. The console subsequently showed Seed Pro
activated and the direct API returned HTTP 200. No credential appears in this
report or repository configuration.

Both model references passed `POST /api/phone/models/diagnostics` through the
running authenticated local Gateway: HTTP 200, `protocolValid=true`,
`groundingVerified=true`, `deviceActions=0`. These requests sent generated
screenshots to the actual selected provider, parsed its native click protocol,
and checked that the coordinates fell inside the visible test button.

The cloud publication probe also grounded a click in its generated 800×600 test
image. A subsequent public Cloud Chat Completions request returned HTTP 200 and
a native click at normalized `[500, 482]`, inside the button. The first Gateway
Cloud diagnostic returned HTTP 503; the subsequent direct request and Gateway
diagnostic both passed. This report does not establish sustained availability.

The local Cloud login had expired. Browser authorization restored the existing
client connection, and catalog refresh returned `phone-doubao` with
`doubao-seed-phone-v1`. Local model registry reload was needed before its
diagnostic passed. Reconnecting Cloud preserved the explicit BYOK primary.

The model-gateway deployment passed its local and public health checks. A
separate-port canary established that cold startup on this host takes about
44 seconds; deployment readiness now permits 90 seconds and preserves rollback.

## Observer and Cloud admission fixes

The initial real-device trial failed before inference with `PHONE_UI_UNAVAILABLE`.
A two-owner reproduction established that closing a cloud ADB socket could leave
the resident `PhoneUiDump` process alive, retaining Android accessibility ownership.
The helper now accepts an explicit `close` command. Local and cloud transports
send that command, wait for process exit with a bounded grace period, then close
their transport. The embedded DEX was rebuilt from the Java source.

Temporary Gateway previews release their observer before their device lease, on
success and failure. The acceptance harness also releases its independent reader
before Gateway control and drains the Gateway operation before independent UI
inspection. No other automation owner is killed. Two consecutive real-device
observer cycles and a cancelled pending snapshot all confirmed remote process exit.

The first Cloud real-screenshot request exposed a separate admission bug: new
native phone profiles used ordinary byte-based text token estimation. The Cloud
gateway now applies its existing bounded 20,480-token Phone Use screenshot budget
to all supported phone profiles. Doubao and GUI-Owl regression tests use images
larger than 1 MB through authenticated free-tier inference routes. Existing quota,
pricing, fixed routing and single-attempt rules are preserved. The scoped server
deployment and its public health check passed.

## Real-device acceptance

Device: registered Aliyun Android test phone, model `SM-F900F`. Each trial starts
from Android Settings, then asks the selected model to navigate to Display and
make the Font size and Display size options visible without changing settings.

| Model path | Model requests | Native actions | Result |
|---|---:|---:|---|
| `volcengine-ark/doubao-seed-2-1-pro-260915` | 2 | 2 | completed, verified |
| `xopc-cloud/phone-doubao` | 2 | 2 | completed, verified |

Both runs reached `condition_satisfied`. An independent native UI read checked
the app, target text and bounds inside the screen; screenshot inspection confirmed
the Display page with both options. Sampled brightness, brightness mode, screen
timeout and font scale stayed unchanged. Cloud reconnect preserved the selected
independent model in the isolated catalog. Temporary Gateway state was removed.
The live local Gateway retains the BYOK primary and has no running test task.

Evidence files: `result.json`, `trial-1.png` (BYOK), `trial-2.png` (Cloud), and
`observer-lifecycle.json`. Reproduce against the registered test device with:

```sh
XOPC_PHONE_REAL_MODEL=1 \
XOPC_PHONE_MODEL_REFS=volcengine-ark/doubao-seed-2-1-pro-260915,xopc-cloud/phone-doubao \
XOPC_PHONE_EVIDENCE=/tmp/xopc-doubao-phone-check \
node --import tsx scripts/verify-phone-cloud-e2e.mts
```

Validation: 507 phone unit tests passed (one skipped), root and Electron
typechecks passed, and the Node build passed. The prepared Cloud release passed
309 gateway tests (one skipped), typechecking and build; its deployment health
checks passed. The scope of real-device acceptance is Settings navigation and
observer ownership handoff.

GUI-Owl remains available as a BYOK preset and platform provider specification,
but no ModelScope token was supplied, so it has no live verification here.
