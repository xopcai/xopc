# 语音功能 (STT/TTS)

xopc 在多种通道上支持语音能力：

- **STT**（语音转文字）：将语音附件转为模型可读文本  
- **TTS**（文字转语音）：在策略允许时将助手回复转为音频  

**主要入口：** [Telegram](/zh/channels) 语音消息、**网关 Web 聊天（webchat）** 的语音附件 STT。其他通道若走统一出站管道，也可能附带 TTS 输出。

---

## 功能概述

**Telegram（典型）**

1. 下载入站音频后执行 STT（超长语音可能跳过）。  
2. 在**群聊且需要 @mention** 时，可在 mention 判断**之前**先做语音 **preflight 转写**，使口播里的「@机器人」或类似说法（如 “at 用户名”）能通过校验。  
3. 智能体处理转写文本（非语音媒体可能以文件块形式呈现）。  
4. 出站文本按 **trigger** 等规则可能走 TTS，并按通道选择编码（如 Telegram 语音条用 Opus，微信/Web 常用 MP3）。

**Web UI（webchat）**

1. 在 STT 启用时，由 agent 路径中的 `mergeVoiceTranscriptsIntoUserText` 合并语音转写。  
2. TTS 触发规则与其他通道一致；webchat 侧优先 **MP3** 以兼容浏览器播放。

设计与实现对照见仓库根目录下的 **`.docs/tts/`**（不随本站发布；贡献者向）。

---

## 快速开始

在 `~/.xopc/xopc.json` 中示例：

```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": {
      "apiKey": "your-dashscope-api-key"
    }
  },
  "tts": {
    "enabled": true,
    "provider": "openai",
    "trigger": "inbound",
    "openai": {
      "apiKey": "your-openai-api-key"
    }
  }
}
```

**说明：** 配置里的 `trigger` 取值为 `off` | `always` | `inbound` | `tagged`。历史值 **`auto` 会按 `inbound` 归一化** 加载。

---

## STT 配置

### 阿里云 Paraformer（中文场景常用）

```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": {
      "apiKey": "your-dashscope-api-key",
      "model": "paraformer-v2"
    }
  }
}
```

具体模型名以 DashScope 文档为准。

### OpenAI Whisper

```json
{
  "stt": {
    "enabled": true,
    "provider": "openai",
    "openai": {
      "apiKey": "your-openai-api-key",
      "model": "whisper-1"
    }
  }
}
```

### 回退链（fallback）

主 provider 失败时按 `fallback.order` 依次尝试；每次调用会记录结构化 **attempts**（provider、结果、耗时、原因等），便于日志与诊断。

```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "fallback": {
      "enabled": true,
      "order": ["alibaba", "openai"]
    }
  }
}
```

### 群聊语音与 @mention（Telegram）

在需要 @ 的群聊里，**仅语音、无文字** 的消息会先转写再做过滤，以便识别口播中的昵称或 `checkMentionInTranscription` 支持的模糊说法。实现：`extensions/telegram/src/inbound-processor.ts`（并尽量复用同一段转写避免对同一语音 STT 两次）。

通用工具：`src/stt/preflight.ts`。

---

## TTS 配置

### 触发模式

| 配置值 | 行为 |
|--------|------|
| `off` | 不对出站自动做 TTS |
| `always` | 满足管道条件时尽量对文本回复做 TTS |
| `inbound` | 仅当用户本轮带语音入站（`transcribedVoice`）时 TTS |
| `tagged` | 仅当助手文本含 `[[tts]]` 时 TTS（发送前去掉标记） |

配置中的 **`auto` 会当作 `inbound`**。

### OpenAI TTS

```json
{
  "tts": {
    "enabled": true,
    "provider": "openai",
    "trigger": "inbound",
    "openai": {
      "apiKey": "your-openai-api-key",
      "model": "tts-1",
      "voice": "alloy"
    }
  }
}
```

**音色：** `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`

### 阿里云 DashScope TTS

```json
{
  "tts": {
    "enabled": true,
    "provider": "alibaba",
    "trigger": "inbound",
    "alibaba": {
      "apiKey": "your-dashscope-api-key",
      "model": "qwen-tts",
      "voice": "Cherry"
    }
  }
}
```

### Edge TTS（无需 API Key）

```json
{
  "tts": {
    "enabled": true,
    "provider": "edge",
    "edge": {
      "enabled": true,
      "voice": "en-US-MichelleNeural",
      "lang": "en-US"
    }
  }
}
```

若要从链中排除 Edge，设置 `"edge": { "enabled": false }`。

### TTS 回退链

```json
{
  "tts": {
    "enabled": true,
    "provider": "openai",
    "fallback": {
      "enabled": true,
      "order": ["openai", "alibaba", "edge"]
    }
  }
}
```

### 长文本与 `maxTextLength`

- **`maxTextLength`**：送入各 TTS 提供方的硬上限（schema 默认 **512**，可按主用 provider 调高）。  
- **`summarization`**：默认开启时，超过 **threshold**（默认同 `maxTextLength`）会先经 **LLM 摘要**（`src/tts/summarize.ts`）。模型可用 `tts.summarization.model` 或环境变量 **`XOPC_TTS_SUMMARIZE_MODEL`** 指定。

```json
{
  "tts": {
    "summarization": {
      "enabled": true,
      "threshold": 512,
      "targetLength": 512,
      "model": "openai/gpt-4o-mini"
    }
  }
}
```

### 指令 `[[tts:...]]`

在 `modelOverrides` 默认开启时，可使用 `[[tts:text]]` 等指令；详见 `src/tts/directives.ts`。

---

## 智能体工具：`text_to_speech`

当 **`tts.enabled`** 为 true 时，可注册 **`text_to_speech`** 工具（`src/agent/tools/tts-tool.ts`）：主动合成语音并通过总线发出**独立语音消息**。与通道派发层上的**自动 TTS** 并存；系统提示中的 **Voice (TTS)** 一节会说明不要每条消息都调用。

---

## 聊天命令：`/tts`

内置命令（`src/chat-commands/builtins/tts.ts`）包括：

- `/tts` — 当前开关、trigger、provider、音色、就绪状态  
- `/tts on` | `/tts off`  
- `/tts always` | `/tts inbound` | `/tts tagged` | `/tts never`  
- `/tts provider …` | `/tts voice …`  
- **`/tts status`** — 最近一次 TTS 结果、延迟、是否 fallback/摘要，以及进程内滚动成功率（内存统计）

---

## 通道音频格式

出站编码按通道选择（如 Telegram Opus 语音条、微信 / 网页 / CLI 为 MP3）。未在表中列出的 channel id 与 `default` 相同（MP3、非语音条）。实现见 `src/tts/service.ts` 中 `CHANNEL_OUTPUT_FORMATS`，说明见 `.docs/tts/05-channel-aware-output.md`。

---

## 限制

| 项目 | 说明 |
|------|------|
| Telegram 语音 STT | **60 秒**，超出会跳过或占位 |
| TTS 文本 | 受 **`maxTextLength`**（默认 512）约束，可配 **摘要** |
| Web 语音附件 | 有大小上限与错误占位（见 `voice-stt-webchat`） |

---

## 环境变量

| 变量 | 用途 |
|------|------|
| `DASHSCOPE_API_KEY` | 阿里云 DashScope（STT/TTS） |
| `OPENAI_API_KEY` | OpenAI（STT/TTS/摘要） |
| `XOPC_TTS_SUMMARIZE_MODEL` | 未配置 `tts.summarization.model` 时的摘要模型引用 |

---

## 故障排除

### 语音转文字失败

1. API Key 与额度  
2. Telegram 时长是否在 60 秒内  
3. 是否配置 **fallback.order** 且备用 provider 可用  
4. 日志级别 `XOPC_LOG_LEVEL=debug`

### 没有收到语音回复

1. `tts.enabled` 与 **trigger**（`inbound` 需要用户发语音；`tagged` 需要 `[[tts]]`）  
2. `maxTextLength` / 摘要失败（查日志）  
3. fallback 链是否全部未配置（可临时用 **Edge** 验证）

### 诊断最近一次 TTS

使用 **`/tts status`** 或查看日志中的 provider 尝试与 `TTS:StatusTracker` 调试信息。

---

## API 参考（概念）

### STT

```typescript
interface STTConfig {
  enabled: boolean;
  provider: 'alibaba' | 'openai';
  alibaba?: { apiKey?: string; model?: string };
  openai?: { apiKey?: string; model?: string };
  fallback?: { enabled: boolean; order: ('alibaba' | 'openai')[] };
}
```

转写结果可带 **`attempts`**、**`fallbackFrom`**、**`attemptedProviders`**（`src/stt/types.ts`）。

### TTS

```typescript
interface TTSConfig {
  enabled: boolean;
  provider: 'openai' | 'alibaba' | 'edge';
  trigger: 'off' | 'always' | 'inbound' | 'tagged';
  maxTextLength?: number;
  timeoutMs?: number;
  fallback?: { enabled: boolean; order: ('openai' | 'alibaba' | 'edge')[] };
  summarization?: {
    enabled?: boolean;
    threshold?: number;
    targetLength?: number;
    model?: string;
  };
  modelOverrides?: { /* 见 schema */ };
  openai?: { apiKey?: string; model?: string; voice?: string };
  alibaba?: { apiKey?: string; model?: string; voice?: string };
  edge?: { enabled?: boolean; voice?: string; lang?: string; /* … */ };
}
```

合成结果可带 **`attempts`**、**`fallbackFrom`**、**`wasSummarized`** 等（`src/tts/types.ts`）。

完整校验模式：`src/config/schema.ts`（`TTSConfigSchema`、`TTSSummarizationConfigSchema`）。

---

## 最佳实践

1. 配置 **STT fallback** 提高可用性。  
2. **`maxTextLength`** 与主用 TTS provider 上限对齐；长回复打开 **summarization**。  
3. 调参后用 **`/tts status`** 快速看最近一次合成是否走 fallback/摘要。  
4. API Key 优先放环境变量。  
5. 群聊依赖语音 @ 时，保持 **bot 用户名**清晰、便于 STT 与模糊匹配。
