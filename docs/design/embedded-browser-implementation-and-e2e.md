# 内置浏览器实现与 Electron E2E

后续安装包验收：见 [Electron 打包后验收记录](./electron-packaged-acceptance-2026-10-18.md)，最终 DMG 的 84 项原生检查全部通过。

最终验收（2026-10-18）：70 项 Electron 原生检查全部通过，详见 [完整验证记录](./electron-workspace-e2e-2026-10-18.md)。

日期：2026-10-18。对应 [统一方案 B0 / B1](./unified-workspace-and-embedded-browser.md)。

## 已交付的行为

- Electron 的 Tools 页与工作区更多菜单提供浏览器入口，原位替换 Tools 标签；网页、文件、Files 和 Sidechat 共用标签条。
- 地址栏支持完整 HTTP(S) URL、域名、localhost；网址 query/hash 保留。普通搜索先选择引擎，不做远程联想。地址编辑与实际导航状态分开。
- 网页前进、后退、刷新、加载中停止；标题更新到标签；失败由宿主显示重试和可编辑地址；支持在系统浏览器打开。
- 同一网址可以有多个独立标签。`target=_blank` 转为工作区新标签，保留来源。切换、收起、展开保留 native webContents、历史和表单；非活动页面静音，不承诺暂停所有站点任务。
- 关闭走真实 beforeunload：Stay 保留标签及页面，Leave 释放原生内容；关闭失败不会先移除标签。隐藏与关闭是不同操作。
- 网页下载进入原生保存对话框，显示进度 / 完成 / 失败；上传使用 Chromium 原生选择流程。摄像头、位置等网站权限本期默认拒绝并显示提示，不复用宿主权限，不绕过证书校验。
- 文件树在网页下默认关闭；宽度足够可并排，窄栏使用浮层。所有可见 DOM dialog、Radix 菜单、树浮层和拖动遮罩出现时协调隐藏 guest，关闭后恢复；不依赖 CSS z-index 覆盖原生网页。
- 保留已有文件预览、编辑、revision 保存、Sidechat 草稿、流式发送、后台运行、停止和其他会话能力。
- 普通 Web 没有假的内嵌网页入口；已有文件和 Sidechat 仍正常使用。

## 实现边界

`electron/browser/browser-host.ts` 管理窗口内的网页 registry、专用 profile、生命周期、导航、下载与原生视图 bounds；`types.ts` 定义窄 IPC 协议，`url-policy.ts` 提供 URL 和边界规则。

主进程通过 `registerBrowserIpc` 接入；preload 仅向可信宿主暴露 browser bridge。每次调用都校验 main window 和精确 main frame，不能仅因地址是 localhost 就信任 guest 或 iframe。远程网页使用 sandbox、contextIsolation、无 Node、无应用 preload 和 webviewTag；没有新增全局 CDP 端口或 Agent 操作权限。

每个 workspaceTabId 关联一个 main 生成的 native id。profile 与主应用 session 隔离，按公开 Gateway / 浏览会话身份的哈希分区；身份变化释放旧实例。宿主文档重载、renderer 崩溃、窗口销毁会释放对应资源。最多 24 个原生网页标签，超过时明确报错，避免无限持有网页进程。

`web/src/features/browser/` 维护地址草稿、导航状态与原生布局同步；ResizeObserver 与 rAF 合并 bounds 更新，主进程裁剪到窗口边界并换算应用 zoom。动画期间隐藏原生层，沿用工作区可中断的 transform / opacity 动效和 reduced-motion 支持，避免原生网页与 DOM 过渡错位。

本期不持久化网页 URL、标题或 native id，以免登录回调和一次性地址进入会话存储；不会恢复重启前的网页历史或表单。网站登录数据由专用持久 partition 保存，工作区标签本身只在当前应用文档内保留。

## 本轮真实联调发现并修复的问题

1. StrictMode effect replay 的第一次清理误关第二次复用的实例，随后导航报标签不可用。修为先检查真实工作区成员关系；新增 StrictMode 组件回归。
2. Electron 在 destroyed 时可先清空 view.webContents，导致关闭清理主进程异常。registry 改为独立持有 contents 引用，并覆盖 getter 已清空的测试。
3. 关闭后迟到的隐藏 IPC 产生无效标签错误。隐藏变为幂等操作，导航 / 控制未知标签仍拒绝。
4. 原生 bounds 需要从 renderer CSS 像素换算到 Electron DIP；增加应用 zoom 换算与裁剪测试。
5. 多网页不能每个都在同一 profile 上永久挂一个下载监听。改为按 profile 统一监听，关闭宿主时清理，避免多标签监听告警和残留。

## Electron 验收环境与复跑

真实 macOS Electron **42.4.1** 窗口、生产 browser host / IPC / preload、当前 UI、隔离 Gateway / SQLite / workspace、本地确定性流式模型与 HTTP 网站。UI 操作通过 CUA 原生可访问性接口进行，实际访问 WebContentsView 的网页，未用 iframe 或网页 mock 代替。

复跑步骤：

1. 确保有 Gateway 构建 `dist/src/cli/bin.js` 和最新 preload：`pnpm run electron:vite:build:package`。
2. `node scripts/workspace-e2e-server.mjs`：生成独立 Gateway 和当前 Vite UI；元数据在 `/tmp/xopc-workspace-e2e.json`。
3. `node scripts/browser-e2e-site.mjs`：启动可控网页，URL 在 `/tmp/xopc-browser-site.json`。
4. `node scripts/build-browser-e2e.mjs`，再运行 `pnpm exec electron out/browser-e2e/index.mjs`。
5. CUA 选择该 Electron 窗口，导入 `scripts/browser-e2e-cua.mjs`，调用 `runNativeBrowserE2e(app, siteUrl)`；它是分段 async generator，逐次 `next()` 执行，最终返回检查列表。首次出现欢迎页时按提示跳过；英文测试文案用于稳定定位。
6. Ctrl+C 停止这些测试进程；临时数据可保留检查。不要对日常 Electron 窗口或正式聊天执行此测试脚本。

验收宿主没有启动自动更新和电脑控制端点，相关非浏览器启动 IPC 使用惰性的测试值。browser IPC、原生视图、文件 IPC、renderer 和 Gateway 都是真实实现。**这验证的是原生功能集成，不等于已签名安装包的启动 / 升级 / 分发验收。**

## 最终可复用原生 E2E：28 / 28 通过

| 分组 | 已通过 |
| --- | --- |
| 网页导航 | 原生页面加载与应用 / Node 隔离、标题更新、后退及表单恢复、前进、刷新产生真实网络请求 |
| 多标签 | 弹窗转工作区标签、独立表单状态、切换文件后页面仍存活 |
| 宿主层级 | DOM 标签菜单遮挡时 guest 隐藏、工作区放大 / 还原保留内容、收起隐藏与重开恢复 |
| 文件与 Sidechat | 文件预览、真实编辑；侧聊草稿保留、模型真实流式响应、后台状态与停止 |
| 恢复与关闭 | 停止网页加载、失败宿主 UI、改地址恢复、原生 beforeunload 提示、取消保留、确认关闭只释放目标标签 |
| 输入与权限 | 默认拒绝站点权限且有反馈、guest 中 Cmd+L 回宿主地址、搜索先选引擎、不安全协议拒绝 |

额外原生检查：真实 HTTPS 网站 `https://www.electronjs.org/docs/latest/api/web-contents-view` 成功加载并更新标题 / 地址；下载弹出原生目的地对话框，保存到 `/tmp/xopc-browser-e2e-20261018.txt`，读回内容与 fixture 一致；文件编辑经 Gateway 实际写入隔离 workspace。下载的额外检查与脚本用例不合计为不同自动化用例。

最终原生日志没有 main uncaught exception 或 browser IPC 错误；故意访问 `/fail` 产生预期的 `ERR_EMPTY_RESPONSE`，并验证宿主失败恢复界面。macOS 输入服务可能打印 TSM 系统消息。

证据：`/tmp/xopc-browser-native-e2e-results.json`、`/tmp/xopc-browser-native-final.png`、`/tmp/xopc-browser-native-acceptance.log`。

## 其他验证

| 检查 | 结果 |
| --- | --- |
| 原生 host / IPC / URL / bounds 回归 | 16 项通过 |
| 工作区 / 文件 / Sidechat / Shell / 浏览器范围回归 | 36 个文件、179 项通过 |
| 全量 Web 回归 | 488 文件：487 通过、1 失败；2603 项：2602 通过、1 失败 |
| Web TypeScript、ESLint、生产构建 | 通过 |
| Electron main / preload 构建 | 通过 |
| Browser main TypeScript 检查 | 通过 |

唯一全量失败仍为 `web/src/features/chat/messages/__tests__/message-list-visibility.test.tsx` 中的 `keeps task result follow-ups without answer text and drops empty successful outcomes`，此前已在未修改 HEAD 上复现。本轮没有修改该消息逻辑或放宽断言。

日志：`/tmp/xopc-browser-main-tests.log`、`/tmp/xopc-browser-regression.log`、`/tmp/xopc-browser-full-web.log`、`/tmp/xopc-browser-main-types.log`、`/tmp/xopc-browser-types.log`、`/tmp/xopc-browser-lint.log`、`/tmp/xopc-browser-web-build.log`、`/tmp/xopc-browser-electron-build.log`。

## 未纳入本轮完成声明的能力

- B2 的网页引用快照、指定标签 Agent 控制、接管租约与停止授权尚未接入。手动浏览不会自动发送 DOM、截图或凭证到聊天。
- OAuth 依赖 window.opener 的跨窗口流程、特殊站点 DRM / WebAuthn / 客户端证书、摄像头麦克风授权、上传所有文件类型未逐站验收。当前弹窗被转为独立工作区标签，不能承诺所有站点弹窗协议都兼容。
- 未验证 Windows / Linux、跨显示器 DPI、签名打包应用和安装更新；没有 GPU 长帧采样，因此不宣称所有设备恒定 60fps。
- 网站权限本期采用明确拒绝策略，尚无逐站允许和权限管理页；网页标签本身不跨重启恢复；没有 favicon、标签拖拽重排、页内查找或浏览历史推荐。

后续可在这一原生用户浏览基础上实施 B2，复用现有 browser.control 合同；不需要改造文件预览或把 Sidechat 再迁出统一工作区。
