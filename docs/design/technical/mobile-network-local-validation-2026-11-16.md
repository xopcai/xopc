# 手机连接网络延迟的本机验证

2026-11-16 · 本机 Gateway 0.0.477 · macOS

## 事实

同一个 Gateway 同时提供 loopback 和正常运行的官方 FRP 隧道。本机有 Tailscale，当前 tailnet 中没有第二台设备。没有接入 Android、HarmonyOS 或 iOS 真机。下面的 FRP 数据来自开发机经公网回到本机 Gateway。

| 路径或操作 | 样本 | 中位数 | 最大值 |
| --- | ---: | ---: | ---: |
| Loopback `/api/health`，热 | 10 | 1 ms | 1 ms |
| FRP 下真实 Gateway `/api/health`，冷 | 6 | 587 ms | 592 ms |
| FRP 下真实 Gateway `/api/health`，热 | 10 | 281 ms | 299 ms |
| FRP Broker 自身 `/health`，热 | 10 | 146 ms | 203 ms |
| Model Gateway 自身 `/health`，热 | 10 | 133 ms | 148 ms |
| Loopback 已认证的三项串行读取 | 11 | 51 ms | 73 ms |
| FRP 已认证的三项串行读取 | 11 | 1,105 ms | 1,269 ms |
| FRP 已认证发送准备中的 Agent 配置读取 | 11 | 322 ms | 350 ms |
| FRP 取 ticket 至 WebSocket ready | 11 | 1,156 ms | 1,240 ms |

健康端点计时用 curl DNS、TCP、TLS 和首字节字段。初测以 HTTP/1.1 复用连接依次读取同一个会话的 compact history、agent-config、context-summary，排除预热样本。随后代码走查发现旧 iOS 每条消息还读取一次 `/api/health`，配对对照补齐了此项。WebSocket 测试使用短时 owner ticket 和真实 hello/ready，覆盖独立连接的网络开销。原生配对签名、App 执行及发送 POST 另计。一次 Node/Undici HTTP/2 探测出现超时，归因需要原生客户端复现。

从本机直接发起 4 次极短合成流式请求，设为关闭 thinking、最多 16 个输出 token。Cloud `auto` 首正文 **960–1,186 ms**，直连 DeepSeek Flash 首正文 **376–791 ms**，8 次均返回 OK。Cloud 响应只标注 `auto`。下一轮需要固定实际部署，再评估缩短路由的收益。

macOS 同时启用了本地 HTTP、HTTPS 和 SOCKS 代理。原生 `URLSession` 探测实际连接到该代理端口，一轮出现大量超时，随后另一次也有失败。对同一地址做 curl HTTP/2 对照时，隧道健康请求直连 **590 ms**、经本机代理 **2,624 ms**，模型网关健康请求直连 **449 ms**、经代理超过 **4 s** 未完成。这是本机的代理路径差异。用例单独记录系统代理和直连，设备与生产区域还需各自取样。

## 可重复的验证标准

用 `pnpm exec tsx scripts/measure-gateway-network-latency.mts 12` 复测当前 Gateway。它使用本机已登录的 Gateway 和已固定模型的现有会话，输出耗时及失败阶段。该探针不发送聊天内容，也不输出凭据、会话 ID 或域名。环境变量 `XOPC_LATENCY_SKIP_FRP=1` 用于隔离的本地 Gateway，`XOPC_LATENCY_HTTP2=1` 用于单独诊断 HTTP/2。

- 每项记录所有尝试、超时阶段和成功率。12 次用于本机快速验证，真实环境发布门槛按每个网络分组至少 100 次记录 P50/P95，区分冷连接、暖连接、同网、蜂窝和切网。代理路径与直连各自取样。不同请求路径交替执行并排除预热。
- 首轮发送改动的门槛为普通既有会话的同步准备读取从 **4 次降到 1 次**，保留 Gateway 对 transcript 和配置版本的校验，保留任务对破坏性命令的限制。新旧 Gateway 都能发送。真实 FRP 上要求新路径的准备段中位数至少降低 **50%**，收据和回复无重复。
- 第一阶段真机验收分别记录点击到本地回显、Gateway 持久收据、首个可见正文、断线后继续收流。建议门槛依次为回显 P95 <100 ms、同网热态收据 P95 <300 ms、同城蜂窝中继收据 P95 <800 ms、网络恢复至续流 P95 <3 s。用 Gateway 固定响应桩隔离设备路径，再做同模型对照。
- 模型入口对照固定上游部署、thinking、prompt、工具定义和输出长度，记录首有效事件、首正文、成功率与回答质量。只有同配置对照通过后才据此调整正式模型路由。

## 首轮优化设计

复用现有 `GET /api/sessions/:key/agent-config`，由 Gateway 随配置版本返回当前 transcript ID。只读取会话元数据，避免为配置读取整个历史。iOS 普通发送只访问此配置快照，旧 Gateway 缺少 transcript 字段时保留历史回退。涉及任务连续性的命令仍检查会话归属。冷 endpoint 建连和输入准备可并行，最终 POST 等两者就绪。草稿已带完整模型和 thinking 时直接用已选配置。把逐条消息请求健康接口的能力检查移入建连，旧 Gateway 在建连时查询一次原接口。

命令收据原来也会读取并返回完整会话历史。iOS 接收端只读取收据、输入状态和会话标识，因此在既有提交与收据查询上增加 `view=compact`。回归要求同一条消息先以 compact 提交、再按两种视图重放时仍返回同一收据，而且只入库一次。旧请求继续使用原响应格式。

实时连接复用的验收见下文。LAN 直连和区域中继沿用原网络路径设计。 [网络路径设计](mobile-gateway-network-latency-2026-11-16.md)

## 首轮优化后的验证

| 试验 | 原路径 | 精简路径 |
| --- | ---: | ---: |
| 同一真实 FRP、同一会话、交替读取，11 个暖态样本的准备段中位数 | 4,303 ms | 330 ms |
| 同组暖态准备段最大值 | 4,401 ms | 354 ms |
| 复测逐请求中位数，5 个暖态样本 | 历史 2,751 ms、配置 324 ms、健康检查 291 ms、上下文 910 ms | 配置 325 ms |
| 隔离 Gateway 上同一收据的 JSON 大小，合成对话 | 14,919 B | 1,087 B |

FRP 对照在正在使用的 0.0.477 Gateway 上测试两条请求序列，确认了减少往返和历史传输的收益。精简序列只测配置请求的网络耗时，0.0.477 响应里缺新增 transcript 字段。已更新的 Gateway 在隔离状态目录运行，验证了新配置响应与持久收据 transcript 一致，过期 transcript 与 config version 均返回 409，同一请求在两种收据视图重放时只有一条输入和同一 run。合成收据的 JSON 缩小 **93%**。该实验的短本地历史与 loopback 环境中，两种收据耗时接近。

101 项 Gateway 测试、139 项 iOS 模拟器测试通过，3 项 iOS 测试跳过。Node 构建、TypeScript 检查和修改的 Swift lint 校验通过。此次交付覆盖 Gateway 与 iOS 发送路径。生产部署、代理规则、真实模型默认设置未改动。手机真机首正文、LAN 与区域中继需在下一轮验收。

## iOS 实时连接复用

一个已认证的 endpoint WebSocket 同时承载设备工具与多个 `run:<id>` 订阅。run 结束、消费者取消或服务器报告回放缺口时，客户端取消相应主题订阅。连接断开时，活跃消费者保留已交付的序号，等待同一设备连接重建并以 `afterSeq` 订阅原 run。回放缺口沿用原来的历史恢复。

同机协议对照对每个 run 同时创建两个观察者。两个观察者共享同一次发送、同一个 DeepSeek Flash 执行和同一条 FRP，分别在已有连接上订阅和为 run 单独取票建连。6 次实际运行的发送到首正文中位数为 **2,529 ms → 1,930 ms**，逐组节省 **310–756 ms**。强制断开后的长回复取样中，服务器确认游标 **4**，从 **5** 续流，下一段正文在 **1,491 ms** 到达。数字 1–300 完整且顺序正确，原 run 正常结束，尾部与持久历史一致。

原生对照使用 iPhone 17 Pro 模拟器实际运行 `GatewayClient.sendMessage`、旧的单 run socket 和新的共享 endpoint socket。HTTP 和 WS 由本机测试转发器连接同一官方 FRP，保留上游 TLS。使用同一个 DeepSeek Flash 配置和同样的合成短提示词，交替发送两种模式，排除一组预热。计时从调用发送到客户端收到首个非空正文增量。

| 原生对照 | 暖态样本 | P50 | 范围 |
| --- | ---: | ---: | ---: |
| 每条回复取票并建连接 | 6 | 2,448 ms | 2,387–2,607 ms |
| 复用现有 endpoint socket | 6 | 1,815 ms | 1,579–1,941 ms |

逐组节省 **524–957 ms**。长回复测试在观察到唯一的一条共享 WebSocket 后主动取消它，确认新 socket 从原 run 的序号 **5** 继续收到正文，断线点为序号 **4**，耗时 **2,321 ms**。序号严格递增，完整拼接文本与 Gateway 历史一致，数字 1–300 各出现一次且顺序正确。142 项 iOS 测试及 46 项 Gateway realtime 测试通过，另一次独立的 FRP 集成测试也通过。

复测命令为 `pnpm exec tsx scripts/measure-ios-realtime-reuse.mts 6`。脚本使用本机现有的官方 FRP 和 Gateway 认证，启动仅绑定 loopback 的测试转发器，通过模拟器发起合成模型请求，并在每次试验后归档该临时会话。
