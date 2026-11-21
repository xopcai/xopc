# 浏览器实时预览首期实施与真机验收

2026-11-21 · 实施计划 · 代码核对基线 4b779d0cd · [首期产品与技术方案](browser-live-view-product-technical-design.md)

首期从已配对 PC 上的个人 Chrome 专用任务标签出发，支持 PC Web/Electron 右侧预览和手机应用内小窗。Gateway 统一发现、授权、会话和诊断。Chrome 发送 WebRTC 单向视频，默认走直连，需要时走 TURN。Phone Use 继续使用现有 H.264/WSS。本期共用已经存在的连接、工作区和能独立使用的渲染布局能力，按需抽取少量观看界面组件。

## 1. Phone Use 具体复用清单

| 层 | 直接复用 | 小幅抽取或新增 |
| --- | --- | --- |
| Gateway 身份、信令入口 | 现有配对设备身份、请求证明、实时连接与接入证明。直接继续用已认证的 Realtime 连接，沿用 Gateway 会话、扩展端点登记和鉴权路由懒加载。 [Realtime](../../src/realtime/runtime.ts) · [连接票据](../../src/realtime/tickets.ts) · [服务入口](../../src/gateway/server.ts) | 新增浏览器预览会话、源和观看端的角色校验、逐对端定向 SDP/ICE、租约、撤销及版本检查。普通连接票据只证明能连 Gateway，观看加入仍要检查具体任务、设备、目标和请求代次。 |
| Phone Use 媒体 Gateway | 继续由现有 PhoneStreamGateway 服务 Phone Use。可复用已有设备证明校验等通用能力；一次性票据、按观看者限制缓存、回收资源的行为可对照。 [PhoneStreamGateway](../../src/phone/stream-gateway.ts) · [Phone HTTP 路由](../../src/gateway/hono/routes/phone.ts) | 浏览器 WebRTC 媒体不经过 Phone 视频 socket。独立快照降级需要新的只读媒体票据、帧格式及丢帧策略。现有 Phone socket 的 H.264 头、SPS/PPS、IDR 和指针消息由 Phone Use 自己维护。 |
| Web/Electron 播放 | 直接共用现有工作区外壳、会话范围、组件和状态提示规范。Phone Use 保持 WebCodecs/Canvas 播放，Electron 用同一 Web renderer。 [RightWorkspace](../../web/src/features/right-workspace/right-workspace.tsx) · [Phone 播放器](../../web/src/features/phone/use-phone-video.ts) | 新增 RTC 接收器和视频元素。视频轨直接挂载，播放状态只回报关键变化。快照可沿用已有电脑预览的 Canvas 呈现方式；该本地预览的 IPC 仍服务自身。桌面两个入口共享一个接收会话，以可见视图切换挂载。 [本机电脑预览](../../web/src/features/chat/computer/use-computer-preview.ts) |
| PC 停靠与应用内浮窗 | 直接使用 RightWorkspace 的停靠 slot、会话范围及现有导航。若需要 PC 应用内浮窗，可从 Phone Use 现有实现抽取窗口容器、拖动、键盘移动和边界限制。 [Phone Workspace](../../web/src/features/phone/global-phone-workspace.tsx) · [位置与缩放](../../web/src/features/phone/use-phone-window-layout.ts) | Phone 现有浮窗依赖控制会话 store 和 288:640 竖屏比例。浏览器停靠预览按实际视频比例布局，工作区存临时视图标识。PC 首期验收右侧停靠和展开，浮窗抽取仅在已覆盖验收范围时接入。 |
| Android | 复用现有 Gateway 登录/实时连接、原生 Phone 页的比例适配和 TextureView/Surface 生命周期经验，直接共用可复用的 App 外壳与控件。 [PhoneWorkspace](../../apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/PhoneWorkspace.kt) · [PhoneVideo](../../apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/PhoneVideo.kt) | 新增 RTC 接收和 SDK 支持的渲染宿主。现有 PhoneVideo 把 WSS 数据喂给 MediaCodec，继续用于 Phone Use。浏览器小窗宿主挂在聊天页面之上，独立持有接收会话，键盘和旋转只改变布局。 |
| iOS | 复用聊天根视图、导航、原生宿主布局和前后台处理方式。 [AppRootView](../../apps/mobile-ios/XopcMobile/App/AppRootView.swift) · [PhoneWorkspaceView](../../apps/mobile-ios/XopcMobile/Features/Phone/PhoneWorkspaceView.swift) | 新增 RTC 视频视图及独立会话宿主。现有 AVSampleBufferDisplayLayer 播放器接收 Phone 的 H.264 数据，不能直接接 RTC 轨。将底部面板、小窗和全屏布局与接收器解耦，避免 SwiftUI 重排时重建连接。 [PhoneVideo](../../apps/mobile-ios/XopcMobile/Features/Phone/PhoneVideo.swift) |
| HarmonyOS | 复用原生 Phone 工作区的几何、截图显示、可见性规则和既有网关连接。 [PhoneView](../../apps/mobile-harmony/entry/src/main/ets/view/PhoneView.ets) · [PhoneViewModel](../../apps/mobile-harmony/entry/src/main/ets/viewmodel/phoneViewModel.ets) | 优先验证受信任 ArkWeb 接收视图，要求一个组件换布局且可安全释放；若采用原生 RTC SDK，以 SDK 的输出接 Surface/XComponent。现有 AVCodec 模块负责 Phone 的裸 H.264 解码。新增浏览器小窗宿主并按实测开放。 [Phone AVCodec](../../apps/mobile-harmony/entry/src/main/cpp/phone_video.cpp) |

共用层从具体用途提炼。第一版只共享可见性、宽高或旋转、流状态、渲染宿主和会话关闭语义。浏览器没有 Phone 的接管控件、点击坐标和动作回执。Phone 的单一人工控制者、切聊天自动释放和恢复任务规则原样验证。

## 2. 按依赖推进实施

| 顺序 | 做到什么 | 进入下一步前的证据 |
| --- | --- | --- |
| **1 · 个人 Chrome 采集可行性** | 用已配对的真实 Windows PC、已登录个人 Chrome 和同一任务专用标签。扩展从 [MV3 manifest](../../packages/browser-ext/manifest.json)、[后台动作](../../packages/browser-ext/src/background.ts) 与 [构建入口](../../packages/browser-ext/vite.config.ts) 扩展 offscreen 入口，捕获不带音频的 MediaStream。现有工具栏点击会打开侧栏，先验证能否在保留该体验的同时完成真实本地手势。若不能共用点击，则明确把「开始共享」作为来源侧专用操作，调整工具栏路由并验证侧栏仍可打开。Gateway 通知可以定位待共享任务，不能代替手势。 | 正确标签稳定出帧，错误前台标签不产生媒体。切普通标签、Chrome 最小化、长时间静置、Service Worker 重启、用户取消共享、导航和弹窗都得到预期结果。记录 Chrome 版本与 OS；macOS 同步复验。跨站遮挡如果在发帧之后才生效，连续视频卡住发布。 [Chrome 采集](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture) · [Chrome 侧栏](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) |
| **2 · Gateway 和 PC Web 跑通一条链路** | 由 BrowserRuntime 给出真实 run 与来源目标。首次观看创建有时限的请求，Gateway 在已验证的观看连接和扩展端点之间定向信令。状态可查询，SDP/ICE 不进入可回放事件。增加 join、同意、连接、关闭、撤销与超时的服务端状态模型。PC Web 用原生视频元素先接通，再接右侧工作区。链路沿真实认证入口验证，增加 lazy matcher 与回归断言。 | 一个 run 在真实 Gateway 下从 PC Web 看见正确源的第一帧。第二会话、已解绑设备、重复消费、过期请求和旧代次信令都失败。源端关共享立即停止发送，观看端锁屏或关闭时清缓冲。 |
| **3 · 网络路径与双端隔离** | 接入同网直连、跨网直连、TURN/UDP 和受限网的 TURN/TCP/TLS。一个采集轨支持两条接收连接，每条有独立预算。接入弱网降档、ICE 重启和已授权快照回退，再形成诊断时间点。 | 同任务两个 PC 观看端中，第一个被限速时第二个仍能持续播放。已撤销连接在直连、中继和快照回退路径均拿不到新画面。验证健康媒体无须 Gateway 逐帧转发。上一阶段 PC 延迟指标达标后固定可复现的环境。 |
| **4 · Electron 与第一部 Android 手机** | Electron 验证打包版本中的同一 React 预览。Android 先用真实手机证明接收、出帧和看得清，再把宿主移入聊天面板、小窗和全屏。定义统一的画面与会话接口后，测试切换布局、打开键盘和 App 进入后台。 | 一台工作电脑上的 Chrome 同时被 PC 和手机观看。一个手机连接在小窗与全屏反复切换中复用。Home、锁屏、离线、旋转及切聊天符合设计，连接中途关闭后无视频轨、解码器或观看租约残留。 |
| **5 · iOS 与 HarmonyOS** | 搭建 iOS 原生接收，以及 HarmonyOS 低版本真机的 RTC 接收可行性。HarmonyOS 的 SDK/ArkWeb 试验从第 1–2 步即可开展，避免等全链路完工才发现端侧限制。每个平台以发布构建验证渲染表面、后台清帧和连接恢复。 | 各端独立完成直连、TURN、蜂窝切换与渲染生命周期验收。仅宣告实测达到连续视频门槛的机型和平台。 |
| **6 · 兼容与放量** | 复跑 Phone Use 现有 Web/Electron、原生手机、只读观看、接管和交还回归。确认没有新依赖进入用户浏览器页面，端侧负载和 Gateway 资源达标。按来源、平台和网络路径开放。 | 发布记录包含版本与网络矩阵、失败/降级原因、延迟及资源分布。未达标平台只显示已验证的降级能力，浏览器首期发布无须等待 Phone Use 媒体迁移。 |

最短验收路径为 **个人 Chrome → 真实 Gateway → PC Web → Android 真机 → PC 和手机同时观看**。第一段先定位源端权限和采集，后两段才加入移动端渲染差异。Electron 打包和其余手机端按表中顺序补齐。Android 是首个接收端的实施顺序，三端采用同一协议与验收口径。

### 第一阶段实测记录

macOS arm64，Chrome for Testing 148.0 和 156.0，临时独立 profile、两个回环 HTTP 来源和测试扩展。快捷键触发真实的 Chrome 扩展动作，浏览器页面通过本机 WebRTC 接收。源网页使用合成色块和帧号。

| 验证项 | 结果 |
| --- | --- |
| 工具栏与侧栏 | 原有自动打开侧栏模式下未收到 action 回调。关闭自动模式后，经同步分流可保留无共享请求时开侧栏的体验。先等待异步存储再调用 sidePanel.open 拒绝了手势。后续应提前准备待授权状态，冷启动状态未知时只开侧栏。 |
| 标签视频与播放 | 指定标签的 offscreen 轨输出 960×540、30 fps 配置、0 条音轨。目标标签退到后台后，接收页仍呈现了 12 帧直连 H.264。错误活动标签被拒绝。停止后轨道 ended、offscreen 回收。这里的 30 fps 是轨道配置值，12 帧仅证明收到并呈现。 |
| 长驻发送器的跨页风险 | 长驻 offscreen 在换页后仍能发送新来源像素。按标签限制主文档网络请求挡住了 HTTP 重定向，但 Service Worker 提供的页面和非网络导航仍能进入。叠加 Service Worker bypass 只挡住了这次 Service Worker 样本。该路径未满足文档绑定要求。 |
| 文档内发送器候选 | 用同一标签消费采集流，在 Chrome 扩展隔离世界持有 WebRTC sender，文档 pagehide 时停轨和关连接。156.0 的合成页面分别测试了同站新文档、跨站重定向、Service Worker 页面、非网络页面。在接收端的呈现回调里未观察到新文档色块，有的用例继续呈现 1–2 帧旧内容，返回后也没有自动恢复播放。 |

当前优先推进**文档内发送器**候选。控制面仍由扩展后台通过 Gateway 处理，发送逻辑仅存在于已校验的目标文档的隔离世界。生产实现须把注入和内部消息钉到 documentId，增加目标/代次校验、pagehide 及暂停路径。整页换文档时结束旧共享并清屏，新文档恢复预计需要源端手势，交互成本需与真实浏览流程对照。已知登录、支付和同一文档内的敏感状态仍需要事前停帧。原型每种导航只验证了一个样本，已发现的边界需要用真实受控站点、更多导航竞态、正式 Chrome 和 Windows 复验。

本轮扩展 TypeScript 基线通过。原型使用本机调度交换 SDP，未走真实 Gateway、已登录网页、TURN、Electron 或手机，也没有测光学延迟。后续真实 Gateway 垂直链路与文档身份测试完成后，再开放给观看端。

## 3. 真机验收顺序与记录

1. **场地和样本。** Windows 和 macOS 各一台装有发布候选扩展的工作电脑。至少一台 Android、一台 iPhone、一台 HarmonyOS 真机，平台声明覆盖最低支持版本时需纳入对应设备。准备同 Wi-Fi、真实跨网、强制 TURN/UDP、禁 UDP、限带宽与可控丢包。用无真实隐私数据的已登录测试站点。归档构建和实验配置、各端时间点，以及端到端测量证据。
2. **先验权限。** 未配对端无法观看。正确标签只需一次明确的源端共享操作；错误标签、站外重定向、弹窗、账号登录和手动切标签不漏帧。复验服务重启、撤销、解绑、老票据、老代次及后台超时。用可识别的测试标记确认受保护页面从未到达观看端。
3. **PC 建立性能基线。** 同一可测试网页用随机颜色翻转和帧号标记，先在 Chrome → PC Web 同网用 240 fps 相机同框量两屏，再跑真实远程 Gateway、强制 TURN 和打包 Electron。按链路分别记录冷/暖首帧各至少 30 次和至少 100 次画面变化，不把连接失败从成功率里排除。
4. **手机验收回路。** 逐端先单接收，再与 PC 同时开。测试滚动、中文表格、窄屏、键盘弹起、横竖屏、小窗和全屏来回、切聊天、Home/锁屏、Wi-Fi/蜂窝互切、源端 Chrome 最小化及休眠。用连接标识核对单纯切布局保留同一媒体会话；解码、渲染及租约均可独立回收。
5. **弱网和 Phone 回归。** 用 0.5 Mbit/s、150 ms RTT、3% 丢包分别和组合压测。对其中一个观看端限速，看另一端是否仍流畅。记录降档、转快照、恢复视频及撤销的时间。用同一个 Gateway 验 Phone Use 连续 H.264、只读多端、人工接管、手动收起和交还。输入 ACK 保留原指标，以手势触发到屏幕实际反馈另测可见响应。

发布门槛沿用 [首期方案的量化标准](browser-live-view-product-technical-design.md#6-延迟验收与发布条件)。暖首帧 P95 ≤ 800 ms，冷启动 P95 ≤ 2 秒。屏幕到屏幕局域网 P95 ≤ 150 ms，稳定跨网直连和 TURN/UDP 各 P95 ≤ 300 ms。弱网以可见帧龄、冻屏、降级恢复及状态是否准确为准。正常连接撤销到清屏 P95 ≤ 1 秒，信令失联时不超过租约窗口。真实视频成功率、任务动作开销和各端耗电另列。

100 ms 优化验收按 [局域网 100 ms 分段预算与测量](browser-live-view-product-technical-design.md#局域网-100-ms-目标与分段预算) 执行。先做个人 Chrome → PC Web 30 fps 单端直连，再测真实手机；近门槛用更高速摄影复测。随后分开跑同网 TURN/UDP、双观看端与低帧率小窗。每组交付光学端到端分布、确认过的 ICE 路径、同帧分段证据和未分离耗时。

记录至少覆盖源端捕获、Gateway 加入会话和授权完成、ICE 选路、第一帧解码与实际呈现、下调原因、最后帧、撤销与资源释放。性能日志使用不含画面、完整地址或凭据的运行标识。网络 RTT 仅用于定位链路问题，首帧、延迟和冻结以实际呈现为准。

本节所列的真机验收仍待执行。已完成的开发验证见第 4、5 节。

## 4. PC 直连第一阶段实现

已接入 BrowserRuntime 的实际 Chrome 任务源、Gateway 定向信令和短时租约、浏览器侧栏授权、目标文档隔离世界内的一路发送器，以及 Web/Electron 聊天入口和右侧工作区播放器。该阶段每个 Chrome 端点最多一个观看端。源端先在侧栏查看请求的观看者和网页域名并允许，再在任务标签点工具栏启动，保留 Chrome 所需本地手势。打开已有配对的侧栏复用健康连接，避免观看请求因侧栏初始化而失效。

macOS 上以临时 SQLite、真实 HTTP 鉴权路由和 Gateway Realtime 服务、真实 BrowserRuntime、打包扩展及浏览器接收测试页联调。测试固定活动 run，绕开模型调用，只对回环测试页启用测试用 URL 许可。用侧栏按钮和真实 Chrome 扩展动作批准，后台来源标签送达 H.264 帧。整页导航后接收端收到关闭消息并清除视频，测试新页面的色块无入帧。测试页验证媒体与信令，React 工作区界面通过类型检查和 Web 构建。未对真实 Agent 任务、打包 Electron、手机、弱网或光学延迟执行验收。

## 5. TURN、双端观看与 Android 小窗

Chrome 对同一已授权文档只采集一次，最多同时建立两条 WebRTC 连接。每个观看端单独批准、续租和调档。Gateway 通过既有 Realtime 连接定向传递授权和信令。媒体优先直连，配置 TURN 后 ICE 也能使用中继。Phone Use 继续使用现有 H.264/WSS 链路，两项功能共用 Gateway 登录和设备身份。

- Gateway 通过 `XOPC_BROWSER_PREVIEW_TURN_URLS` 接收逗号分隔的 TURN 地址，通过 `XOPC_BROWSER_PREVIEW_TURN_SECRET` 使用与 coturn 一致的共享密钥。每路连接单独签发有效期 10 分钟的临时凭据。测试环境可设置 `XOPC_BROWSER_PREVIEW_FORCE_RELAY=1` 强制走中继。
- 接收端每秒采样丢包、RTT 和冻结。持续异常先下调该路发送档位，再切低频 JPEG。断线时允许一次 ICE 重启，仍无法恢复则切快照。连接保持可用时尝试恢复低档视频，持续稳定后再回正常档。
- 快照实现复用认证 HTTP 传输和设备请求证明。Gateway 为每个已授权观看端在内存中保留最新一张，最多 80 KiB，有效 2 秒。停止共享和恢复视频时清除临时快照与权限。另一端继续走原 WebRTC 连接。
- PC 使用 Web/Electron 聊天右侧工作区。Android 通过既有连接收信令，用应用内专用 WebView 播放。展开和缩小沿用同一播放器，可拖向屏幕角落。关闭小窗、应用退到后台或连接断开时清理会话。

| 验证 | 结果 |
| --- | --- |
| Chrome → Gateway → 两个桌面测试接收端 | 实际 H.264 解码。同机直连选中的 ICE 路径为 host ↔ host，强制中继时为 relay ↔ relay，经过本地 coturn/UDP。 |
| 独立降级和停止 | 通过信令请求一个观看端降档并转快照，认证 HTTP 收到由真实标签生成的 JPEG。另一端持续收到视频。源标签整页导航后清屏。Android 播放脚本用模拟统计验证了丢包触发和恢复状态转换。 |
| Android | API 35 模拟器安装并启动应用。小窗 UI 测试验证展开和缩小保留同一 WebView，关闭后释放。Android 配对端的签名信令由 Gateway 集成测试覆盖。 |
| 延迟诊断 | macOS 单机 Chrome 直连，源页约 30 fps 更新测试标记。122 个有效帧从页面打标到接收端预计呈现的 P50 / P95 为 33 / 42 ms。同批帧的接收至预计呈现为 20.9 / 28.6 ms，解码回调报告 1.2 / 2.6 ms。解码包含在接收至呈现内，不能相加。采集、发送端编码与本机媒体传输尚未独立计时。 |

100 ms 的局域网屏幕到屏幕验收仍需要物理手机和同框高速摄影。真机同播、真实弱网和跨网 TURN/TCP/TLS 仍按第 3 节验收。本轮 TURN 使用本地测试实例，线上运行需部署可达的中继并向 Gateway 注入配置。

## 6. Android 模拟器双端弱网复验

Chrome for Testing 148 的个人浏览器扩展捕获持续滚动的测试页面。API 35 模拟器通过真实 HTTPS 配对及签名 Realtime 连接打开 Android 应用内小窗。测试夹具提供活动任务，PC 选择 host ↔ host 直连，Android 走 coturn/UDP。仅在 Android 的 TURN 下行媒体入口限速 500 kbit/s，并在限速外每九个媒体包丢一个。Gateway 信令和快照 HTTP 保留原有路径。

压测定位到 Chrome 会把单路编码器的 `maxFramerate` 传到共享标签采集源。Android 切至 15 fps 档后，PC 自己的编码输入也变成约 15 fps。给各连接克隆同一采集源的轨道仍会触发该行为。移除逐观看端的帧率上限后，低档只下调弱网端的码率和分辨率，帧率交由 WebRTC 自适应。

| PC 呈现帧率 | 正常基线 | Android 限速丢包 | Android 快照阶段 | Android 恢复正常 |
| --- | ---: | ---: | ---: | ---: |
| 修复前 | 30.0 | 18.6 | 30.0 | 29.6 |
| 修复后，Chrome 桌面测试接收页 | 29.7–30.0 | 29.8 | 30.4 | 30.0 |
| 修复后，PC Web 预览面板 | 27.4 | 27.6 | 28.4 | 28.0 |

最后一轮使用实际 PC Web 预览面板、浏览器登录 Cookie、Android 播放器和 HTTPS 配对。测试壳提供任务上下文。Android 在施加弱网 1.2 秒后自动降档，6.2 秒后转快照，收到并显示了 JPEG，累计收到 22 张。媒体代理统计该阶段 670 个包中 75 个被主动丢弃，另有 228 个因超过限速被丢弃。解除限速丢包约 10 秒后试探低档，约 21 秒后回到正常档，期间使用同一个观看请求。PC 仍持续呈现，源标签导航后清屏。修复前有一次恢复试探未出视频并继续显示快照，第二次试探后才回正常档。
