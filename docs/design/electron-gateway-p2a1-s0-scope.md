# P2a-1 S0 范围与验收冻结

日期：2026-10-31。源基线：main `f5b4b66015a386813ff31923cde8bde702fa544d`（PR #38）。本文件在 S1 产品代码修改前建立；测量完成后附原始证据，失败样本不删除。

## 本批次交付与停止边界

S0 冻结范围、身份依据、接口盘点、版本和预算，并在同一 worktree 测量本地新建/复用各 30 次。S1 交付显式选择的连接预览入口、独立配置与安全凭据、单窗口连接状态/epoch、严格来源检查和本机能力默认拒绝。远端开关默认关闭，不更改原本地默认路径。

S1 是本地配置/恢复界面，不是远端聊天：无 Shell、上游 HTTP/WS、认证就绪、远端 Host、Renderer Host fallback 或任何本机工具。不把存入 profile 当作连通/核验成功。S2 开始前仍须实现和验收认证后身份接口及能力兼容，S1 不伪造 gatewayId。首版切换使用进程重启，不支持运行中的本地执行器热迁移；从预览显式返回本地时退出预览后走原入口，不能并行启动两套运行时。

入口采用启动参数 `--gateway-connections`；无该参数时不读取/初始化远端 profile、凭据或窗口资源。预览状态不自动恢复为活动远端连接；原本地 main、Host、数据库及 preload 保持原路径。预览资源损坏可退出，去掉参数直接启动本地。

## 身份与兼容依据

- 持久身份已有 `src/storage/sqlite/gateway-identity-repository.ts` 的 singleton `gateway_identity`（UUID + Ed25519）。不得另建身份，不改会话表或 transcript 写入。
- 现有 `POST /api/gateway-identity/challenge` 在 `routes/devices.ts` 的 public 注册入口，返回带 nonce/期限的签名 payload。它不是已认证身份发现，响应不含可独立信任的新公钥；不能仅解析 payload 或把自签响应当作认证后身份。
- 当前 owner 侧 pairing setup 可返回身份/公钥，但会创建 mobile/Chrome 配对，不适合聊天身份发现。S2 需设计只读、owner 认证的身份/公钥读取契约，复用持久身份，再以随机 nonce challenge 核验绑定；同步 contract、lazy-bundle 正负映射及真实认证入口测试。S1 不新增 Gateway 路由，不开启配对。
- 首阶段只声明当前构建配套的 REST/Realtime 契约为待验组合；旧 Gateway 没有身份/必要 manifest 时拒绝连接并提示升级，不能假定严格协议可跨版本互通。S2 必须固定确切构建摘要/协议版本后才能接受远端聊天。
- Computer/Endpoint 不作为聊天就绪依赖，S1 的本机能力始终关闭。现有本地 strict 兼容检查不调整。

## 聊天协议范围（供 S2 白名单，S1 全部不转发）

下列路径已按当前源码盘点，参数须按单段 ID 校验，query 另列许可键。不是 `/api/*` 放行表；扩展一个场景须先补表和验收。返回包络及 receipt/topic/cursor 复用现有 gateway-contract、agent-stream-client 和 realtime-client。

| 方法与路径 | 用途/来源 | 处理与大小边界 |
| --- | --- | --- |
| GET/DELETE `/api/browser-session` | 本地 Shell 会话状态/退出 | Shell 自己处理，不透传上游；POST 凭据交换仅可信配置入口完成 |
| GET `/api/models`、`/api/agents` | 文本聊天选择器，registry-api/chat-agents-api | 认证、no-store、JSON 最大 4 MiB；不开放 provider 密钥/配置管理 |
| GET `/api/sessions`、`/api/sessions/:key`、`/:key/messages`、`/:key/history`、`/:key/timeline`（后三者均接 sessions 前缀） | 会话/聊天历史，session-manager | 认证分页，no-store；单次 JSON 4 MiB，分页恢复而非无限全量缓冲 |
| POST `/api/sessions/:key/materialize` | session-manager 创建持久会话 | 结构化 JSON，不接受设备 claim/本机路径；输入上限 1 MiB |
| GET `/api/sessions/:key/agent-config` | 读取会话 Agent 设置 | 只读；修改设置不在首批范围 |
| POST `/api/sessions/:conversationId/inputs` | 文本输入，agent-stream route/message-sender | JSON 1 MiB，不附本机文件、设备 claim；保留 clientMessageId/receipt，不自动重发 |
| GET `/api/sessions/:conversationId/input-receipts/:clientMessageId`、`/:key/input-state`、`/:key/run`（后两者均接 sessions 前缀） | 核实提交、运行与恢复 | 认证 JSON 4 MiB，无法核实则保持待确认 |
| POST `/api/agent/abort` | 用户请求停止远端运行 | 不把发出请求当作停止确认，不调用本机停止器 |
| POST `/api/realtime/tickets`、WS `/api/realtime/v1/ws` | 一次性 ticket、run/session topic/cursor/gap | 每 UI 仅一条活跃连接，最多 2 条含切换重建；不开放设备/控制 topics |
| GET `/api/media/read` | 服务器已有媒体的认证读取，media route | query 仅许可资源引用/会话字段，Range 逐项验证；流式、单资源 32 MiB，不把远端 HTML 当主界面，不落盘/打开本机应用 |

实际完整 Web 页面还有 preparation/clarification、MCP setup、capability/config、任务/旁聊、设备桥接、预览等请求。S2 使用受限聊天界面或明确禁用这些入口；不能因原页面依赖它们就扩成全 API 代理。reset、会话编辑、上传/下载、管理、更新、设备/Endpoint/Computer/Browser 路由均不在首批许可范围。新增认证身份/兼容只读路由名称在 S2 契约评审固定，不能擅自复用会产生配对副作用的 POST。

## IPC 与非 IPC 入口

完整旧 IPC 调用点见 [S0 IPC 清单](./evidence/electron-gateway-p2a1-s0-s1/s0-legacy-ipc-inventory.json)。该 AST 清单覆盖 ipcMain/ipc 的 handle/on/once 注册；S1 默认全部拒绝远端窗口，包括当前缺少来源检查的 clipboard/fullscreen。新连接配置 IPC 是独立命名空间，只有登记的配置窗口顶层 frame + 精确本地文件 URL 才可使用；聊天角色无配置权限。

| 非 IPC 路径 | S1 处理 |
| --- | --- |
| main 的自动 DesktopEndpointHost、tunnel/voice、托盘/桌宠、配置初始化 | 预览入口在加载 local main 前分流，均不启动；本地默认入口不变 |
| Web EndpointToolBridge 的 Renderer fallback | S1 不加载 Web 聊天/远端页面，不实例化任何 Host；S2 接 Web 前必须增加显式 mode/capability 门禁 |
| open-file/第二实例 argv/拖放/intake/deep link | 预览不注册本地 intake/deep-link handlers；禁止页面拖放/默认文件导航，第二实例只聚焦预览，不接收本地文件 |
| 菜单、快捷键、导航、window.open/webview | 预览只保留退出/显式返回本地；禁止外部导航、新窗口和 webview；无控制快捷键或菜单执行器 |
| session 权限/下载/网络 | 独立内存 partition；权限检查与请求全部拒绝，下载取消；CSP 禁止 connect/frame/object，预览不发任何 HTTP/WS 请求 |
| 导航/销毁后的 IPC | 窗口仍标记受限，旧授权撤销，不能回落到本地 loopback 信任分支；旧 epoch 请求拒绝 |

## 冻结预算、故障和产物

本批次本地测量沿用 P0/P1 脚本：spawn/reuse 各 30 次，首轮各 100 次 config/sessions 操作；P95 上限为 S0 + max(5%, 固定绝对容差)：ready 100ms、API 5ms、进程树 RSS 32MiB。保留所有失败样本，不在结果出来后调预算；CPU 仅快照，不能当稳态/泄漏验收。功能 E2E 另测 Cookie、真实 Agent/SQLite/Realtime、聊天、文件边界、PTY、浏览器、重启持久化和复用拒绝重启。

S1 预览 IPC payload 最大 16KiB，profile 最多 20 个、文件最大 128KiB；凭据 UTF-8 最大 8KiB，只存安全存储加密数据，不明文回退；不使用 Linux basic_text。持久写入串行、临时文件原子替换、epoch 防并发旧请求；损坏文件不覆盖，显示恢复原因。配置/加密操作 15 秒内返回结果或明确超时错误，失败不能发布半写状态。配置不保存远端会话、设备授权或已核验身份。

S2 预定但本批次不实现：DNS/TLS、认证、WS 每次预算 15s；离线检测 45s，稳定网络后恢复/明确失败 30s；重试间隔最多 30s、连续最多 10 次；取消本地代理流 5s，清理/切换 15s；资源无进度 30s。HTTP 并发 16、排队 16、WS 最多 2、单 JSON 响应/WS 消息上限 4MiB、单连接待发送缓冲 4MiB、远端资源磁盘缓存 0。超限拒绝/背压，不更改本地默认。后续如需修改，先形成预算评审再验收，不能忽略过大正常事件或假报聊天成功。

平台：本批次 macOS arm64 开发 Electron 验证，固定 Node/Electron 版本和产物摘要记录在证据。S0/S1 不声称签名安装包、Windows、真实远端 TLS 或 24 小时运行已验收。S4/S5 必须补齐真实发布产物与这些门槛；本次不接网也不等于远端网络测试通过。

S1 故障集：非法/SSH origin、损坏 profile、密钥不可用/错误解密、持久化失败、过期 epoch、导航/iframe 来源、所有旧 IPC 及消息通道拒绝、退出和显式返回本地；本地开启/复用与核心功能对照。验收证据在 S1 报告中填写，不提前勾选通过。
