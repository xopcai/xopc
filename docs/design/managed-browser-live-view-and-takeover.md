# 服务器托管浏览器实时预览与人工接管｜产品与技术方案

2026-11-21 · 实施基线 · 关联文档：[个人 Chrome 实时预览方案](browser-live-view-product-technical-design.md) · [Phone Use 产品与技术方案](phone-use-product-technical-design.md)

## 1. 目标与首个验收闭环

在服务器上运行由 xopc 托管的 Chromium（Playwright 驱动），普通网页任务无需安装浏览器扩展、个人电脑关机也可执行。手机与 PC 可随时查看当前任务的实时画面；遇到登录、验证码、二次验证或敏感确认页面时，Agent 暂停并保持原浏览器会话，用户在手机或 PC 一键「接管浏览器」完成操作，点击「完成，继续任务」交还控制权，Agent 从刚处理完的真实页面继续执行。

**首个端到端验收场景**：
> 手机发任务 → 打开小窗看到服务器网页 → 遇到登录/确认页 Agent 暂停 → 点击「接管浏览器」全屏输入与提交 → 点击「完成，继续任务」→ Agent 在同一 `BrowserContext`（保留 Cookie、页面和表单状态）内重新观测页面并继续完成任务。

验收重点分两项独立测量：
1. **点开到首帧**：点击「查看浏览器」到屏幕上渲染出首帧真实页面的耗时。
2. **触摸到画面反馈**：接管态下发出点击/滚动/键盘输入到屏幕上呈现对应变化的端到端耗时（接管体验核心指标）。

---

## 2. 用户体验与状态流转

| 阶段 | 行为与体验 |
| --- | --- |
| **发起任务** | 手机或 PC 发消息；Gateway 通过 Playwright 启动服务器 Chromium，为每个任务创建独立 `BrowserContext`（隔离 Cookie/Storage/标签页）。Docker 构建参数 `XOPC_INSTALL_BROWSER=1` 已预装 `xvfb` 与 Playwright Chromium，配置 `browser.driver.kind = "playwright"` 即可启用。 |
| **只读观看** | 手机聊天页顶栏与 PC 右侧工作区展示「查看浏览器」。小窗只读，切换聊天或继续打字时仍可看进度。无需源端手势授权（托管浏览器归属 Gateway 自身）。 |
| **人工接管** | 当 Agent 主动请求协助（`request_user`）或用户手动点击「接管浏览器」时，Gateway 等待当前在途动作结束（或取消该单步动作但不关闭会话），将独占控制权授予该设备（递增 `controlEpoch`）。手机进入全屏交互，支持点击、拖动、滚动和手机键盘输入。**接管期间同一任务的其他观看端立即清屏并进入「隐私暂停」**，防止登录密码与验证码外泄。 |
| **暂离与断线** | 手机退到后台、锁屏或网络中断时，Gateway 立即停止接收输入并回收当前 `controlEpoch`（租约上限 10 秒兜底），但**保留服务器浏览器上下文与等待态**；用户回来可重新点击「接管浏览器」继续操作。 |
| **交还继续** | 点击「完成，继续任务」后，Gateway 回收人工控制权、清空旧 DOM 引用缓存、入队系统续跑消息（复用 `PhoneAssistance` 事务模式），Agent 自动重新 `observe` 当前页面并接着原目标执行。 |

---

## 3. 架构设计与现有能力复用

### 3.1 与现有系统的复用边界

| 模块 | 现有基础 | 本次新增/扩展 |
| --- | --- | --- |
| 托管浏览器运行时 | `PlaywrightDriver`（每任务独立 `BrowserContext`）、`BrowserRuntime` | 新增 `getLiveHandle(sessionId)` 暴露 CDP Screencast 与 CDP Input；将「接管暂停」与 `abortClosesSession` 解耦；增加会话 pin 机制阻止 `evictExpiredSessions` 在等待人工期间回收会话；在途动作排空 `waitForIdle(taskKey)`。 |
| 挂起与续跑 | `src/phone/assistance.ts`、`run-turn.ts`、`session-input-coordinator.ts` | 参照 `PhoneAssistance` 新增 `src/browser/assistance.ts`（`DurableState('browser.assistance')`）与 `browser_assistance_required` 停止原因；在 `browser_use` 工具增加 `request_user` 动作。 |
| 实时画面与控制面 | `BrowserPreviewRuntime`、`/api/browser/preview/:conversationId` | 新增 `ManagedBrowserLiveRuntime` 负责托管源帧分发、单控制者 `controlEpoch` 锁、租约续期、隐私互斥与有序输入队列。阶段一使用 CDP `Page.startScreencast` + 即时唤醒长轮询帧通道打通低延迟闭环；阶段二接入任务隔离虚拟显示 + 服务端 WebRTC，CDP 保留为弱网/降级通道。 |
| Web / Android 观看与接管 | `BrowserPreviewPanel`、`BrowserPreview.kt`、`PhoneWorkspace.kt` | 复用现有预览入口、工作区标签与 Android 悬浮小窗；扩展支持 `mode: "managed"` 交互层（归一化坐标映射、滚轮/拖动、键盘输入、「接管浏览器」「完成，继续任务」按钮、隐私暂停遮罩）。 |

### 3.2 关键技术决策

1. **为什么阶段一先用 CDP `Page.startScreencast` + 即时唤醒帧通道，阶段二再切 WebRTC？**
   - 当前 `PlaywrightDriver` 为单 Chromium 进程 + 多 `BrowserContext`。共享 `Xvfb` 采屏存在多任务窗口串屏风险；而 CDP `Page.startScreencast` 天然绑定到单个 `Page`，100% 任务隔离、无需引入 Node 原生 WebRTC 二进制依赖、Docker 镜像零增量体积。
   - 相比 600 ms 定时轮询，服务端在收到 CDP 新帧时立即唤醒挂起的 `GET /api/browser/managed/:conversationId/frame?after=<seq>` 长轮询请求，兼顾现有 HTTPS/设备签名认证与低延迟交互，先完整验证「接管登录 → 交还继续」闭环，再按同口径对比服务端 WebRTC（任务级独立 Xvfb + 媒体发布器）。
2. **输入映射与安全边界**
   - 客户端基于实际渲染视频区域（扣除 `object-contain` 留白）上报归一化坐标 `[0, 1]`，服务端结合实时 `viewport` 映射为 CDP `Input.dispatchMouseEvent`（`mousePressed` / `mouseMoved` / `mouseReleased` / `mouseWheel`），兼容桌面登录页、下拉框与滑块验证。
   - 中文与 IME 文本经 `Input.insertText` 注入，控制键经白名单 `page.keyboard.press` 注入；**所有键盘/文本载荷严禁写入日志、聊天消息或 transcript**。
   - 所有输入请求必须携带有效 `controlEpoch` 与严格递增 `seq`，单会话待执行输入队列上限 16，超限返回背压错误；所有控制端状态变更需经 `sessions.read` + `agents.run` 及设备身份校验。

---

## 4. API 与协议契约

| 路由 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/browser/preview/:conversationId` | `sessions.read` + `agents.run` | 返回预览可用性；托管模式下附带 `mode: "managed"`、`interactive: true`、`status`、`assistanceId`、`reason`、`url`、`viewport`、`ownControl`、`controlEpoch`。 |
| `GET /api/browser/managed/:conversationId/frame?after=<seq>` | `sessions.read` + `agents.run` | 即时唤醒长轮询获取最新 JPEG 帧（`200 image/jpeg` + `X-Xopc-Preview-Frame` / `X-Xopc-Viewport-*`；无新帧返回 `204`；被其他设备接管隐私暂停时返回 `423`）。 |
| `POST /api/browser/managed/:conversationId/takeover` | `sessions.read` + `agents.run` | 等待在途动作完成，锁定会话并获取独占 `controlEpoch`，同时清屏其他只读观看端。 |
| `POST /api/browser/managed/:conversationId/heartbeat` | `sessions.read` + `agents.run` | 续期当前控制租约（3 秒心跳，10 秒超时自动释放控制权但保留等待态）。 |
| `POST /api/browser/managed/:conversationId/release` | `sessions.read` + `agents.run` | 退后台/关闭时主动释放控制权，不关闭浏览器上下文，允许回来继续接管。 |
| `POST /api/browser/managed/:conversationId/handback` | `sessions.read` + `agents.run` | 回收控制权、失效旧 DOM refs、入队续跑输入恢复 Agent 执行。 |
| `POST /api/browser/managed/:conversationId/input` | `sessions.read` + `agents.run` | 按 `epoch` + `seq` 投递指针、滚轮、文本、按键或导航（后退/前进/刷新）事件。 |

---

## 5. 分期实施计划

1. **阶段 1（本次实现）**：`PlaywrightDriver` CDP 截帧与输入句柄 + `BrowserRuntime` 会话保活与控制栅栏 + `BrowserAssistance` 挂起/续跑 + `ManagedBrowserLiveRuntime` + Gateway 路由与鉴权测试 + Web & Android 观看与接管交互全闭环。
2. **阶段 2（真机验收与 WebRTC 升级）**：在 Docker + Android 真机实测首帧与触摸反馈延迟；验证任务隔离虚拟显示 + 服务端 WebRTC 连续 30 fps 路径，并保留 CDP Screencast 作为弱网兜底。
