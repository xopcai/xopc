# S2 范围、契约与实施冻结

基线：main `ab82be00f`（PR #39）；分支 `codex/gateway-p2a1-s2`。代码图 MCP 不可用，按主方案、实际路由及协议源码核对。

S2 仅交付受限 Shell 与认证传输底座，不实现 S3 聊天输入/历史界面和完整切换工作流，不启动任何远端 Host、Renderer Endpoint fallback、本机文件/PTY/剪贴板/浏览器/Computer/语音能力。默认本地入口及本地 strict 兼容检查保留。Shell 用受监督的 utility process；配置恢复页独立于 Shell 保持可用。

## 实施顺序

1. 固定本次 main 的完整产物、范围与接口；按历史 S0 的原始权重和预算复测本地基线，失败保留，不重置门槛。
2. 增加 owner 认证的只读身份/聊天 manifest，复用持久 Gateway identity 与既有随机 nonce challenge；同步 lazy-bundle 正负映射及真实认证测试。
3. 实现独立 Shell worker：精确 loopback Host/Origin、本地一次性 IPC bootstrap、HttpOnly 会话和主进程注入的窗口 proof；固定上游目标，HTTP/WS 白名单、响应隔离、取消/背压与配额。
4. 将显式 S2 连接动作接入独立配置预览；凭据只在主进程/worker 间传递。首次认证后持久绑定 identity；同 origin 换身份锁定，用户可显式移除并新建配置，不自动沿用旧授权。
5. 相关单测、真实认证 Gateway 与 Electron E2E、HTTPS/WSS 和显式 SSH loopback、故障/限额验证；重跑本地功能与原预算完整对照。开发 E2E 不冒充 S4 安装包验收。

## 身份与兼容契约

新增 `GET /api/desktop-chat/bootstrap`，只有 token 认证配置下的 owner/gateway.admin 可读。响应为 `{ok:true,payload:{gatewayId,publicKey,manifest}}`，只返回持久公开身份，不创建配对、设备、数据库 schema 或会话副本。manifest 固定 `xopc.desktop-chat.v1` 与 Realtime v2，明确只支持已核实的 read/ticket/resource 传输；Computer/Endpoint 不参与聊天兼容门槛。旧 Gateway 缺契约、401、TLS 错误、错误签名/nonce、身份变化均拒绝激活，不自动切本地。

客户端从认证响应获得公钥，再调用已有 `POST /api/gateway-identity/challenge`，验证 Ed25519、purpose、gatewayId、随机 nonce、30 秒有效窗口和时钟偏差。不单独信任公开 challenge。完整校验后才持久绑定，尚未核验身份不启动代理。

## S2 HTTP 许可面

- 包内静态 `/` 与 `/shell.js`：固定 CSP/nosniff，禁止 frame、object、远端脚本、service worker、下载与外部导航。
- Shell 自己处理 `GET/DELETE /api/browser-session`、`GET /api/desktop-shell/status`；不转发上游 Cookie。
- 上游只读 GET：`/api/models`、`/api/agents`、`/api/sessions`、单段 UUID 会话及已盘点 messages/history/timeline/agent-config/input-state/run 子路由；query 按路由逐项允许，拒绝编码路径、路径穿越、任意 URL 与未知参数。
- `POST /api/realtime/tickets`：仅 web client、当前 Realtime 版本；限定小 JSON，记录本 Shell 签发的 ticket/clientId/期限，最多 32 个未使用 ticket。
- `GET /api/media/read`：仅 uri + conversationId/taskId（实际 Gateway 契约），Range 单范围；只读服务器已存在附件，不本机落盘，拒绝 HTML/SVG/可执行 MIME。
- 其余全部拒绝，含输入提交/abort（S3 再开放）、上传、设置/更新/重启、配对、设备、Endpoint/Computer/Browser、管理页面与任意 WebSocket 路径。无通配 `/api/*`。

身份/manifest/challenge 仅由连接初始化调用，不作为 Renderer 代理入口。上游禁止跟随任何重定向；只构造 Authorization 与目标 Origin，不透传 Renderer Cookie/Authorization/Forwarded。响应只输出许可头，不继承 Set-Cookie/CSP/CORS/Location/下载策略，认证响应 no-store。

## WS 与资源边界

仅 `/api/realtime/v1/ws`，本地会话 + 精确 Origin + 窗口 proof；仅转发本 Shell 申请且未使用的 ticket hello。复用既有协议；拒绝 hello.endpoint、endpoint.message、设备/控制/logs/管理 topic，订阅仅 sessions、session:<id>、run:<id>。同样过滤上游消息，拒绝 Endpoint 注册结果。ticket 不进入 URL，不把长期 token 用于 WS URL。

沿用原预算：网络/auth/WS 15s；清理 15s；单 JSON/server frame 4MiB，client frame 使用协议更严格的 256KiB；资源 32MiB/无进度 30s；HTTP 活跃 16、队列最多 16（其中媒体最多 4 个活跃，保留控制空间）；WS 最多 2、每端待发送缓冲最多 4MiB。会话仅内存，15 分钟到期后需显式重新连接；S2 不自动重放 POST、不做后台队列或认证硬错误重试。恢复、切换与完整聊天重连由 S3 补齐，不提前宣称 A06/A07/A09 或完整 P2a-1 已验收。

本地 P95 仍比较旧 S0：ready +max(5%,100ms)、API +max(5%,5ms)、RSS +max(5%,32MiB)。新 main 复现结果与最终结果分别存档，不能把新 main 当作较宽替代预算。

实现核对补充：已有 pin 的连接先进行不携带 owner 凭据的随机 nonce 身份证明，再发送认证 discovery；首次连接才按认证 discovery→challenge 建立 pin。profile 文件写入版本升级为 2，仍可读取旧 v1，默认本地入口不读取或迁移它。
