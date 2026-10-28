# 外部文件与图片进入聊天：产品与技术方案

日期：2026-10-28。状态：已实现；平台验证范围与发布注意事项见文末。

## 1. 目标与核心决策

用户在文件管理器、图片预览、浏览器或其他应用中，选择“用 xopc 打开”或“分享到 xopc”，把原始文件加入指定聊天的输入框。用户可以补充问题、查看或移除附件，最后自行发送。

推荐默认流程：**接收文件 → 选择对话 → 加入输入框 → 用户发送**。

- 外部入口默认推荐“新对话”，同时展示“当前对话”和可搜索的最近对话。不根据文件内容猜测归属，不静默加入上次会话。
- 每次只选择一个目标。一个系统分享操作中的多份文件作为同一批处理。
- 不自动发送、不自动生成“请总结”等提示词、不自动写入笔记。
- 文件以附件卡片进入 chatinput；图片显示缩略图，文档显示名称、类型和大小。可提供“总结内容”“提取文字”等可选提示，点击后才填入问题。
- 原文件保持原样；处理的是接收时复制的快照。

## 2. 会话去向规则

| 场景 | 推荐与行为 |
| --- | --- |
| 从系统“打开方式/分享”进入 | 展示目标选择页；默认选中“新对话”，点击“加入输入框”执行 |
| xopc 有正在显示的聊天 | 在新对话下方单列“当前对话 · 标题”；用户明确选择后追加 |
| 当前显示的是一个空白新对话草稿 | 可提供“当前新对话草稿”；选择“新对话”仍分配独立草稿，不覆盖它 |
| 用户希望继续以前的工作 | 搜索已有对话；按最近活跃排序，展示标题、所属项目/Agent、时间 |
| 没有已有对话 | 保留简单的新对话入口，不显示空搜索列表 |
| 目标已有文字或附件草稿 | 保留原文，在附件区追加；系统分享附带的文字放入待导入预览，用户选择加入时追加为独立段落 |
| 目标正在生成回复 | 可以加入下一条输入草稿；不打断生成，不自动插入当前运行或 follow-up 队列 |
| 目标删除、不可访问或已失效 | 文件留在待导入批次，提示重新选择，不静默转到其他对话 |
| 目标不可继续输入（如只读、需恢复的归档状态） | 标明原因；按已有产品规则恢复后再加入，或选择其他目标 |
| 未登录、网关未配置或离线 | 先保存本地待导入批次；登录/连接恢复后继续选择，不提前创建远端会话 |
| 用户取消目标选择 | 不创建会话、不修改原草稿；本批次清理，关闭前尚未复制完成的文件也停止接收 |

新对话沿用现有默认 Agent、模型和项目选择规则。外部来源没有可信项目上下文时，默认普通对话；用户可在新对话设置中选择项目/Agent。已有对话严格保留其项目、Agent 和配置。

“当前对话”仅指本设备选定窗口中实际展示的聊天；应用在后台时标注“上次查看”，不把它作为默认目标。多窗口下显示窗口和会话标题，避免用一个不透明的全局 activeConversationId 决定归属。

**新建时机：** 确认加入后才分配新对话草稿 UUID；延续现有本地草稿/延迟持久化机制，不因接收或取消创建空的远端会话。若现有附件接口必须物化会话，单独复用其资源准备流程，不写入聊天消息。真正发送时进入现有 session input 协议。

## 3. 交互布局

桌面：唤起现有主窗口，在其上显示固定尺寸的“添加到对话”弹窗。建议宽 560px、高 min(640px, 视口高度减 48px)，头尾固定，列表内部滚动。

移动：使用接近全屏的接收页/大尺寸 sheet，文件预览与目标列表可滚动，底部固定操作区；搜索时保证底部按钮不被键盘遮挡。iOS 分享扩展使用自己的接收界面，见平台差异。

```text
添加到对话                               关闭
┌──────────────────────────────────────────┐
│ [PDF] 需求说明.pdf  2.4 MB   [图片] +2     │
│ 共 3 个附件                         展开 │
└──────────────────────────────────────────┘
○ 新对话                                 默认
○ 当前对话 · 官网改版                     有草稿

[ 搜索已有对话                              ]
○ 官网内容优化             官网项目 · 今天
○ 分析产品反馈                        昨天

仅加入草稿，点击发送后才交给 AI
取消                           [加入输入框]
```

按钮显示明确目标，例如“加入新对话”“加入「官网改版」”。加入成功后进入目标聊天，附件可见，并将焦点交给输入框；移动端不强制弹出键盘，避免挤掉附件预览。使用现有设计 token、Select 和附件卡片，列表加载采用骨架屏。

第一版不提供“记住后总是加入当前对话”，以免长时间后台运行或切换项目后产生误投。后续如加入快捷模式，必须让用户主动启用并始终可见目标。

## 4. 系统入口与平台差异

| 平台 | 接入方式 | 注意事项 |
| --- | --- | --- |
| macOS Electron | 打包注册 fileAssociations；监听 open-file | 在应用 ready 前注册事件；冷启动先入队，热启动唤起已有窗口；角色为 Viewer，作为可选打开方式 |
| Windows Electron | 安装器注册文件关联；解析首次启动参数和 second-instance 参数 | 处理多文件及包含空格的路径；使用事件提供的工作目录解析相对路径；过滤启动参数 |
| Linux Electron | desktop/MIME 注册与启动参数接收 | 按发行包验证关联和多文件参数；与 Windows 共用接收规范 |
| Android | ACTION_SEND、ACTION_SEND_MULTIPLE；ACTION_VIEW 接“打开方式” | 读取 EXTRA_STREAM/ClipData/content URI；在临时授权有效期内复制到私有目录；首次 Intent 与 onNewIntent 共用逻辑 |
| iOS/iPadOS | CFBundleDocumentTypes 接文档打开；Share Extension 接照片/多文件分享 | 文档 URL 在可读授权范围内复制；扩展通过 App Group 保存待导入批次，不依赖强制唤起主应用 |
| HarmonyOS | 扩展已有 ShareExtensionAbility；补充经 SDK 确认的文档打开入口 | 复用已有分享接收和跨进程交接；把文件附件真正接入聊天；验证冷启动和 onNewWant |

iOS 需要产品上接受一个明确差异：**“打开文档”可以进入主应用；“分享”优先在扩展里完成接收**。扩展内选择新/已有目标并保存为待加入草稿；完成后显示“已保存，打开 xopc 后继续”。主应用下一次激活后，将其幂等合并到目标输入框，不自动发送。扩展无法连接网关或不能读取最新会话时，允许保存为待选择，不依赖过期列表决定目标。

第一版仅为已有聊天附件链路实际支持的图片、PDF、文本、Office 文档注册对应类型；具体扩展名和 MIME 从现有能力表核对。音视频和任意二进制作为后续范围。不通过抢占默认应用或宣称可处理所有 MIME 获得系统入口。第三方应用是否展示 xopc，仍取决于其调用的系统能力和文件类型。

## 5. 工程结构与交付可靠性

建议新增统一的 `ExternalIntakeBatch` 概念，各平台实现自己的系统适配与本地存储，共享字段语义和状态约定：

```text
ExternalIntakeBatch
  intakeId, schemaVersion, createdAt, sourcePlatform, sourceAction
  targetScope?: gateway/account + conversationId 或 localDraftId
  text?: 共享文字
  items[]: itemId, displayName, detectedMime, size, localSnapshotRef, state, error?
  state: receiving → awaitingTarget → committing → committed / cancelled
```

文件接收状态和聊天发送状态分开。`committed` 表示已持久化进指定输入草稿，不代表已发送。文件项可单独重试；失败项必须可见，不静默跳过。

1. **系统适配层**：取得系统授权，复制实际字节到本地私有暂存区，保存 manifest；不把本机原路径当作远端网关可读路径。
2. **接收队列**：每次系统操作生成独立 intakeId，连续打开文件也不覆盖上一批。用户在处理第一批时，后续批次显示待处理数量，逐批选择去向。
3. **目标解析层**：目标绑定当前网关/账号与稳定 conversationId。切换网关或账号后重新选择，不能仅凭同名标题或一个深链参数跨作用域投递。
4. **草稿适配层**：等待目标草稿完成恢复，再合并附件；以 intakeId + itemId 去重重放，防止页面重载或系统事件重发导致重复追加。手动再次分享同一个文件视为新的操作。
5. **持久化确认**：先保存可恢复的目标草稿与提交凭据，再标记消费完成。崩溃重启按凭据恢复。Web 若不能跨存储原子提交，应让草稿同时保存消费 ID，重放时检查，不提前删除源文件。
6. **发送层**：继续走现有附件和 session input 流程。确认目标前不上传网关；确认后是否预上传复用已有机制，不触发模型。远端网关通过正常上传或消息附件字节接收文件。

未选择目标的批次建议保留 24 小时，界面显示有效期；已加入草稿的文件按草稿生命周期保存，不能被待导入过期任务清理。清理根据引用关系执行；用户删除附件、丢弃草稿、退出账号时释放对应本地引用。临时会话沿用现有临时存储约定，并告知退出后丢弃。

附件个数和大小复用实际聊天链路限制；不同平台能力未统一前，以该路径可承受的限制显示明确错误。超限、无授权、源文件不可读和部分复制失败都逐项提示，可移除失败项继续。目录和特殊文件不作为普通附件读取。

## 6. 与当前代码的衔接

以下为本次静态检查结果，未运行端侧验证：

- `electron/main.ts` 已处理 xopc 深链和 second-instance，尚未看到 open-file 接收；`scripts/electron-builder.pack.yml` 注册了 xopc 协议，尚未声明文件关联。新增原生文件接收队列，通过可信 IPC 暴露 intakeId，不让网页传任意路径读取文件。
- `web/src/features/chat/composer/use-composer-attachments.ts` 已支持 File 到附件的加载与追加，可以复用；需补充明确的逐项成功/失败返回，不能只依赖 toast 判断是否交付。
- `web/src/features/chat/composer/use-persisted-composer.ts` 和 `session/local-session-drafts.ts` 已保存输入草稿，新增批次提交需协调它们的异步恢复过程。
- `composer-attachment-handoff.ts` 目前使用内存 Map，TTL 为两分钟，仅适合一次页面导航，不能承担冷启动、登录等待和崩溃恢复。
- `session/resolve-new-chat-target.ts` 当前始终调用 createSession。外部导入须在“新对话”分支调用，已有对话按 conversationId 打开，不能误走新建分支。
- 鸿蒙 `ShareExtensionAbility.ets` 已复制文件，但目前有单文件 8 MB 限制且超限会跳过；`service/shareIntake.ets` 的 pending 为单槽，新接收会清理旧文件，需要改为持久化批次队列。
- 鸿蒙 `HomeView.ets` 的 exploreShare 当前直接创建聊天并传 chatPrompt；`targetChat/consumeChat` 只交接文本。应改为目标选择和完整附件草稿交付，成功落盘前不得 dismiss 清理原快照。
- Android 当前 Manifest 的主 Activity 仅见 launcher 入口；iOS 当前 Info.plist 未见文档类型声明。本次未发现可复用的 iOS Share Extension target，需新增并配置共享容器。

如果新增认证 Gateway 接口，必须同步 lazy-bundles matcher、映射测试，并通过运行中的认证 Gateway 验证真实路由。优先复用现有会话、附件与输入接口。

## 7. 建议实施顺序与验收

1. 先建立批次、目标选择、草稿追加与恢复契约；用桌面适配器验证完整链路，同时修复鸿蒙现有入口的文件丢失与强制新建问题。
2. 完成 macOS/Windows 文件关联、鸿蒙接入；补 Android 单文件、多文件、打开方式入口。
3. 实现 iOS 文档打开和独立分享扩展；Linux 如纳入本轮发布，按实际包格式完成关联验收。

发布验收必须覆盖：

- 冷启动、运行中、后台、未登录、离线，以及 iOS 分享扩展独立执行。
- 新对话、当前对话、搜索已有对话、不同项目/Agent、目标失效、切换账号/网关。
- 原草稿包含文字和附件时完整保留；后台接收不修改正在生成的回复。
- 多文件、连续多批、系统事件重放、应用中途退出和草稿恢复，无覆盖、丢失或重复追加。
- 图片传入实际图片内容，文档传入实际文件内容，而非只有路径、文件名或自动拼接的提示词。
- 取消不产生远端会话；确认加入不触发 AI；点击发送后仅产生一次输入。
- 超限与权限失败可见，原文件无修改，本地临时文件在正确生命周期清理。

## 8. 平台依据

- [Electron app：open-file / second-instance](https://www.electronjs.org/docs/latest/api/app)
- [electron-builder 文件关联](https://www.electron.build/docs/api/electron-builder.interface.fileassociation/)
- [Android 接收其他应用分享的数据](https://developer.android.com/develop/ui/compose/sharing/receive)
- [Apple 配置支持的文档类型](https://help.apple.com/xcode/mac/current/en.lproj/devddd273fdd.html)
- [Apple 分享扩展](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html)
- [Apple 扩展与主应用的执行边界](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionOverview.html)
- [Apple 共享数据与 App Group](https://developer.apple.com/documentation/technologyoverviews/shared-data)
- [HarmonyOS ShareExtensionAbility](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-app-ability-shareextensionability)


## 9. 实现与验证记录（2026-10-28）

- 桌面新增独立的本地文件接收队列、可信 IPC、会话目标选择，以及按输入草稿持久化结果确认交付的机制。macOS 接 open-file；Windows/Linux 接启动参数和 second-instance。macOS/Linux 使用逐 MIME 文件关联；Windows 使用 NSIS 当前用户 OpenWithProgids/SupportedTypes 注册，不修改现有文件默认应用。
- Android 接 ACTION_SEND、ACTION_SEND_MULTIPLE、ClipData 和 ACTION_VIEW。接收时复制 URI 内容到现有加密附件存储；已有附件追加与导入凭据在一个 SQLite 事务中提交。补充了单批多文件、作用域绑定、重放和系统目标匹配的模拟器测试。
- 鸿蒙扩展了图片/文档分享与文件打开入口，增加持久化批次、逐项错误、附件移除、24 小时未选择批次清理。选定目标后保留文字与引用，把实际文件字节追加到草稿；保存成功后清理原快照。
- iOS 新增文档类型声明、App Group 与独立 Share Extension。扩展先接收并保存文件，用户回到主应用后选择去向；不依赖扩展强行打开主应用。补充输入框文字/附件/引用持久化、已导入批次凭据、会话选择恢复，以及跨凭证/路由刷新保持稳定的本地网关作用域。

验证结果：

| 验证 | 结果 |
| --- | --- |
| 桌面接收队列、草稿交付、目标选择测试 | 14 项通过 |
| 桌面文件关联/Windows 不修改默认应用的打包配置检查 | 1 项通过 |
| Web 生产构建、Web/Electron 类型检查、Electron 主进程与 preload 构建 | 通过 |
| 鸿蒙分享、附件草稿、Manifest 测试 | 15 项通过 |
| 鸿蒙 HAP 编译 | 通过，当前未连接可验证的设备 |
| Android 单元测试 | 71 项通过 |
| Android 加密附件与外部导入模拟器测试 | 13 项通过，包含系统 Open With/单文件/多文件 Intent 匹配 |
| iOS 模拟器测试 | 46 项通过，覆盖本次导入与关联的产品状态、模型和 AppRoot 测试 |
| iOS 主应用与 Share Extension 编译 | 通过，模拟器使用 CODE_SIGNING_ALLOWED=NO |

Android 使用 gradle-run 技能管理构建。其验证问答如下，均已通过最终验证；工作流结束时仅清理该 wrapper 管理的临时日志：

- “Do Android compilation and unit tests pass with external file intake?” — 通过；初次发现缺少 JSONObject 导入，修复后编译和 71 项单元测试通过。
- “Does encrypted external file intake preserve existing attachments and avoid replay after send on Android emulator?” — 通过；定向模拟器用例确认保存原附件、原始字节和发送后重放不追加。
- “Do Android unit tests and encrypted external intake instrumentation pass after final recovery changes?” — 通过；71 项单元测试及定向模拟器用例通过。
- “Do Android system open/share registration, multi-file capture, target binding and replay tests pass on the emulator?” — 通过；完整附件测试类的 13 项用例通过。

发布时仍需实际安装桌面新包验证各操作系统菜单；本次未在 Windows/Linux 主机验证安装器运行。iOS 真机签名的主应用和扩展 provisioning profile 都必须包含 group.ai.xopc.xopc 共享容器能力。鸿蒙真机系统分享与文件管理器入口仍待设备验收。没有新增或修改 Gateway API。

Windows 注册依据：[Microsoft Open With 注册说明](https://learn.microsoft.com/en-us/windows/win32/shell/how-to-include-an-application-on-the-open-with-dialog-box)。
