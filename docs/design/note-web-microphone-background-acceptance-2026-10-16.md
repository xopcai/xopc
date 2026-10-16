# Web 真实麦克风与后台录音验收（2026-10-16）

## 范围和环境

macOS 内置 MacBook Pro Microphone，48 kHz、单声道，原生有窗口 Chrome。使用生产 `useDiscussionRecorder`、MediaRecorder、IndexedDB、保存状态投影和本地导出逻辑；页面为最小验收壳，不代表整套 Notes 页面视觉复验。本轮不测鸿蒙真机。

真实麦克风模式不注入模拟音源、不伪造 getUserMedia。采集文件仅留在本机临时目录，不上传供应商，不提交音频文件。

## 实施修复

- 麦克风 `mute` 与 `ended` 均触发统一异常收尾。即使浏览器继续产生编码静音，也不能据此继续宣称采集正常。
- 页面 `freeze` 触发异常收尾，保留落盘分片并标记中断；续录创建独立音频段并保留原记录及服务端关联。
- `visibilitychange`、`pageshow` 检查音轨真实状态；健康音轨切后台不会停止录音。停止时移除监听，避免旧录音事件影响新录音。
- 验收脚本提供真实麦克风与原生后台模式。后台模式通过自有独立 Chrome profile 和 CDP 连接关闭自动化默认页面可见性覆盖；确认真实 `document.hidden` 和窗口最小化状态。后台断言使用定时轮询，避免 animation frame 停止造成误报。

## 验收内容

运行记录见 [专项 JSON](technical/note-web-physical-mic-background-2026-10-16.json)，以 `passed` 和逐项 `checks` 为准：

1. 真实采集后切到同窗口其他标签页 20 秒，确认隐藏且音频分片继续落盘。
2. 原生窗口最小化 20 秒，确认麦克风未静音且分片继续落盘。
3. 断网继续录音，SIGKILL 自有浏览器进程，原 profile 重启后恢复；已保存原音前缀 SHA-256 不变，ffmpeg 可解码。
4. 恢复后沿用同一录音 ID 续录，旧段不变，新段可单独解码，本地恢复包可读。
5. 麦克风停止、暂停恢复、停止保存屏障，以及刷新后原音和重点标记恢复。
6. CDP 页面冻结/解冻后读取已保存中断录音，确认旧字节不变并沿用原记录续录。浏览器可能重建页面，允许从恢复列表恢复；不把页面重建误认为音频丢失。

重复运行命令：

```sh
XOPC_NOTE_BROWSER_PHYSICAL_MIC=1 \
XOPC_NOTE_BROWSER_BACKGROUND=1 \
XOPC_NOTE_BROWSER_DURATION_MS=12000 \
XOPC_NOTE_BROWSER_CONTINUATION=1 \
XOPC_NOTE_BROWSER_REPORT=docs/design/technical/note-web-physical-mic-background-2026-10-16.json \
node scripts/note-recording-browser-acceptance.mjs
```

## 自动化回归

录音 Hook、保存范围、状态投影和全局录音面板共 66 项测试通过；Web 类型检查、生产构建及本轮修改文件 ESLint 通过。新增覆盖 mute/freeze 中断后的同记录续录、关联保留、原音前缀不变和事件清理。

## 真实边界

**本机系统休眠唤醒未通过实测验收。** `pmset -g` 显示 `SleepDisabled=1`，且其他应用持有防休眠断言。本轮没有修改电源设置，没有将屏幕熄灭或 CDP 页面冻结当作系统休眠。需在允许系统休眠的环境补测真正的睡眠/唤醒，包括未发送浏览器 freeze 事件的路径。

真实麦克风曾因 1 ms 时间戳差异导致连续保存范围低估，该观测随后已修复，参见 [修复与专项验证](note-web-microphone-timing-fix-2026-10-16.md)。本报告保留原轮次的验收范围；后续修复没有放宽对真实缺包和正向跳时的判断。

本轮是短时真实麦克风及后台恢复专项；先前两小时测试使用模拟麦克风，不能合并声称完成两小时真实麦克风测试。供应商转写和笔记生成不在本轮实测范围。
