# 等待用户判断的通知技术方案

调研日期：2026-10-10。状态：第一阶段已实现；第二、三阶段仍为后续规划。

## 结论与范围

截图对应普通对话的持久化 `clarify` 卡片。应在问题成功持久化、确实需要用户回答时产生产品通知，点击回到问题所在对话。建议扩展现有 `NotificationService`，新增 `chat.needs_input`；审批仍沿用同一事件类型，在 payload 中用 `kind: input | approval` 区分。不要让模型另行调用通知工具，也不要从问题文字猜测是否需要通知。

首期覆盖持久化对话的输入澄清和审批，包括 Personal 对话；复用 Electron、在线 Web 和现有 HarmonyOS Push。Task 已有 `task.needs_input`，需避免同一等待同时产生聊天与任务通知。临时 side chat、CLI 终端及 worker 的内部协作问题单独处理，不把所有问题自动提升为用户待办。

这里的“高优先级”表示产品层需要关注，不绕过用户关闭通知、系统权限或免打扰设置。首期不默认循环催促；未回答的问题保留为待处理状态。

## 代码现状与缺口

本次会话未提供 codebase-memory 图工具，因此在检查可用工具后回退到源码检索。调研结论来自工作区静态阅读；调研时没有修改运行代码或发送通知。后续实现与验证见下方记录。

| 环节 | 当前实现 | 对本需求的影响 |
| --- | --- | --- |
| 澄清入口 | `src/gateway/service/agent-runner.ts` 的 `requestClarification` | 普通持久化对话创建 wait，再发送 `clarify_request` 流事件；创建时未向全局通知链路发布事件 |
| 权威状态 | `src/storage/sqlite/clarification-wait-repository.ts` | `session_clarification_waits` 保存问题、选项、版本、来源 run 和 transcript；输入问题不设过期时间，审批 10 分钟过期 |
| 回答与恢复 | 同 repository 与 agent runner | 回答进入 `queued` 后恢复执行；用户回答入口会 emit `clarification.updated`，但状态还可能由替换、重置、恢复、过期改变，不能只依赖这一事件 |
| 通知规划 | `src/notifications/planner.ts` | `agent.run.ended` 只接收 success/error，suspended 不产生通知；没有澄清通知映射 |
| Task | `src/tasks/task-run-repository.ts` 的 `createWait` | user_input/approval 已入队 attention 事件，规划为 `task.needs_input`；普通对话没有这一兜底 |
| 全局出口 | `src/gateway/service.ts` 的 `emit` | 广播 gateway 事件后调用 NotificationService，可复用通知出口 |
| 持久化通知 | `src/notifications/store.ts` | dedupe_key 唯一，保存事件和移动设备 delivery；客户端可补拉通知、ack |
| 桌面 | Web coordinator → Electron IPC → native Notification | 主进程当前无条件抑制主窗口 focused 时的通知；Electron 退出后不能靠 renderer 提醒 |
| 在线 Web | coordinator → `showNotification` | 一般聊天当前在文档 visible + focused 时抑制，即使用户在其他对话或设置页 |
| 离线 Web Push | `browserTransport.ts`、`src/gateway/scenes/browserNotifications.ts`、`web/public/notification-sw.js` | 已有 VAPID、订阅和持久投递，但 host 绑定场景授权，SW push 路径白名单也仅允许 scenes，不能直接用于聊天 |
| 鸿蒙 | NotificationService → `sendHarmonyPush` → notificationNavigation | 已有设备注册、系统推送和 gateway 校验的点击路由；需要接入新事件，现有普通 Push TTL 是 24 小时 |
| iOS / Android | 服务端 platform 枚举包含两端，但 `NotificationService.send` 只投递 harmonyos | 尚不能承诺后台系统通知；本次检索未找到对应 APNs/FCM 产品通知注册链路 |

额外注意：worker 的非审批 `clarify` 在 agent runner 中走 Task collaboration question + external_event wait，需要协作者处理；它与截图中的用户澄清路径不同。Personal 来源 worker 的聊天通知还会被 `allowsPersonalTaskNotification` 抑制，不能简单新增类型就认为全部覆盖。

## 推荐事件与投递链路

```text
clarify → 持久化 wait + 同事务写 notification intent
        → 提交后通知泵读取 intent，并校验 wait 仍可回答
        → NotificationPlan(chat.needs_input)
        → notification_events / notification_deliveries
        → notification.created → Web Activity / Electron / 在线浏览器
        → Harmony Push；后续扩展聊天 Web Push
```

`notification intent` 是服务端持久化的通知生成意图，不是模型消息。建议建立轻量澄清通知 outbox，记录 `waitId`、来源时间和处理状态，以 waitId 唯一；不要在 SQLite repository 里直接引用 Gateway 或进行网络发送。wait 和 intent 在同一事务写入；通知泵通过注入的 planner/service 消费，通知落库和 intent 完成标记也同事务提交，随后广播并触发网络投递。

快速验证可在 `createClarificationWait` 返回后调用全局通知出口；正式实现应包含 outbox，否则进程在“wait 落库、通知落库”之间退出会永久漏报。启动时按批次对当前 transcript 的 open wait 做一次补偿扫描，补齐历史数据中缺失的 intent；每次重启都复用原 dedupe key。补偿记录应保留问题原创建时间，不能把历史通知伪装成新问题。

可借鉴 `NotificationResultOutbox` 的事务消费和重试方式，但该类的 owner/workspace/subject 字段来自另一套结果发布模型，不建议在本需求中硬塞兼容值或把两个通知存储体系一起重构。

建议契约：

```typescript
type = 'chat.needs_input'
target = { kind: 'chat', conversationId, personal? }
priority = 'high'
payload = { waitId, transcriptId, originRunId, objectiveRevision, kind, expiresAt? }
dedupeKey = `clarification.needs_input:${waitId}`
```

首次上线复用 chat target 和现有打开对话后加载 clarification snapshot 的行为，payload 带 waitId 供最新状态核对。若后续需要多问题精准定位，可向 chat target 增加可选 clarificationId，并同步修改所有端的解析和路由；首期不新增必填 target kind，降低旧客户端点击不兼容风险。新增通知 enum 仍需协调版本：旧 Web 的 Zod schema 会拒绝未知事件，不能认为追加枚举完全兼容。

默认标题：“需要你判断后继续”；审批标题：“需要你的授权”。在线应用内可展示截断的问题预览；系统通知默认用“有一个问题等待你回答，点击继续”，避免把用户问题或审批内容发到锁屏。预览采用现有纯文本裁剪，不发送 approvalKey 或完整 checkpoint。

## 状态、去重和过期处理

- **产生条件**：当前 transcript 下的 open wait，且明确面向用户。重复工具调用返回原 wait，不重复创建通知。不能以 runId 去重，因为同一任务可能先后提出多个不同问题。
- **发送前复核**：wait 存在、status=open、transcript 仍是会话当前 transcript、审批未过期，再检查用户通知偏好和目标设备资格。queued 已说明用户作答，无需继续通知。
- **回答后停止**：回答、自行判断、取消、superseded、expired、重置、删除会话均停止未发送 delivery。应增加明确的取消状态及原因，或以等效的状态终结接口实现；不要把用户已回答记为投递失败。
- **两类确认分开**：当前 `acknowledgeNotification` 在客户端消费时就执行，说明事件被接收，不表示用户回答。产品“待你判断”只能由 wait 状态决定。
- **已送达通知**：已被推送服务接受的通知不能保证撤回。点击后重新拉 snapshot；原问题失效时显示“这个问题已处理/已过期”，不展示旧选项供作答。短期客户端可对可控制的本地通知主动关闭。
- **审批 TTL**：将 Push 缓存期限限制在 expiresAt 剩余有效期内，并在每次重试前复核。现有 Harmony 固定 24 小时 TTL 不适合 10 分钟审批；传输接口应支持按事件 TTL。
- **旧问题补发**：现有 Web catch-up 只对最近 5 分钟事件尝试系统提醒。旧 open wait 保留在应用内待处理提示；首期保留这一防刷屏规则，不将重启作为重发理由。
- **Task 去重**：持久 wait 关联 TaskRun 时优先复用 Task attention 通知，补充 clarificationId 关联和点击目标。需要核查 task_run.wait_created / task attention payload 能否携带关联 ID，不能仅按 taskId 抑制后续独立问题。内部 collaboration 问题仍按实际接收人通知。

投递保证采用“通知持久化、服务端幂等生成、客户端去重、发送前复核”，不承诺系统端 exactly-once。推送超时可能已到服务商；现有 NotificationService 会自动重试，需要稳定 eventId/notifyId 并测试重复显示，服务商 accepted 也不等于用户已看见。

## 前台策略与设置

推荐新增 attention 表现状态，与 success/error 分开；“需要判断”显示为待处理，不显示成失败。Web 的通知偏好新增 `needsInput`，移动设备 preferences 新增 `chatNeedsInput`，旧配置缺省为 true。不要把关闭“完成提醒”或“失败提醒”解释为关闭待判断提醒。

| 用户位置 | 推荐行为 |
| --- | --- |
| 当前问题卡片可见、窗口有焦点 | 保留卡片及待处理状态，抑制系统横幅 |
| 应用在前台，但看其他页面/其他对话 | 应用内提醒，同时允许系统通知 |
| 应用在后台、最小化或浏览器标签页隐藏 | 系统通知，点击打开对应会话 |
| 系统权限拒绝/用户关闭通知 | 应用内待处理状态仍存在；不反复申请权限 |

“卡片可见”建议用 route/conversationId + document visibility/focus + 卡片可见性报告组合判断；Personal 要核对具体 conversationId。Electron 主进程目前仅看窗口焦点，需要由可信 renderer 报告短时有效的当前问题可见性，主进程保持权限与参数校验。移动端若希望系统 Push 也抑制当前问题，可后续增加带租约的 presence；首期不声称跨设备抑制已具备。

多端原则：每个有资格的设备可收到一次通知；一端回答后所有端清除待处理。服务器消费 ack 不应阻止其他设备通知，否则后台标签页接收事件可能吞掉手机提醒。

## 分阶段实施

### 第一阶段：补齐截图场景

1. 更新 gateway-contract enum、通知 presentation/偏好默认值。
2. 新增 wait notification intent 存储、SQLite migration 和事务写入；接入 Gateway 通知泵和启动补偿。
3. 扩展 planner 与 NotificationService，加入 wait 状态复核、Task 去重、Personal 路由与过滤检查。
4. 调整在线 Web 和 Electron 的 attention 前台策略；鸿蒙复用 chat 点击路由并支持按事件 TTL。
5. 点击后复用现有 `GET /api/sessions/:conversationId/clarification` 和 `POST /api/clarifications/:id/responses`，保留版本校验和幂等回答。

首期无需新增回答 API。若新增 presence / 待处理查询等 authenticated API，必须同步 lazy-bundles matcher、正负映射测试和通过真实带认证 Gateway 的验证。

### 第二阶段：离线 Web

复用浏览器订阅和 VAPID transport，但为澄清建立独立的授权/状态复核适配器；不要调用 scene dispatcher。SW push 扩展为验证 chat 路径或结构化 target，不放宽成任意 URL。统一在线 showNotification 与 Web Push 的 eventId/tag 去重，避免同一浏览器收到两次提醒。Web Push 依赖安全上下文、浏览器权限与已注册订阅；关闭网页后的送达由浏览器推送能力决定。

### 第三阶段：iOS / Android

分别补齐 APNs 和 Android 推送提供方的 token 注册、服务端凭证、发送适配、深链与后台验证。FCM 可作为具备 Google 服务环境的 Android 选项；实际渠道选择需按发行市场另行验证，不能把 Harmony Push 直接当作 Android 实现。以上能力独立于本次澄清事件，可以沿用同一产品通知契约。

## 验收重点

1. 普通对话提出问题后，切去其他应用能够收到提醒，点击回到真实待回答卡片；审批不会显示为执行失败。
2. 重复创建、重新连接、通知补拉、Gateway 重启不会生成第二个同问题通知；新 wait 正常产生新通知。
3. 故障注入：事务提交前退出无半成品；wait+intent 提交后退出可恢复通知；通知落库后广播前退出可补拉。
4. 回答/取消/自行判断/被替换/重置/删除后，积压通知不继续发送；审批 TTL 不超过剩余有效期。
5. 当前卡片可见时不弹系统横幅，看其他对话时会提醒；多窗口和 Personal 的可见性不能互相误判。
6. Task 关联澄清只发一类产品提醒，Personal worker 过滤不会吞掉真实面向用户的问题。
7. 权限拒绝、通知开关关闭、旧配置、旧客户端、设备 token 失效和推送网络超时均有覆盖。
8. 首期验证桌面、在线浏览器和鸿蒙真机；第二阶段单独测试网页关闭后的 Web Push。当前已完成自动化验证，桌面系统横幅和鸿蒙送达仍需真机验证。

## 官方资料

- [Electron Notification](https://www.electronjs.org/docs/latest/api/notification)：主进程创建系统通知及 click 事件；现有 IPC 可以继续承载点击打开会话。
- [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) 与 [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)：后台 Push 交给 service worker，依赖安全上下文，localhost 可用于开发。
- [Apple 远程通知服务端](https://developer.apple.com/documentation/usernotifications/setting-up-a-remote-notification-server)：APNs 需要服务端与客户端注册，不能只接 realtime 事件。
- [Firebase Android 消息接收](https://firebase.google.com/docs/cloud-messaging/android/receive-messages)：后台 notification message 可由系统托盘展示，点击再进入应用。
- [Huawei Push Kit](https://developer.huawei.com/consumer/cn/hms/huawei-pushkit)：平台推送能力入口；本方案具体复用当前仓库的 HarmonyOS V3 transport，新增参数应再按对应 SDK/API 文档验证。

## 第一阶段落地记录

已接入 `chat.needs_input`、独立提醒偏好、wait 与 notification intent 同事务写入、幂等发布、启动恢复、发送前状态复核及失效 delivery 取消。SQLite v239 保留已有投递记录，并补齐旧 open wait 的通知意图。关联 TaskRun 的 wait 不另发聊天通知。

Web 会在展示前读取真实 clarification snapshot，使用 attention 表现状态，并根据具体问题卡片可见性决定是否弹系统通知。Electron 的可信 IPC 支持为需要判断的通知放行前台显示，原通知策略继续适用于其他事件。鸿蒙复用现有聊天深链，审批 Push TTL 限制在剩余有效期内。锁屏通知使用通用正文。

验证覆盖通知模块、澄清持久化与生命周期、设备 Push API、通知契约、Web 状态与可见性、Electron IPC/点击路由、迁移数据保留。未接入离线聊天 Web Push、APNs 或 Android 提供方；没有执行实际系统通知或鸿蒙真机送达测试。

验证结果：相关回归累计 142 项通过；后端类型检查、Web 类型检查/生产构建、Electron main/preload 构建和本次修改的适用 ESLint 检查通过。契约包整体 typecheck 被既有 `sessions-backend-contract.test.ts:65` 引用不存在的 `SessionListItem.usage` 阻塞，该文件未在本次修改中变更。
