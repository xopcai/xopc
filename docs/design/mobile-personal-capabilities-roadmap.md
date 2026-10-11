# 移动端个人信息能力：调研与实施路线

2026-10-11。范围：xopc Android、HarmonyOS、iOS，随后复用到 PC、浏览器和硬件。本文是下一阶段设计与官方 API 调研，不表示新能力已实现或验收。

## 建议

优先把用户的行程、人际联系、文档、照片和主动分享内容接到 Agent。业务价值排序：日历 > 联系人 > 文档/照片 > 分享上下文 > 健康摘要。工程上先完成资源选择闭环，同时做日历权限验证；不要等全端日历打通才交付其他信息能力。

沿用现有 Endpoint Tools。新增一项能力要同时交付：受信契约、来源路由、端侧适配器、明确共享范围、输出投影、聊天反馈和三端验收。设备注册目录即可让 Agent 发现支持的能力，注册不等于读取个人数据或取得系统权限。

## 代码现状

- 已实现来源身份冻结、时区/语言、状态/电量、单次位置任务；HarmonyOS Mate 60 已验收核心链路。Android/iOS 同能力目前仍缺真机验收。
- `src/endpoint-tools/policy.ts` 已认可 `mobile.contacts.pick/search/get`、`mobile.file.pick` 等；协议已有联系人和文件输出类型。三端未找到对应联系人 Device Tool 执行适配器，不能把服务端白名单当成已交付能力。
- HarmonyOS `chatPhotoPicker.ets`、`fileTransfer.ets`，iOS `AttachmentPickerModifier.swift`，Android `ChatAttachmentStore.kt` 等已有附件/选择/采集基础。主动附件入口和 Agent 发起选择的工具仍需接通，复用上传链路。
- HarmonyOS 已有 `ShareExtensionAbility.ets`、`shareIntake.ets`。Android/iOS 需要分别核对系统入站分享入口，现有“分享中心”页面不能证明已接收其他 App 分享。
- `deviceCapabilityTarget()` 目前仅 device.* 和 web.page.get_selection 默认指向 turn_origin；contacts.*、file.pick 新接入时必须增加明确的来源端规则，否则会落到 session_bound。
- `grant-service.ts` 当前跨设备单次授权限于位置任务，参数也使用 LocationRequest。联系人/日历不能直接套用现有授权接口，需逐项扩展受信契约和授权范围。

## 能力优先级

“可实施”指存在公开 API 或用户选择入口；不保证所有版本、所有账号、所有 App 内的数据均可访问。复杂度是相对工程判断，非工期承诺。

| 优先级 | 能力与首版范围 | 用户场景 | 平台差异/前置条件 | 复杂度 |
| --- | --- | --- | --- | --- |
| P0 | 文件选择、已共享文件的内容读取 | 总结 PDF、合同、课件；提取账单字段 | 三端系统选择器；只访问已选文件，复用上传和解析 | 低—中 |
| P0 | 照片选择、拍照/扫描 | 看截图、识别菜单、票据、纸质资料 | 三端选择/相机 API；先选或拍，再处理；视频后续 | 低—中 |
| P0 | 联系人选择，只返回选定姓名及请求的号码/邮箱 | 找到某人的联系方式、准备邀请 | Android ACTION_PICK；iOS ContactsUI；鸿蒙 selectContacts | 低—中 |
| P0 | 日历空闲时间/事件查询 | 今天安排、会议冲突、出行规划 | Android/iOS 可直接建设；鸿蒙全日历权限和签名须先验证 | 中；鸿蒙有权限门槛 |
| P0 | 系统分享至 xopc、主动粘贴 | 将其他 App 的文章、聊天片段、订单、地址交给 Agent | 来源 App 实际分享什么就处理什么；不保证分享 URL 包含正文 | 中 |
| P1 | 已授权联系人搜索、单联系人详情 | 用户不用每次在选择器中找人 | 需明确联系人共享范围；iOS limited、Android 版本变化、鸿蒙读取权限分别适配 | 中 |
| P1 | 日历事件详情、确认创建/修改 | 看会议地点、创建行程 | 写操作独立确认；系统编辑页取消不算成功；禁止自动重复写入 | 中 |
| P1 | 提醒事项/待办 | 今天要做什么、截止任务 | iOS EventKit Reminders；Android/鸿蒙系统待办非通用跨端接口，先用 xopc 任务 | 中 |
| P1 | 用户选定图片/文档的结构化提取 | 表单、发票、清单、名片 | OCR/解析属于内容处理管线；端侧提取或现有 Gateway 解析按格式确定 | 中 |
| P1 | 网络、连接、前台可用性摘要 | 选择上传方式、提示打开手机 | 有界状态；未知返回 null；不读取 SSID/IP/周边设备作为用户画像 | 低 |
| P2 | 步数、睡眠、运动的按日聚合 | 复盘运动和作息 | HealthKit/Health Connect/Health Service Kit；设备、地区、账号、开放范围和应用资格验证 | 中—高 |
| P2 | 已获授权照片集合的日期/类型检索 | 找某段时间照片 | 与系统选择器不同，需要媒体库访问；云端未下载内容和权限收缩需处理 | 中—高 |
| P2 | 活动状态、方向/运动传感器 | 步行场景、硬件联动 | 平台权限与传感器不一致；没有明确场景时价值低于日历文档 | 中 |
| 单独立项 | Android 通知摘要/使用统计 | 消息汇总、时间使用分析 | 特殊系统授权、平台不对称；不能承诺 iOS 普通 App 可读取其他 App 通知/使用正文 | 高 |
| 不作为通用首批 | 全量短信/通话记录、任意 App 聊天/账单/浏览历史、账号凭证 | “手机上的所有信息” | 无三端统一公开读取接口；通过用户分享、截图、导出或对应服务 connector 提供 | 高/部分不可行 |

用户相关信息不等于设备标识。IMEI、MAC、广告 ID、自动推断手机号等不优先；用户姓名、偏好通过 xopc 用户资料和明确输入取得，不从联系人“我”或设备昵称推断。

## 关键系统事实与来源

### 日历

Android Calendar Provider 可读取事件与展开的重复事件实例，读取需要 READ_CALENDAR；Intent 可以交给系统日历编辑，但不能替代日历查询。首版使用 Instances 做时间区间查询，不能只查 Events 就判断重复事件冲突。[Android 官方说明](https://developer.android.com/identity/providers/calendar-provider)。

iOS EventKit 读取事件/提醒需要 full access，没有系统 read-only 授权；write-only 不能读回自己创建的事件。xopc 的“只查询”是产品执行限制，授权说明不能称系统仅授予只读权限。用当前 requestFullAccessToEvents/Reminders，不沿用已弃用请求方法。[Apple 官方授权说明](https://developer.apple.com/documentation/eventkit/accessing-the-event-store)。

HarmonyOS Calendar Kit 有事件查询/编辑能力，但旧版概览和本机新 SDK 不能简单等同：本机 `@ohos.calendarManager.d.ts` 的 getAllCalendars 注释描述当前应用及默认日历；API 23 权限注释出现 READ_WHOLE_CALENDAR，editEvent 注释说明读取系统创建事件需要该权限。本机 `PermissionDefinitions.json` 中此权限为 system_basic、provisionEnable=true。因此“读取全部用户日程”必须验证权限申请、签名 ACL、真机返回的账号范围，不能以 READ_CALENDAR 返回空列表宣称用户没有日程。此项为本地官方 SDK 证据，网页旧版概览仅支持 Kit 基础能力。[华为官方概览](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V14/calendarmanager-overview-V14)。

权限 PoC 未通过时：能力标注 limited_scope/unavailable；仅提供确实可见的 xopc 日程并明示范围，或提供用户导入 ICS / 后续日历账号 connector。不能伪造全量日历支持。

### 联系人

先提供系统选择入口，再提供授权集合的搜索。iOS ContactsUI 支持选择和 limited 联系人访问。[Apple ContactsUI](https://developer.apple.com/documentation/contactsui)。Android 新 Contact Picker 要做 API 37+ 检测；旧系统保留 ACTION_PICK 指定电话/邮箱字段路径，不把新版 API 当作当前全量设备基线。[Android 新选择器](https://developer.android.com/about/versions/17/features/contact-picker)、[通用 Intent](https://developer.android.com/guide/components/intents-common)。鸿蒙当前 SDK 的 selectContacts 为公开选择 API，query 系列标有 READ_CONTACTS。[华为联系人 API](https://developer.huawei.com/consumer/en/doc/harmonyos-references-V2/js-apis-contact-0000001478181645-V2)。

### 文件、照片与分享

系统选择器给予选定内容访问，适合第一批。Android 使用 Photo Picker 与 Storage Access Framework；没有 Photo Picker 的设备走文件选择回退，避免依赖 GMS 补装。[Android Photo Picker](https://developer.android.com/training/data-storage/shared/photo-picker)、[文档访问](https://developer.android.com/training/data-storage/shared/documents-files)。iOS 使用 PhotosPicker/PHPicker、文档选择器；外部文件需要管理 security-scoped 生命周期。[Apple PhotosUI](https://developer.apple.com/documentation/photosui)、[文档选择器](https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller)。鸿蒙 PhotoPicker/DocumentViewPicker 提供用户选择路径。[华为 PhotoPicker](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-v5/component-guidelines-photoviewpicker-V5)、[文件 Picker](https://developer.huawei.com/consumer/en/doc/harmonyos-references/js-apis-file-picker)。

分享是用户输入通道，不是 Agent 静默读取另一 App 的工具。Android 接收 ACTION_SEND 内容；iOS 用 Share Extension 取得宿主给出的文本/附件，不能据此枚举宿主全部数据。[Android 入站分享](https://developer.android.com/develop/ui/compose/sharing/receive)、[Apple Share Extension](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html)。

### 健康及高限制数据

HealthKit 按数据类型授权，并不暴露可靠的读取拒绝状态；空结果不能解释成用户步数为零。[Apple HealthKit](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)。Health Connect 需检测实际可用性，不能覆盖所有无 GMS 的 Android 设备。[Android 可用性](https://developer.android.com/health-and-fitness/health-connect/availability)。HarmonyOS Health Service Kit 当前引用版本列有地区/设备限制，scope 需平台开放申请与用户授权的交集；先确认当前账号和发行条件。[华为 Kit](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V14/health-service-kit-ability-V14)、[scope 说明](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V5/health-faqs-2-V5)。

Android 通知监听有 NotificationListenerService；这是平台专属接入，不是三端共同能力。[官方 API](https://developer.android.com/reference/android/service/notification/NotificationListenerService)。SMS/Call Log 的 Google Play 发布有默认处理器及允许用途等限制；即便侧载可获得权限，也不代表能作为通用发布能力。[官方发布政策](https://support.google.com/googleplay/android-developer/answer/10208820)。

## 发现、调用与信息流

1. 手机握手声明它实现的受信工具；不上传日历、联系人或照片清单。
2. Gateway 校验 schema/revision/策略/平台条件，将具体工具挂到现有 deferred tool search。
3. 用户消息保留当前来源端；个人信息读取和选择器默认指向 turn_origin。跨端请求必须显式选目标并有对应授权。
4. Agent 发现工具及执行条件；需要用户选择时在手机显示选择卡片/原生选择器。后台设备返回需要前台，不自动替换其他手机。
5. 手机校验 xopc 范围与 OS 权限，按本次范围读取。工具等待用户期间可取消，迟到选择不能上传。
6. Gateway 验证结果和资源所属会话，再把已允许字段/附件交给 Agent，显示来源、范围、采样时间和截断情况。

建议新增只含状态的 capability availability 视图，区分 supported、permissionNeeded、limited、requiresForeground、offline、unavailable，而不是一个“已授权”布尔值。状态不可观察时返回 unknown，例如 HealthKit 读权限。首版可用受信状态工具/管理 API 查询；若将来增加实时目录更新，需要版本协商，不给 Endpoint v2 随意添加字段。

每条消息继续只带设备身份、语言、时区等有界基础环境。日历、联系人、最近照片和剪贴板不是自动附加的上下文。用户主动分享则冻结该次资源快照；Agent 按需读取则按调用授权。

## 第一批工具契约（拟议）

名称仍需在受信目录中正式加入，不能只在端上注册。已存在工具优先复用。

| 工具 | 约束与结果 |
| --- | --- |
| mobile.contacts.pick | 首版选择一人；请求 name/phone/email 明确字段；原生选择器本身承接用户共享；取消无结果 |
| mobile.contacts.search/get | P1；搜索非空，最多20项；只在已授权集合查询，不同名自动选人；get 使用本次受限资源引用 |
| mobile.file.pick | 复用现有名字；限定类型/大小，上传后返回经 Gateway 验证且归属本会话的 fileId；Agent 不拿 content:// 或本地路径 |
| mobile.media.pick | 照片选择，首版最多5张、复用现有附件大小总额；默认剥离 EXIF GPS，用户可预览分享项 |
| mobile.camera.capture | 单次拍照，用户操作快门；取消无结果；不持续摄像、不在后台拍摄 |
| mobile.calendar.query_events | 必选时间范围，首版最多7天/50项；字段白名单，默认标题、起止、全天/忙闲、时区；描述/参与人/会议链接另请求 |
| mobile.calendar.get_free_busy | 同一授权范围，端上只输出忙闲区间；不读取后再把全部标题上传隐藏 |
| mobile.calendar.get_event | P1；会话内资源引用；范围不能超出已批准的日历和事件集合 |
| mobile.calendar.create_event | P1；用户检查标题、时间、目标日历后创建；幂等/回执与 uncertain 状态完整后上线 |
| mobile.health.get_daily_summary | P2；指定日期/类型，只聚合；来源、单位、时间范围、缺失原因明确；不能将设备累计计步器当完整当日健康数据 |

系统分享/粘贴作为输入和共享资源接入，不强行包装“读取其他 App”工具。OCR 与文件解析复用已有内容处理，避免三个平台都实现一套通用解析引擎。

## 数据范围与保留

- 先做“允许一次/用户实际选中”。跨多次查询的会话授权作为后续独立交付，不能用系统权限永久开启替代 xopc 授权。
- 授权记录包含源设备、目标设备/连接、会话、能力、日历集合/字段、日期范围、参数摘要、截止时间。不要把模型描述用途当凭证。
- 位置仍执行现有只返回任务摘要规则。联系人、事件标题和文件正文不同：Agent 完成任务需要看到已授权内容，结果可能保留在聊天；确认文案要说明这一点，不能套用“任何个人数据均不进入模型/历史”的承诺。
- 日历忙闲允许无标题投影；事件查询仅授权字段。手机号只有需要具体联系/匹配时输出，其他用途可只返回姓名和引用。
- 通用个人资源引用绑定 principal/会话/字段/有效期，不能是任意可猜的系统 ID；撤销后阻止继续读，已进入历史的数据按现有删除能力处理，不能承诺撤销会自动抹除过去答案。
- 建立“不自动转长期记忆”的读取标识并验证记忆输入路径，用户要求记住时再用现有记忆授权方式。此项需要新实现，当前不宣称已经成立。
- 日志、授权审计、遥测只记录元数据；正文在允许的内容路径中处理，不能在失败日志中倾倒联系人/事件/文件。
- 外部照片文字/文件/事件描述均为资料，不得作为授权或系统指令。

## 实施顺序与完成标准

### A：共享资源与联系人选择

复用选择器和上传，接通 mobile.file.pick、联系人选择，新增照片选择/单次拍照；完善 share 输入快照。明确等待选择、已选、上传、Agent 使用、拒绝/取消状态。每项交付都在三端上线注册、tool search 发现、调用真实选择器、返回内容、来源卡片的完整闭环。

先交付可快速复用的文件/照片与 contacts.pick，不暴露还未实现的 contacts.search/get。已有附件操作继续可用。

### B：日历查询

业务优先级最高；从 A 开始同时安排权限 PoC。Android/iOS 查询指定日历的重复事件实例；鸿蒙首先真机验证 WHOLE 权限与系统用户创建事件可见范围。通过后交付 busy-only 和指定范围事件查询；不通过则如实声明有限能力，保留导入/账号连接替代路径。

默认查询今天/未来7天，不开历史全量同步。测试时区、全天事件、跨日、重复例外、权限收缩、分页/截断和空集合，并显式返回 accessScope/coverage/truncated，让 Agent 不能把部分可见当全量日程。

### C：更顺畅的个人助手

搜索已授权联系人、事件详情、受确认的日历创建；iOS reminders 与 xopc 任务统一业务语义但保留数据源差异。写操作出现网络中断时，先查回执，不重复创建。

### D：健康与持续上下文

先验证开放范围和发行资格，再做按日摘要；后续单独实现会话授权、后台事件与持久订阅，不通过常驻 WebSocket 轮询假设 iOS 永久在线。

所有阶段必须验收：来源不串、系统选择与权限真实发生、取消/后台/断线无迟到内容、权限缩小不扩大读取、错误不会无限弹窗、空值不伪造零、工具结果/历史/记忆范围符合选择、能力不可用时不偷偷换设备。
