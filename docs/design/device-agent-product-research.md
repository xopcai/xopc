# 设备接入 Agent 的产品与协议调研

> 核对日期：2026-10-11。主要参考 Meta Muse Gadgets、腾讯 WorkBuddy，并补充 OpenClaw Nodes 与 MCP/ACP 官方规范。本文区分公开实现、公开接口与 xopc 的设计建议；未登录账号、配对设备或进行产品实测。

## 1. 结论

Device Tools 的方向有直接参考。建议 xopc 保留两条入口：**设备向 Agent 提供能力**，以及 **设备作为聊天客户端向 Agent 提交任务**。消息来源身份连接这两条链路，但不代替授权。

| 参考 | 公开证据 | 最值得参考的部分 | 尚不能据此确认的部分 |
| --- | --- | --- | --- |
| Muse Gadgets | 官方 SDK 源码 | 身份与命令表注册、反向命令调用、消息带来源设备 ID | 服务端如何把设备摘要注入模型、内部工具选择与授权逻辑 |
| WorkBuddy | 官方硬件/Open API/连接器文档 | 硬件触发本地/云端 Agent，工具连接器单独接入，审批与产物回传 | 任意硬件动态注册传感器的统一设备协议、完整来源设备上下文 |
| OpenClaw Nodes | 官方节点和握手文档 | node 角色、命令声明、服务端策略、设备状态与活跃设备提示 | 文档覆盖的能力在所有平台均可用、活跃状态能证明消息来源 |

这些产品的公开资料没有提供一个已经覆盖所有设备、全部场景且可直接照搬的统一方案。下面提出的 xopc 分层是结合已有代码的设计建议。

## 2. Muse Gadgets：最直接的 Device Tools 参考

### 2.1 接入与产品形态

官方 SDK 提供 ESP32 与 Linux 路径，通过 Muse 手机 App 的 Devices 入口配对；SDK token 是配对前提。设备可以承载显示、输入、采集或控制能力。参考：[官方仓库 README](https://github.com/facebookincubator/muse-gadget-sdk)。

本次只读检出源码 commit `812c46f9fe42b69d916613a9dc702cbac5ff7b54`，未运行安装脚本或设备服务。源码链接固定到该提交，便于复核。

### 2.2 注册、调用与消息来源

Linux 的 `DeviceDescription.register_params()` 提供 node ID、名称、平台、版本、设备类别、型号和 `commands_v2`。设备发出 `link.register`，处理服务端 `link.invoke`，按调用 ID 回传 `link.result`。聊天请求通过另一条 `/chat/stream` 请求提交，并带 `device_id` 和可选 `session_id`。同一源码的注释说明后续设备命令路由回该来源设备。[link_client.py](https://github.com/facebookincubator/muse-gadget-sdk/blob/812c46f9fe42b69d916613a9dc702cbac5ff7b54/linux/src/musegadget/link_client.py)

因此有代码证据支持：设备能力注册与消息来源是独立但关联的机制。不能据此断言 Muse 会把完整设备 manifest 塞进每轮模型提示词；Agent 服务端实现不在本仓库内。

### 2.3 能力描述与设备约束

Linux `COMMAND_SPECS` 定义具体命令描述、必填/可选参数及超时，包含 `system.run`、`file.read`、`file.write`、`device.health`。执行器按命令分发；执行账号的权限限制实际操作范围。[executor.py](https://github.com/facebookincubator/muse-gadget-sdk/blob/812c46f9fe42b69d916613a9dc702cbac5ff7b54/linux/src/musegadget/executor.py)

ESP32 根据构建能力生成命令表，例如健康状态、局域网发现、屏幕显示；显示命令描述包含尺寸、色深和刷新限制。这说明能力声明既描述“能做什么”，也需要说明硬件约束。不能把示例板卡能力当所有设备都支持。[noise_control.cpp](https://github.com/facebookincubator/muse-gadget-sdk/blob/812c46f9fe42b69d916613a9dc702cbac5ff7b54/esp32/main/noise_control.cpp)

### 2.4 传输与适用边界

Linux 链路使用带 bearer 的 WebSocket、Noise XX 握手，再承载控制与聊天请求；控制消息为长度前缀 JSON。这是 SDK 的专用设备链路，不能称为 MCP 或标准 ACP。[传输源码](https://github.com/facebookincubator/muse-gadget-sdk/blob/812c46f9fe42b69d916613a9dc702cbac5ff7b54/linux/src/musegadget/link_client.py)

Linux README 表明安装账号的权限会影响 Agent 可执行范围。xopc 可以学习命令表与配对，但通用 shell 不应成为移动端/传感器读取的必经路径。[Linux README](https://github.com/facebookincubator/muse-gadget-sdk/blob/812c46f9fe42b69d916613a9dc702cbac5ff7b54/linux/README.md)

## 3. WorkBuddy：硬件任务入口与连接器分层

### 3.1 硬件接入 Agent

官方开放平台将硬件作为第三方应用类型，通过 OAuth 2.1 用户授权调用 HTTPS Open API，可访问本地助理、云端任务和产物能力。这个身份首先是应用与用户授权关系，不等于公开了每台硬件的统一能力 manifest。[第三方应用文档](https://open.workbuddy.cn/docs/third-party-app)

硬件专区列出的眼镜、录音设备、外设等用于观察产品入口与结果展示方式，不能仅凭“适配”字样认定都采用同一个端侧控制协议。[官方硬件专区](https://www.workbuddy.cn/hardware/)

### 3.2 对话、审批与结果回传

公开 Open API 支持向 PC 本地助理发消息与查询历史；云端任务返回 task ID、连接地址和 token。实时对话采用 ACP 方法与 JSON-RPC：GET SSE 收消息、POST 发请求，以连接 ID 关联；涵盖 prompt、增量更新、权限请求和结束响应，产物另有扩展事件与 REST 查询。[Open API 文档](https://open.workbuddy.cn/docs/openapi)

它适合作为“硬件负责收集输入/呈现结果，Agent 负责执行”的参考。所核对的本地消息接口主要公开 content/msg_type，不能据此确认内置了任意硬件能力动态注册或完整 device-origin 字段。

### 3.3 Agent 调用外部能力

连接器文档推荐 MCP + Skill，已有成熟 CLI 时可用 CLI + Skill；元数据与配置声明工具接入方式，Skill 提供使用指导。这里解决的是 Agent 调用外部能力，和硬件调用 Agent Open API 的方向不同。[连接器文档](https://open.workbuddy.cn/docs/connector)

对 xopc 的启示：对话、工具调用、产物展示和授权各有清晰职责。无需因为硬件需要发消息，就让硬件实现一整个 MCP Server；也不能因为能发任务，就推断 Agent 已能反向读取它的传感器。

## 4. OpenClaw Nodes：多端节点与能力治理参考

Node 是连接 Gateway 的能力宿主，用 `role=node` 声明摄像头、设备、系统等命令，由 `node.invoke` 调用；多数使用 Gateway WebSocket，部分平台使用其他传输。[Nodes 文档](https://docs.openclaw.ai/nodes)

握手区分 `caps`、`commands` 和 `permissions`，Gateway 将这些视为声明并施加服务端约束；还提供连接后发布工具描述的机制。适合参考“设备宣称支持”与“系统允许执行”的分离。[握手协议](https://docs.openclaw.ai/gateway/protocol/handshake)

设备命令覆盖状态、信息及部分个人数据，平台支持不一致。xopc 的能力目录应同样明确 unsupported，而不是给所有设备预置相同工具集合。[设备命令文档](https://docs.openclaw.ai/nodes/device-commands)

Active computer presence 会给 Agent 稳定的活跃节点提示，详细状态按需读取；官方特别说明活跃节点不证明消息来自它。这支持 xopc 分开维护消息来源、活跃设备提示与执行目标。[Presence 文档](https://docs.openclaw.ai/nodes/presence)

## 5. 协议如何选

| 层次 | 解决的问题 | xopc 建议 |
| --- | --- | --- |
| 设备连接协议 | 配对、身份、在线状态、命令执行、断线、前后台 | 复用并扩展现有 Endpoint Tools；按设备类型提供 Host/Bridge |
| 消息与 Agent 会话 | 用户输入、上下文、流式回答、审批、产物 | 保留 Gateway 会话与 realtime 契约；第三方接入时单独评估 ACP 投影 |
| 工具互操作 | 工具发现、参数 schema、调用与结果 | 内部仍用已有 endpoint/external-tools；生态需要时投影成 MCP |
| 设备上下文语义 | 数据来源、采样时间、精度、资源、有效期 | 由 xopc 定义稳定 context/observation 契约 |

MCP 的标准 tools 接口定义发现、调用和目录变化通知，支持结构化契约；它不是完整的硬件身份、聊天来源和系统权限协议。设备相关语义仍需宿主补齐。[MCP Tools 规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

ACP 官方规范使用 JSON-RPC，列明 stdio、讨论中的 Streamable HTTP 与自定义传输。WorkBuddy 的 SSE/POST 是其公开网络接入方式，不应表述为所有 ACP 客户端必须使用的标准传输。[ACP Transports](https://agentclientprotocol.com/protocol/v1/transports)

## 6. 对 xopc 方案的具体修订建议

以下为结合调研的设计判断，不是竞品已实现的事实：

1. **统一 Device Manifest。** 身份、显示名称、平台与能力契约版本、能力描述和约束一次注册；动态权限与在线状态单独更新。能力表不包含实际隐私数据。
2. **每条消息携带经验证的 origin。** 服务端补齐最小设备摘要；资源快照另带 resourceRef。消息到达时冻结来源，执行时验证在线状态与契约。
3. **Device Tools 按需调用。** Agent 主动选择具体能力；宿主控制目标与权限，返回结构化 observation。无需把全部设备 schema 注入每轮 prompt。
4. **分离来源、执行目标和活跃提示。** 来源证明这条消息从哪里发出；绑定决定任务在哪里执行；presence 只是辅助信号，不能覆盖前两者。
5. **提供结果回到设备的能力。** 除读取与操作，未来硬件可能需要展示进度、播放结果或接收审批。可复用会话事件与设备输出适配器，需定义任务/资源归属。
6. **两种第三方集成分别支持。** 硬件可以只当聊天入口，也可以只当工具设备，或兼具二者。开发者接入文档分别说明，不要求所有硬件实现所有角色。
7. **先保持既有协议，再做兼容投影。** 从 Muse 学注册/来源关联，从 OpenClaw 学节点与策略，从 WorkBuddy 学硬件任务入口和结果回传；不需要同时重建三套运行时。

待验证的问题：来源上下文对工具选择的实际提升、多设备选择歧义、会话授权粒度、硬件输出与审批交互，以及敏感工具结果在 transcript/缓存/导出中的投影。需要后续实现和真机验证，公开资料无法代替这些检查。
