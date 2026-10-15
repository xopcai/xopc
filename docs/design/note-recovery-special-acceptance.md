# 录音与生成链路专项验收

日期：2026-10-15（Asia/Shanghai）。按用户最新要求，本轮不执行鸿蒙设备测试。

## 验收范围和证据

所有音频均为测试生成的语音或正弦波；不读取或上传用户录音。使用隔离目录、SQLite 和浏览器 profile，不修改现有 Gateway 配置或业务数据。

- 供应商脚本：[note-recovery-live-acceptance.mts](../../scripts/note-recovery-live-acceptance.mts)。真实 Alibaba `qwen-audio-3.1-asr-flash` 转写与 DeepSeek `deepseek-flash` 纪要调用。断连通过本机 TCP 连接关闭注入，429 通过本机 HTTP 服务注入，成功请求直连真实供应商。没有通过高并发耗尽供应商配额；429 不代表供应商现场发生了限流。
- 浏览器脚本：[note-recording-browser-acceptance.mjs](../../scripts/note-recording-browser-acceptance.mjs)。真实 Chrome、MediaRecorder、音频编码和磁盘 IndexedDB；麦克风输入由浏览器测试设备提供，页面直接使用生产录音 hook 和草稿存储模块，没有替换 MediaRecorder 或 IndexedDB。
- 恢复原音入库脚本：[note-recovered-audio-acceptance.mts](../../scripts/note-recovered-audio-acceptance.mts)。读取浏览器实测恢复文件，通过生产录音上传、封存、合成、Note 附件与分段解码流程验证服务端接收能力。
- 供应商逐步证据：[JSON](./technical/note-recovery-live-2026-10-15.json)。每阶段记录请求结果、供应商 request ID（如返回）、检查点数量、退避时间、原音哈希、Note ID、人工 Markdown 和处理状态。源码哈希绑定本次执行实现。
- 浏览器证据：[JSON](./technical/note-recording-browser-2026-10-15.json)。记录浏览器版本、录制时间、恢复分片数、恢复字节及解码结果。

## 判定标准

1. 第一段真实转写成功后断连，前段检查点已提交，不能提前越过退避时间重试。
2. 收到 HTTP 429 后仍保留相同原音和检查点，退避进度跨进程保留。
3. 第二段真实转写成功后强杀处理子进程。新进程不能抢占未过期租约；自然过期后只调用剩余一段 STT。
4. 在纪要请求期间强杀处理子进程。逐字稿和原音保留，新进程等待组织任务租约自然过期后可接管。
5. 纪要阶段断连/429 后继续生成，只重试纪要；最终真实模型结果发布为 completed，Note ID、原音哈希和人工 Markdown 全程不变。
6. Web 录音开始后断网，持续保存原音；对浏览器主进程发送 SIGKILL，重启相同磁盘 profile 后可发现并恢复草稿。恢复前缀 SHA-256 必须与杀进程前已提交音频一致；恢复音频必须可完整解码，解码时长与已提交时长差小于 1 秒。
7. 所有麦克风轨道停止后，真实 MediaRecorder 必须自动收尾，尾段提交后草稿进入 stopped。
8. 恢复的实际 WebM 必须通过服务端生产入库与分段解码流程；Note 附件字节哈希不变，解码总时长与浏览器已提交时长一致。

进程验收使用生产 sealer、organizer、供应商适配层和真实 SQLite 文件，强杀的是隔离处理子进程；不是完整 Gateway daemon 或操作系统断电验收。Web 页面是生产录音模块的最小入口，未覆盖完整产品上传交互。租约时钟没有被改写：转写 60 秒、纪要 5 分钟的接管等待均使用实际墙钟时间。

## 本次修复

共享供应商 HTTP 层原先每次请求都会向同一个任务取消信号增加一个监听器，请求完成后没有释放。长音频分片和重试会持续保留这些请求的控制器。改用原生 `AbortSignal.any` 组合信号，避免手动监听器积累，并保留收到响应头之后取消 body 读取的能力。

新增 4 项真实 HTTP 回归：连续 100 段请求不积累监听器；连接断开后不残留；进行中请求可取消；响应头已返回但 body 未结束时仍可取消。

通过实际模型 SDK 连接本机断连服务复现另一项问题：SDK 将传输失败转换为 `stopReason=error` / `errorMessage="Connection error."`，原有重试分类返回 false，导致可以恢复的网络故障直接进入 needs_attention。新增回归先确认修复前失败，再将该错误纳入临时故障，沿用持久化退避与次数上限；鉴权等永久错误的分类不变。

该修复在专项执行的纪要租约等待期间落地，后续纪要 429、断连与真实模型恢复阶段均运行修复后的代码。供应商 JSON 同时保留 `sourceHashesAtStart`、最终验证源码 `sourceHashes` 和 `inRunFixes`，明确执行期间的修复边界。

## 供应商与进程实测结果

专项全部通过，共 11 个阶段。45 秒合成语音经真实 Alibaba STT 识别，第一段成功后断连、429 后持久化退避，第二段成功后 SIGKILL；租约自然过期后仅调用最后一段，累计 3 个检查点，发布逐字稿进入 organizing。

纪要请求期间 SIGKILL 后，旧租约有效期内不发请求；5 分钟租约自然过期后可接管。429 和 SDK 实际返回的 `Connection error.` 均保持 organizing 并安排退避。随后真实 DeepSeek 返回 HTTP 200，生成 261 字纪要，进入 completed，未重新调用 STT。11 个阶段的原音哈希、Note ID 和人工 Markdown 始终相同。

## Web 实测结果

Chrome 155.0.8059.40，断网持续录制 180 秒后强杀浏览器主进程。重启恢复 36 个已提交分片、1,469,922 字节；已提交音频前缀 SHA-256 一致。浏览器记录时长 181,435.8 ms，恢复解码时长 181,380 ms。麦克风所有轨道中断后自动保存 2 个分片，进入 stopped。

同一恢复 WebM 已通过服务端生产上传/封存/合成并成为 Note 附件，附件哈希与恢复文件一致；生产分段解码得到 10 段，共 181,380 ms。异常结束的 WebM 缺少正常结束标记，ffmpeg 会打印 premature EOF，但返回成功并解码出全部已保存音频；服务端生产解码亦通过。本结论只承诺已提交分片，不能追回杀进程前仍未触发或提交的录音尾部。

## 复现

```bash
# Needs configured DASHSCOPE_API_KEY and DEEPSEEK_API_KEY; incurs real supplier usage.
XOPC_NOTE_LIVE=1 pnpm exec tsx scripts/note-recovery-live-acceptance.mts

# Needs local Chrome, ffmpeg, ffprobe; synthetic microphone only.
XOPC_NOTE_BROWSER_DURATION_MS=180000 node scripts/note-recording-browser-acceptance.mjs
pnpm exec tsx scripts/note-recovered-audio-acceptance.mts

XOPC_MEETING_LONG_SMOKE=1 XOPC_LOG_LEVEL=fatal pnpm exec vitest run \
  src/media-shared/http/__tests__ src/discussions/__tests__ \
  src/storage/sqlite/__tests__/migrations.test.ts \
  src/gateway/hono/routes/__tests__/lazy-bundles.test.ts \
  web/src/features/discussions/__tests__
```

最终回归：28 个文件、237 项测试通过，无跳过，含两小时原音处理测试。根 TypeScript 检查、验收 TypeScript 脚本检查、相关 ESLint、Node 构建及 `git diff --check` 通过。专项实测结论以对应 JSON 的 `passed` 和各阶段证据为准；鸿蒙真机长录音仍保持未验收。三分钟浏览器实录不替代两小时实时录制验收，后者本轮没有执行。
