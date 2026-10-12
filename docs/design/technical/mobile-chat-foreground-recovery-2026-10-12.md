# 移动端聊天前台恢复修复（2026-10-12）

## 问题与根因

鸿蒙 App 在 AI 输出过程中进入后台后，EntryAbility 会停止实时连接，回前台会启动连接；但 ChatView 的前台监听只恢复连接等待提示。聊天依赖连接事件间接恢复，缺少主动的前台恢复入口。

chatViewModel.recover() 还会无条件开启 snapshotMode。历史读取成功后清除实时输出，而之后的 assistant_delta 只更新活动状态、触发历史读取。尚未写入历史的回复无法继续显示，表现为对话中断。

iOS 的文字聊天没有 scenePhase 恢复入口；流断开后只轮询运行是否完成，不再订阅文字输出，且网络读取第一次失败就结束恢复。打开已在运行的会话也只读取 activeRun，没有订阅其输出。

Android 的实时连接有重试循环，但没有前后台恢复入口，也没有在连接成功后主动核对选中会话的历史与 activeRun。后台失效的 socket 可能持续等待超时，后台已结束的运行也可能保留旧状态。

## 修复

- 鸿蒙：前台主动恢复聊天；先恢复 Gateway 的前台状态，再通知页面。普通重连保留同一运行的实时内容，继续接收增量；仅真正缺失事件前缀时使用历史快照恢复。已入库的文本片段按 messageId 去重，恢复中的结束事件不会被旧查询复活。后台完成会重新取最终历史。
- iOS：文字聊天订阅随前台和页面可见性恢复，后台取消客户端观察但不终止服务端运行。流断开后核对运行、保留未入库内容、重新订阅；短暂网络失败继续重试。用观察代次、会话和 transcript 身份隔离旧请求、旧事件；按消息片段识别重放，避免重复文本。新增对打开已运行会话的订阅。
- Android：ON_STOP/ON_START 接入恢复；回前台替换失效连接并刷新历史和运行状态，保留同一 run 的回放游标与输出。系统个人工具调用仍在进行时保留其连接。每次重连成功都核对聊天；历史与实时片段去重，重放可接续重叠文本，缺失前缀不会清空已经显示的回复。结束事件与运行查询之间增加旧结果保护。
- Android lint 额外发现定位调用的权限异常处理缺口，已在 getCurrentLocation 与 requestSingleUpdate 调用点捕获 SecurityException，沿原有 PERMISSION_DENIED 路径返回；同时将 Compose 回调与语义中的资源读取移至 stringResource，并声明相机硬件为可选。

## 验证

- 鸿蒙：112 个测试文件、731 项 host 测试通过；其中 chatViewModel 57 项，包括前台续流、后台完成、离线历史保留和恢复中的结束事件；debug HAP 构建通过。
- iOS：FeatureStateTests 与 AssistantRecoveryTests 共 15 项通过，覆盖前台恢复、后台完成、历史暂时不可用、断线自动订阅、旧会话事件隔离；SwiftLint 通过。
- Android：38 项单元测试通过；专用 API 35 模拟器上 ForegroundRecoveryTest、RunStreamEventTest 与输入栏交互共 6 项通过，覆盖连续两次前后台切换、重叠重放及操作面板。
- Android lint：整理定位权限、Compose 资源访问和可选相机声明后，lintDebug 通过。

当前 HDC 没有连接设备，鸿蒙真机后台/前台操作验收尚未执行。iOS 验证为模拟器上的状态与网络流测试；Android 验证包含实际 Activity 生命周期，尚未使用真实 Gateway 进行三端真机长回复验收。以上验证不代表已发布或安装到用户手机。
