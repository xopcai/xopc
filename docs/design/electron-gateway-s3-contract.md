# S3 范围、接口与验收冻结

基于 main `3f86a8af255b1d52108ba11c59b0703ab85592aa`（PR #40），独立 worktree/分支 `gateway-p2a1-s3` / `codex/gateway-p2a1-s3`。代码图 MCP 当前不可用，按主方案及实际契约/路由核对。默认本地入口、Gateway 监督、SQLite/transcript 写入路径与既有预算不改。

## 分阶段交付

1. 核对现有输入/receipt、历史、run、Realtime cursor/gap，复现最新 main 本地基线；预算始终比较历史 S0，不重置门槛。
2. 受限文本输入、receipt 查询与停止：复用现有 Gateway API/契约，Shell 双侧限制 payload；身份核验后才能发送。旧 Gateway 无 S3 capability 时只读，不误开写能力。
3. 包内远端聊天 UI、按身份隔离的加密草稿/待核实记录、窗口重建与 A→B→本地；不复制历史数据库、不共享 localStorage/service worker，不落盘服务器附件。
4. 复用 RealtimeClient、agent-stream-client；cursor/gap、历史和 input-state 核实，断线有界重连，身份/证书/认证/协议错误锁定；HTTP POST 不自动重发。相关测试、真实 Gateway + 开发 Electron 故障 E2E、本地功能与原预算复测。

## 接口与信任边界

- 原 `GET /api/desktop-chat/bootstrap` 响应保持 S2 不变；显式 `?chat=1` 返回新增可选 `manifest.chat=text-receipt.v1`。旧 Gateway 不声明则不开放 S3 输入。无新设备、数据库 schema、Host 或会话副本。
- `POST /api/sessions/:conversationId/inputs` 复用 `sessionInputCommandSchema`，仅 start/append、纯文本、客户端 UUID。origin 固定为现有 `{type:system,source:cli}`：当前无 Endpoint 的 owner 输入兼容字段，不表示 Electron 执行。start 的 projectId/execution 必须 null，temporary=false；拒绝附件/context/endpoint/browser/app 字段及 steer/interrupt。append 使用服务器 transcript/configVersion，冲突重新读取而非重发。
- `GET /api/sessions/:conversationId/input-receipts/:clientMessageId`：超时/断线后只核实。404 是当前未找到，不能据此自动重发。未确认记录保存前不发 POST，保存失败拒绝新提交；已有待核实记录阻止重复提交。收到 receipt 后才清除记录。新窗口/进程恢复从该记录查询，不重放。
- `POST /api/agent/abort` 仅 runId。UI 区分已请求、服务器响应与 input-state 确认停止；超时显示未知，不宣称取消成功。它停止服务器 run，不启动或控制本机执行器。
- GET sessions/messages/input-state/run/agent-config/models/agents/media 继续白名单。恢复以服务器历史为权威；run 流使用稳定 messageId/offset 去重，gap 清空临时流并重新读快照；无客户端会话数据库。
- 不开放上传、文件/PTY/Computer/Browser/语音、本机路径、设备/配对、设置/更新/重启等路由。历史工具记录纯文本显示不可在本机执行，附件只经许可媒体读取，不生成本机路径链接。
- 每次代理请求恢复前核验已 pin 身份；TLS、身份/认证/协议硬错误锁定。Realtime 复用既有 ticket/hello/topic/cursor，UI clientKind=web，绝不注册 Endpoint。

## 状态与磁盘隔离

主进程只对当前 Shell WebContents/主 frame/精确 URL/epoch 开放受限 state IPC。加密业务文件使用 profileId + gatewayId + publicKey 摘要命名；正文有版本、大小和字段校验，只存草稿、选中会话与最多一条未确认输入身份，不保存 token、历史或 cursor 到磁盘。凭据/业务数据均不进入本地 ~/.xopc 数据目录。换 Gateway/身份不沿用草稿/未确认记录；同 Gateway 重连可以核实原记录。内存 subscription、run 缓冲、cursor、HTTP 控制器与状态在窗口退出时销毁。原清理失败隔离继续阻止新激活。

可见状态：连接中、同步中、就绪、离线重试、需恢复、待核实。只有当前就绪且无未确认输入时允许发送；用户可返回配置切换或回本地。最多 10 次网络重试，指数退避上限 30 秒；单次认证/HTTP/WS 仍 15 秒，清理 15 秒、无进度 30 秒，JSON/server WS 4MiB、client WS 256KiB、媒体 32MiB、HTTP 16+16、媒体4、WS2 不变。纯文本输入正文额外限 64KiB，草稿 8192 字符；业务存储故障/超时隔离，不能当作写入成功。

## 验收

- 相关单测：S2 边界不回退，输入字段/身份/来源/大小拒绝，状态文件加密/隔离/损坏/超时，过期响应拒绝，receipt 未确认不重发，流 offset/cursor/gap 去重。
- 开发 Electron + 真实 Gateway：SSH loopback 与 HTTPS/WSS 的新会话、历史、连续输入、服务器流与停止；丢响应/断线/重启后核实且服务器只接收一次；同 URL 换身份锁定；A→B→A 草稿/待核实/历史不串用；B→本地无额外 Host/Gateway/SQLite，旧 Shell 端口与 IPC 失效，恢复页独立。
- 全部本机通道继续拒绝，远端服务器设备列表不变；旧 S2 客户端 discovery 不变，旧 Gateway 只读降级。清理失败继续阻止新连接。
- 每模式本地新建/复用各 30 次，历史 S0 权重（每模式每 API 129 个样本）及 ready/API/RSS 原门槛不变；保留所有失败和重跑原因。开发 E2E 不算 S4 安装包、独立物理服务器、跨平台或 S5 长期运行验收。
