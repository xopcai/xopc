# Chat header: three actions

后续安装包验收：见 [Electron 打包后验收记录](./electron-packaged-acceptance-2026-10-18.md)，最终 DMG 的 84 项原生检查全部通过。

Updated: 2026-10-18. This supersedes the outer header controls in the earlier workspace plan.

## Interaction

The chat action group contains exactly three controls, in order:

1. **More**: conversation search and the existing conversation share dialog. Search retains its keyboard shortcut; sharing still requires reviewing and explicitly creating a snapshot.
2. **Context**: the existing Session info panel, including project, task, sources and environment. Working-directory selection is inside the environment section.
3. **Plus**: opens the Tools page in the existing right workspace. It activates an existing Tools tab or creates one, and does not collapse the pane. Repeated clicks do not accumulate empty tabs.

The Agent selector belongs beside the conversation title, outside the action group. The outer folder, search, share, terminal and Sidechat buttons are removed. Terminal and Sidechat shortcuts remain available.

## Tools and tabs

Files, Sidechat, native browser and terminal are reached through Tools. Browser and terminal entries appear in Electron when their native APIs are available. Files and Sidechat remain available on the web. Creating a browser or Sidechat from an empty Tools tab consumes that tab, following the existing tab model. Terminal retains the current terminal panel and sessions; before the first project message, its Tools action delegates to the existing conversation-preparation callback.

The right tab strip uses More, tab list, separator, content tabs, Plus, expand and pane-collapse controls. File-tree toggles belong inside the file/browser toolbar; the workspace menu also provides a tree action for Sidechat. Tab-list menus support Arrow Up/Down, Home/End, Enter and Escape. Closing a file/browser continues through its save/beforeunload guard.

Menus enter in 120 ms using opacity and a small transform. Existing pane opening/closing and tab motion remain 220/150 ms; reduced-motion preferences disable the new menu animation. Native browser surfaces yield to DOM menus through the existing occlusion coordinator.

## Verification

- TypeScript, ESLint and web production build checked for the final implementation.
- 73 tests passed across 13 files: header registration, shell/task Sidechat, workspace, browser host/UI and sharing.
- Live isolated Gateway UI checks: menu search opens and focuses find, sharing opens the existing review dialog without publishing, Tools opens Files, Markdown preview renders, Sidechat draft survives tab changes, Sidechat sends a real streamed fixture-model response, and repeated outer Plus clicks reuse a single Tools tab.
- Screenshot: `/tmp/xopc-header-three-actions.png` (web UI; native-only Tools cards are intentionally absent).
- Final Electron acceptance (2026-10-18) resolved the native capture/accessibility blockers: **70 native checks passed**, including all three entries, files, Sidechat, terminal, browser, narrow layouts and motion. The related regression suite passed 98 tests; full Web regression has one unchanged-baseline failure. See [final acceptance record](electron-packaged-acceptance-2026-10-18.md) for evidence and scope.

历史产物保留说明（2026-10-29）：本页所涉已清理截图、逐次 JSON 与源码快照可从 Git 历史恢复；上文数字和失败限制保留为历史观测，不代表本次重新验收。复跑输出应指定临时目录；旧路径仅记录当次运行位置。
