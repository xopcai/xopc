# 移动录音界面、上传与会议总结：实施技术方案

日期：2026-09-15。本文描述本批实现，完整路线图仍见 [移动会议技术设计](./mobile-meeting-technical-design.md)。

## 1. 产品路径

收件箱顶部录音入口 → 本地录音页 → 开始 / 暂停 / 继续 / 结束保存 → 用户主动「同步并生成总结」→ 上传进度 → 转写与总结状态 → 摘要、要点、决策、行动项 → 会议笔记。

- 原生录音不依赖网关在线。离开页面后录音继续，应用底部显示返回入口；Android 使用前台服务和停止通知。
- 录音列表点击打开，长按进入多选，退出多选后支持滑动打开；批量同步逐条执行。
- 单条最长两小时，原生按采样数限制。界面显示已保存时长，不把墙钟时间伪装为已保存音频。
- 录音前告知参与者；同步按钮文案明确声音会发往工作区及其配置的转写和 AI 服务，并复用现有数据共享授权机制。
- 失败保留本地音频。手动重试上传会跳过服务器已确认的块；转写或总结失败提供处理重试。
- 非预期中断仅恢复并结束，不自动恢复麦克风。用户主动暂停后可以继续，暂停时间不计入音频时间轴。

## 2. 最小模块划分

| 层 | 职责 |
|---|---|
| `RecordingSpool` | 独立 WAV、回执、哈希、单写入锁、崩溃恢复；音频持久化的权威来源 |
| `RecordingCapture` | 系统麦克风、格式转换、有界写入队列、音频中断、停止排空 |
| `XopcVoice` | 唯一正式原生导出；录音与现有通话互斥，原生命令在专用串行队列执行 |
| `features/recordings/recordings.ts` | 本地列表、命令互斥、恢复对账、共享麦克风所有者 |
| `query/recordings.ts` | 网关绑定校验、分块续传、幂等创建、封存、React Query 状态查询 |
| 现有 Discussion | 录音持久化任务 → 整段转写 → 会议总结 → Note |

MMKV 仅保存录音 ID、录制时间、状态、网关身份和远端 ID，不保存音频。坏索引会报错并禁止覆盖；不会删除原生目录。原生开始前先保存索引，以便进程在采集中退出后可以发现录音。

启动、恢复扫描和停止排空不阻塞主线程。iOS 使用专用 lifecycle DispatchQueue 和 writer 队列；Android 使用专用串行 CoroutineScope、读线程及有界写队列。系统回调调回录音生命周期队列，原始 PCM 不经过 JS bridge。

## 3. 上传契约

复用现有端点，无第二套移动会议 API：

1. `POST /api/discussions`：`source: mobile`、`recordedAt`、`clientRequestId: mobile:<deviceId>:<captureId>`。
2. `GET /api/discussions/:id/recording/chunks`：查询已确认的序号 / 字节数 / SHA-256。
3. `PUT /api/discussions/:id/recording/chunks/:sequence`：原生文件 binary body、`x-audio-sha256`，不用 multipart 或 base64。
4. `POST /api/discussions/:id/capture/seal`：`containerMode: independent_wav`、`mimeType: audio/wav`、`chunkCount`、`lastSequence: -1`。
5. `GET /api/discussions/:id`：复用录音 job、Discussion 和 organization 状态。
6. `POST /api/discussions/:id/retry`：重试后续转写 / 总结。

`lastSequence` 是转写段序号，不能填原始录音块序号。本批没有上传实时转写段，因此始终传 -1，由既有转写 worker 处理最终音频。

每个原生文件都是完整 WAV。服务器逐块限定读取大小，验证规范 44 字节头、16kHz / PCM16 / mono、长度和 SHA-256，再去掉各块头并生成一个总 WAV 头。最终文件还必须通过音频解码和时长校验，之后才附加到 Note。格式也参与封存幂等摘要，不能把同一任务改成另一种容器解释。

浏览器 MediaRecorder 的连续容器片段仍使用其现有格式。它与独立 WAV 是两种真实输入格式，不增加旧接口转接或格式猜测。

## 4. 身份、重试和状态

录制时已连接网关则固定 gatewayId + deviceId + publicKey；离线未绑定录音在首次主动同步时绑定。每个上传阶段检查当前身份，复用客户端的设备认证、网关身份校验、禁止重定向和请求完成栅栏。切换工作区后隐藏原工作区的远端详情，要求切回同步。

这沿用已有网关授权模型，没有新增逐录音 ACL。原始录制时间与服务器接收时间分开保存；Note 的来源映射到既有 `app` 分类。SQLite 173 扩展 Discussion 来源约束，不重建主表，因此不触发子表级联删除。

- 进程退出后：本地 `recording` 与原生当前录音不一致 → `interrupted` → 用户结束恢复 → 原生验证回执和尾段 → `saved`。
- 上传响应丢失：创建使用固定幂等键；远端回执对账决定补传哪些块。
- job 已 queued / running：不重复提交；查询状态直到 completed / cancelled / needs_attention。
- 收据哈希冲突：停止上传，保留本地材料；不覆盖服务器内容。
- 上传成功不自动删除唯一的本地副本。

## 5. 当前边界与后续设计

本批交付单麦克风、结束后同步的路径。独立 WAV 模式解决了这一场景的远端格式依赖；**不是**完整多轨 / epoch 墙钟时间轴的替代品。

尚未交付：OS 托管后台上传、离线全文转写、会中实时问答、实时波形 / 首帧状态、后台通知完成、锁屏 Live Activity、本地连续回放、录音删除与空间管理、外部文件导入，以及多音源 track/epoch 合并。上述功能不能仅靠扩展此页面宣称完成；沿原 PRD 分阶段实施。

真机验收仍需覆盖：锁屏跨多个块、来电、蓝牙拔插、权限撤销、两小时真实麦克风、低空间与耗电。模块编译和合成音频测试不能代替这组验收。前台文件上传中应用退出时，由用户重新打开后重试，不承诺系统后台传输。

## 6. 锁屏体验后续设计

跨录音、通话、播放及会后处理的锁屏方案见 [产品方案](./mobile-lock-screen-prd.md) 和 [技术设计与分阶段验收](./mobile-lock-screen-technical-design.md)。两份文档为后续设计，不改变本文已交付范围。
