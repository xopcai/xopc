# P2a-1 S2 实施与验收记录

基线 main `ab82be00f`（PR #39），新 worktree `gateway-p2a1-s2/xopc`，分支 `codex/gateway-p2a1-s2`。先提交[范围与接口冻结](./electron-gateway-s2-contract.md)，再提交认证/传输、受监督窗口和限额/故障回归。没有推进 S3、远端 Host 或本机能力，没有 push、创建 PR 或合并。

## 已实施边界

- 默认入口继续直接进入原本地 main；远端仍需显式 `--gateway-connections`。保存/选择配置不联网，新增“建立 S2 连接”才启动认证和 worker。
- 新增 owner token 认证下的 `GET /api/desktop-chat/bootstrap`，复用持久公开 identity、既有 nonce/Ed25519 challenge，新增独立聊天传输 manifest；不同于 Endpoint/Computer 兼容检查。不创建配对、设备、schema 升级或本地会话数据库。
- 首次认证后证明身份才持久 pin；已有 pin 时先以不携带 owner token 的随机 challenge 验证，再发认证 discovery。同 URL 身份变化锁定，旧 pin 不被覆盖，需用户核实后显式移除/重建配置。profile body 写入 v2，兼容读取 v1；默认本地入口不读取或迁移它，旧版本配置预览可能拒绝 v2，但本地启动仍独立。
- Shell 网络、JSON/WS 解析在受监督 Electron utility process；主进程只保管凭据、协调窗口与存储、监督进程。配置恢复页独立于 worker；崩溃后关闭对应会话，手动恢复，不自动切本地或重放操作。
- 每次连接独立内存 partition，无存储路径。一次性可信 IPC bootstrap 在主进程安装 HttpOnly/SameSite Cookie，凭据不进 Renderer。每个 HTTP/WS 还须主进程按 WebContents、顶层 frame、精确 URL 注入窗口 proof，抵御 Cookie 跨 loopback 端口/窗口共享。
- 固定上游、精确 Host/Origin、逐方法/路径/query 白名单、无重定向、头重建、no-store、CSP/nosniff/下载和权限拒绝。代理不开放设置、更新、配对、设备、Endpoint/Computer/Browser 或本机路径。
- 只复用 read/ticket/resource 与 Realtime v2。ticket 绑定当前 Shell/clientId、一次使用；拒绝 Endpoint hello/message 与控制 topic，限制 sessions/session/run。16 活跃/16 排队、4 媒体活跃保留控制容量、最多 2 条 WS；JSON 4MiB、资源 32MiB、client frame 256KiB、server/待发送帧 4MiB，含 JSON 重编码膨胀检查；取消关闭上游，无进度 30s，认证/握手 15s，清理 15s。
- 新建/切换前清理旧 worker、流、cookie/存储及连接池；清理未确认则在本进程隔离，禁止新激活。配置动作进入串行队列后重新检查 epoch，过期请求不能先关闭新 Shell。退出过程消费清理异常，显式回本地先确认 worker 退出再按原入口重启。

S2 页面只显示已核验传输与恢复入口，没有聊天输入/历史、Agent 执行、上传、磁盘下载、草稿恢复、完整切换工作流或自动重连；这些是 S3/S4 的独立范围。默认本地 strict 兼容、Cookie、生命周期/停止权限、文件/PTY/浏览器及已有 Host 路径未改。

## 核对中发现并修正的问题

1. 首轮 TypeScript 的导航事件联合类型不匹配 Electron overload，改为逐项注册；失败日志保留。
2. 首轮 Host 测试使用 fetch，实际未发送伪造 Host；改原始 HTTP 请求验证精确 Host 403。该失败属于测试口径，未放宽服务端检查。
3. 首轮真实 Electron WS 失败：窗口 proof 的 webRequest filter 只有 HTTP，补齐 WS scheme。后续真实 SSH loopback WS 与 HTTPS/WSS 均通过，原失败保留。
4. 第一次 HTTPS fixture 超时：现有 Gateway `tls-server.ts` 仅有配置 helper，未接入监听器。本轮不改本地服务监听逻辑；明确使用独立 TLS 终止代理→真实 Gateway 测试 HTTPS/WSS。测试 CA 仅通过启动器的 NODE_EXTRA_CA_CERTS 提供；不关闭证书或主机名验证。不宣称实现了 Gateway 原生 TLS。
5. 审查补齐使用实际 resolved auth（防止 env 覆盖为 none）、SSH localhost 解析只允许 loopback、过期会话不因回拨时钟复活、ticket 并发上限、重编码 WS 帧体积，以及 stale 配置动作副作用前的 epoch 校验。

## 测试与证据

相关单测/回归 **865 项 / 108 文件通过**，完整类型检查通过；lint 0 errors / 5 个既有 warnings，dependency-cruiser 0 violations；完整 Node/Web/Electron 构建通过。包含 Gateway owner/设备/无认证边界、lazy-bundle 正负映射、旧 profile/v2 pin、Nonce/身份、路由/头/MIME/Range、Cookie/proof、限额、媒体取消、ticket 重放、WS topic/帧边界等。实际 33 并发请求验证 16 活跃 + 16 排队 + 第 33 个 429；四条媒体流时控制请求仍可用；WS 第三连接被拒绝。

最终独立真实 Gateway + 生产 main/preload/utility process 的开发 Electron E2E 覆盖：

- 显式 SSH loopback 逻辑远端、可信 HTTPS/WSS；不受信任证书及错误主机名均明确 TLS 失败，无 Shell/本地回退。
- 真实认证/lazy-route、持久 pin、同 URL 换 identity 后锁定、不覆盖旧 pin；新窗口 HttpOnly Cookie、内存 partition、无凭据响应。
- 相同 Cookie/session 的另一个窗口仍无窗口 proof，HTTP 401；111 个旧 IPC × invoke/send/MessagePort（含 prepend），副作用 0；bootstrap 重放及旧 epoch 动作拒绝。
- Gateway 设备列表不变；客户端无本地 Gateway/SQLite/workspace；worker 清理、崩溃恢复、注入清理失败阻止新激活。
- S1 配置预览仍无自动连接；原生 safeStorage 跨进程验证；本地新启动/复用完整聊天、Realtime/SQLite、文件/PTY/浏览器、退出及自有/外部服务重启规则。

本轮没有外部 SSH 登录/隧道管理或物理远端主机；TLS 终止层与 Gateway 是独立测试进程，不把同机开发 E2E 当作 WAN/部署环境、真实安装包、跨平台或长期运行验收。S4 仍需真实发布产物和独立服务器。

证据目录为 [electron-gateway-s2](./evidence/electron-gateway-s2/README.md)。原 S0/以前失败证据保持不变，本轮所有失败与重跑原因独立保存。

## 原预算本地对照

最新 main 基线 60 次、新启动/复用各 30 次，按历史 S0 的权重和门槛 **8/8 通过**；不是重新制定预算。最终两轮仍比较历史 S0，保持每模式每 API 129 个样本、无诊断、无额外计时前等待；最终两轮各 60 次均 **8/8 通过**，共 120 次，运行前后产物指纹不变。

| 模式/指标 P95 | 原冻结上限 | S2 完整复测 1 | S2 完整复测 2 |
| --- | --- | --- | --- |
| spawn readyMs | 2140.48ms | 1803.86ms | 1815.67ms |
| spawn configMs | 52.60ms | 33.50ms | 31.90ms |
| spawn sessionsMs | 31.60ms | 18.90ms | 19.40ms |
| spawn rssMiB | 1077.64MiB | 1011.69MiB | 1011.03MiB |
| reuse readyMs | 1102.21ms | 882.90ms | 886.49ms |
| reuse configMs | 53.30ms | 31.50ms | 20.10ms |
| reuse sessionsMs | 25.00ms | 5.00ms | 6.20ms |
| reuse rssMiB | 719.53MiB | 693.92MiB | 694.98MiB |

额外故障产物移除了 S2 worker、Shell/配置 UI、受限 preload 和连接入口 chunk，本地两种模式的完整功能 E2E 仍通过。故障副本共享已构建 Gateway/Web 与开发 SQL 映射，明确不作为安装包验收。原始移除清单与报告单独保存。

结论：当前 macOS 开发产物范围内，S2 已实现范围的功能、隔离、故障恢复和原预算本地回归通过；不宣称完整 A01–A10、P2a-1 发布或本地/远端所有环境的同等稳定性。S3 的聊天写入/业务隔离/恢复与 S4 安装包/物理服务器、跨平台和长期故障矩阵继续待实施。
