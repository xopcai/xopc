# P2a-1 S3 实施与验收记录

基于 main `3f86a8af255b1d52108ba11c59b0703ab85592aa`（PR #40）。新 worktree `/Users/micjoyce/.codex/worktrees/gateway-p2a1-s3/xopc`，分支 `codex/gateway-p2a1-s3`。先提交[范围/契约冻结](./electron-gateway-s3-contract.md)，再提交受限传输和恢复存储、聊天 UI/切换、保守流核实修复。最终产品源码为 `e6298c4fc`，初次实施未 push、创建 PR 或合并；后续按 review 授权验证并提交 PR，见文末补充。

## 交付与改造边界

- `packages/gateway-contract` 与 Gateway desktop-chat：普通 S2 discovery 保持原响应，显式 `?chat=1` 才声明 `text-receipt.v1`。旧 Gateway 无该能力时只读，不开放提交。没有新增路由家族、lazy matcher、设备/配对或 SQL schema；原 lazy 路由与真实认证入口均验证。
- `electron/shell`：仅增加现有纯文本 inputs、receipt 查询和服务器 run abort。复用 SessionInputCommand、owner 的 system/cli 来源、稳定 clientMessageId、receipt、run 状态；拒绝项目执行、Endpoint、附件、上下文、steer/interrupt 和所有本机能力字段。上游每次代理前重新核验已 pin 身份，再发 owner 凭据；硬错误锁定，不自动回本地。
- `electron/chat/state.ts` 与受限 IPC：按 profileId/Gateway 身份/公钥摘要隔离的加密业务提示，只保存所选 UUID、最多20份草稿和一条待核实输入身份。单份草稿8192字符，JSON总256KiB；写文件与目录 fsync 确认后才允许 POST。没有历史数据库、token、持久 cursor 或离线提交队列。安全存储失败/超时拒绝新输入；配置显式移除/改目标会清理孤立提示，并告知不会停止服务器任务。
- `electron/chat/model.ts`：复用 RealtimeClient 和 agent-stream-client。run topic/cursor 去重、gap 后重新读取服务器快照；网络最多10次有界重试，认证/证书/身份/协议硬错误要求恢复。仅远端增加40秒单调时钟/3秒巡检，半开检测仍按原45秒门槛验收，不改本地 RealtimeClient。
- 发送前持久记录意图；网络断开/丢响应/窗口或进程重建只查询 receipt，不自动重发。404只表示当前未找到，不推断没执行。存在待核实记录时，该连接所有会话暂停新提交；收到匹配 receipt 后才清理。停止区分已请求、服务器响应、状态确认和未知，不把 abort 响应当作已停止。
- 原历史接口不一定带流 messageId。无法建立可信对应时，不以相同文本猜测身份：当前轮次还没有持久回复时展示流；有持久回复后以服务器快照为准，后续段落按事件/周期快照刷新。避免重复气泡或错误改写相同前缀的不同回答。
- 独立包内文本聊天页通过 esbuild 复用既有客户端协议库，展示会话、文本、历史翻页、运行/停止状态、许可图片与恢复入口。最近100个会话、历史每页100条；翻旧页时不发送，回最新消息再发送。草稿按会话隔离并可找回；原始工具/路径内容只展示文本，不触发本机动作。没有完整本地管理控制台、结构化工具卡片、上传、写盘下载、PTY、Computer/Browser、语音或远端 Host。
- 每次显式连接（包括已有 pin）递增 epoch；错误响应携带不含凭据的当前配置快照，避免失败后配置页一直使用过期 epoch。A/B 切换重建独立内存窗口，清理 HTTP、WS、订阅、缓冲、Cookie/会话；清理未确认则继续隔离。配置预览的旧 status 字段仍表达“仅选择尚未建立连接”，聊天就绪状态由独立会话状态机判断。

默认 `electron/index.ts`、`electron/main.ts`、本地 Gateway 进程监督、原性能采样器和历史证据未改；本地模式不经过 Shell，不读取/迁移上述业务存储。原本地路径中的 Host 保持既有行为，远端窗口不注册任何 Host、Endpoint 或本机能力。

## 阶段与验证

| 阶段 | 交付/验证 |
| --- | --- |
| 契约与基线 | 冻结原 S0 预算；新 main 完整产物独立基线8/8。首轮与类型检查短暂重叠，原样保留但不采纳，独立重跑使用同一 main 产物 |
| 传输/存储 | owner/S2-S3 协商、纯文本字段拒绝、身份变更锁定、receipt、加密隔离/损坏/超时、写入前记录、旧 epoch拒绝 |
| UI/恢复 | 真实 Gateway 新建/追加/历史、服务器停止核实、网络/gap/半开、丢回执、进程重启与 worker SIGKILL、A/B 草稿/历史/待核实隔离、返回本地 |
| 最终回归 | 940项 / 113文件通过；完整类型检查、lint（0 errors / 5个既有 warnings）、depcheck（0 violations）、CLI启动导入检查；Node/Web/Electron构建通过 |

最终10组开发 E2E通过：聊天 SSH loopback（含半开）/HTTPS-WSS；Shell SSH/HTTPS；不信任证书/错误主机名；清理失败隔离；配置预览；原生安全存储；本地新建/复用完整功能。包含111项既有 IPC × invoke/send/MessagePort 拒绝、同 Cookie窗口拒绝、bootstrap重放拒绝、新 state IPC来源拒绝、设备列表不变、客户端无额外 Gateway/SQLite/workspace。显式回本地检查生产代码请求的干净 relaunch 参数，并由测试监督器按这些参数启动原 main；不把它当作 OS 原生重启或安装包验收。

聊天故障代理只改变网络条件，Gateway/Agent/SQLite/认证路由与 Electron main/preload/utility 均真实；只有模型推理由本地 SSE fixture 确定化。gap 为代理注入的协议合法故障帧；半开保持HTTP正常并停止WS入站帧。不是物理远端机器、外部SSH登录/隧道管理或真实WAN。

## 修复与失败证据

所有记录在[独立证据目录](./evidence/electron-gateway-s3/README.md)，旧 S0/S1、性能和 S2 失败记录不变。

- 实际产品问题：历史缺流 ID 导致重复气泡；进一步用回归复现相同前缀的后续片段在 gap 后可能被错误合并，改为持久历史优先。已有 pin 重连不增 epoch 的边界也补齐，失败响应同步刷新配置快照。
- 编译失败：一次事件注册多传参数，随后必需 stream callback 和 UUID默认参数推断不匹配；均修复并保留日志。
- 测试口径：重新核验 discovery 的重定向现在是硬错误409并锁定，旧502断言拆分；预览旧文案及错误响应新增snapshot断言同步更新；一次错误 project过滤未执行测试，保留并正确重跑。
- E2E fixture：旧 agents 配置字段已由服务端目录/配置API管理，改通过真实管理API准备fixture；等待配置页导航完成；改用可用的主进程内置模块接口；构建Node后重新构建被清理的Web产物；本地browser-session核对真实conversationId响应；utility metrics兼容name/serviceName。均未修改产品超时或原性能预算来使失败通过。

## 验收限制

当前只完成所列 macOS arm64 开发产物范围的 S3 技术预览。TLS终止代理与真实Gateway是独立测试进程，不代表Gateway原生TLS接入。S4安装包/独立服务器/跨平台与S5长期故障、24小时运行、升级回退等仍待实施。完整富媒体、工具交互和本地控制台不在本次纯文本预览范围；不宣称全部A01–A10、完整P2a-1发布或所有环境与本地具有同等稳定性。

## 原预算最终对照

两轮各60次启动，均 **8/8通过**。每模式每API129个样本，继续比较历史S0；未放宽预算、改变权重或加入计时前等待。正式采样期间没有并行构建或测试，前后及两轮产物指纹一致。

| 模式/指标 P95 | 原冻结上限 | 完整复测1 | 完整复测2 |
| --- | --- | --- | --- |
| spawn readyMs | 2140.48ms | 1897.59ms | 1914.40ms |
| spawn configMs | 52.60ms | 18.20ms | 17.00ms |
| spawn sessionsMs | 31.60ms | 20.20ms | 5.10ms |
| spawn rssMiB | 1077.64MiB | 1025.86MiB | 1023.02MiB |
| reuse readyMs | 1102.21ms | 993.97ms | 952.21ms |
| reuse configMs | 53.30ms | 18.80ms | 25.10ms |
| reuse sessionsMs | 25.00ms | 20.10ms | 8.10ms |
| reuse rssMiB | 719.53MiB | 708.36MiB | 698.02MiB |

额外本地故障验收通过：移除 S3 专用连接入口chunk、worker、包内远端HTML/JS/CSS和两种受限preload后，本地新建/复用完整功能E2E均通过。副本共享开发依赖、Gateway/Web/SQL与辅助资源映射，仅证明所列资产缺失不阻断本地原路径，不替代安装包验证。首次准备副本误以为chunk在out/main根目录，断言失败且尚未启动功能测试；修正实际out/main/chunks路径后通过，准备失败记录也保留。

## S3 review 补充

review 确认并修复会话切换/关闭时的旧历史与迟到连接、旧停止回执污染、草稿 drain 收尾微任务漏写、意图落盘期间断线后仍发送、初始化与显式选择竞争。先以受控异步边界复现6项失败，再修复；复现日志保留。切换先撤销旧 generation/请求，每个等待后再核对；写入 Promise 覆盖真正持久化，发送调用前再验证当前状态。没有重放未知 POST 或放宽预算。

修复后相关946项 / 113文件、完整类型检查、lint（0 errors / 5个既有 warnings）、depcheck（0 violations）及CLI启动导入检查通过，Electron产物重新构建；Node/Web/Gateway/SQL源码未变，沿用此前通过的构建。相关证据、最终E2E与性能原始数据见[review记录](./evidence/electron-gateway-s3-review/README.md)。本地默认入口与监督、原采样器及历史证据保持不变，S4/S5与远端Host/本机能力继续不接入。

review 后10组E2E和两轮原预算对照通过：每轮新启动/复用各30次，每模式每API129样本，均8/8；out/main、dist/Gateway/Web和SQL指纹与原S3验收相同。未改变采样或预算，最终指纹/原始耗时/命令见review的validation.json。
