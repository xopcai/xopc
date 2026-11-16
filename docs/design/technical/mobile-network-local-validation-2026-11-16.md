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

## 2026-11-17 鸿蒙真机与上游网络分段

使用 BRA‑AL00 鸿蒙真机、同一份 FRP 注册、同一个公网入口和同一台 Mac Gateway。手机到中继使用真机 ICMP，电脑到中继从实际 `frpc` 的 TCP 连接读取内核 RTT，再对实际控制端口单独测冷 TCP/TLS。上游直连使用冷 HTTPS 握手、同一连接的轻量请求和认证业务事件。各列采用不同测量边界。ICMP、TCP 建连、TLS 握手和业务首字节不相加当作一个纯网络 RTT。[curl 计时字段](https://curl.se/docs/manpage.html#-w) · [FRP 网络与 TLS 配置](https://gofrp.org/en/docs/features/common/network/network/)

| 路径 | 传输观测 | 握手与服务阶段 |
| --- | ---: | --- |
| 鸿蒙 Wi‑Fi → 公网中继 | ICMP 中位 **212 ms**，133–596 ms，28 次成功 | 真机 OpenSSL 的 TLS 阶段中位 **212 ms**，8 次；TLS 建连中只有中继入口参与 |
| 鸿蒙蜂窝 → 同一公网中继 | ICMP 中位 **151 ms**，135–193 ms，14 次成功 | 真机 OpenSSL 的 TLS 阶段中位 **185 ms**，4 次 |
| Mac `frpc` → 中继控制端口 | 活动连接内核 RTT 约 **149–152 ms**，五次独立冷 TCP 建连中位 **135 ms** | 冷 TLS 中位 **161 ms**；现有 `frpc` 连接持续复用。这组 TLS 探针不包含 FRP 登录和鉴权 |
| Mac → 阿里 DashScope | 轻量 HTTPS 探针冷 TCP **41 ms**，TLS **53 ms**，热 HTTP 响应 **39 ms**（401） | 认证 ASR 从创建 WebSocket 到任务就绪 **192–251 ms**，TTS 会话就绪 **191–311 ms**。最后有声帧到最终转写中位约 **1.22 秒**，含 **800 ms** 判停；提交 TTS 文本到首 PCM 中位 **251 ms** |
| Mac → DeepSeek | 轻量 HTTPS 探针冷 TCP **11 ms**，TLS **18 ms**，热 HTTP 响应 **101 ms**（401） | 固定 DeepSeek Flash、关闭思考、短提示词。4 个热连接业务样本从请求写出到首正文中位 **469 ms**，245–824 ms |
| Mac → XOPC Cloud | 轻量 HTTPS 探针冷 TCP **140 ms**，TLS **157 ms**，热 `/health` **162 ms**（200） | 固定文字会话模型 GPT‑6.1 Sol 和同一短提示词。4 个热连接样本从写出到响应头中位 **872 ms**，到首正文 **1.79 秒**，1.54–2.24 秒。另有一次冷样本总计 **21.4 秒**，其中 TLS 阶段记录到 **12.3 秒**，保存在样本里 |

手机 WSS 入口和 `frpc` 控制端口在这次采样命中同一中继 IP。Mac 回环 Gateway 健康请求约 **1 ms**，Mac 走实际公网 FRP 热请求约 **303 ms**。前者给出本地服务对照，后者含两段中继链路。模型业务样本在 Gateway 所在 Mac 发出，上游服务内部的鉴权、排队、二次中继和推理没有单独的计时边界。尤其是 XOPC Cloud 的热连接仍有约 1.79 秒首字等待，公开健康接口只能约束本地到云入口。

手机是最大的已测网络 RTT。保持测试手机、入口 IP、FRP 注册、Gateway 和请求内容一致，交替用 Wi‑Fi 和蜂窝访问同一个公网健康接口。只计已验证 TLS 且同一连接两次均返回 200 的样本，热请求中位从 **479 ms**（Wi‑Fi，8 次）降到 **419 ms**（蜂窝，4 次），范围从 **434–982 ms** 收窄到 **417–458 ms**。Wi‑Fi 四组的 ICMP 中位分别为 229、152、259、188 ms，蜂窝两组为 151、150 ms。蜂窝的收益主要出现在 Wi‑Fi 波动时。Mac 的系统代理也单独做了对照，FRP 与 XOPC Cloud 请求超时，DeepSeek 冷 HTTPS 从 124 ms 增至 221 ms，阿里冷 HTTPS 接近，因此保留了 Gateway 的直连路径。

同一个诊断会话使用鸿蒙应用实际发起四次语音通话，按 Wi‑Fi、蜂窝、Wi‑Fi、蜂窝交替。以手机时钟记录触发通话到 `Voice input ready`，四次日志均确认 `FRP: yes`。Wi‑Fi 的两次为 **3.93、6.73 秒**，蜂窝为 **3.71、3.65 秒**。这段含设备认证、语音会话与音频初始化，仅作小样本端到端交叉验证。实验结束后恢复原 Wi‑Fi。

## 2026-11-17 XOPC Cloud 首正文分段

固定 `openai-codex/gpt-6.1-sol` 和 `请只回复 OK。`，直接探针使用流式 Chat Completions，单条用户消息、最多 16 个输出 token。Mac 到生产入口的新一轮 4 个热连接样本首正文 P50 为 **2,053 ms**，范围 **1,996–2,945 ms**。用请求 ID 对齐生产端的 8 个冷、热样本，网关收包到开始鉴权 P50 **3.5 ms**（**3–19 ms**），鉴权开始到进入路由 P50 **3 ms**（**3–5 ms**），收包到路由 P50 **6.5 ms**（**6–24 ms**）。个人 Codex 路由的限流即时放行或返回 429，代码没有等待队列。

在同一 Cloud 主机上用生产构建和隔离数据库副本追踪请求，排除首个预热样本。上游接单以 SSE `response.created` 到达为界，首正文以第一个非空 `response.output_text.delta` 为界。上游内部排队、预填充、推理和缓冲只能按可见事件划分。TCP RTT 只覆盖到上游接入边缘。

| 阶段 | 默认 SSE，10 次 P50 | 范围 |
| --- | ---: | ---: |
| 收包到开始鉴权 | 4 ms | 3–5 ms |
| 鉴权开始到路由 | 4 ms | 3–8 ms |
| 路由到请求体写出 | 11 ms | 7–16 ms |
| Cloud 到上游入口的 TCP RTT | 1.39 ms | 1.22–1.85 ms |
| 请求体写出到上游接单 | 645 ms | 489–759 ms |
| 上游接单到首个正文增量 | 1,561 ms | 704–4,819 ms |
| Cloud 转发首个正文增量 | 0 ms | 0–1 ms |

固定同一提示词和 `reasoning.effort=low`，默认档和 `service_tier=priority` 交替各测 10 次，20 次均返回 `OK`。Cloud 内首正文中位数 **2,231 → 1,280 ms**，接单后首正文 **1,561 → 634 ms**。实验组有 3 次新建上游连接，建连阶段 **10–15 ms**，只看复用连接时实验组首正文中位数 **1,284 ms**。两组上游均回报 `service_tier=default`。这是请求字段的实验对照，实际服务档未得到上游确认。GPT‑6.1 Sol 的最低推理档为 `low`，已安装的模型目录将 `minimal` 映射为 `low`。 [Codex 快速档请求字段](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/config_types.rs) · [GPT‑6.1 Sol 推理档](https://developers.openai.com/api/docs/guides/deployment-checklist)

在真机经原 FRP 的隔离验证中，还复现了网关诊断清理的周期性长尾。无索引时，SQLite 对约 349 MB 的生产数据库副本扫描整张诊断表，查找超时的运行中记录，4 次查询 **2,771–3,227 ms**。已在 `xopc-platform` 的数据库初始化中加上运行中记录的局部覆盖索引。相同查询改为索引范围查找，副本上 4 次为 **0.036–0.599 ms**，结果一致。生产端另外抽取一小时 43 条同路由诊断，鉴权前含诊断写入的阶段 P50 **3 ms**、P95 **23 ms**、最大 **68 ms**。数秒长尾在隔离副本复现，生产窗口中没有观察到。

真机用原生鸿蒙应用、新建诊断会话和同一个 Wi‑Fi→FRP→Mac 路径提交。只将测试请求从 Mac 经 SSH 转发到同一 Cloud 主机上的隔离网关。两组使用相同的模型、用户提示词、`medium` 推理档、3 条上游输入消息和 22 个工具定义。索引改动前后，验证网关启动和清理周期的收包到开始鉴权分别为 **3,771/3,948 ms** 和 **652/598 ms**。无索引初轮另有一次测试转发器拒绝已刷新的登录令牌，改为用真实请求的当前令牌通过同一 Cloud 鉴权后复测。

装上索引后，鸿蒙发出的 10 次请求均完成，每次只有一个 run，屏幕均显示 `OK`。排除第一条预热请求后的同条件对照如下。手机点击与 UI 树采样有间隔，屏幕统计为中位上下界。Mac 收到首字到手机上屏还包含 FRP 下行、客户端处理和 UI 采样。

| 阶段 | 默认 SSE，4 次 P50 | 请求 `priority`，5 次 P50 |
| --- | ---: | ---: |
| Cloud 收包到首正文 | 3,440 ms | 1,696 ms |
| 上游接单到首正文 | 2,647 ms | 627 ms |
| 手机点击到 Mac 收到首正文 | 6,062 ms | 3,579 ms |
| 手机点击到屏幕可见正文，中位上下界 | 5,670–7,952 ms | 4,041–5,534 ms |

隔离环境中完成索引和快速档对照。索引代码通过 15 项诊断、推理观测和实时语音中继测试。上游在真机对照中也回报 `default`，正式 Cloud 路由继续使用现有服务档。停止隔离网关并恢复 Mac 的正式 Cloud 路径后，鸿蒙经原 FRP 再发同一提示词，成功显示 `OK`，只有一个 run。

## 2026-11-17 生产部署和快速档核验

在生产网关实际打开的 WAL 数据库中在线创建诊断覆盖索引，DDL 耗时 **43 ms**。SQLite 查询计划由整表扫描切换为 `model_diagnostic_running_updated` 索引范围查找，5 次查询为 **0.035–0.081 ms**。部署前后网关进程 ID 一致，健康接口返回 200。Mac 走生产入口的 8 次标准档探针均成功。4 次热连接从请求写出到首正文中位 **2,415 ms**。

仍固定 `gpt-6.1-sol`、`请只回复 OK。` 和 `low`。用实际连接的 Codex 账号读取上游模型目录，返回 HTTP 200，模型列出的 Fast ID 是 `priority`。分三层核验：

- 生产 Cloud 的 Chat Completions 入口收到 `service_tier` 时，返回 **400 `unsupported_request_field`**，请求尚未进入上游。隔离验证中，把 `serviceTier` 作为 SDK `streamSimple` 的普通选项传入，SSE 请求体和 WebSocket 帧都没有此字段。
- 在隔离网关的已授权请求中，用 SDK `onPayload` 明确写入 `service_tier: priority`，检查实际发出的 SSE 正文和 WebSocket `response.create` 帧。5 次请求都有该字段和正确的模型，均返回 `OK`。上游原始 `response.created` 均回报 `auto`，`response.completed` 均回报 `default`；上游没有提供降级原因。字面值 `fast` 在 SSE 返回上游 HTTP 400，在 WebSocket 返回错误事件。 [Codex 的 Fast 模式](https://learn.chatgpt.com/docs/agent-configuration/speed) · [Codex 的请求字段映射](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/config_types.rs)

索引部署后用鸿蒙原生应用经原 Wi‑Fi 和同一条 FRP，按正式默认档完成 **7 次**测试，跨度约 **99 秒**。每次只有一个会话 run，屏幕均显示 `OK`。点击到 Mac 持久收据中位 **723 ms**，最大 **1,560 ms**。点击到屏幕可见首正文的中位上下界为 **2,479–5,433 ms**，最慢一条的上界为 **6,942 ms**。在这 7 个发送窗口中匹配到 14 个同账号同模型的 Cloud 调用，收包到开始鉴权中位 **3.5 ms**、最大 **30 ms**。真机样本期间没有复现隔离环境的数秒诊断清理长尾。验证后段设备从 HDC 断开，最终样本量为 7。快速档仍缺少上游生效证据，真机数据按标准档统计。
