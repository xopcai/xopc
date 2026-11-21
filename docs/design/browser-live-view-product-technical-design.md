# 浏览器任务实时预览｜首期产品与技术方案

2026-11-21 · 评审稿 · 仓库核对基线 4b779d0cd · [网易 UU 远程低延迟调研](browser-live-view-latency-research-2026-11-21.md)

## 首期决定

**WebRTC 单向视频是首期主路径，个人 Chrome 专用任务标签是首发来源和发布门槛。** 手机上从聊天打开、缩成应用内小窗或全屏查看。PC Web 和 Electron 在右侧工作区并排显示聊天与画面。源页有动作时目标为 15–30 fps，延迟按屏幕实际呈现验收。CDP/JPEG 只用于已授权场景的低频降级；该能力一律标为「低帧率预览」。任务审批继续从聊天完成。

以 Muse 的对话内观看入口、Manus 的本机任务标签、网易 UU 的连续串流体验为参考。UU 公开确认了直连、只读观看和小窗。本方案的延迟指标为 xopc 首期目标，公开材料不足以作出与 UU 实测等效的结论。[Muse 浏览器帮助](https://www.meta.com/en-gb/help/superintelligence/2124746764949121/) · [Manus Browser Operator](https://manus.im/blog/manus-browser-operator) · [网易 UU 远程](https://apps.apple.com/cn/app/id1642306791)

首期覆盖 Android、iOS、HarmonyOS 应用内小窗和 PC Web/Electron。按设备实测开放连续视频。系统画中画、桌面跨应用置顶和远程键鼠操控列为后续阶段。

## 1. 用户怎么用

1. Agent 在已配对电脑的个人 Chrome 专用标签开始工作，手机和 PC 聊天随任务显示「查看浏览器 · 工作电脑」。能显示入口的前提是 Gateway 确认当前运行已选定真实浏览器和目标标签。
2. 用户点「查看浏览器」。首次显示「请在工作电脑打开任务标签，点击 xopc 扩展开启共享」。源端侧栏显示任务、当前域名、请求观看的设备和有效范围。点浏览器工具栏的 xopc 扩展动作触发 Chrome 授权，采集前核对当前标签就是待共享的任务标签。若是另一标签，提示切到任务标签后再次点击。
3. 手机出现远端画面，用户可缩小并继续聊天，PC 也可同时打开。源电脑可看到正在观看的设备。离开 xopc 前台或锁屏关闭该观看端；关闭预览只结束本端。源端「停止共享」立即撤销所有观看端，「停止任务」走现有 run 取消。
4. 任务仍在执行但共享暂停时，状态单独说明原因，例如「需要在工作电脑登录」「工作电脑离线」「弱网 · 低帧率预览」。任务结束后清画面，入口原位变为任务结果或结束状态。

| 界面 | 首期落地 |
| --- | --- |
| 手机底部面板、应用内小窗、全屏 | 底部面板展示视频、任务来源、状态、「缩小」「全屏」。小窗占屏宽约 40%–48%，贴边且避开输入框、安全区和键盘；空间不足缩成可点击的状态条并暂停画面消费。全屏保持纵横比，支持本地放大和平移。每台手机固定一个观看窗口，换聊天时仍显示原任务名。三种视图复用一个观看会话和接收器。 |
| PC Web / Electron | 聊天动作打开右侧工作区里的临时「浏览器预览」标签，以运行身份定位和去重。保留聊天和输入，支持放大、收起、关闭。源 PC 如能经扩展定位已验证标签，可提供「在源 Chrome 打开」。收起或切出时停止消费画面，短暂恢复沿用原连接，超过约定时间释放观看端。 |
| 各端状态 | 「待源端授权」「正在连接」「实时」「弱网 · 正在调整」「低帧率预览」「正在重连」「隐私暂停」「源离线」「已结束」。普通断线最多保留最后画面 2 秒，显示时间；目标切换、私密流程及撤销立即盖住并清除画面。静态页面使用源状态和连接心跳判定是否仍在线。 |

小窗放大与缩小优先重用渲染表面。PC 面板收起和手机折为状态条允许 10 秒内恢复消费，过期释放观看连接。最后一个观看者退出时释放视频轨。此后重新观看若需要新的 Chrome 采集手势，明确提示源端再次开启。

## 2. xopc 接入分工

| 层 | 已有入口 | 首期改动边界 |
| --- | --- | --- |
| 浏览器执行与目标归属 | [BrowserRuntime](../../src/browser/runtime/browser-runtime.ts)、[Chrome 扩展 Provider](../../src/browser/providers/realtime-extension.ts)、[标签绑定合同](../../packages/gateway-contract/src/browser-tab-binding.ts) | 由运行时解析当前 run 与实际浏览器会话和目标；复用标签绑定的 endpoint、tab、window、document、origin、有效期或专用标签的所有权证据。运行时动作事件用于提示，媒体授权独立于工具权限。 |
| Chrome 发布端 | [MV3 manifest](../../packages/browser-ext/manifest.json)、[扩展后台和端点注册](../../packages/browser-ext/src/background.ts) | 当前最低 Chrome 120，尚无 tabCapture 权限。启用首发能力时新增该权限和用户说明。Service worker 处理本地手势、标签校验及 Gateway 信令。首轮实验将发布方向调整为由目标文档的扩展隔离世界持有视频轨和发送端，跟随文档退出。既有 debugger 继续服务 Agent 动作及有条件的快照降级。 |
| Gateway 控制面 | [Realtime 客户端入口](../../web/src/features/gateway/gateway-realtime-bridge.tsx)、[Gateway Realtime](../../src/realtime/runtime.ts)、[连接票据](../../src/realtime/tickets.ts)、[认证路由](../../src/gateway/hono/routes/lazy-bundles.ts) | REST 查当前预览状态和创建观看会话，既有 Realtime 传提示和定向信令，扩展沿已有已验证端点连接应答。新增按预览和对端校验的消息能力。SDP、ICE、租约与票据不进入可回放 broker、聊天或日志。新增认证路由需同步 lazy matcher、正反例测试及运行中的真实鉴权验收。 |
| PC Web / Electron | [RightWorkspace](../../web/src/features/right-workspace/right-workspace.tsx)、[工作区 store](../../web/src/stores/right-workspace-store.ts)、[电脑操作预览](../../web/src/features/chat/computer/use-computer-preview.ts) | 复用聊天入口、工作区、画面代次和过期处理思路；增加临时远端只读预览视图。既有 Browser 标签是导航用的本地网页，既有电脑预览是 Electron IPC/JPEG。预览使用独立接收器和视频元素，像素在 React 状态之外。关闭、刷新或切换 Gateway 均释放会话。 |
| Android / iOS | [Android RealtimeClient](../../apps/mobile-android/app/src/main/java/ai/xopc/mobile/gateway/RealtimeClient.kt)、[iOS RealtimeRunSocket](../../apps/mobile-ios/XopcMobile/Core/Networking/RealtimeRunSocket.swift)、[iOS AppRootView](../../apps/mobile-ios/XopcMobile/App/AppRootView.swift) | 用已有登录和实时状态连接承载入口及信令，原生接收器独立于聊天生命周期。Android 验证 libwebrtc 兼容的原生视频表面及硬解，iOS 验证原生 WebRTC 客户端与硬解渲染。接收会话放在页面之上的宿主，保证切对话时小窗不重建。SDK、包体和端侧性能需实证。 |
| HarmonyOS | [ChatView](../../apps/mobile-harmony/entry/src/main/ets/view/ChatView.ets)、[realtimeClient](../../apps/mobile-harmony/entry/src/main/ets/service/realtimeClient.ets) | 同样接入应用内小窗。先在最低支持真机验证 ArkWeb 受信任本地页面的 RTC 接收、解码和布局切换。若其中任何一环未达标，验证独立 RTC 接收 SDK 和原生渲染表面。AVCodec 能力只解决解码，RTC 信令、ICE 到 RTP 仍需完整接收栈。未过门槛的机型仅按能力提供带明确标签的低频预览。[ArkWeb](https://developer.huawei.com/consumer/en/doc/HarmonyOS-Guides/web-component-process/) · [HarmonyOS AVCodec](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/avcodec-kit-intro/) |

PC 与手机先协商 H.264 等双方可用的编码，以实际选中的编码、硬解能力和冻结测量验收。托管 Playwright/headless 和 Electron 本地 WebContents 可按授权增加快照能力，连续视频需单独验证稳定采集轨道后开放；不算作个人 Chrome 首发成功样本。

## 3. 与 Phone Use 统一的观看架构

### 当前代码里的 Phone Use

Android 本地和经 ADB 连接的部分云手机由 scrcpy 输出 H.264，HarmonyOS USB 通过 HDC/HOScrcpy 输出 H.264。Gateway 中的 PhoneInteractiveSession 复用同一个采集源，先检查前台应用和几何版本，再放行媒体。新观看端等编码配置和关键帧。PhoneStreamGateway 用独立的二进制 WSS 转发已压缩视频，按观看端处理积压，缓冲超过 1 MiB 时关闭该端连接。Gateway 没有逐帧解码再编码。现有 WS 还能承载通过 Phone Use 控制租约验证的指针输入。 [来源选择](../../src/phone/runtime.ts) · [采集与屏幕校验](../../src/phone/interactive-session.ts) · [媒体协议](../../src/phone/stream-gateway.ts) · [观看与控制票据](../../src/gateway/hono/routes/phone.ts)

Web/Electron 工作区复用 WebCodecs/Canvas，Android 走 MediaCodec，iOS 走 AVSampleBufferDisplayLayer，HarmonyOS 走原生 AVCodec Surface。当前路径是 H.264 over WSS。Chrome 首期 WebRTC 同样观看连续视频，差别在于 Chrome 本身能提供 MediaStream，可在源端直接做媒体发送。 [Web/Electron](../../web/src/features/phone/use-phone-video.ts) · [Android](../../apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/PhoneVideo.kt) · [iOS](../../apps/mobile-ios/XopcMobile/Features/Phone/PhoneVideo.swift) · [HarmonyOS](../../apps/mobile-harmony/entry/src/main/cpp/phone_video.cpp)

### 推荐统一的边界

| 层 | 共同能力 | 各来源保留的能力 |
| --- | --- | --- |
| 产品入口与呈现 | 在任务里打开画面。手机一键缩小/展开，PC 可停靠。共用连接中、实时、弱网、重连、隐私暂停和结束的呈现语义。画面表面和观看会话绑定，重排布局时尽量复用，观看者各自限速。 | 当前 Phone Use 仍与来源聊天绑定，离开该聊天按原规则释放本端媒体和人工控制。浏览器只读小窗可固定在应用内并标识来源任务。Phone Use 的「接管手机」「完成，继续任务」保留明确语义。 |
| Gateway 会话与授权 | 同一个 Gateway 负责发现源、认证接收端、协商传输能力、发放短效授权、撤销和只读会话的状态。统一最小语义字段，例如来源、运行、目标代次、画面几何、传输类型和不可用原因。先建薄的观看接口与接收端适配器，避免复制一整套工作区或把 Phone Use V1 票据强行迁移。 | Phone Use 保留 conversation/transcript、设备、前台应用与控制 epoch 校验。Chrome 保留端点、实际标签、文档/站点与本地手势校验。观看票据不给输入权限，播放恢复不自动取得控制或继续 Agent。 |
| 媒体与性能 | 能力协商后自动选路径。每个来源只采集一次，控制排队，尽量直接发送已有视频轨或编码帧，使用同一组首帧、呈现、帧龄、冻屏与恢复指标。媒体避开聊天事件和回放。 | 当前 Phone Use 从 Gateway 转发编码流。Chrome 源端发 WebRTC，直连时媒体从 Chrome 到观看端，需中继时走与 Gateway 部署关联的 TURN。没有可用视频时才回快照或状态。 |

这里的「通过 Gateway」统一的是用户入口和授权。Phone Use 现有采集句柄就在 Gateway 所在主机，先到 Gateway 再分发自然且省事。Chrome 具备独立的媒体发送端，默认优先直达观看设备。管理员需要媒体统一经过部署边界时可在高级设置选中继模式，将 TURN 与 Gateway 一同配置。用户日常只点「查看」，个人 Chrome 首次按提示在源电脑授权一次，网络路径由产品选。诊断页记录实际选择的线路。

### 落地顺序与性能门槛

1. **浏览器首期先统一体验和接口。** Phone Use 的 H.264/WSS 解码路径继续作为现有可用实现，浏览器走 WebRTC 及独立快照降级。在 PC 和手机复用画面容器、可见性/清屏规则和状态组件。先验证本地 Phone Use 和浏览器各自的端到端时延，能从测量区分采集、关键帧等待、Gateway 排队、接收与呈现。
2. **Phone Use WebRTC 做独立对照。** 把通过 Phone Use 既有前台、代次和几何校验的 H.264 access unit 交给 Gateway 侧或同机媒体进程，在 profile/level、码率和解码能力兼容时直接封装成 RTP/SRTP，保持原编码数据。验证 SPS/PPS 与 IDR、RTP 时钟、旋转、接收端 PLI 到源刷新、带宽反馈与退档。WebRTC 不能自动把固定码率的 scrcpy 流变成自适应码率。若源无法及时降档、协商不兼容或需要常态转码，优先保留已有 WSS 或降为快照。人工输入暂走当前经租约校验的链路，并验证媒体切换不会释放仍有效的控制租约或重放输入。 [H.264 RTP 封装](https://www.rfc-editor.org/rfc/rfc6184.html) · [WebRTC H.264 协商](https://www.rfc-editor.org/rfc/rfc7742.html) · [WebRTC RTP 与反馈](https://www.rfc-editor.org/rfc/rfc8834.html)
3. **哪条路径快，用真机选择。** 对同一 Phone Use 来源、编码参数、观看端和网络分别跑 H.264/WSS 与 WebRTC。先跑同网条件，再跑受限网及双端同时观看。WebRTC 进入 Phone Use 的默认路径需在目标弱网上取得可重复的 P95 帧龄或冻结改善，并在同网维持首帧、控制响应、CPU/耗电及源端校验。若同网 WSS 实测更快，保留自动选择。首期浏览器发布不依赖 Phone Use 的传输迁移。

Phone Use 有历史基准可复用实验流程。局部模拟器报告记录过约 1016 ms 的冷启动首个呈现帧，两次持续手势约 24.1 / 25.1 个 Gateway 视频包/秒。指针 ACK 计到传输写入，视频包速率也不能替代屏幕呈现的 FPS 或端到端时延。这些历史样本用作对照参考，统一验收仍用本方案后文的高速摄影和分段指标，Phone Use 另外测触摸到画面反馈。 [Phone Use V2 验收记录](technical/phone-use-video-v2.md)

## 4. 个人 Chrome 与 WebRTC 链路

**首轮验证后的调整。** 优先验证把采集轨和 WebRTC 发送器绑定到当前任务文档的扩展隔离世界。长期运行的 offscreen 轨已经在隔离测试里出现跨文档后继续发送的行为，所以下述 offscreen 能力仅作为采集技术对照。整页导航先终止旧共享并清屏，新文档重新确认。用真实 Gateway、发布版 Chrome 和真机复验文档绑定与操作成本。 [第一阶段实测记录](browser-live-view-phase-one-delivery-plan.md#第一阶段实测记录)

### 授权、采集和观看顺序

1. **发现目标。** Gateway 从活动 run 解析 conversationId、runId、浏览器会话、实际端点及标签，生成仅供状态发现的预览 ID。浏览器执行与观看权限相互独立。手机发起观看后，Gateway 校验会话归属、配对与来源，创建有时限的待批准请求，定向通知该 Chrome 端点。
2. **源端同意。** Chrome 扩展验证手势来自绑定目标，显示来源域与接收设备。用 tabCapture 获取该标签的 stream ID，优先验证由同一标签内、已绑定 documentId 的扩展隔离世界消费为视频轨。手机或 Gateway 的远程消息不能产生 Chrome 用户手势。先建立源端授权和目标检查，媒体随后才可发布。只采集网页视口，无音轨，也不打开桌面捕获。[Chrome tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture) · [Chrome MV3 采集](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)
3. **一台观看端一条连接。** Gateway 向绑定的源和观看端定向交换 SDP 和 ICE。身份包含预览 ID、代次、观看端 ID 和一次协商 ID；只接受正确方向的新消息，重连不复用失效协商。观看端仅接收视频，源端单向发送。手机和 PC 同时观看时复用一个采集轨，每端独立协商和限速。上限先按 2 个并发观看端验证，观察源端编码实例和上行预算。
4. **直连及中继。** 同网或 ICE 可用的场景走直连，直连失败由 TURN/UDP 中继，受限网络验证 TURN/TCP 或 TURN/TLS。自托管部署可配置 TURN 的短效凭证与接入地址，明确「无 TURN 仅保证已验证可直连的场景」。已有 HTTPS/FRP 可承载 Gateway 信令，TURN 的可达性、端口、协议和区域时延独立验证。Gateway 不在 WebRTC 媒体路径上。首发一对二以内无需 SFU。[WebRTC TURN](https://webrtc.org/getting-started/turn-server)
5. **会话续期。** Gateway 同时给生产与观看端短租约，初值每 3 秒续期、失联后最长 10 秒失效。撤销通过定向状态即时通知双方，生产端关闭对应连接，观看端遮盖、销毁渲染和缓冲。任务结束、共享撤销、设备解绑、端点换绑均失效。仅网络切换可用当前授权进行一次 ICE restart，授权过期后重新申请。停止最后一个观看端后释放采集。

### 换页、敏感内容与并发竞态

- 授权绑定源端点、实际任务标签和站点范围。Agent 可按已有执行规则切页。同一文档内的地址变化仍须验证共享范围；跨文档导航结束旧共享。聚焦另一标签不会让直播跟着切。切换目标标签、打开新标签或需要扩大共享范围时按新目标走授权及手势。
- 已知登录、支付、OAuth、验证码等路径，以及 Agent 发起的站点切换，先进入隐私暂停，源端停发并确认，然后才允许该浏览器动作继续。应用立即遮盖旧帧。已授权源重连也需检查当前文档及代次。可用浏览器端的导航约束阻挡未授权顶层跳转，候选包括限定到任务标签的会话期请求规则。跳转回调可能晚于 compositor 产帧，也无法识别通用网页绘制的所有私密内容。必须用带标记的重定向、弹窗、登录和手动导航验证零泄露；无法证明已经拦在画面发出之前的目标或浏览器版本只开放经同一校验的快照或进度状态。[Chrome 请求规则](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- 所有媒体传输及降级沿用同一授权，旧代次帧、旧视频轨、旧 ICE 消息和旧快照一律丢弃。关闭端点或浏览器、撤销与切目标都允许重复执行。用户撤销优先于端侧重试。采集停止后回收视频轨、发送器及任何临时导航约束。

## 5. 弱网怎么退、何时恢复

先让 WebRTC 拥塞控制自行调整，应用只管理档位限制及回退。以下初值进实验配置，用真机调参。对有持续运动的画面按每秒采样、3 秒窗口评估，静态页空闲依赖心跳。手机小窗与 PC 档位彼此独立。

| 档位或事件 | 行为与可见状态 |
| --- | --- |
| 正常视频 | 小窗长边 640–768 px、15–24 fps、约 0.5–1.2 Mbit/s。PC/全屏长边 960–1280 px、24–30 fps、约 1.2–2.5 Mbit/s。先把中文网页读清楚，再增加画质。 |
| 弱网视频 | 持续运动时，3 个采样中至少 2 个呈现帧率低于该档目标的 70%，或单个 3 秒窗口出现两次超过 250 ms 的冻结，每次降一档。若发送端判断为编码 CPU 或接收端判断为解码瓶颈，同样降分辨率并单独标记原因。长边约 480–640 px、10–15 fps、0.25–0.65 Mbit/s。滚动时优先新鲜度，静止时减少发帧并尽量维持字形。显示「弱网 · 正在调整」。稳定 10 秒才尝试升一档，升档间隔至少 10 秒。 |
| 网络切换或 ICE 断开 | 保留现会话短时间等待恢复，必要时一次 ICE restart，按候选路径使用 TURN。画面最多短暂保留 2 秒，继续没有新画面则清除并显示重连。恢复时校验授权及当前代次。 |
| 视频无法建立 / 已降到低档仍不可用 | 初始协商 5 秒仍无首帧，或一次重启失败，或最低档在持续运动时连续 5 秒无法维持画面更新，尝试与同一观看端切到独立 WSS 快照。JPEG 从长边 480 px、1–2 fps 开始，首帧及时刷新。发送前只留最新帧，已写入 TCP 的积压触及缓冲阈值时断开。明确显示「低帧率预览」。 |
| 回到视频 / 无权限或无带宽 | 降级后稳定 15 秒或用户点重试，尝试恢复视频。确认同代次视频实际呈现后切换并关闭快照，防止来回跳。若快照也不可用，则显示操作状态和具体原因。撤销、隐私暂停及目标失效不触发媒体降级。 |

信令和媒体连接分开观测。使用 selected ICE candidate pair、RTT、实际码率、丢包、解码、接收抖动缓冲、冻结和呈现间隔定位问题。可用吞吐指标按平台特性探测，指标缺失不能当作网络良好。WebRTC 累计数据取窗口增量再按帧数归一化。压测用含运动画面的受控网页，以可见帧龄和冻屏为准。[WebRTC 统计规范](https://www.w3.org/TR/webrtc-stats/)

## 6. 延迟验收与发布条件

### 测量口径

- **点击到首帧**从用户点击「查看」起算到第一帧真实呈现。暖启动从已授权且已有共享轨时点「查看」起算。冷启动包含建采集轨与建媒体连接，测试时协调源电脑立即点击授权，记录操作间隔并从首帧性能值中剔除可单独测量的人工等待。首次实际使用的总耗时同时保留。连接超时、降级和打开失败计入总体成功率，WebRTC 达标结果只按真实视频样本计算并同时报告失败率。声明支持的稳定网络组合，WebRTC 打开成功且不用降级的比例目标 ≥ 95%。
- **画面端到端**从测试源页实际显示变化到观看端显示该变化。受控测试页渲染递增序号和随机翻转色块，240 fps 相机同框拍源屏和观看屏，记录约 4.2 ms 的逐帧量化误差。跨网可让两屏同地、使用独立出口或网络仿真；确需跨地域测量时记录时钟同步误差与源时码。隐藏或最小化源使用可追溯的合成/采集时间和客户端呈现，单独报告口径。网络 RTT 仅作诊断。
- **连续性**用 10 分钟的持续滚动、停顿、点击、中文表格和页面切换脚本，测帧间距、播放冻结及恢复。对同一 PC、Chrome 标签、手机和网络做 WebRTC 与 JPEG/WSS 的 A/B。每个发布组合至少 30 次冷/暖打开，各至少 100 次页面变化，另报告 P50、P95、失败/降级率。局域网、跨网直连、TURN/UDP、TURN/TCP 或 TLS 各自出报告。

| 首期发布项 | 目标与条件 |
| --- | --- |
| 首帧 | 已授权暖启动 P95 ≤ 800 ms，冷启动 P95 ≤ 2 s。 |
| 画面变化到观看端呈现 | 局域网 P95 ≤ 150 ms，稳定跨网直连与 TURN/UDP 各 P95 ≤ 300 ms。记录测量拓扑与两端 RTT，参考跨网环境 RTT ≤ 80 ms 且丢包 < 1%。TCP/TLS 受限网单列回连与降级结果。 |
| 流畅与文字 | 局域网持续滚动，小窗实际呈现 ≥ 15 fps、PC 或全屏 ≥ 24 fps 的目标覆盖至少 95% 活动测量窗口。展开后能读约 14 CSS px 的中英文样稿。统计冻结超过 250 ms 的占比及次数。参考目标稳定链路 10 分钟内累计冻屏占比 ≤ 1%。 |
| 弱网 | 限速 0.5 Mbit/s、150 ms RTT、3% 丢包分别及组合压测。验证视频降档或进入可标识的快照/状态；不得持续显示为实时却越来越滞后。Wi-Fi 与蜂窝互切后，有效信令、媒体路径恢复且源和授权有效时，恢复当前画面 P95 ≤ 3 秒。 |
| 双端与生命周期 | 同时手机小窗 + PC 面板。对其中一端单独限速验证另一端继续更新。小窗与全屏切换不中断连接，退出后台和锁屏释放。开预览对 Agent 动作 P95 增幅 ≤ 10%。 |
| 授权与隐私 | 正常连接下撤销到两端清屏 P95 ≤ 1 秒，信令断开按不超过 10 秒的租约兜底。覆盖错误标签、重定向、OAuth、弹窗、手动跳转、旧代次、跨会话票据和重启，确认受保护区域零帧外泄。 |

### 局域网 100 ms 目标与分段预算

**优化目标为稳定局域网直连、发送 30 fps 活动档、单观看端、已预热会话的屏幕到屏幕延迟 P95 ≤ 100 ms。** 先用真实 Windows 或 macOS 工作机、有线接入同一局域网、手机接同一 AP、目标约 720p 等级的画面进行基线测试。局域网基线建议空闲 RTT ≤ 10 ms，报告带载 RTT、丢包、实际捕获和呈现帧率、编码器/解码器以及屏幕刷新率。端上 60 Hz 即纳入参考矩阵。PC Web、Electron、各手机端分开出数。既有局域网发布线 P95 ≤ 150 ms、跨网发布线和首帧目标按上表执行。100 ms 评估的是视频已建立后的画面更新。

| 环节 | 直连预算 | 同网 TURN/UDP 预算 | 同一帧的计时边界 |
| --- | ---: | ---: | --- |
| 采集 | 32 ms | 32 ms | T0 浏览器合成出新画面 → T1 捕获的画面可交给发送端。包括等采样、缩放、拷贝。 |
| 编码 | 10 ms | 10 ms | T1 → T2 编码帧可供 RTP 打包。包括等待编码器和实际编码；关键帧单列。 |
| 发送排队与打包 | 4 ms | 4 ms | T2 → T3 该帧所需的原始 RTP 包全部交给源端网络栈。包括打包、加密和 pacing 排队。 |
| 网络传输 | 8 ms | 14 ms | T3 → T4 接收端凑齐该帧所需数据包。包括无线排队及该帧所需的补包。同网 TURN 档包含两段网络和 TURN 停留，初始预留相对于直连多 6 ms，其中 TURN 停留目标 ≤ 2 ms。 |
| 接收抖动缓冲 | 10 ms | 10 ms | T4 → T5 完整帧开始解码。单列末包到齐后的等待，避免与上一段传输重复计时。 |
| 端上解码 | 8 ms | 8 ms | T5 → T6 解码输出可交给呈现层。 |
| 合成与显示 | 17 ms | 17 ms | T6 → T7 画面实际可见。包含渲染提交、合成和屏幕刷新等待。 |
| **预算合计** | **89 ms** | **95 ms** | 相对于 100 ms 留 **11 ms / 5 ms** 余量，供尾部波动及源合成到可见差异使用。 |

分段数字是用来定位瓶颈的初始规划值，不能把各段实测 P95 相加当作端到端 P95。表中 T0 是合成时间，240 fps 相机的起点是源屏首次可见时间。两种起点分别记录，有条件时实测差异。T7 以光学上屏为准，系统合成记录主要用于定位。

**100 ms 在受控条件下有机会，需要实测确认。** 若 30 fps 以固定周期采样，随机变化仅等待下次采样的 P95 约 32 ms，15 fps 则约 63 ms，且尚未计入缩放、复制和后段。验证极限时保持活动档，分别测试小窗和全屏实际发帧；如果小窗降至 15 fps，单列该档。60 Hz 显示如果多等一轮刷新就增加约 16.7 ms。硬编/硬解、视频轨直发和只保留有时效的数据都需要在真机上证实。

**中继单独归类。** Gateway 的授权和信令主要影响首帧和重连。WebRTC 中继时，Gateway 部署旁的 TURN 转发加密媒体包，Gateway 应用不搬运每帧。同网 TURN/UDP 的 14 ms 是紧张的实验预算，达不到就单独报告，不能并入直连成绩。云端 TURN、TURN/TCP/TLS、WSS/JPEG 回退和 Phone Use 的 H.264/WSS 分别建基线。跨网按原发布目标，快照归入降级。 [WebRTC TURN](https://webrtc.org/getting-started/turn-server)

### 真机怎么定位哪一段变慢

1. **先量用户实际看到的延迟。** 测试页在持续滚动或动画中，以随机相位翻转带序号的高对比度色块。240 fps 或更快的相机同框拍源屏和接收屏，色块放在两屏相近的扫描位置，并固定显示刷新率或记录实际数值。记录相机约 4.2 ms 的帧间隔及屏幕扫描误差。每组合做 3 轮、每轮至少 100 个变化样本，分别报告 P50/P95/P99、丢标、冻结和成功率。近 100 ms 且落在误差带内的结果用更高速摄影复测。保持同一源、同一接收端和相同分辨率/帧率，依次测直连、强制同网 TURN/UDP、真实跨网，再测手机与 PC 同时观看。以 ICE 选路和 TURN 收发计数确认实际路径。
2. **用同一帧串起内部时间。** 使用测试页的画面序号对齐光学样本，以 RTP 时间戳连同 SSRC 和当前连接代次匹配发送、接收和解码。源端 Chromium trace 观察合成、capturer、编码和发送队列，接收端用 SDK trace 记录末包到齐、等待解码、解码输出和渲染提交。中继侧有条件时用同一 RTP 包的进出时间测 TURN 停留。端内用单调时钟。跨设备仅在同步误差实测 ≤ 2 ms 时报告逐帧单向网络段，且附误差；否则用光学全程、端内分段及同网强制 TURN 的对照差值诊断。RTT 和两端日志的未校准时间差均不能单独给出单向耗时。缺少同帧匹配或不可见的 SDK 阶段标为未分离，避免硬凑预算。
3. **用应用统计找段，再用 trace 定因。** Web/Electron 可用 requestVideoFrameCallback 的可用字段记录 RTP 时间戳、接收、处理和预计显示时间。该回调描述浏览器呈现链路，光学摄影确认实际亮屏。移动端以 RTC SDK 的帧回调及系统呈现 trace 为辅。Android 优先用 Perfetto 检查合成及掉帧，按实际渲染表面确认支持。getStats 的编码、发送排队、缓冲和解码指标是窗口统计。用计数差算均值定位，再回到慢帧 trace。标准 jitterBufferDelay 从首包进入起算，和网络包到齐区间有重叠，不能再和本表网络段相加。 [视频帧回调规范](https://wicg.github.io/video-rvfc/) · [WebRTC 统计规范](https://www.w3.org/TR/webrtc-stats/) · [Android Perfetto 帧时间线](https://perfetto.dev/docs/data-sources/frametimeline)

| 真机现象 | 先看哪里 | 对照验证 |
| --- | --- | --- |
| 视频稳定收到，但源页变了还要等一拍 | T0→T1 采集帧间隔、源页合成节奏及 GPU 拷贝 | 同一端比 15/30 fps，前台与最小化分别出数。 |
| 捕获正常，发送越来越晚 | T1→T3、编码实现、关键帧、发送排队 | 比较硬编与当前编码、两档分辨率、单观看与双观看，观察 CPU/GPU 和上行。 |
| 只有强制中继明显变慢 | 选中的 ICE 路径、实际 TURN 进出、无线或两段链路拥塞 | 同网同参数交替直连和 TURN/UDP，确保未意外走 TCP/TLS 或远端 TURN。 |
| 包及时收齐，画面仍逐渐落后 | T4→T5 和接收端队列，排除补包和缓冲增长 | 降码率后看帧龄是否恢复，保持分辨率/刷新率，检查抖动缓冲随时间变化。 |
| 解码完成很快，手机画面仍迟 | T6→T7、合成/刷新、渲染表面重建 | 同设备比小窗与全屏、空闲和聊天列表滚动，查额外一次 VSync 或显示队列。 |

### 发布顺序

逐项复用边界、实施依赖和真机执行清单见 [首期实施与真机验收](browser-live-view-phase-one-delivery-plan.md)。

1. **Chrome 端到端试验。** 同一真实任务验证工具栏手势、offscreen 采集、后台/最小化、跨站隐私和 TURN。用 PC 与一个原生手机验证 WebRTC 与快照的实际差距。
2. **接入各观看端。** PC Web/Electron 右侧面板以及 Android、iOS、HarmonyOS 应用内小窗按能力落地。手机和 PC 从任务进入同一已授权源，双端同时观看通过。PC 与一个已声明支持的手机平台通过 WebRTC 验收仍只代表该组合达标，其他端按各自验证结果开放。
3. **按路径和机型放量。** 只有个人 Chrome 的真实连续视频与弱网、撤销门槛通过后，才开放该组合的实时预览。降级组合按实际能力显示。发布记录包含出帧、画面延迟、冻结、降档频率、TURN 比例、端侧 CPU/耗电及浏览器任务性能。

本轮为文档设计。SDK、采集限制及所有数值需在首轮试验验证。
