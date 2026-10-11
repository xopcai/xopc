# Device Tools 实现与验证记录

2026-10-11。实施状态对应 [产品方案](./device-tools-product-spec.md) 和 [技术方案](./device-tools-technical-spec.md)。

## 已实现

- 每次输入由 Gateway 验证来源端 token 及认证主体归属，生成名称、平台、设备 ID 的冻结快照；语言、时区为客户端协商后提供的可选字段。设备昵称由 Gateway 管理，修改采用 revision 乐观并发控制。
- 来源快照随输入队列持久化并注入 Agent 数据上下文。重试保留原输入环境；编辑重新执行继承原 turn 的来源。设备名字中的标记字符作为数据转义，不能成为上下文指令。
- 来源端读取与会话执行端使用服务端固定目标规则。基础设备状态/电量读取使用来源端；文件操作和 Bridge 使用会话绑定端。已绑定目标离线不自动换设备。
- Android、HarmonyOS、iOS 提供状态和电量工具。Web 和 Electron 提供基础环境读取。所有状态工具使用固定有界 schema；未知电量为 null，0 是有效读数。
- 基础读数由 Gateway 检查时间，包装 endpoint/principal、capturedAt、receivedAt、validUntil 和 cached 字段。读数有效期 30 秒；超出未来时钟容差 60 秒或已过期的数据报错。
- Web 设备详情支持昵称编辑、能力及授权/前台说明；历史聊天消息显示当时的来源名称。
- 提供 Node 通用 Bridge 驱动接口、签名连接 host，以及温湿度模拟器。真实驱动替换 adapter.read，无需修改 Agent 工作流。

## Bridge 接入

在仓库根目录运行（Node >= 22.22.3，已安装 pnpm 依赖）：

```sh
export XOPC_GATEWAY_URL=http://127.0.0.1:18790
# XOPC_GATEWAY_TOKEN 使用本机已配置的 Gateway owner token，通过环境安全注入。
pnpm exec tsx scripts/devices/simulated-bridge.mts
```

URL 使用实际 Gateway 地址。远程连接要求 HTTPS；不在 URL 里传 token。模拟器只注册能力，启动后打印 endpointId、资源列表和 simulated 标记，不发送聊天消息。身份默认存储在 `~/.xopc/devices/simulated-bridge.json`，私钥文件权限 0600；可通过 `XOPC_BRIDGE_IDENTITY_PATH` 设置独立实例。重启沿用身份和 endpointId；每次连接使用新的 connectionInstanceId、签名和 nonce。Ctrl+C 关闭连接并取消活动调用。

通过现有会话设备选择界面绑定该 Bridge，或由 Gateway owner 调用：

```http
PUT /api/endpoint-tools/bindings/<conversationId>
Authorization: Bearer <owner token>
Content-Type: application/json

{"endpointId":"<启动输出的 endpointId>"}
```

绑定后 Agent 能按需发现两个工具：

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `desktop.bridge.list_resources` | `{}` | 独立 resourceId、名称、measurement、unit、simulated |
| `desktop.bridge.read_sensor` | `{"resourceId":"sim.room.temperature"}` | 单次采样时间、数值、资源身份、单位、模拟标记 |

当前固定模拟值为 23.5°C、45%。这些值用于协议演示，不表示真实室内环境。设备未知状态返回 null；无效资源、重复 ID、非法单位、越界数值、过期时间和取消调用均失败，不伪造读数。

通用驱动入口：`src/endpoint-tools/bridge.ts` 的 `BridgeSensorAdapter` 和 `createDeviceBridge`。温度范围 -100…200°C，湿度 0…100%。新测量类别需扩展 Gateway 认可的共享契约及政策；硬件自报任意 tool/schema 不会自动获得执行权限。

Bridge 采用 Endpoint v2 的 **desktop host transport**，平台为驱动运行主机，物理传感器身份使用独立 resourceId。没有增加协议枚举或把主机当成每个传感器。`hardwareBridgeV1` 特性协商控制兼容性；旧 Gateway 缺少该标志时拒绝启动。未来若引入专用 bridge kind，应同步升级协议与所有端，而不是静默添加 enum。

## 验证与边界

核心、协议和 Web 类型检查、Web 生产构建及 Electron main/preload 构建已通过。核心与协议/Gateway/相关 Web 回归共 26 个测试文件、179 项测试通过；Web 消息发送及重试相关回归另有 45 项通过。通过实际监听的认证 Gateway 验证输入来源冻结、幂等重试和昵称修改的 lazy route。Bridge 测试通过实际 HTTP 注册、P-256 签名 WebSocket 握手、显式会话绑定和 Agent provider 调用，检查资源来源及 simulated 标记。

Android 使用 gradle-run wrapper：

- “Do Android device tools compile and existing unit tests pass?”：通过。
- “Do Android device tools and negotiated message context compile and pass unit tests?”：通过。

工作流结束后只清理 wrapper 自有日志。HarmonyOS debug HAP 构建及本次能力相关测试通过；iOS 模拟器构建和单元测试通过。尚未完成三端真机验收。HarmonyOS 全量测试 684 项通过、2 项失败：`chatOptimisticComposer` 测试夹具未提供 `reserveReplySpace`，`colorLayerHierarchy` 的禁止边框断言与已有 ChatView 不符。相关源码和测试文件与 HEAD 相同，确认为基线问题；本次变更相关测试全部通过。

本次交付覆盖 M1 通用来源/状态链路、M2 的单次位置任务与跨设备授权，以及 M3 的 Bridge 接入示例。日历等其他个人资源、位置附件共享、通用临时资源引用，以及 M4 的持久订阅/自动化授权尚未实施。配对移动端不能绑定其他设备；跨设备授权由 Gateway owner 在设备管理页批准。离线能力历史目录、全端来源气泡和统一结果卡片仍需后续完善。

## M2：单次位置任务与跨设备授权

Android、iOS、HarmonyOS 和浏览器注册 `mobile.device.get_location` / `web.device.get_location`。通过 `deviceLocationTasksV1` 协商；旧 Gateway 继续只收到基础状态工具。Electron 暂未注册原生位置能力。三端同时修正 Endpoint v2 调用包裹：外层 `endpoint.message`，内层 `type: tool.invoke/tool.result/tool.cancel`。

每次调用都先显示本地确认：使用当前哪台设备、用途、精度，以及坐标交给 Open-Meteo 或 OpenStreetMap。系统定位权限已开启也不省略本次确认。只申请前台定位，不申请后台权限。拒绝、取消、转后台、断线和超时停止采集，迟到回调不能发布结果。HarmonyOS 本地确认使用可关闭的 ComponentContent 对话框，取消、超时或转后台会主动关闭。OS 权限弹窗由系统管理；调用取消后不再申请后续权限或采样。

当前支持天气和附近地点任务。附近类别为餐厅、咖啡馆、药店、公园，半径 2 公里，最多 10 个命名地点。新增个人资源需增加自己的服务端可信契约、范围和结果处理器，不能开放任意设备 schema 或让模型读取所有原始数据。

大致位置在端上先量化到 0.02° 网格，精度字段至少 3000 米，再上传；OS 只批准大致位置或实际精度差时降级为 approximate。Gateway 再次处理精度，校验样本 30 秒新鲜度，未来时间最多容忍 60 秒。浏览器 maximumAge=0；移动端只接收本次请求的新鲜样本，不主动读取历史定位。OS 可能返回满足新鲜度的缓存样本。

**原始坐标不进入通用模型。** `location-task.ts` 在当前异步调用内存中消费坐标，向固定 HTTPS 服务发起一次查询（15 秒超时、禁止重定向、响应最多 512 KB），返回有界天气字段或地点名称/街道摘要。坐标不进入 Agent tool result、progress、details、模型上下文、聊天事件或 SQLite，历史、FTS、导出、compaction 和记忆输入都只包含摘要。没有可跨任务恢复的原始数据缓存或通用坐标引用。地点名称和天气结果属于可保留摘要，可能透露场景；这些摘要仍需按个人任务数据对待。

跨设备入口位于 Web 设备管理页。owner 选择会话、消息来源设备、目标在线端、用途、精度和附近类别，批准后 60 秒内在来源设备继续请求。授权限定来源 principal、目标 endpoint/当前连接、能力和精确参数摘要；同名设备重连不能替代目标。调用原子占用一次，成功、失败或拒绝均消费。撤销、到期、断线、移除和 Gateway 重启使其失效，正在执行的查询也取消。目标设备依然需要本地确认。

- `GET /api/endpoint-tools/target-authorizations`：当前授权。
- `POST /api/endpoint-tools/target-authorizations`：创建，body 为 conversationId、requestorPrincipalId、targetEndpointId、toolName、arguments。
- `DELETE /api/endpoint-tools/target-authorizations/:grantId`：撤销。

SQLite v241 只记录 issued/reserved/consumed/revoked/expired、设备/会话标识、参数 SHA-256 和时间。活动授权留在内存，不重放；审计正文不含坐标。

### M2 验证结果

- 核心类型检查、Web 类型检查/生产构建及新增代码 ESLint 通过。
- 核心、真实 HTTP lazy route、授权、位置处理、浏览器相关回归 8 文件 67 项通过。覆盖扩大精度拒绝、单次消费、撤销、到期、同名重连，以及摘要写入 SessionStore 后的模型历史、FTS、JSON 导出检查。外部查询使用受控响应。
- HarmonyOS 4 文件 19 项通过，覆盖本地拒绝、取消后不申请权限、OS 拒绝、前台限制、样本量化、传感器停止和 realtime 包裹；debug HAP 构建通过（无发布签名）。
- iOS 模拟器构建及 83 项现有单元测试通过。Android 使用 gradle-run wrapper 执行 `:app:compileDebugKotlin :app:testDebugUnitTest`，问题“Do Android single-use location consent and realtime envelopes compile and pass unit tests?”，结果通过。wrapper 工作流结束，只清理自有日志。
- HarmonyOS Mate 60 真机已验证权限弹窗、大致定位、Open-Meteo 公网查询、拒绝、取消及等待确认时转后台；详情见 [真机验收记录](../../apps/mobile-harmony/docs/mate60-device-tools-acceptance-20261011.md)。Android/iOS 真机联调尚未完成。Open-Meteo/Overpass 使用公开服务；上线前需确定服务容量、商业使用条件和提供方配置，不把受控响应测试视为公网服务验收。
