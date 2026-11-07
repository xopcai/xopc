# 语音技术参考

本页用于定位首段音频等待时间；日常配置见[语音指南](../voice.md)。

## 首段音频路径

当前助手模式会在识别到用户开始讲话时准备 TTS 连接，提前隐藏握手等待；此时不发送合成文本，也不提前执行 Agent。Alibaba 在同一回复的分段间复用连接，后一段等待提供商的 `response.done`。XOPC Cloud 预连接首段，后续段使用独立连接并保留预取，不把文本 flush 确认误当作音频完成。静音或丢弃输入时清理未使用的预连接；完成、打断或挂断时释放回复所属连接。

完整句子或至少六字符的中文短分句可以立即提交播报。首段等待 120 ms 后会尝试安全短语边界；不在单词、代码块、表格或未完整的链接内强制截断。识别端负责配置的静音等待；完整 final 只保留 40 ms 事件顺序缓冲，不再补足另一段最低静音。未说完的句子继续保留延长等待。

Web 请求交互式音频延迟，首帧调度缓冲为 20 ms。识别到开口先可逆降音量；足够长、非回声且稳定 180 ms 的中间识别结果可提前停止旧回复，只有 final 才提交 Agent。停止播报仍不等于取消后台任务。

## 执行与历史预算

`voice.realtime.assistant` 可配置语音专用 `model`、`thinkingLevel`（默认 `off`）和 `historyTokens`（默认估算 4000，范围 1000–16000）。模型只作用于语音轮次；不改写文字会话的模型，也不减少工具。实时识别可独立选择 Alibaba 或 XOPC Cloud。

语音请求保留系统指令、近期完整用户轮次和当前执行的完整工具链，包括途中补充指令；预算允许时保留既有压缩摘要。较早内容仍完整存储于 SQLite，可通过回忆或搜索工具按需读取。省略历史时会向模型明确说明，不能猜测旧事实。当前执行可超过预算；能容纳的投影请求不再为无关旧历史阻塞等待前台压缩。

Ada 使用临时的口语提示词，保留身份、工作区指令、安全、信任、记忆权限和任务协作；不改写普通文字提示词。

## 测量 1.5 秒目标

运行 `node --import tsx/esm scripts/benchmark-voice-latency.mts PCM16_16KHZ_FILE AGENT_ID ROUNDS`。默认创建并清理临时会话。可选第四参数使用既有会话，会实际追加测试轮次；比较 Ada 真实历史时应使用数据库快照，脚本不会删除既有会话。

脚本按 20 ms 发送音频，从最后一帧有效语音发送时开始计时，包含识别判停等待；等待时持续发送静音。输出识别、提交、模型、合成各阶段及 p50/p95。播放确认是模拟的，指标只到音频收到，不能冒充扬声器首声；小样本也不能证明生产 SLO。冷启动、失败、插话和真机需单独验收。

## 定位等待时间

网关记录 `first_response_text`、`first_speech_phrase`、`response_tts_ready`、`first_synthesis_requested`、`first_tts_text_submitted` 和 `first_response_audio`。在同一 `responseId` 下对比 `textToPhraseMs`、`phraseToSubmitMs`、`submitToAudioMs`，区分文本分段、连接等待和合成；DashScope 另记录 `setupMs` 和 `synthesisMs`。

网页和桌面报告 `speech_end_to_audio_received`、`speech_end_to_audio_scheduled`。原生客户端报告 `speech_end_to_audio_buffered`，表示音频进入客户端队列或播放提交。以上都不是物理扬声器出声时间。

新指标通过语音 preflight 公布；连接旧网关时，新客户端会省略不受支持的指标。比较冷启动与后续回复的 p50/p95，并同时检查打断、回声和声音连续性。模拟提供商测试只能验证顺序与清理，真实延迟需要现场通话。

完整实现说明见[英文技术参考](../../reference/voice-runtime.md)。
