# Web 真实供应商与长录音专项验收

日期：2026-10-16。使用隔离的 SQLite、文件目录和浏览器 profile，输入均为合成语音或测试音频。鸿蒙真机未测试。

## 已验证的恢复边界

### 真实供应商：自动恢复与进程接管

[11 阶段实测证据](./technical/note-recovery-live-2026-10-16.json)，脚本为 [note-recovery-live-acceptance.mts](../../scripts/note-recovery-live-acceptance.mts)。

- 45 秒合成语音经过真实 Alibaba STT 与 DeepSeek 笔记生成。
- 第一段转写成功后断连，再注入 429；检查点与退避时间写入 SQLite，重开进程后仍然有效。
- 第二段成功后强杀转写子进程。旧租约到期前无供应商调用，到期后只处理剩余一段，最终保留 3 个检查点。
- 笔记生成请求期间强杀处理子进程，等待真实 5 分钟租约自然到期，再验证 429、断连、恢复生成。恢复时只调用笔记模型，不重做转写。
- 最终 completed；各阶段原音哈希、Note ID 与人工 Markdown 保持一致。

断连与 429 在本机 TCP/HTTP 边界注入，成功请求直连真实供应商。这验证实际供应商适配层及 SDK 的故障处理，不代表供应商现场出现了限流，也没有通过耗尽配额制造故障。强杀对象是隔离处理子进程，不是完整 Gateway daemon。

### 自动重试耗尽后的手动续跑

[9 阶段实测证据](./technical/note-provider-manual-recovery-2026-10-16.json)，新增脚本 [note-provider-manual-recovery-acceptance.mts](../../scripts/note-provider-manual-recovery-acceptance.mts)。

- 转写连续失败 3 次进入 needs_attention，仍保留已完成的第 1 个检查点。
- 通过真实 HTTP、鉴权、scope middleware 与 lazy route 请求 `POST /api/discussions/:id/retry`，返回 200；真实供应商只转写剩余 2 段。
- 笔记生成连续 3 次 429 后，同一重试接口恢复 organizing，真实 DeepSeek 完成生成，没有再次调用 STT。
- 无鉴权重试返回 401；两次授权重试返回 200；原音、Note ID 与人工笔记始终不变。

### 两小时原音与转写断点

增强 `src/discussions/__tests__/service.test.ts` 中的 opt-in 长录音测试：实际生成并分片入库两小时、超过 200 MB 的 PCM 音频，校验解码时长为 7,200,000 ms。第 181 段注入 429，确认前 180 段、3,600,000 ms 的进度已持久化。

关闭并重新打开 SQLite 后续跑，只转写剩余 180 段，最终得到全部 360 段、7,200,000 ms。原音哈希、Note 身份和人工正文保留。这里的音频生成、文件入库、解码与检查点处理均为真实实现；转写回调为可控测试实现，不会向供应商发送两小时静音。

### Web 产品页刷新恢复

[8 项实测证据](./technical/note-web-recovery-journey-2026-10-16.json)。扩展 [notes-web-journey-acceptance.mts](../../scripts/notes-web-journey-acceptance.mts)，从生产 NotesPage 开始录音，断网刷新后联网重载，通过“未完成的录音”列表继续录制。

恢复沿用相同 Discussion 与 Note，原音已提交前缀哈希不变，新增独立采集容器。完成后可打开原文、播放原音与证据区间；窄屏离线结束、重试、搜索和再次刷新也通过，未捕获浏览器运行时错误。

该页面夹具使用生产页面与录音组件、真实 Hono 路由和 SQLite，外层应用壳与登录为简化夹具，AI 结果受控。离线刷新无法重新获取应用页面，需要联网后进入恢复入口；本轮未实现应用壳离线缓存。

### 浏览器持续实录、强杀与恢复

最终结果见 [浏览器实测证据](./technical/note-recording-browser-2026-10-16.json)。脚本 [note-recording-browser-acceptance.mjs](../../scripts/note-recording-browser-acceptance.mjs) 使用真实 Chrome、MediaRecorder、WebAudio 与磁盘 IndexedDB，麦克风为合成音频输入。

Chrome 155.0.8059.40 持续离线实录 15 分钟后，强杀浏览器并重开相同 profile，恢复 180 个分片、7,310,185 字节。已提交前缀 SHA-256 一致，保存元数据为 902,155.9 ms，实际解码为 902,100 ms，相差约 56 ms。

每 30 秒检查采集状态、已提交分片与连续保存范围；共 6 个恢复场景通过，包括重点跨进程保留、中断续录形成两个独立容器、原音包导出、麦克风轨道中断收尾、暂停续录和页面刷新恢复。异常终止的 WebM 缺少正常结束标记，ffmpeg 提示 premature EOF，但成功解码了全部已提交原音。

恢复入库脚本同时修正了验收报告中按固定数组位置读取时长的问题，改为查找恢复时长记录，兼容同时启用重点验收。恢复原音已通过生产上传、封存、合成与解码链路，附件哈希一致，分段解码得到 46 段、共 902,100 ms；结果记录在浏览器 JSON 的 `gatewayIngestion`。

## 复现

```bash
XOPC_NOTE_LIVE=1 XOPC_NOTE_ACCEPTANCE_REPORT=docs/design/technical/note-recovery-live-2026-10-16.json pnpm exec tsx scripts/note-recovery-live-acceptance.mts
XOPC_NOTE_LIVE=1 pnpm exec tsx scripts/note-provider-manual-recovery-acceptance.mts
XOPC_NOTE_BROWSER_DURATION_MS=900000 XOPC_NOTE_BROWSER_ANNOTATIONS=1 XOPC_NOTE_BROWSER_CONTINUATION=1 XOPC_NOTE_BROWSER_REPORT=docs/design/technical/note-recording-browser-2026-10-16.json node scripts/note-recording-browser-acceptance.mjs
pnpm exec tsx scripts/note-recovered-audio-acceptance.mts docs/design/technical/note-recording-browser-2026-10-16.json
XOPC_NOTE_JOURNEY_RECOVERY=1 XOPC_NOTE_JOURNEY_OUTPUT=/tmp/xopc-notes-recovery-2026-10-16 pnpm exec tsx scripts/notes-web-journey-acceptance.mts
XOPC_MEETING_LONG_SMOKE=1 XOPC_LOG_LEVEL=fatal pnpm exec vitest run src/discussions/__tests__ src/media-shared/http/__tests__ src/storage/sqlite/__tests__/migrations.test.ts src/gateway/hono/routes/__tests__/lazy-bundles.test.ts web/src/features/discussions/__tests__
```

真实供应商命令需要 `DASHSCOPE_API_KEY` 与 `DEEPSEEK_API_KEY`，浏览器脚本需要本机 Chrome 与 ffmpeg/ffprobe。记录中不包含密钥。

## 回归检查

相关回归 39 个文件、355 项测试通过；增强两小时续跑断言后，重新运行完整 service 集成测试，29 项通过。根项目 TypeScript 检查、修改的 JS 验收脚本和 service 测试 ESLint、`git diff --check` 通过。

浏览器持续实录与两小时文件处理属于不同验收范围；本轮浏览器实录目标为 15 分钟，不等同于两小时实时麦克风录制。
