# Electron workspace acceptance — 2026-10-18

后续 Apple 公证已完成：应用与 DMG 均 Accepted，真实下载隔离、首次安装/启动与 Gatekeeper 通过，详见 [公证验收记录](./electron-notarization-acceptance-2026-10-18.md)。下文保留当时打包验收的历史状态和原始哈希。

后续安装包验收：见 [Electron 打包后验收记录](./electron-packaged-acceptance-2026-10-18.md)，最终 DMG 的 84 项原生检查全部通过。

## Scope and environment

macOS, Electron 42.4.1, native WebContentsView, production preload and browser/file/terminal IPC modules, current React UI, real authenticated isolated Gateway, real node-pty shell, and deterministic local streaming model. This tests the workspace feature in Electron; it is not a signed installer/package smoke test.

The fixture uses a temporary state/workspace and a local-only model. The launcher copies the installed Electron runtime into a dedicated temporary application with a fresh bundle identity and ad-hoc signature. The user's application, Gateway configuration and workspace are not modified.

## Verification blockers fixed

- Enabled renderer accessibility explicitly in the acceptance host. The screenshot could render correctly while native accessibility exposed only an empty container; old generic Electron identities also made window selection ambiguous. A dedicated bundle identity, stable title and `force-renderer-accessibility` make native controls and screenshots reliable.
- Registered the real production terminal IPC and Gateway connection in the acceptance host. Previous browser-only hosts could not validate PTY behavior.
- Removed the test's ignored ScreenCaptureKit failures: a failed UI action now fails the test.
- Fixed native test locators for descriptive button names, scoped browser Retry to its workspace, and waited for Radix's asynchronous close-focus callback in the header regression test.
- Preserved relative framework symlinks when copying the runtime, so the temporary macOS app can be signed and launched reproducibly.

## Product fix found during E2E

Opening Terminal before the first message on an unconfigured draft submitted an empty model to the materialization endpoint. The Gateway rejected it as `Invalid session command`, while the saved pending materialization could prevent selecting a model.

`SessionManager.materialize` now checks the model before creating/saving the pending command. The user sees a localized actionable error and the draft stays editable. The terminal error panel adds **Retry terminal** so selecting a model can recover in place without closing the panel or creating another terminal tab. Regression tests verify no request/pending command is written on failure and that model selection followed by retry succeeds.

## Test coverage

- Browser suite: 28 native checks. Address navigation, back/forward/form restoration, real reload, stop, multiple tabs, popup-to-tab, independent form state, failure/recovery, beforeunload stay/leave, denied site permissions, Cmd+L, explicit search consent, unsupported protocols, expansion/collapse and retained native pages.
- Desktop suite: 33 native checks. Exactly three outer entries; search focus/results; existing share review/focus restoration; context/environment; four desktop Tools cards; Plus deduplication; actual shell output; PTY state after hide/reopen; multiple terminal tabs; file saves; Sidechat/browser/file/terminal coexistence; traced terminal open/close; repeated mixed tab switching; compact/narrow layouts; tree overlay/native occlusion; browser crash/reload.
- Supplemental native checks: JSON, SVG zoom/rotate, file reference without sending, main draft preservation, tab-list keyboard navigation, and actual native file download with verified bytes.
- New-draft suite: separate Tools/tab ownership, no old-page leakage, actionable missing-model preflight, editable model selection, in-place Retry, shell execution before the first message, and restored main/browser drafts after switching conversations.
- Related regression suite: 98 tests across 16 files passed. Web TypeScript/build and ESLint passed. Full web regression: 2,605 tests passed; one existing failure at `message-list-visibility.test.tsx:103` (also reproduced on the unchanged baseline).
- Animation hook regression includes interrupted close/reopen, retained controllers, compositor-only pane/tab properties and reduced motion.

## Reproduction

Run each long-lived process in its own terminal, from the repository root:

```sh
# Set XOPC_E2E_UNCONFIGURED_DEFAULT=1 to exercise the missing-model recovery case.
XOPC_E2E_UNCONFIGURED_DEFAULT=1 node scripts/workspace-e2e-server.mjs
node scripts/browser-e2e-site.mjs
pnpm run electron:vite:build:package
node scripts/build-browser-e2e.mjs
node scripts/start-workspace-desktop-e2e.mjs
```

Read `/tmp/xopc-workspace-desktop-e2e.json` and bind its exact `application` with CUA. Use the site URL from `/tmp/xopc-browser-site.json`. All UI input must go through CUA:

1. Iterate `runNativeBrowserE2e(app, site)` from `scripts/browser-e2e-cua.mjs` through completion.
2. Iterate `runNativeWorkspaceExtras(app)` from `scripts/workspace-desktop-e2e-cua.mjs` through completion.
3. Run `runNativeNewSessionTerminal(app)` from that module.
4. Run `node scripts/analyze-workspace-transition-trace.mjs` to summarize the trace saved by the native Acceptance menu.

Keep the Mac unlocked during desktop acceptance. A locked screen is a test interruption, never a passing result. Save each completed result array and the final screenshot before quitting the temporary application; quitting also terminates its PTYs.

## Final result

All **70 native checks passed on the final code**: 28 browser checks, 33 desktop checks and 9 new-draft checks. After manual unlock, the remaining 14 motion/layout/crash checks and all 9 new-draft checks completed successfully. Missing-model preflight and in-place terminal retry were verified through the native UI, including real shell execution before the first message. Supplemental checks are recorded separately and excluded from the 70-check count.

The native transition trace covered terminal opening/closing, repeated mixed-tab switching and pane expansion/restoration. Across 6,716 renderer tasks, p95 duration was 1.342 ms, maximum 25.564 ms and no task exceeded 50 ms. Animation-frame callbacks had p95 0.946 ms; Layout p95 0.286 ms; Paint p95 0.202 ms. These are sampled timings, not a guaranteed frame rate or proof of zero dropped frames.

Final-code artifacts:

- `/tmp/xopc-acceptance-final-progress.json`: completed aggregate, 70 passed, no pending checks.
- `/tmp/xopc-acceptance-browser-results.json`: 28 browser checks.
- `/tmp/xopc-acceptance-desktop-results.json`: 33 desktop checks.
- `/tmp/xopc-acceptance-motion-results.json`: resumed 14-check motion/layout/crash segment.
- `/tmp/xopc-acceptance-new-session-results.json`: 9 new-draft checks.
- `/tmp/xopc-workspace-transition-trace.json` and `/tmp/xopc-workspace-transition-metrics.json`: native timing evidence.
- `/tmp/xopc-acceptance-native-final.png`: final native screenshot.
- `/tmp/xopc-acceptance-regression.log`, `/tmp/xopc-acceptance-web-build.log`, `/tmp/xopc-acceptance-lint.log`, `/tmp/xopc-acceptance-types.log`: passing targeted checks.
- `/tmp/xopc-acceptance-full-web.log` and `/tmp/xopc-acceptance-baseline.log`: full-suite result and reproduction of the same unrelated failure on unchanged HEAD.

Acceptance covers the Electron workspace feature with production preload/IPC and a real isolated Gateway. Signed installer and full production startup acceptance remain outside this run.
