# xopc 三通道升级调研与设计

2026-11-11 · Telegram / 飞书（Feishu、Lark）/ 微信

## 决策

- **微信优先修收件，再补引用与多附件。** 腾讯 3.0 beta 的收件恢复设计值得借鉴。协议兼容以 2.4.10 为基线，PIN 挑战按平台响应逐步兼容。继续内置轻量 iLink 客户端。
- **Telegram 优先修轮询与出站恢复，同步升级 grammY。** 自托管主路径保留 BotFather Token，随后用扫码或打开 Bot 完成主人配对。Managed Bots 可以做到免粘贴 Token，适合单独验证托管服务的凭据权限和运维模型。
- **飞书优先让扫码在干净安装上走通。** 已有扫码注册与 CardKit，不必另起一套。先把默认私聊改为仅扫码本人，补齐 SDK 按需交付、机器人身份探测和双向验证，再升级卡片可靠性。

三条通道共用接入界面和持久收件约定。各平台保留自己的授权、收件协议、限速、消息格式和降级策略。

## 取样与证据

| 对象 | 2026-11-11 拉取或核对的版本 | 用法 |
| --- | --- | --- |
| xopc | `025cb9b59b6aacf57775db366dd2eb30dadfa942` | 读本地 Gateway、Web 接入和三个 bundled extension |
| OpenClaw | `main@26a4a89b304f1363e2564666dac47a47620ad26c`；npm latest 对应 `v2026.11.3@847611dcaa3bf0e2783335f961dd1fd0580e4d9f` | Telegram、飞书对照最新主线与稳定 tag；两者代码有明显差异 |
| 腾讯微信 | `main@0ad1ae91347a938f52f1e4e2abd6dcda51e05f9e`；包版本 `3.0.0-beta-0`；npm latest 为 `2.4.10` | 同时检查主线和 npm 稳定 tarball 中的源码 |

源码快照在本机 `/tmp/xopc-channel-research.CHdHho/`，分别为 `openclaw`、`weixin` 和 `stable-weixin/package`。OpenClaw 使用浅克隆和 sparse checkout，稳定 tag 已抓取。npm 使用 `npm pack --ignore-scripts` 取公开发行件并读取 tarball 元数据。来源见 [OpenClaw 主线](https://github.com/openclaw/openclaw/tree/26a4a89b304f1363e2564666dac47a47620ad26c)、[OpenClaw 稳定发布](https://github.com/openclaw/openclaw/releases/tag/v2026.11.3)、[腾讯微信主线](https://github.com/Tencent/openclaw-weixin/tree/0ad1ae91347a938f52f1e4e2abd6dcda51e05f9e)、[微信 2.4.10 发行件](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin/v/2.4.10)。

## Telegram

**当前已有。** grammY、runner、代理/API Root、offset 持久化、论坛话题、配对、原生按钮及流式回复。锁定的 grammY 是 1.43.0；原生 `sendMessageDraft` 已有能力探测和普通消息编辑回退。前端仍是 BotFather → 粘贴 Token → 配对。见 [xopc polling](../../../extensions/telegram/src/polling-session.ts#L31)、[draft](../../../extensions/telegram/src/draft-stream.ts)、[接入向导](../../../web/src/features/settings/channels/telegram-setup-guide.tsx)。

**稳定版上游可借鉴。** 以成功结束的 `getUpdates` 作为健康信号，空响应同样有效；独立拉取与 spool 入队，成功持久化后确认；区分重复 poller/Webhook 冲突、暂时断网与限流，退出时清理 transport。xopc 当前在 `await next()` 前写 offset，首次恢复时用 offset + 1 请求；handler 未处理完就退出时，该 update 可能被跳过。当前 watchdog 只看收到 update 的时间，健康的空闲 Bot 也可能触发重启。建议保留现有 grammY handler，在其前增加受控轮询适配与持久收件，确认边界移到收件事务。一个凭据只允许一个本地 poller，409 直接给出冲突诊断；检测已有 Webhook 后提示处理，避免无提示删别处的订阅。分别记录最近成功轮询、最近收到用户消息、最近完成回复。见 [稳定版 polling session](https://github.com/openclaw/openclaw/blob/847611dcaa3bf0e2783335f961dd1fd0580e4d9f/extensions/telegram/src/polling-session.ts)、[主线 liveness](https://github.com/openclaw/openclaw/blob/26a4a89b304f1363e2564666dac47a47620ad26c/extensions/telegram/src/polling-liveness.ts)。

**能力升级。** 先将 grammY 升至上游同版 1.46.0，验证 runner、代理、附件、回复线程及不同 API Root。采用稳定版的限流和可恢复投递思路，处理 429 的 `retry_after`，节流同一回复的更新，按目标会话顺序发送。首个增强选主线的 Rich Messages 子集，优先表格、代码和引用，按账号或 API Root 探测能力，遇到明确不支持时回退现有 HTML/文本。Telegram Bot API 已到 10.4；上游主线有 Widgets 并带 QuickJS/WASM，不纳入本轮。原生可停止草稿是单独增量，后续需把停止事件校验到原聊天、发起者及 run，再接 xopc 取消机制；调研到的上游 `allowed-updates` 还显式排除了该事件。见 [Bot API](https://core.telegram.org/bots/api)、[主线 rich message](https://github.com/openclaw/openclaw/blob/26a4a89b304f1363e2564666dac47a47620ad26c/extensions/telegram/src/rich-message.ts)、[主线包清单](https://github.com/openclaw/openclaw/blob/26a4a89b304f1363e2564666dac47a47620ad26c/extensions/telegram/package.json)、[allowed updates](https://github.com/openclaw/openclaw/blob/26a4a89b304f1363e2564666dac47a47620ad26c/extensions/telegram/src/allowed-updates.ts)。

**接入设计。** 本地版先提供一个 Token 输入框，保存前跑 `getMe` 并显示 Bot 名称，再提供短期一次性 `t.me/<bot>?start=<nonce>` 链接和同内容二维码。仅消费来自目标 Bot 的私聊 start，把发起接入的 Gateway owner 和 Telegram sender ID 绑定起来；在控制台显示认领身份并确认，收码本身不会开放陌生人的 DM。托管试点可以用官方 `t.me/newbot/…` 创建 Managed Bot，manager 消费 `managed_bot` 事件并调用 `getManagedBotToken`。先通过 manager 私聊的一次性连接会话绑定 Telegram 用户，再核对创建事件的 user、Bot 和接入会话，处理撤销和换 Token。manager 拥有获取与更换受管理 Bot Token 的权限；单独评审凭据交付、租户隔离、恢复和离线自托管路径。Telegram 的普通账号扫码登录不能替代 Bot 授权。见 [Managed Bots 官方指南](https://core.telegram.org/bots/features#managed-bots)、[Bot API getManagedBotToken](https://core.telegram.org/bots/api#getmanagedbottoken)。

## 飞书与 Lark

**当前已有。** `/oauth/v1/app/registration` 探测、扫码/手动录入、WebSocket/Webhook、多账号、卡片流式、文档/Wiki/云盘/多维表格工具。接入代码已经请求 `open_id`，但在新配置下把 `dmPolicy` 默认设成 `open`，与本地文档描述的配对默认值不一致。OpenClaw 扫码向导在拿到扫码人的 ID 后设置 `allowlist`。改为对新账号在账号级写入仅扫码本人，无法取得可信 `open_id` 时转显式配对；已有账号策略按原值运行，重扫时按目标账号更新，避免覆盖默认账号或静默扩大权限。新账号先启用消息功能，文档工具由用户在现有能力中心按需授权。见 [xopc setup](../../../extensions/feishu/src/adapters/gateway-setup.ts#L45)、[OpenClaw setup](https://github.com/openclaw/openclaw/blob/26a4a89b304f1363e2564666dac47a47620ad26c/extensions/feishu/src/setup-surface.ts)、[上游飞书引导](https://github.com/openclaw/openclaw/blob/26a4a89b304f1363e2564666dac47a47620ad26c/docs/channels/feishu/setup.md)。

**扫完后的真实状态。** 先选飞书/Lark；引导自动探测 SDK、扫码入口和连接模式。扫码成功只代表拿到凭据。再展示应用身份与租户，启动长连接，让用户在飞书发一条验证消息，Gateway 原路回复后才显示「已连接」。平台需要发布、审批、事件订阅或机器人权限时，单独显示可执行的下一步。WebSocket 默认，无需用户提供公网入站地址；手动 App ID/Secret 和 Webhook 放进高级入口。飞书官方要求长连接事件在 3 秒内处理并支持重推，持久收件应位于 ACK 前，下载附件、模型推理和卡片更新都放在 ACK 后。验收需要覆盖实际 SDK 的 ACK 行为，并检查同一个 App 多个实例的竞争。见 [飞书长连接说明](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-)。

**收件与回复。** 目前两种 transport 都会在处理前做进程内去重，重启会丢失去重状态。Webhook 路径还有独立的文本解析和空文本提前返回。统一两种 transport 的验签后事件归一化、授权、去重、线程与媒体语义；串行键用账号和实际会话/话题，独立会话可并发。上游的分会话队列、持久去重与 CardKit 顺序控制有参考价值。xopc 已带 `sequence`，但部分更新/文本 fallback 只要 promise 正常返回就记成功，最终常规投递又看 `editedAtLeastOnce`。若 SDK 返回业务失败响应或只有早期预览成功，最终内容可能被抑制。改为分别记录「预览已送达」和「最终内容已确认」，检查业务码和消息 ID、合并中间帧、在 429 下重试最新帧。卡片缺 scope、超限或失效时，用同一会话/线程发最终文本；响应不确定时保留可重试状态。见 [xopc dedupe](../../../extensions/feishu/src/transport/reliability/dedupe.ts)、[Webhook](../../../extensions/feishu/src/transport/webhook/monitor.ts#L177)、[卡片流式](../../../extensions/feishu/src/streaming/streaming-adapter.ts#L105)、[上游消息处理](https://github.com/openclaw/openclaw/blob/26a4a89b304f1363e2564666dac47a47620ad26c/extensions/feishu/src/monitor.message-handler.ts)、[上游 CardKit](https://github.com/openclaw/openclaw/blob/26a4a89b304f1363e2564666dac47a47620ad26c/extensions/feishu/src/streaming-card.ts)。

## 微信

**当前已有。** iLink 二维码、刷新、凭据与 context token、多个账号、文字和媒体、typing；已有绑定当前私聊的安全配置与提醒投递。沿用这些产品能力。当前 monitor 在处理批次之前持久保存 `get_updates_buf`，又串行等待 typing 配置与消息处理；退出或单条失败可能影响同批其他消息。腾讯稳定版 2.4.10 仍在处理前保存游标；3.0 beta 的 journal 将游标和待处理消息一起保存，重启恢复未开始的消息，已执行的工作进入中断状态。xopc 用现有 SQLite 实现相同确认边界，落盘失败保留上次游标，瞬时网络问题退避，停止用清空游标处理轮询异常。按账号/对端管理 context token；把失效凭据状态显示成「需重新扫码」，换绑成功后再替换旧账号绑定。见 [xopc monitor](../../../extensions/weixin/src/monitor/monitor.ts#L116)、[稳定版源码发行件](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin/v/2.4.10)、[腾讯 journal](https://github.com/Tencent/openclaw-weixin/blob/0ad1ae91347a938f52f1e4e2abd6dcda51e05f9e/src/storage/inbound-journal.ts)、[xopc 对话配置](weixin-conversation-configuration-2026-10-28.md)。

**升级项。** 第一批吸收明确的网络错误分类和账号状态；xopc 已检查发送响应里的 `ret`，重点回归失败分类、退避和投递确认。第二批补多附件、引用和顺序：逐条读取 `item_list`、有界下载、保留正文与原附件顺序；旧引用失效时仍提交本条新消息。对 `svr_id` 等 64 位 ID 在解析阶段保留精确字符串，按账号和对端建立轻量引用索引。缓存限制容量、条数与保留时间，复用已有受管附件目录，避免保存两份。短窗口合并只用于同一私聊连续附件，命令单独提交。平台要求 PIN 时才在界面提示，保留普通扫码默认路径；本人接入若取得平台返回且可验证的主人 ID，可直接限定本人，历史账号与缺失 ID 的新账号继续执行现有授权。暂不承诺微信个人号全消息或群聊能力。见 [腾讯协议](https://github.com/Tencent/openclaw-weixin/blob/0ad1ae91347a938f52f1e4e2abd6dcda51e05f9e/docs/protocol_zh_CN.md)、[变更日志](https://github.com/Tencent/openclaw-weixin/blob/0ad1ae91347a938f52f1e4e2abd6dcda51e05f9e/CHANGELOG.zh_CN.md)、[引用缓存](https://github.com/Tencent/openclaw-weixin/blob/0ad1ae91347a938f52f1e4e2abd6dcda51e05f9e/docs/quote-cache_zh_CN.md)。

## 共用接入交互

复用 Gateway channel runtime actions 和 Web 的 `ChannelSetupCard`。三个入口都用「连接 / 重新连接」，展示简短进度「等待授权 → 凭据已确认 → 等待首条消息 → 已连接」。需要时显示「等待管理员」「需验证码」「通道组件未安装」「传输冲突」「需重新登录」和对应动作。桌面显示二维码，手机同屏提供打开应用入口，微信按平台返回能力提供二维码刷新。高级区保留代理、API Root、多账号、群权限、Webhook 与额外工具。

接入会话由 Gateway owner 发起并绑定具体通道/账号；会话 ID 随机、短期有效、可取消，完成后防止重复消费。扫码或录入后的凭据留在 Gateway，响应只含账号、状态与下一步；任何重新授权必须与目标账号和配置版本匹配，避免过期会话覆盖并行编辑。验证阶段收到的测试消息只验证通道与归属，成功后才交给正常会话路由。Web、Electron 内置控制台及 CLI 共用 Gateway 状态；其他客户端是否接入同一 UI 需独立验证。见 [Gateway actions](../../../src/gateway/hono/routes/channels.ts#L109)、[Web 接入卡片](../../../web/src/features/settings/channels/channel-setup-card.tsx)。

## 收件确认与恢复设计

1. **确认前落盘。** 在 xopc DB 增加有界收件记录，以 channel、凭据命名空间、平台事件 ID 去重。命名空间绑定 Bot/App 身份并兼顾账号映射，换绑新身份时切换游标。微信批次与不透明游标同一事务；Telegram 完整批次先入库，再允许下一次带更高 offset 的请求确认；飞书在持久接受后 ACK。对 SQLite 写入失败报警、退避并保留确认边界，队列满时暂停接收或返回平台可重试结果。
2. **持久接纳到 Agent。** 当前 `MessageBus.publishInbound()` 只交给内存消费者或队列，不能作为完成凭据。收件记录保留到现有会话输入持久层确认接纳，用收件 ID 作为幂等键，将接纳与收件状态提交在同一数据库事务，或在重启时以持久输入反查确认。普通聊天、控制命令、卡片动作分别定义接受语义，避免直接改写 transcript 或仅依赖内存事件。命令或动作进入外部副作用阶段后，崩溃时记为「执行结果待确认」，避免静默重放。失败退避，人工补发需可定位原账号、会话和事件。
3. **保持正确顺序。** 入库与媒体下载解耦，按照通道实际会话/话题串行接纳，不让慢附件阻塞整个账号。永久失败可定位并结束单条工作，允许其他消息继续。隔离不同账号的重复 ID、权限和附件，日志及指标只记录阶段、失败分类、可脱敏关联 ID 和数量。
4. **区分预览与最终投递。** 预览可合并丢弃；最终回复记录稳定投递 ID 和分片进度，优先用平台幂等能力。对网络超时且平台可能已收件的发送，记录「结果待确认」，按平台可核对能力处理，避免盲重发。保留 xopc 已有的提醒、自动化持久 outbox 路径；先确认现有通用队列能承接哪些回复。
5. **迁移与回退。** 使用当前 SQLite 升级链增量迁移，首次启用导入仍匹配账号身份的旧 cursor/offset。切换前停止旧 poller。新路径需能排空待处理收件后回到旧 handler，平台确认已推进时，待处理记录必须先处理或保留给支持该 schema 的恢复程序。既有账号、配对、会话 UUID 和话题路由纳入回归。

见 [内存 MessageBus](../../../src/infra/bus/queue.ts#L19)、[Agent 收件循环](../../../src/agent/inbound/inbound-loop.ts#L112)、[会话输入仓储](../../../src/storage/sqlite/session-input-repository.ts)。

## 包体积与交付

同一 npm registry 实测，单位为十进制 MB。解包大小含 SDK 自身的声明文件等内容，未计传递依赖，也不等于 Electron 安装包增量。

| 发行件 | tgz MB | 解包 MB |
| --- | ---: | ---: |
| grammY 1.43.0 → 1.46.0 | 0.211 → 0.217 | 1.319 → 1.377 |
| Lark SDK 1.66.0 → 1.74.0（上游稳定） | 1.271 → 1.698 | 26.735 → 30.230 |
| Lark SDK 1.76.0（上游主线） | 1.705 | 30.259 |
| 腾讯微信 2.4.10 | 0.173 | 0.697 |
| QuickJS-WASI 3.6.3 | 0.569 | 1.525 |

用 xopc 现有 `dist/extensions` 对照 Electron 的 esbuild 参数做了只读内存打包。三个扩展的 minified JS 体积为飞书 1.203 MB、微信 1.957 MB、Telegram 9.314 MB，单独 gzip 后分别为 0.302、0.533、2.271 MB。飞书 bundle 存在 SDK 名称引用，metafile 的 Lark SDK 输入为零；Electron 最小生产依赖清单也排除了可选 peer。干净安装首次启用时需要独立交付或已有可解析 SDK。现有扩展 bundle 之间可能有共享代码重复，以正式制品 diff 和依赖清单判断增量。见 [SDK 动态加载](../../../extensions/feishu/src/transport/client/lark-sdk.ts)、[Electron extension build](../../../scripts/build-electron-extensions.mjs)、[Electron runtime dependencies](../../../scripts/electron-runtime-externals.mjs)。

- **默认包。** 复用 Node SQLite、现有 QR 渲染、Weixin iLink 与现有语音解码。Telegram 升级现有 SDK，等首轮包体 diff 后决定是否调整依赖去重；新能力优先纯 TS 和现有渲染。npm、Electron 与移动制品分别统计。建议本轮给基础压缩制品设 **+0.5 MiB** 预算，按同平台、同架构、同制品类型比较。
- **飞书按需组件。** npm 自托管继续支持可选 peer。Electron 首次连接时复用现有托管运行时下载模式，优先发布独立版本锁定、可校验的 SDK 与完整运行时依赖制品，原子安装到用户数据目录，支持离线导入、重试和上一版回退。先验证 1.74.0，再用同一套长连接、Webhook、CardKit 与 Lark 国际版契约检查 1.76.0，选通过验收的更新版本。暂不自研长连接协议；后续用制品与运行数据评估是否值得把轻量 REST 客户端分离出去。

## 交付顺序与验收

| 阶段 | 范围 | 通过条件 |
| --- | --- | --- |
| P0 可靠性 | 微信/Telegram 持久收件，Telegram 空轮询与 409，飞书安全默认和统一收件入口 | 注入事务前/后、ACK 前/后、接纳前/后崩溃，已确认事件可追踪且未接纳事件能恢复；重复事件只有一条会话输入；在途有副作用工作不会静默重跑；Feishu WS/Webhook 的文本、附件、线程一致 |
| P1 接入和最终回复 | 接入向导、飞书 SDK 按需交付、微信账号失效/扫码，Telegram Token 后扫码配对，飞书最终回复确认 | 干净 npm 和 Electron 安装走完首次连接；真实客户端双向验证；扫码过期/取消/并行接入有明确状态；管理员拒绝或 SDK 下载失败后可重试；卡片 429、业务失败、预览成功但最终帧失败时有最终回复或明确失败状态 |
| P2 平台能力 | 微信多附件和引用、Telegram 富文本、飞书卡片收尾，按需能力启用 | 微信两条消息多附件、旧引用缓存 miss、64 位 ID；Telegram 富文本→HTML/纯文本；飞书卡片限额、缺 scope、线程回退；每项都通过跨账号隔离与包预算 |
| 独立试点 | 托管 Managed Bots | 实际创建、首次收发、撤销/换 Token 和回到手动接入；验证不同 Gateway 的认领隔离与凭据交付流程 |

当前已运行 `pnpm run test:extensions`，29 个文件、256 个测试通过。这里只做源码、发行件和现有测试验证，尚未做真实平台账号接入、崩溃注入或最终 Electron 安装包 diff。以上 P0–P2 都是待实施设计。

## 2026-11-12 实施与验收

- Telegram、飞书和微信使用现有 SQLite 持久表保存平台收件及 Agent 待处理输入。Telegram 和微信将页游标与收件一起提交，飞书 WebSocket 和 Webhook 共用消息接收、授权、去重、线程和附件处理。安全的附件准备可重放，开始执行的命令或发送结果不明的最终回复保留中断状态。新增持久层无需改变数据库 schema。
- Telegram 自托管版验证 Bot Token 后支持扫码或点链接认领，用户在控制台确认后完成配对。飞书和微信扫码后进行双向消息验证。飞书 SDK 1.76.0 使用固定版本和哈希按需安装，并裁去仅供开发使用的 SDK 类型和 ESM 副本。
- Telegram 使用 grammY 1.46.0，支持向有能力的 Bot API 发送代码、表格和引用富文本，并在明确拒绝时走 HTML 或纯文本。飞书 CardKit 串行更新并在流结束时关闭流式模式，最终回复单独检查平台确认。微信支持平台触发的 PIN、精确的 64 位消息 ID、多附件和按账号、对端隔离的引用恢复。
- 真实本地 Gateway 配模拟 Telegram Bot API，验证认证路由、Token 校验、轮询、测试回复和确认配对。Chrome 中走通 Token 表单、二维码链接、配置刷新后的本人确认。飞书用实际 SDK 验证签名 Webhook 和重复事件过滤，并在空白状态目录验证 SDK 下载、校验、解包和加载。收件 SQLite 通过进程 SIGKILL 恢复验证。
- Electron 三通道 JS 以同样参数 gzip 对照调研基线，合计约增加 0.29 MB。SDK 的 52 个固定版本发行件共下载约 3.89 MB，按需安装目录约 18 MiB。正式签名安装包的整包差值、真实 Telegram/飞书/Lark/微信账号扫码和收发需要另行实测。Telegram Hosted Managed Bots 是独立试点。
- 通道与 Gateway 定向回归 321 项通过。Node、Web 与 Electron Gateway/扩展构建通过。一次全量回归中 13,719 个用例通过，38 个跳过，语音 WebSocket 关闭原因用例失败。单独重跑该语音测试文件时 16 个用例通过。
