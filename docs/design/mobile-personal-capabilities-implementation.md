# 移动端个人信息能力：本阶段实施与验收

日期：2026-10-11。基于 `mobile-personal-capabilities-roadmap.md` 的文件／照片、选定联系人和有界日历读取优先级，复用 Endpoint v2。此记录区分代码实现、自动验证和真机验证。

## 已实现

| 能力 | Android | iOS | HarmonyOS |
|---|---|---|---|
| `mobile.file.pick` | 系统文档选择，单文件 | 系统文档选择，单文件 | DocumentViewPicker，单文件 |
| `mobile.media.pick` | Photo Picker／系统文档回退，单照片 | PHPicker，单照片 | PhotoViewPicker，单照片 |
| `mobile.camera.capture` | 系统相机和临时 FileProvider URI | 系统相机 | 系统 CameraPicker |
| `mobile.contacts.pick` | 选择一个电话或邮箱，不申请整个通讯录权限 | CNContactPicker，选择一个电话或邮箱 | 系统联系人选择，返回所选联系人的一个指定字段 |
| `mobile.calendar.query_events` | Calendar Provider Instances | EventKit | CalendarKit 事件实例 |
| `mobile.calendar.query_free_busy` | 不查询标题 | 返回前移除标题 | 不查询标题 |

三端注册由同一个 TypeScript 契约生成，保留原来的设备状态、电量和定位索引。Gateway 的 `mobilePersonalToolsV1` 控制新目录注册；旧 Gateway 继续使用原目录。Agent 通过既有外部工具发现、描述和调用接口访问这些能力，无需将设备私有数据放进注册消息。

这些个人信息读取默认绑定本条消息的来源端。会话另行绑定电脑不会把手机联系人或文件读取路由到电脑；没有端上消息来源时不代选一台设备。本阶段不扩展定位以外的跨端临时授权。

## 交互和边界

- 每次在来源手机说明读取范围、发送给 Agent 以及可能保存在聊天历史中；拒绝即停止。选择器本身完成选定内容的授权，日历另需系统权限。
- 日历必须提供整数毫秒 `startAt`／`endAt`，正区间、至多七天，返回最多 50 条。返回范围、时间区、截断状态和可访问范围；不读取描述、参会人、地点或链接。
- 鸿蒙当前使用普通 `READ_CALENDAR`，明确返回 `accessScope: app_only`。不声称已经取得用户全部日历的访问权。iOS 系统权限为完整日历访问，但每次应用层查询仍限定范围和返回字段。
- 忙闲结果包含所查询事件的占用区间，不是对“没有事件就一定有空”的承诺。鸿蒙缺少忙闲标记的事件保守标为 busy；`app_only` 或 `truncated` 结果不能用于证明用户有空。
- 文件每次最多一个、10 MiB。使用本次调用的上传 grant，与来源 endpoint、principal、调用 ID 绑定。拒绝其他设备上传和下载；取消使上传 grant 失效，并清理未完成文件。
- 照片在 Gateway 入库前有界解码、缩放、重新编码，去除 EXIF／GPS／内嵌缩略图；Agent 获得规范化后的图片内容。文档复用已有有界文本抽取，不仅返回文件名。扫描或压缩 PDF 的现有抽取器可能无法取得文字，返回明确失败原因。
- 前台用户操作串行；来源退后台、取消或连接改变时停止返回私有信息。系统选择器暂时覆盖 App 时允许完成本次选择，回到前台后才处理结果；迟到回调不复用到下一次调用。
- 个人读取不转发未经筛选的进度文本、客户端 details 或错误文本到审计。读取结果确实进入对话，仍受现有会话和记忆策略管理；本阶段没有新增个人信息专用的历史过期／记忆删除机制。

## 验证记录

- Gateway、Endpoint 协议、路由和 Agent 文件内容相关测试：16 个测试文件、119 项通过；日历区间和返回字段强化后的定向回归 6 项通过。
- 真实本地 HTTP 测试：认证、通过已有 lazy bundle 加载兼容接口、文件上传、本人下载、其他设备拒绝和取消后拒绝上传均通过。该测试使用隔离上传目录和测试身份，不使用用户资料。
- 根项目 TypeScript 检查和三端生成目录 `--check` 通过。
- Android 通过 gradle-run 管理包装器运行 `:app:compileDebugKotlin :app:testDebugUnitTest`。验证问题：“Do Android device adapters compile and unit tests pass after adding personal tools?” 结果通过。
- iOS 模拟器构建、83 项测试通过；另一个依赖真实文件服务的既有 XCTest 保持跳过。
- HarmonyOS 隔离构建的 HAP 编译通过；本次涉及的设备、定位、个人信息和 realtime 回归 22 项通过。
- 鸿蒙全量：696 项通过、2 项失败。这两项为既有的 `chatOptimisticComposer`（测试 fixture 缺少 `reserveReplySpace`）和 `colorLayerHierarchy`（ChatView 边框约束）。本次未修改相关 UI 实现。

随后已在 Mate 60（HarmonyOS 7.0.0.109）覆盖安装本阶段调试包，并通过手机现有配对的 Gateway 0.0.370 验证九项工具注册、文本文件真实内容回传、联系人拒绝、图库／相机取消、日历两个接口的 `app_only` 空结果及等待授权时退后台终止。完整记录见 [Mate 60 个人信息工具验收](../../apps/mobile-harmony/docs/mate60-personal-tools-acceptance-20261011.md)。联系人选定数据、图片及拍摄内容成功回传、非空日历和 Android／iOS 真机仍待验收；本次没有重启用户 Gateway。发布验收仍需覆盖各平台系统权限、拒绝、选择器取消、切后台和真实内容回传。

## 后续范围

主动粘贴继续使用输入框的系统粘贴交互；鸿蒙已有分享入站。本阶段没有新增 Android／iOS 分享扩展。通讯录搜索、日历写入、提醒事项、健康数据和后台订阅仍属于后续阶段，当前不注册这些能力。
