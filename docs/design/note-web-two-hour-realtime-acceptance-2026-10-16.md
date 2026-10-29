# Web 两小时实时录音验收

2026-10-16 完成。使用真实墙钟、Chrome MediaRecorder、WebAudio 与磁盘 IndexedDB 连续采集；输入为循环合成语音，没有加速时间或导入预制两小时文件。鸿蒙真机未测试。

## 结果

| 验收项 | 结果 |
| --- | --- |
| 实际运行时间 | 北京时间 12:29:58 至 14:30:10，超过两小时，包含刷新和重启间隙 |
| 长时间断网 | 首段约一小时离线；刷新恢复后继续离线，直到接近两小时强杀浏览器 |
| 一小时刷新恢复 | 716 个已提交分片、29,200,961 字节，刷新前后原音前缀 SHA-256 一致 |
| 浏览器强杀恢复 | 1424 个已校验分片、58,116,035 字节，重开同一磁盘 profile 后前缀 SHA-256 一致；随后继续录制 |
| 同一 Note 续录 | 最终 3 段独立采集容器、1430 个原始分片，全程只有 1 个 Discussion 和 1 条录音 Note，人工正文保留 |
| 最终原音 | 原始分片共 58,351,501 字节；服务端保留各采集段并合成可播放原音，解码时长 7,200,840 ms，WAV 大小 230,426,924 字节 |
| 真实转写 | Alibaba 返回 361 次 HTTP 200，完成全部检查点，生成 55,212 字符原文 |
| 真实笔记生成 | DeepSeek 返回 43 次 HTTP 200，最终状态为 completed，生成摘要、章节及相关分析；摘要 591 字符 |
| 回听 | 实际播放原音开头，并定位至两小时尾部继续播放 |

实测 JSON（历史产物已移入 Git 历史） 保存 244 次进度采样、各恢复边界的原音哈希、Note 身份、供应商调用统计、最终数据库状态及修复后的源码哈希。完整运行文件和截图位于 `/tmp/xopc-note-realtime-two-hour-2026-10-16/`。

## 发现并修复的问题

**两小时编码尾包导致原音合成失败。** 录音端按两小时自动停止，但异步停止与编码收尾产生了约 0.84 秒的尾包。服务端严格按 7,200 秒拒绝合成，返回 `Recording exceeds duration limit`。本机与服务端已提交分片均保留，因此可以直接恢复，无需重录。

新增 `DISCUSSION_MAX_SAVED_DURATION_MS`，给保存和转写解码统一增加最多 5 秒的收尾余量。录音端停止上限仍为两小时，原音尾部完整保留，不通过裁切音频规避校验。回归覆盖两小时加 0.84 秒的跨容器合成、完整转写，以及超过余量时拒绝并保留原分片。修复后，使用本次相同分片、相同 Note 重试同步，并完成全部真实供应商处理。

**完成浮窗释放本机状态后可能显示 00:00。** 改为优先显示服务端已确认原音时长，其次使用已收尾草稿时长。

**从列表导航到已就绪的 Note 时，完成浮窗可能重复出现。** 当前路由对应同一 Note、原音已确认且重点同步无异常时，自动收起重复浮窗；正在录制或仍有待处理异常时保留。

验收脚本也修正了最终状态沿用上次处理采样的问题，最终状态重新读取数据库，并支持沿用原 profile、端口和 Note 继续验收。

## 验证

- 新增长录音边界用例先复现失败，修复后两组相关集成测试 47 项通过。
- 相关回归原有 214 项通过；补充浮窗回归后，Web 录音完整测试 142 项通过。合计覆盖 216 项不同测试。
- 根项目 TypeScript、相关源文件与测试 ESLint、Node 构建、Web 生产构建、`git diff --check` 通过。
- 最终数据库独立复核：completed、Discussion 数量为 1、原 Note ID 和原音哈希一致；浏览器未捕获运行时错误。

## 复现

```bash
XOPC_NOTE_LIVE=1 \
XOPC_NOTE_REALTIME_OUTPUT=/tmp/xopc-note-realtime-two-hour \
caffeinate -i pnpm exec tsx scripts/note-web-realtime-acceptance.mts
```

需要本机 Chrome、macOS `say`、ffmpeg/ffprobe，以及 `DASHSCOPE_API_KEY`、`DEEPSEEK_API_KEY`。脚本默认按实际墙钟采集两小时，之后执行真实转写和笔记生成。可用 `XOPC_NOTE_REALTIME_DURATION_MS=60000` 做短时预检；短时结果不能替代两小时验收。

若处理失败，原数据保留，可设置 `XOPC_NOTE_REALTIME_RESUME=1`、`XOPC_NOTE_REALTIME_STATE`、`XOPC_NOTE_REALTIME_VITE_PORT` 和相同输出目录继续处理。状态目录及端口来自原报告；必须沿用原浏览器 origin，才能读取相同 IndexedDB。

本轮挂载生产 NotesPage、录音面板和真实 Hono 路由，使用独立 SQLite 与文件存储；外层应用壳和登录为验收夹具，路由限流未启用。因此本结论覆盖本次录音、恢复及生成链路，不代表物理麦克风、完整 Gateway 登录启动或鸿蒙设备验收。

## 合并保留的其他录音验收（2026-10-15/16）

2026-10-29 合并早期供应商恢复、产品页旅程与短时真实麦克风报告。以下均为各自历史范围，不与上方两小时合成麦克风结果相加。

| 范围 | 实际观测及限制 |
| --- | --- |
| 真实供应商/进程恢复 | 45 秒合成语音，Alibaba STT + DeepSeek；断连/429 在本机注入，非耗尽真实配额。第一段检查点保留，第二段后 SIGKILL；转写 60 秒、纪要 5 分钟租约按真实墙钟自然过期后接管，只处理剩余范围。11 阶段最终 completed，Note/原音哈希/人工 Markdown 不变；强杀隔离 worker，不是完整 Gateway 或断电验收 |
| 人工续跑 | 连续 3 次失败进入 needs_attention；真实认证 HTTP/scope/lazy route 的 retry 返回 200，未认证 401；STT 只补剩余两段，纪要重试不重做 STT。9 阶段通过 |
| 两小时文件恢复 | 生成 230MB 级 PCM，360 段；181 段注入 429 后保留 180 段/一小时检查点，重开 SQLite 后完成剩余范围。STT 为可控替身，不把生成音频测试算作实时采集 |
| 早期离线浏览器 | 3 分钟恢复 36 片、1,469,922 字节，解码 181,380ms；15 分钟恢复 180 片、7,310,185 字节，解码 902,100ms；已提交前缀哈希不变，独立 epoch 续录/导出/服务端入库通过。异常 WebM 有 premature EOF 提示但已保存音频解码成功；未提交尾部不承诺恢复 |
| Notes 产品页 | 7 项旅程及 8 项恢复扩展：空笔记自动保存、合成录音、标记、暂停/续录、本地屏障、播放/证据、同一 Note；390px 离线再同步及 320px 无溢出。生产页面/真实 Hono/SQLite，但简化应用壳和本地 Cookie 身份、AI 受控，未覆盖完整 Gateway 登录/lazy 启动 |
| 短时真实麦克风 | macOS 内置麦克风 48kHz mono，Chrome 真实 getUserMedia；切标签和窗口最小化各 20 秒继续落盘；离线强杀/同 profile 恢复、同 ID 续录、暂停、标记与 CDP freeze 恢复。未上传人声给供应商；不能推断两小时真实麦克风或系统休眠通过 |
| WebM 时钟量化修复 | 同一真实样本的连续证明由 2940ms 修为 55320ms，与 ffmpeg 一致；1/7/4093 字节及整文件重放一致。只容忍最多 1ms 提前，不放宽正向缺口、漂移、缺包和 epoch 边界。独立快照 181 项回归通过 |

供应商 SDK 的 `Connection error.` 纳入有界暂时故障；共享 HTTP 采用 AbortSignal.any，真实 HTTP 回归覆盖 100 段请求无监听累积、连接断开及响应头之后取消 body。它们不放宽凭据等永久故障。

复跑入口保留 `scripts/note-recovery-live-acceptance.mts`、`note-provider-manual-recovery-acceptance.mts`、`note-recording-browser-acceptance.mjs`、`note-recovered-audio-acceptance.mts`、`notes-web-journey-acceptance.mts`、`note-media-timing-acceptance.mts`。真实麦克风模式使用 XOPC_NOTE_BROWSER_PHYSICAL_MIC=1、XOPC_NOTE_BROWSER_BACKGROUND=1；合成产品页模式不等于硬件验收。输出优先指定 `/tmp`。真实供应商复跑会产生实际用量，本次清理未运行它们。

系统休眠当时受 SleepDisabled=1 和其他应用防休眠断言阻塞，未改电源设置；CDP freeze/屏幕熄灭不代替睡眠。两小时真实麦克风长稳、鸿蒙真机、Safari/其他容器、来电/蓝牙和低存储验证仍未由这些报告证明。

历史产物保留说明（2026-10-29）：本页所涉已清理截图、逐次 JSON 与源码快照可从 Git 历史恢复；上文数字和失败限制保留为历史观测，不代表本次重新验收。复跑输出应指定临时目录；旧路径仅记录当次运行位置。
