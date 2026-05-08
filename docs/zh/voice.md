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
4. 出站文本按 **trigger** 等规则可能走 TTS，并按通道选择编码（Telegram 语音条用 Opus，微信/Web 常用 MP3）。

**Web UI（webchat）**

1. STT 启用时，语音附件会先转写再进入模型上下文。
2. TTS 触发规则与其他通道一致；浏览器侧使用 **MP3** 便于播放。

---

## 快速开始

语音配置位于 **`messages.tts`**（TTS）和 **`tools.media.audio`**（STT）。

`~/.xopc/xopc.json` 最小示例（API Key 也可用环境变量）：

```json
{
  "tools": {
    "media": {
      "audio": {
        "enabled": true,
        "provider": "alibaba",
        "alibaba": {
          "apiKey": "your-dashscope-api-key"
        }
      }
    }
  },
  "messages": {
    "tts": {
      "enabled": true,
      "provider": "openai",
      "trigger": "inbound",
      "openai": {
        "apiKey": "your-openai-api-key"
      }
    }
  }
}
```

**说明：** `trigger` 取值为 `off` | `always` | `inbound` | `tagged`（详见下表）。

---

## STT 配置

> 下方各示例只展示**内层结构**。直接编辑 `~/.xopc/xopc.json` 时，请把整段包在
> `{ "tools": { "media": { "audio": { ... } } } }` 之内。

### 阿里云 Paraformer（中文场景常用）

```json
{
  "enabled": true,
  "provider": "alibaba",
  "alibaba": {
    "apiKey": "your-dashscope-api-key",
    "model": "paraformer-v2"
  }
}
```

具体模型名以 DashScope 文档为准（`paraformer-v2` 等）。

### OpenAI Whisper

```json
{
  "enabled": true,
  "provider": "openai",
  "openai": {
    "apiKey": "your-openai-api-key",
    "model": "whisper-1"
  }
}
```

### 回退链（fallback）

主 provider 失败时按 `fallback.order` 依次尝试；每次调用会记录结构化 **attempts**（provider、结果、耗时、原因等），便于日志与诊断。

```json
{
  "enabled": true,
  "provider": "alibaba",
  "fallback": {
    "enabled": true,
    "order": ["alibaba", "openai"]
  }
}
```

所有 HTTP 调用都走共享的 `media-shared/http` 底盘，启用了 **SSRF 防护**（`fetchWithTimeoutGuarded`）。

### 群聊语音与 @mention（Telegram）

在需要 @ 的群聊里，**仅语音、无文字**的消息会先转写再做过滤，以便识别口播中的机器人名或类似说法。

---

## TTS 配置

### 触发模式

| 配置值 | 行为 |
|--------|------|
| `off` | 不对出站自动做 TTS |
| `always` | 满足管道条件时尽量对文本回复做 TTS |
| `inbound` | 仅当用户本轮带语音入站（`transcribedVoice`）时 TTS |
| `tagged` | 仅当助手文本含 `[[tts]]` 时 TTS（发送前去掉标记） |

> 下方各示例只展示**内层结构**。直接编辑 `~/.xopc/xopc.json` 时，请把整段包在
> `{ "messages": { "tts": { ... } } }` 之内。

### OpenAI TTS

```json
{
  "enabled": true,
  "provider": "openai",
  "trigger": "inbound",
  "openai": {
    "apiKey": "your-openai-api-key",
    "model": "tts-1",
    "voice": "alloy"
  }
}
```

**音色：** `alloy`、`echo`、`fable`、`onyx`、`nova`、`shimmer`、`coral`、`verse` …
**模型：** `tts-1`、`tts-1-hd`、`gpt-4o-mini-tts`

### 阿里云 DashScope TTS

```json
{
  "enabled": true,
  "provider": "alibaba",
  "trigger": "inbound",
  "alibaba": {
    "apiKey": "your-dashscope-api-key",
    "model": "qwen-tts",
    "voice": "longxiaochun"
  }
}
```

### Microsoft Edge TTS（无需 API Key）

```json
{
  "enabled": true,
  "provider": "edge",
  "edge": {
    "enabled": true,
    "voice": "en-US-MichelleNeural",
    "lang": "en-US"
  }
}
```

若要从链中排除 Edge，设置 `"edge": { "enabled": false }`。

### MiniMax T2A

```json
{
  "enabled": true,
  "provider": "minimax",
  "minimax": {
    "apiKey": "your-minimax-api-key",
    "model": "speech-2.8-hd",
    "voice": "male-qn-qingse"
  }
}
```

MiniMax 走异步任务接口，运行时会自动把单次超时提到 ≥150s。

### 本地 CLI TTS（离线，自带二进制）

针对离线 / 端侧模型（mlx-audio、sherpa-onnx-tts、piper 等），启用内置的
**`tts-local-cli`** 扩展并配置 shell 命令。Provider 会启动该二进制、读取产物
文件并把字节回传。

```json
{
  "enabled": true,
  "provider": "tts-local-cli",
  "trigger": "inbound",
  "tts-local-cli": {
    "command": "mlx_audio.tts.generate --model mlx-community/Kokoro-82M-bf16 --text \"{{Text}}\" --file_prefix {{OutputBase}}",
    "cwd": "/Users/me/work",
    "outputFormat": "wav",
    "timeoutMs": 90000
  }
}
```

`command` 内可用占位符：`{{Text}}`、`{{OutputPath}}`、`{{OutputDir}}`、`{{OutputBase}}`（大小写不敏感）。
完整 schema 见 `extensions/tts-local-cli/`（源码与 `xopc.extension.json`）。

### TTS 回退链

```json
{
  "enabled": true,
  "provider": "openai",
  "fallback": {
    "enabled": true,
    "order": ["openai", "alibaba", "edge", "minimax"]
  }
}
```

回退列表接受**任意已注册 SpeechProviderPlugin 的 id**，包括扩展 provider（如 `tts-local-cli`）。失败尝试会记录到日志（含 provider、耗时、原因），成功合成则在内部结果对象上挂 **attempts** 摘要。

### 长文本与 `maxTextLength`

- **`maxTextLength`**：送入各 TTS 提供方的硬上限（schema 默认 **512**，与最严格的 provider 对齐 —— 阿里 qwen-tts 的硬限是 512；若主用 provider 上限更高可酌情上调）。
- **`summarization`**：默认开启时，超过 **threshold**（默认同 `maxTextLength`）会先经 **小模型摘要** 再送 TTS。模型用 `messages.tts.summarization.model` 或环境变量 **`XOPC_TTS_SUMMARIZE_MODEL`** 指定。

```json
{
  "summarization": {
    "enabled": true,
    "threshold": 512,
    "targetLength": 512,
    "model": "openai/gpt-4o-mini"
  }
}
```

### 指令 `[[tts:...]]`

在 `modelOverrides` 默认开启时，模型可使用 `[[tts:text]]...[[/tts:text]]` 等指令、以及音色/模型 hint。完整列表以当前版本的 schema 为准。

---

## 智能体工具：`text_to_speech`

当 **`messages.tts.enabled`** 为 true 时，可注册 **`text_to_speech`** 工具：主动合成语音并发出**独立语音消息**（与出站路径上的**自动 TTS** 并存）。

适用于明确的「读出来」请求；常规回复仍走 **`send_message`**。系统提示中的 **Voice (TTS)** 一节会说明不要每条消息都调用。

---

## 聊天命令：`/tts`

内置命令包括：

- `/tts` — 当前 trigger、provider、音色、就绪状态
- `/tts on` | `/tts off`
- `/tts always` | `/tts inbound` | `/tts tagged` | `/tts never`
- `/tts provider …` | `/tts voice …`
- **`/tts status`** — 最近一次 TTS 结果、延迟、是否 fallback/摘要，以及进程内滚动成功率（内存统计）

---

## 通道音频格式

出站编码按通道选择（例如 Telegram 常用 **Opus** 语音条，微信 / 网页 / CLI 常用 **MP3**）。其它通道 id 一般跟随 “generic” 默认（多为 MP3），除非扩展另有说明。

---

## 限制

| 项目 | 说明 |
|------|------|
| Telegram 语音 STT | **60 秒**，超出会跳过或占位 |
| TTS 文本 | 受 **`maxTextLength`** 约束（schema 默认 **512**），可配 **摘要** |
| Web 语音附件 | 过大文件可能被拒绝并返回占位说明 |

---

## 环境变量

| 变量 | 用途 |
|------|------|
| `DASHSCOPE_API_KEY` | 阿里云 DashScope（STT/TTS） |
| `OPENAI_API_KEY` | OpenAI（STT/TTS/摘要） |
| `MINIMAX_API_KEY` | MiniMax T2A（TTS） |
| `XOPC_TTS_SUMMARIZE_MODEL` | 未配置 `messages.tts.summarization.model` 时的摘要模型引用 |

---

## 工作流（Telegram 简化版）

```
用户发送语音
       │
       ▼
┌──────────────────────┐
│ 下载音频              │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐   （群聊 + 需要 @mention）
│ 可选：preflight STT  │ ──► 转写用于 @ 检测
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ STT → 用户文本       │  （可复用 preflight 转写）
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 智能体一轮            │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 出站 + 可选 TTS      │  摘要 → TTS 链 → 压缩
│ （按 trigger）       │  → 通道格式（Opus/MP3 …）
└──────────────────────┘
```

---

## 故障排除

### 语音转文字失败

1. API Key 与额度
2. Telegram 时长是否在 60 秒内
3. 是否配置 **fallback.order** 且备用 provider 可用
4. 日志级别 `XOPC_LOG_LEVEL=debug`

### 没有收到语音回复

1. `messages.tts.enabled` 与 **trigger**（`inbound` 需要用户发语音；`tagged` 需要 `[[tts]]`）
2. `maxTextLength` / 摘要失败（查日志）
3. fallback 链是否全部未配置（可临时用 **Edge** 验证）

### 诊断最近一次 TTS

使用 **`/tts status`** 或查看日志中的 provider 尝试与 `TTS:StatusTracker` 调试信息。

---

## API 参考（概念）

STT 位于 **`tools.media.audio`**；TTS 位于 **`messages.tts`**。

### STT (`tools.media.audio`)

```typescript
interface STTConfig {
  enabled: boolean;
  provider: 'alibaba' | 'openai';
  alibaba?: { apiKey?: string; model?: string };
  openai?: { apiKey?: string; model?: string };
  fallback?: { enabled: boolean; order: ('alibaba' | 'openai')[] };
  /** 单次调用超时（ms），默认 60s。 */
  timeoutMs?: number;
}
```

转写结果可带 **`attempts`**、**`fallbackFrom`**、**`attemptedProviders`** 等诊断字段。

### TTS (`messages.tts`)

```typescript
interface TTSConfig {
  enabled: boolean;
  provider: 'openai' | 'alibaba' | 'edge' | 'minimax' | 'tts-local-cli' | string;
  trigger: 'off' | 'always' | 'inbound' | 'tagged';
  maxTextLength?: number;
  timeoutMs?: number;
  fallback?: { enabled: boolean; order: string[] };
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
  minimax?: { apiKey?: string; model?: string; voice?: string };
  /** 扩展 provider 配置（如 tts-local-cli）。 */
  [providerId: string]: unknown;
}
```

`provider` 现为开放字符串：任何已注册的 `SpeechProviderPlugin`（内置或扩展加载，参见 [extensions.md](./extensions.md#speech-providers)）都可以选用。

合成结果可带 **`attempts`**、**`fallbackFrom`**、**`wasSummarized`** 等诊断字段。

完整字段说明见 [配置参考](configuration.md)。编辑 JSON 后可运行 `xopc config show` 或启动网关，确认配置能被正常加载。

---

## 最佳实践

1. 配置 **STT fallback** 提高可用性。
2. **`maxTextLength`** 与主用 TTS provider 上限对齐；长回复打开 **summarization**。
3. 调参后用 **`/tts status`** 快速看最近一次合成是否走 fallback/摘要。
4. API Key 优先放环境变量。
5. 群聊依赖语音 @ 时，保持 **bot 用户名**清晰、便于 STT 与模糊匹配。
