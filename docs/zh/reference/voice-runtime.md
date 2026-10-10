# 语音技术参考

本页用于定位首段音频等待时间；日常配置见[语音指南](../voice.md)。

## 首段音频路径

当前助手模式的 Alibaba TTS 会在 Agent 生成期间并行准备 WebSocket，并在同一回复的分段间复用连接。后一段等待提供商的 `response.done`；完成或打断时释放连接。其他提供商是否支持预连接取决于实现。

完整句子可以立即提交播报。没有完整句子时，网关会尝试在安全的短语边界分段；不在单词、代码块、表格或未完整的链接内强制截断。

## 定位等待时间

网关记录 `first_response_text`、`first_speech_phrase`、`response_tts_ready`、`first_synthesis_requested`、`first_tts_text_submitted` 和 `first_response_audio`。在同一 `responseId` 下对比 `textToPhraseMs`、`phraseToSubmitMs`、`submitToAudioMs`，区分文本分段、连接等待和合成；DashScope 另记录 `setupMs` 和 `synthesisMs`。

网页和桌面报告 `speech_end_to_audio_received`、`speech_end_to_audio_scheduled`。原生客户端报告 `speech_end_to_audio_buffered`，表示音频进入客户端队列或播放提交。以上都不是物理扬声器出声时间。

新指标通过语音 preflight 公布；连接旧网关时，新客户端会省略不受支持的指标。比较冷启动与后续回复的 p50/p95，并同时检查打断、回声和声音连续性。模拟提供商测试只能验证顺序与清理，真实延迟需要现场通话。

完整实现说明见[英文技术参考](../../reference/voice-runtime.md)。
