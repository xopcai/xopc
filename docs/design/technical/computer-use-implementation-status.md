# Computer Use implementation ledger

Status: core macOS preview implemented, platform gateway deployed, and controlled native click/text/stop paths verified. This is not a claim of Codex-quality general desktop automation or completion of the RFC's multi-platform and real-application quality gates.

## Verified prerequisites (2026-09-16)

- Existing SSH deployment target reachable; platform installation present.
- Existing DASHSCOPE_API_KEY successfully called gui-plus-2026-02-26 with a synthetic PNG (HTTP 200). No personal screen was uploaded.
- Both repositories have unrelated user changes; preserve these throughout development and deployment.

## Delivery gates

- [x] Strict shared contracts, config inheritance, BYOK and managed model adapters
- [x] Main-process broker, private Cua driver, bounded native approvals and local Stop
- [x] Endpoint transport, ephemeral image handling and hidden internal tool
- [x] Agent single-step integration, real suspension and resume
- [x] Setup/status/control UI and packaged driver lifecycle
- [x] Platform GUI model routing, catalog, payload limits and tests
- [x] Adversarial unit tests, authenticated Gateway smoke and native fixture click E2E
- [x] Scoped platform deployment, rollback backup and live managed model verification

Use computer-use-architecture.md as the design baseline. Record evidence and deliberate scope changes here; do not mark mock tests as native or live validation.

## Deployment and evidence (2026-09-16)

- Production service: `xopc-model-gateway`, active root `/var/www/xopc-platform-releases/d61a802`. Only reviewed Computer Use gateway source/bundle changes were merged over the live baseline. No DB schema migration and no other service deployment.
- Backup: `/var/www/xopc-computer-deployments/computer-20260916111144893`. Includes original source/bundle, nginx configuration, activation manifest and scoped rollback manifest. The activation script restores these automatically on failed health checks. Do not restore the whole shared database when rolling back this feature.
- Nginx `/v1/` request limit is now 8 MiB. The application still enforces the previous smaller limit for ordinary language models.
- Managed route: `xopc-cloud/computer-gui-plus-preview` → Alibaba Beijing `gui-plus-2026-02-26`. Fixed one-target route, deployment fingerprint required, no automatic provider/key retry. Existing Alibaba credentials reused without printing or overwriting the key.
- Preview quota: 5 requests/minute, concurrency 1, 20 requests/day and 100,000 tokens/day per user. Existing platform/pool limits additionally apply. This is a free preview, not final commercial pricing.
- Actual platform-login request successfully grounded the synthetic Continue button. Missing deployment fingerprint was rejected with HTTP 409. No personal desktop screenshot was used in these cloud tests.
- Isolated production-baseline platform build: 26 test files / 202 tests passed, typecheck and bundle passed. This excludes concurrent local Voice changes; the separate local development baseline had 210 tests before the GUI integration test was added.
- xopc full Node/types/web build passed. Electron main/preload/server/extension builds passed. Signed macOS ARM64 directory package and nested Cua Driver passed `codesign --verify --deep --strict`. Apple notarization was not performed; do not publish this as a notarized release.
- Selected endpoint/computer/native-mock tests: 66 passed, three opt-in cloud cases skipped in the latest combined run. Embedded-agent plus contracts regression: 73 passed. A separate live run passed all 38 computer/driver tests, including three actual Alibaba button positions; managed routing was independently rechecked successfully.
- Real authenticated isolated Gateway: GET config exposes `computer`, global defaults PATCH/reload succeeded, signed main-process endpoint registered all seven tools. Existing user's main Gateway was not restarted.
- Real integration found and added fixes/regressions for: resolving a verified turn endpoint when no persistent binding exists; passing appConfig when resolving agent-scoped credentials; omitting undefined optional fields from canonical endpoint requests; accepting native app catalog entries with a null bundle identifier.
- Native session approval and persisted chat clarification/resume were exercised in the signed application. Setup now reports safe stage-specific error codes, never raw driver payloads.
- Native fixture acceptance at 19:42 CST: real Alibaba screenshot prediction → exact native action approval → one completed click receipt. An independent accessibility read of the fixture showed `PASS: Continue clicked`. The isolated conversation contained no image/data-URL transcript content. Receipt correctly remained `outcome:unknown`, `verification:visual`; the independent fixture assertion supplies the test's success evidence.
- Local settings Stop was exercised from a ready session: UI changed to `stopped` and both private driver processes exited. A synthetic global-hotkey attempt did not stop the driver, so the keyboard shortcut is not certified by this smoke test; settings Stop is the verified path.
- Native testing exposed Cua's application-menu siblings in a window AX response. The earlier synthetic run transmitted this extra menu metadata; it was not a personal desktop screenshot. Added a fail-closed window-subtree filter (including static outcome text), tests excluding menu/recent-item metadata, and explicit screenshot pid/window/frame validation. Signed-package retest returned the `PASS` static text, no menu/recent-item metadata, and a 1,372-character scoped summary.
- Raw hosted-model tests did expose malformed action JSON (including a missing coordinate-array bracket). The parser still rejects it without repairing or executing it. The single-step policy now permits at most one same-recipient/same-image format re-prediction before dispatch, counts both attempts, and never retries HTTP errors, truncated responses or native actions. GUI sampling uses temperature 0 and presence penalty 0. Three-position hosted tests passed with this bounded policy; this small sample is not a general quality benchmark.
- The initial failed preview provisioning left an empty dedicated provider. After verifying that it had zero keys and zero models, disabled only that unused connection; the published service continues to use the existing healthy Alibaba provider.
- Final signed package at 19:59 CST: open → observe → native `setValue(e2)` approval → held-action `step` resume → observed exact text `Computer Use verified` → close. Independent accessibility read confirmed the actual field value. No tool errors, menu metadata or screenshot content appeared in that final conversation. Control close removed both private driver processes; it deliberately leaves the target application open.
- After verification, the isolated desktop and port-18796 Gateway were stopped. The user's existing main Gateway was left running. Local sources remain uncommitted; unrelated concurrent work was preserved.

## Deliberate preview boundaries

- macOS, one explicitly selected running application/window; Windows/Linux execution is not certified. The driver interface remains extensible.
- Native session approval and exact per-action approvals; no unattended desktop automation. Main-window hide/minimize, lock, suspend, endpoint disconnect and explicit Stop revoke control.
- In-memory leases/receipts/frames deliberately replace the RFC's proposed persistent computer tables for this preview. Restart fails closed; no input replay. Existing endpoint audit records retain metadata, not screenshots.
- Screenshot frame blobs are bounded, fully decoded/validated, invocation-bound, single-consumer and expire after 120 seconds. They are not downloadable through generic attachment routes and are not appended to chat transcripts.
- A model's `terminate(success)` remains `verified:false`. There is no general business-semantic verifier yet. Screenshots changing and input acknowledgements are not treated as task success.
- Exact snapshot freshness comparison is intentionally conservative; animated/caret-heavy windows may need a fresh observation and renewed approval.
- UI exposes configuration, permission state, connection state, Stop and explicit native principal re-enrollment, but not a remote screenshot viewer. Remote Gateway desktop pairing remains outside the preview; re-enrollment has automated regression coverage but has not yet been re-certified in a signed native smoke test.
- BYOK uses existing credential storage, custom model profiles and a frozen HTTPS recipient. Managed deployments pin the disclosed Alibaba upstream. No self-hosted model inference.
- The RFC's 60-task real-application evaluation, paired Codex benchmark, Chinese IME/native multi-platform matrix, and beta success-rate/stop-latency gates have not been completed. Planning-model mistakes occurred during integration; fixture success must not be advertised as general task reliability.

## Review fixes (2026-09-16)

- Normalized request headers use `Headers.set`, so BYOK provider `authHeader` configuration cannot duplicate bearer credentials. Conflicting credentials remain rejected.
- Direct and predicted actions share one budget reservation before dispatch. Repeated pending-action resumes do not consume extra slots; exhausted budgets close the lease.
- A revoked principal stops reconnect attempts and clears its claim. Settings exposes re-enrollment via main-frame-only IPC and a native, cancel-by-default confirmation. Only consent rotates the encrypted identity atomically; cancellation, hidden UI and shutdown do not rotate it. Reconnect handshakes recheck revocation as well.
- Computer/driver/endpoint/settings regressions: 80 passed, 3 opt-in cloud tests skipped. Root and Web typechecks, Web production build and Electron main/preload build passed. No cloud inference, production deployment or real-device revocation was performed for these fixes.
- An additional standalone Electron TypeScript scan (outside the repository's configured typecheck) reports existing errors in `temporary-preview-file.ts`, `remove-user-data-dirs.ts`, and declaration resolution for logger/semver; these unrelated files were not changed.

## Reproduction

### Unified model configuration, staged implementation (2026-09-16)

1. **Model policy and validation.** Added one compatibility predicate shared by the model API, runtime, readiness, reference audit and configuration checks. Removed chat-model inheritance and rejected nonempty GUI fallback routes. Self-review added regression tests for missing selection, explicit agent overrides, withdrawn bindings and GUI actors being treated as ordinary vision models. Phase check: 57 tests passed, three opt-in inference tests skipped; root typecheck passed.
2. **Shared settings UI.** Both Models and Computer use now mount the same selector/editor against `agents.defaults.models.computerUse`. Added a capability status card, provider-list capability filter/labels, advanced custom-model protocol selection and stable-height model dialogs. Removed the old free-text GUI editor and hardcoded candidate hints. Self-review separated unselected/configured model states from native access, preserved unrelated defaults on save, and verified both Cloud/BYOK selections and clearing across simultaneous editors. Focused component/picker tests: 11 passed; Web typecheck and scoped ESLint passed.
3. **Integration and final review.** Excluded GUI actors from generic recommendations/replacement suggestions and validated custom model API/image compatibility. Final selected xopc regressions: 128 passed, three opt-in inference tests skipped. Existing platform GUI/app suites: 87 passed. Root/Web typechecks, Node/Web builds and Electron server bundle passed. Node build used `--no-clean` to preserve existing release packages.

An authenticated source-backed Gateway on isolated port 18807 verified real lazy routing: unauthenticated model requests return 401; GUI selection returns 200 and configured readiness; vision-only and fallback bindings return 400 without replacing the saved binding; clearing removes the selection without changing chat defaults. Real browser tests selected a GUI model, checked its binding on the other settings route, excluded an ordinary vision model from candidates and found no page errors or horizontal overflow at 390 pixels. Chinese/dark custom-model editing retained a 720-pixel dialog height when Advanced expanded; the Chinese mobile control page was visually inspected. The isolated Gateway was stopped and its temporary model binding was restored after verification; the user's running Gateway and configured model binding were not changed.

The existing platform login successfully read the live 34-model catalog and found `xopc-cloud/computer-gui-plus-preview` with its supported GUI-Plus profile and image input. No hosted inference or personal desktop capture was requested. The platform already publishes the required metadata and fixed deployment contract, so no new platform endpoint, duplicate model store, credential store or production deployment was needed. These checks do not replace native-control or model-quality certification.

### Dedicated settings page (2026-09-16)

- Setup now lives at Settings → Integrations → Computer use (`#/settings/computer-use`), with sidebar navigation and command-palette discovery. Browser control retains its existing settings page.
- The page exposes only implemented controls: desktop enablement, macOS permission requests, device/session status, conditional native re-enrollment, emergency Stop, and the dedicated GUI model using existing BYOK/Cloud connections. It does not introduce Excel integration, per-app allowlists or unattended/locked-use controls.
- Existing native approvals remain mandatory. Stop stays available while configuration loads or another settings action is pending. Browser and unsupported desktop platforms cannot grant local control.
- Six focused test files / 31 tests passed, including model-only updates preserving fresh global defaults, invalid model input, native status failure, permission actions and Stop during a pending request. Web typecheck, focused ESLint and production build passed. Isolated browser rendering checked light/dark layouts and a 390-pixel viewport with mocked configuration/native status; no horizontal overflow or page errors. This was not a live native-control or hosted-model retest.

### Commands

```sh
pnpm run computer:driver:setup
pnpm exec vitest run src/computer/__tests__ electron/computer/__tests__ src/endpoint-tools/__tests__
XOPC_COMPUTER_LIVE_TEST=1 pnpm exec vitest run src/computer/__tests__/model-live.test.ts
node --import tsx scripts/verify-managed-computer.mts
```

The live managed test uses the existing platform login and synthetic pixels only. `scripts/computer-fixture.swift` supplies a disposable native target. Never disable the broker's approvals to make a smoke test pass.
