# Recent mobile changes: physical-device verification — 2026-11-19

Scope agreed with the user: the latest five mobile feature commits, rather than the latest GitHub PR numbers. This is targeted regression evidence, not full release acceptance.

## Environment and results

- Physical Huawei phone, model `BRA-AL00`, reporting API 26; existing pairing and application data preserved.
- Locally built, signed and signature-verified `ai.xopc.xopc` 0.1.37, including the capability navigation fix below, installed with HDC replacement installation.
- HDC UI operations, native UI trees and screenshots used because DevEco MCP was unavailable.

| Commit | Device coverage | Result |
| --- | --- | --- |
| `ff84786a9` — next-turn suggestions | Authenticated ready response displayed in the empty composer; tapping filled an editable draft without sending; shown/accepted feedback persisted; draft cleared afterward | Passed with a controlled suggestion cached only for the regression conversation. The live predictor returned `none`; live prediction quality is not certified. |
| `7bdf6f988` — read-aloud | Real Gateway speech synthesis and native playback state; completion waits for the next reply; a subsequent real model response auto-plays; pause, resume and stop | Passed. No acoustic fidelity or lock-screen acceptance claim. |
| `2401d4597` — message interaction and capability UI | Assistant context menu, inline text selection, select-all, native copy/paste into an unsent draft, and native share-sheet handoff; capability categories and expert settings | Navigation defect reproduced and fixed; three origin-category journeys passed after reinstalling. No external share recipient was selected. |
| `3e5ac8be2` — chat/file simplification | Header has no new-chat button; sidebar still opens a new chat; existing Markdown attachment opens in the native preview without a file-version action | Passed; existing files were not edited. |
| `9e9a01285` — expert chat and task retry | Expert entry created a `coder` conversation and returned `EXPERT_OK`; retry confirmation on a dedicated failed-task fixture created one new attempt linked to the failed run, then succeeded with `HARMONY_RETRY_OK` | Passed after restarting the stale Gateway process. Existing user tasks were not retried. |

The Gateway had been running since before the task-retry route was added. Its cached route registry returned 404 for the new endpoint. After checking that no conversations were running, the authenticated process-restart endpoint launched a fresh Gateway; the phone reconnected and the same retry journey succeeded. This required no route-source change.

## Capability settings defect and fix

- **Trigger:** Enter Capabilities on Connections, Plugins or Channels, switch to Agents, then open the coding expert's settings.
- **Before:** Opening the sheet reapplied the original Swiper index, changed the active category, and requested the wrong category's panel. From Connections, the expert sheet incorrectly showed “Set up connection”.
- **Cause:** `CapabilitiesView.ets` bound `.index()` to a plain `initialIndex` that was never updated by `commitPage()`. Updating `.disableSwipe(this.detailOpen)` reapplied that stale index.
- **Fix:** Bind the Swiper index to the current observed `category`, including restoration on entry. Opening and closing the sheet now retain Agents and its name/description fields.
- **Regression:** `scripts/verify-capability-settings.mts` re-enters each of the three origin categories before switching to Agents, opens the expert settings without saving, verifies its fields and category, and closes it. It performs no Gateway mutations.

Run against a paired phone on main Chat or Capabilities, with the bundled coding expert enabled:

```sh
HDC_PATH=/absolute/path/to/hdc pnpm exec tsx apps/mobile-harmony/scripts/verify-capability-settings.mts DEVICE_ID
```

## Supporting checks

- Debug HAP compilation, local signing, signature verification and device installation passed.
- Harmony host suite: **135 files, 889 tests passed**.
- Related backend suggestion HTTP/service and lazy-route tests: **3 files, 93 tests passed**.
- CodeLinter: **zero errors or warnings**; existing startup-icon size suggestions remain, including copies under ignored historical test projects.
- App-process error-level hilog snapshot after the fixed installation contained no entries.
- Raw device evidence remains local in repository-root `.test/harmony-recent-mobile-20261119/`; the reusable regression runner writes `apps/mobile-harmony/.test/capability-settings/`.
- The dedicated task and three regression conversations were deleted through authenticated Gateway APIs and verified absent. The previous user conversation and remembered Connections category were restored, with an empty composer.

## Header navigation follow-up

The capability categories now use the same `XopcPageTitleMenu` as the workbench, showing the active category in the header instead of a separate segmented strip. The workbench owns one fixed header outside its Swiper; progress, task and project children render only their main content. The Swiper index follows the current selection so returning from a create screen does not reset the selected work page. Project search remains controlled from the shared header, with its query cleared when search closes.

Physical-device acceptance passed for all five capability categories, dropdown selection, content swipes, header-only swipes, expert settings, progress/task/project swipes, project search and close, task/project create cancellation, and return to the original chat. Screenshots captured during the swipe show the header staying in place while the content moves. No messages were sent or records saved. Debug compilation, signature verification, replacement installation, 889 Harmony host tests and CodeLinter's error/warning checks passed. Local evidence: repository-root `.test/harmony-header-navigation-20261119/`.

The nine main interaction checks and all three origin-category expert-settings journeys passed with the updated dropdown UI.

The final hilog snapshot contains 14 platform NETSTACK reporting/HCF key-destruction diagnostics; no UI exception or application crash was observed during these journeys.

## Library swipe follow-up

The library now supports horizontal paging in the existing order **All files → Favorites → Trash**, synchronized with its header dropdown. The header and shared search/type controls stay outside the pager. Each scope owns its item list, cursor and loading/error state; requests capture that scope's state and retain the existing request-generation guard against stale responses. Opening a preview disables paging underneath it.

Device testing caught an initialization issue when re-entering on Trash: a computed active-page lookup still referenced the initial page during lifecycle work, leaving the visible page loading. Requests now resolve the current scope directly, without relying on the computed UI index. A fresh installation confirmed Trash loads correctly after that fix.

Local evidence and the native regression runner are in repository-root `.test/harmony-library-swipe-20261119/`. Debug compilation, signing, signature verification and installation passed. CodeLinter reported no errors or warnings. The host suite passed 888/889 tests; the remaining color-hierarchy assertion points to an existing `Divider()` in the independently modified `DeviceConnectionsView.ets`, which this change does not edit.

After the initialization fix, all **10 physical-device journeys passed**: both swipe directions and endpoint boundaries, fixed header, synchronized dropdown, search reset, type filtering, preview isolation, Trash restoration, Favorites restoration, and return to Chat. Visible rows were checked against authenticated list API results for the selected scope/type. File contents and records were not modified; the original All files preference was restored.

## Preview reading and overflow-menu follow-up

The shared Markdown, plain-text and extracted-text preview scroll containers now align their contents to the top; plain text also explicitly fills the available width and uses start alignment. The user's short “今天AI新闻HTML简报” Markdown preview was reproduced on the physical phone: the first paragraph now starts at the scroll container's top rather than in the middle of the sheet.

Following the user's design discussion, the library preview has no fixed bottom action bar. Its existing top-right overflow menu now starts with **用此文件提问 / Ask about this file**, followed by an available source action labeled **查看来源任务 / View source task**, **查看执行记录 / View run details**, or **查看来源对话 / View source chat** according to its destination. Download, favorite, rename, trash and version actions remain in the same menu. Attachment size and busy-state guards remain in force. Asking about a file retains the existing handoff into a new unsent chat draft; adding to an existing chat is outside this change.

Physical-device checks confirmed top alignment for the reported short Markdown, removal of the footer, the new overflow labels, task-source navigation and return, the conversation-source label, long-Markdown scrolling, and plain-text preview layout. The ask menu entry was checked; its existing attachment handoff was not executed in this pass. No Gateway records were changed. The original chat was restored.

Debug compilation, signing, signature verification and replacement installation passed. The current Harmony host suite passed **135 files / 889 tests**, including the previously failing color-hierarchy check. CodeLinter reported **zero errors or warnings**, with nine existing startup-icon suggestions. Local native UI trees, screenshots and check summary: repository-root `.test/harmony-preview-menu-20261119/`.

## Taller library preview follow-up

The library preview sheet now uses **95%** height, up from 88%, matching the existing chat attachment preview. Physical-device capture confirmed its top moved upward by 180 px with the short Markdown still aligned to the top. The overflow menu, close control and return to the original chat passed. Debug compilation, signing, signature verification and replacement installation passed; this one-value layout change did not repeat the previously passing host suite. Local evidence: repository-root `.test/harmony-preview-height-20261119/`.
