# 录音前置验证与 P0 状态投影落地

日期：2026-10-15。承接[产品技术推进方案](./note-recording-product-technical-roadmap.md)的前置验证和工作包 1A。本次交付 Web/Electron 录音状态投影、鸿蒙对应模型与界面、连续保存时间依据及停止提示；不扩展恢复列表、导出、跨 epoch 续录、重点标记或章节搜索。

## 连续保存范围

新增 `recording-media-coverage.ts`，增量解析 Chrome 单音轨 WebM/Opus 的容器时间戳、时间单位及 Opus 包时长。只计算已完整到达的编码包，跨任意字节切片保留解析状态；缓冲有上限，不保留整段录音。

每次写本地分片时，将原音、对应 `mediaCoverage` 和 `committedChunkCount` 放在同一 IndexedDB 事务中。只有事务成功后更新 UI。`verifiedThroughMs` 是从起点连续可验证的前缀，`observedThroughMs` 是最近已观察媒体位置，二者不能互换；时间缺口后冻结前缀，不跳到最新包。

原有 durationMs 保留作采集时长估计和兼容字段，不再作为“本机已确认保存至”的依据。恢复时继续验证分片数量及连续序号，并检查证明绑定的分片数量；旧记录或不一致证明降级为时长待确认，保留原音。

遇到 MP4/OGG、未覆盖的 WebM 编码结构、lacing、非零 codec delay、BlockGroup/discard padding 或损坏头部时停止推进证明，保留此前已确认前缀，并说明其余音频时长待确认。原音仍按原样落盘和上传，不能将不支持本地时间验证误报为存储失败。这个解析器不是通用音频解码器。

鸿蒙沿用已提交 PCM 样本数和连续序号作为保存范围；不使用录制计时或上传百分比推进保存时长。

## 四类独立状态

Web 默认显示一行状态，展开后分别显示：

- 采集：等待真实输入、正在录音、暂停、收尾、中断、停止。
- 本地保存：等待提交、连续已确认范围、时长待确认、停止保存完成或保存异常。
- 原音同步：等待、离线、上传、校验、服务端可用、失败。
- AI 处理：实时文字、文字延迟、补转写、整理、等待重试、失败、完成。

新录音及暂停恢复后，权限成功和 recorder.start() 不直接构成采集成功；需要真实 PCM 帧或新编码包证明。静音 PCM 帧仍是有效输入，电平为零不代表中断。输入电平按约 200 ms 更新，不逐帧刷新 React。

设备 ended、recorder error/stop 及 recorder 变为 inactive 都能退出活跃显示。两类音频回调均停止 15 秒时，降级为等待输入，收到新音频才重新确认；不能把一个仍自称 recording 的卡住录音器持续显示为正常采集。鸿蒙同样在等待首帧、暂停恢复和 PCM 读取停滞时显示待确认。

转写延迟独立提示“转写稍有延迟，录音继续”。上传已保存分片到 100% 只代表本轮字节上传完成，封存期间显示校验；完整附件确认后才显示服务端原音可用。AI 失败不会覆盖本地保存或原音可用状态。Web 保留处理进度查询，避免等待仅依赖某个实时事件。

鸿蒙录音页提供状态详情，迷你录音条也依据采集事实显示等待、录制、暂停、收尾、中断、停止。新增 localSaveComplete、syncStatus、processingStatus 等独立投影，避免将封存排队当作服务端原音确认。

## 停止后的保存提示

Web 正常结束依次等待原音 stop/尾段、持久化写队列、停止元数据提交。完成后记录 `saveOutcome=complete`；鸿蒙等待原生关闭结果和尾段 PCM 事务成功，才置本次会话的 localSaveComplete。只有相应屏障成功，才显示：

> 录音已在本机保存，可以离开此页面。

此时不需要等待在线建会话、同步、STT 或模型。界面可收起，后续同步和 AI 状态单独显示；本地草稿确认删除后，仍保留这次停止结果用于状态展示。

麦克风中断、停止超时、存储错误分别保留 interrupted/incomplete 结果，不能显示完整保存成功。关闭浏览器会暂停尚未完成的本机同步，文案明确需重开恢复；不承诺关闭后继续上传。

修复停止超时后的迟到分片仍可能推进保存边界的问题；旧录音的迟到 stop/error 事件也不能中断新录音。鸿蒙原生 stop/release/read 超时不再悄悄充当正常结束，会保留 shutdownIncomplete 标志，仅承诺已保存部分；网络失败不撤销已经完成的本地保存确认。

结束流程仍在进行时，禁止对同一录音并发恢复或丢弃。附件 ID 存在但服务端已标记删除时，不显示原音可用，不自动重传以撤销删除，也不能据此自动清理本地副本。鸿蒙停止确认目前是会话内状态，重启恢复仍按异常前缀保守展示，不冒充完整停止已确认。

## 前置验证结论

真实 Chrome 使用测试麦克风、实际 MediaRecorder 和磁盘 IndexedDB：断网录制、强杀浏览器、相同 profile 重启、原音恢复解码；另外验证轨道中断、暂停/恢复与正常结束提示。结果见[浏览器与媒体证明 JSON](./technical/note-p0-browser-2026-10-15.json)。

`scripts/note-p0-media-preflight.mts` 将同一实录按 1、257、65,536 字节增量输入，连续前缀与生产音频解码时长一致。暂停后最终容器如含尚未支持的结构，按“保留原音、冻结已确认范围、其余时长待确认”降级，不拿采集时钟补全证明。

不同 MediaRecorder 会话生成的容器直接按字节拼接不能获得连续时间证明。本批不开放这种续录；后续工作包 1B 需要独立原音资源和版本化 manifest，不能覆盖已有资源哈希或既有证据。

## 测试与检查

新增或扩展的故障覆盖包括：媒体边界拆分、未完整编码包、时间缺口、超大/损坏头部、不支持格式、两小时媒体时间推进、已解析未提交、磁盘失败、停止元数据屏障、超时后迟到分片、旧录音迟到事件、输入停滞、恢复证明不一致、上传完成但附件未确认、同步与 AI 失败分离。

鸿蒙主机测试覆盖首帧及暂停重确认、读取停滞、本地结束与网络失败分离、封存排队、异常前缀、原生停止挂起和重启状态。按用户要求未连接或操作鸿蒙真机；主机测试不等于原生 SDK/硬件验收。

复现入口：

```bash
XOPC_MEETING_LONG_SMOKE=1 XOPC_LOG_LEVEL=fatal pnpm exec vitest run \
  src/discussions/__tests__ src/storage/sqlite/__tests__/migrations.test.ts \
  src/gateway/hono/routes/__tests__/lazy-bundles.test.ts \
  web/src/features/discussions/__tests__

pnpm exec vitest run --config "$PWD/apps/mobile-harmony/vitest.config.ts" --root "$PWD/apps/mobile-harmony"

XOPC_NOTE_BROWSER_DURATION_MS=30000 \
  XOPC_NOTE_BROWSER_REPORT=docs/design/technical/note-p0-browser-2026-10-15.json \
  node scripts/note-recording-browser-acceptance.mjs
pnpm exec tsx scripts/note-p0-media-preflight.mts
```

兼容边界：Web 不增加 Service Worker 或离线冷启动承诺；两小时媒体时间及录音处理主机测试不代表两小时浏览器实时录制。Safari/MP4 精确本地媒体时间、跨 epoch 续录和鸿蒙真机保留为后续验收项。

最终验证：Web/服务端相关 22 个文件、205 项测试通过，无跳过，包含两小时原音处理与两小时媒体时间推进；鸿蒙 115 个文件、764 项主机测试通过。真实 Chrome 的断网、强杀、重启、解码、轨道中断及暂停/恢复均通过，恢复文件亦通过服务端生产入库。根 TypeScript、Web 类型检查与生产构建、媒体验证脚本类型检查、相关 ESLint、鸿蒙 HAP 编译和 CodeLinter error/warn 检查通过；`git diff --check` 通过。CodeLinter 的既有启动图标 suggestion 和 Web 的既有分包构建提示不作为本次验收新增问题。
