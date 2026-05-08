# 语音（STT / TTS）架构重构方案

> 目标：把 xopc 现有「内核内置 4 家 TTS + 2 家 STT、硬编码 switch 工厂」的语音实现，迁移到「内核空 + 插件契约 + 注册表」的架构，**核心对齐 [openclaw](https://github.com/openclawai/openclaw) `src/tts/` 与 `src/media-understanding/`** 在以下五项能力：
>
> 1. **Provider 插件化**（`extensions/<vendor>-speech/`）
> 2. **流式 TTS 合成**（`synthesizeStream`）
> 3. **本地 CLI Provider**（whisper-cli / 自定义 TTS 命令）
> 4. **HTTP 安全层**（SSRF 守卫、私有网络策略、proxy 路由）
> 5. **API key 轮换**（`executeWithApiKeyRotation`）
>
> **不在本方案范围**：电话音（telephony）、persona 系统、实时语音通话（Realtime Voice）。这三项是**显式排除项**，不属于本方案的待办或后续承诺；任何一项落地都需要单独立项 RFC，处理路径详见 [§15.3 本方案明确不涵盖的范围](#153-本方案明确不涵盖的范围)。

- **状态**：Draft v0
- **作者**：xopc core
- **范围**：`src/voice/{stt,tts}` → `src/voice/tts/`、新建 `src/media-understanding/`、新建 `extensions/<vendor>-speech/`、`src/config/schema.ts`、`web/src/features/settings/voice/`
- **预估工作量**：3 个迭代（每个 ~1 周），见 [§13 分阶段迁移路径](#13-分阶段迁移路径)
- **不影响**：`@mariozechner/pi-ai` LLM 调用链、`channels/` 输入输出主链路（仅替换内部调用）
- **联动文档**：[docs/image-generation-rearchitecture.md](./image-generation-rearchitecture.md)（共享 `src/media-*` 公共底盘）、[docs/voice.md](./voice.md)（用户文档，本方案落地后需同步更新）

---

## 目录

- [1. 现状基线（As-Is）](#1-现状基线as-is)
- [2. 目标架构（To-Be）总览](#2-目标架构to-be总览)
- [3. 模块清单与目录树](#3-模块清单与目录树)
- [4. 核心契约：SpeechProviderPlugin](#4-核心契约speechproviderplugin)
- [5. 核心契约：MediaUnderstandingProvider](#5-核心契约mediaunderstandingprovider)
- [6. HTTP 底盘（provider-http + SSRF）](#6-http-底盘provider-http--ssrf)
- [7. API Key 轮换与鉴权](#7-api-key-轮换与鉴权)
- [8. 流式 TTS（synthesizeStream）](#8-流式-ttssynthesizestream)
- [9. 本地 CLI Provider](#9-本地-cli-provider)
- [10. Directive 自治（[[tts:xxx=yyy]]）](#10-directive-自治tts-xxxyyy)
- [11. 插件 Registry 与发现](#11-插件-registry-与发现)
- [12. 配置 Schema 演进与破坏式升级](#12-配置-schema-演进与破坏式升级)
- [13. 分阶段迁移路径](#13-分阶段迁移路径)
- [14. 验收清单与测试矩阵](#14-验收清单与测试矩阵)
- [15. 风险、回滚与未涵盖项](#15-风险回滚与未涵盖项)
- [附录 A：openclaw 关键文件索引](#附录-aopenclaw-关键文件索引)
- [附录 B：xopc 当前可复用基础](#附录-bxopc-当前可复用基础)

---

## 1. 现状基线（As-Is）

### 1.1 现有结构

```
src/voice/
├── stt/
│   ├── types.ts              # STTProvider 接口（仅 transcribe + isConfigured）；STTConfig 字面量联合类型 'alibaba' | 'openai'
│   ├── factory.ts            # createSTTProvider — 硬编码 switch case
│   ├── transcribe-core.ts    # transcribe() — 串行 fallback chain + classifySTTError
│   ├── alibaba.ts            # Paraformer-v2，DashScope 异步任务（提交 → 1s 轮询 → 拉转写 JSON）
│   ├── openai.ts             # Whisper，openai SDK
│   ├── preflight.ts          # audioPreflightTranscribe（mention 检测专用）+ checkMentionInTranscription
│   ├── availability.ts       # isSTTAvailable
│   └── index.ts              # barrel
└── tts/
    ├── types.ts              # TTSProviderInterface；TTSProvider 字面量联合 'openai' | 'alibaba' | 'edge' | 'minimax'
    ├── factory.ts            # createSingleProvider — 硬编码 switch case
    ├── speak-core.ts         # speak() 编排：parseDirectives → preprocess → summarize → fallback chain
    ├── service.ts            # TTSService + shouldUseTTS + CHANNEL_OUTPUT_FORMATS（telegram→opus、weixin→mp3...）
    ├── payload.ts            # maybeApplyTtsToPayload（outbound 主入口）+ ffmpeg 压缩
    ├── audio.ts              # compressAudio：spawn ffmpeg WAV → opus(24k) 或 mp3(64k)
    ├── preprocess.ts         # stripMarkdown / normalizeWhitespace / truncateText
    ├── summarize.ts          # 长文本 LLM 摘要
    ├── directives.ts         # [[tts:xxx=yyy]] 指令解析（硬编码 4 家 case）
    ├── sentence-boundary.ts  # truncateAtSentenceBoundary
    ├── status-tracker.ts     # 内存状态计数
    ├── merge-config.ts       # 配置合并 + setup hint
    └── providers/
        ├── base.ts           # BaseTTSProvider 抽象基类（OOP）
        ├── openai.ts         # OPENAI_TTS_VOICES 字面量数组写死
        ├── alibaba.ts        # qwen-tts
        ├── edge.ts           # node-edge-tts（写临时文件再读回）
        └── minimax.ts
```

### 1.2 痛点

| # | 痛点 | 影响 |
|---|------|------|
| **P1** | Provider 内置在内核，加新厂商必须改 `factory.ts` 的 switch case + `directives.ts` 的指令解析 + `types.ts` 的字面量联合 | 扩展性差，与 channels 的 `ChannelPlugin` 模型不一致；社区无法独立发布新 provider |
| **P2** | STT 与图像理解（image understanding）完全隔离 — 没有 `media-understanding` 统一框架 | 用户给同一个对话用 GPT-4o 多模态时，STT 还要单独配 Whisper/Paraformer，且不能复用对话主模型 |
| **P3** | 每家 Provider 各自手写 `fetch + AbortController + setTimeout`，无 SSRF 守卫、无 dispatcher policy、无 proxy 路由 | 企业部署时无法对私有网络/内网访问做策略控制 |
| **P4** | 鉴权只有 `process.env.XXX_API_KEY \|\| config.xxx.apiKey`，单 key | 无法支持多 key 轮换降配额风险，无法 per-agent 区分 profile |
| **P5** | TTS 全 Buffer（`provider.speak() → Buffer`），不支持流式 | Telegram draft / webchat 边说边播无法实现，长文本首包延迟高 |
| **P6** | 音色列表是字面量数组（`OPENAI_TTS_VOICES = [...] as const`） | 无法拉取 ElevenLabs/Azure 全量音色，UI 选音色受限 |
| **P7** | `directives.ts` 中 `openai_voice / alibaba_voice / edge_voice / minimax_voice` 等 case 全集中在一个文件 | 加 provider 必改主仓代码；指令策略无法 per-provider 自治 |
| **P8** | 无本地 CLI provider（whisper-cli、自定义 TTS 命令） | 离线/隐私场景无法满足 |
| **P9** | `BaseTTSProvider` OOP 基类把"截断/超时/日志"硬塞进 speak()；想复用其中一两个 helper 必须继承整套 | 函数式组合更灵活，更方便插件作者自由实现 |
| **P10** | 错误分类靠 `error.message.toLowerCase().includes('timeout')` 字符串匹配 | 不可靠；上层无法基于 status code 做精确重试决策 |

### 1.3 已有可保留的设计

并非全部推倒。以下设计在新架构里**继续沿用或微调**：

- ✅ `TTSAutoMode = 'off' \| 'always' \| 'inbound' \| 'tagged'` 四种 trigger 语义（与 openclaw 一致）
- ✅ `STTResultWithTracking` / `TTSResultWithTracking` 的 `attempts[]` 元信息（openclaw 的 `MediaUnderstandingDecision` 也是类似形态）
- ✅ `preprocess.ts` 的 markdown 剥离 + 句子边界截断（LLM 输出预处理逻辑通用）
- ✅ `summarize.ts` 长文本摘要（openclaw `summarizeText` 形态等价，仅鉴权链路不同）
- ✅ `service.ts` 的 `CHANNEL_OUTPUT_FORMATS` 表（保留概念，但格式决策下沉到 provider）
- ✅ `status-tracker.ts` 内存状态（openclaw `getLastTtsAttempt/setLastTtsAttempt` 等价）
- ✅ `payload.ts` 的 `maybeApplyTtsToPayload` outbound 编排入口（接口签名保留，内部实现替换）

---

## 2. 目标架构（To-Be）总览

### 2.1 架构分层图

```
                                    ┌──────────────────────────────────────┐
                                    │  channels/ (telegram/weixin/webchat) │
                                    │  inbound (audio) → outbound (text)   │
                                    └──────────┬───────────────────────────┘
                                               │
              ┌────────────────────────────────┼─────────────────────────────────┐
              │                                │                                 │
   ┌──────────▼──────────┐         ┌───────────▼────────────┐         ┌──────────▼──────────┐
   │   STT 入口（preflight）│         │ TTS 入口（payload.ts） │         │   tools (typebox)   │
   │ transcribeFirstAudio │         │  maybeApplyTtsToPayload│         │  text_to_speech etc │
   └──────────┬──────────┘         └───────────┬────────────┘         └──────────┬──────────┘
              │                                │                                 │
   ┌──────────▼──────────────────┐  ┌──────────▼──────────────────────────────────▼───────┐
   │  src/media-understanding/   │  │              src/voice/tts/  (编排层)                │
   │  runner.ts (capability=audio│  │  speak-core.ts → directive parse → preprocess →     │
   │  /image/video 三合一)       │  │  summarize → resolveProviderOrder → fallback chain   │
   └──────────┬──────────────────┘  └──────────┬──────────────────────────────────────────┘
              │                                │
              │           ┌────────────────────┴───────────────────┐
              │           │                                        │
   ┌──────────▼───────────▼─────────┐                ┌─────────────▼──────────────────────┐
   │  src/media/provider-registry/  │                │   src/voice/tts/provider-registry/ │
   │  MediaUnderstandingProvider 注册│                │       SpeechProviderPlugin 注册     │
   └──────────┬─────────────────────┘                └─────────────┬──────────────────────┘
              │                                                    │
              └───────────────────┬────────────────────────────────┘
                                  │
                ┌─────────────────▼─────────────────────────────────────┐
                │  src/media/provider-http/   (公共 HTTP 底盘)           │
                │  - resolveProviderHttpRequestConfig (SSRF / dispatcher)│
                │  - postJsonRequest / postTranscriptionRequest          │
                │  - executeWithApiKeyRotation                           │
                │  - assertOkOrThrowProviderError                        │
                └────────────────────────────────────────────────────────┘
                                  │
        ┌─────────────────────────┼────────────────────────────────────────────┐
        │                         │                                            │
┌───────▼──────────┐    ┌─────────▼──────────┐    ┌────────────────────────────▼──────┐
│ extensions/      │    │ extensions/        │    │ extensions/                        │
│ openai-speech/   │    │ alibaba-speech/    │    │ tts-local-cli/                     │
│  ├ tts.ts        │    │  ├ tts.ts          │    │  └ speech-provider.ts              │
│  ├ stt.ts        │    │  ├ stt.ts          │    │  (whisper-cli / 自定义命令模板)    │
│  └ index.ts      │    │  └ index.ts        │    └────────────────────────────────────┘
└──────────────────┘    └────────────────────┘
   定义 provider plugin，bundled.ts 静态注册 + 用户可在 extensions 配置自定义 provider
```

### 2.2 与 openclaw 对齐的五项核心能力

| # | 能力 | xopc 现状 | 对齐后 | 实现位置 |
|---|------|----------|--------|----------|
| **C1** | **Provider 插件化** | switch case + 字面量联合 | `SpeechProviderPlugin` / `MediaUnderstandingProvider` 注册到 registry，extensions 独立 | `src/voice/tts/provider-registry.ts` + `src/media-understanding/provider-registry.ts` |
| **C2** | **流式 TTS** | 全 Buffer | `synthesizeStream(req): { audioStream: ReadableStream<Uint8Array>, release }` 可选契约方法 | `extensions/<vendor>-speech/tts.ts` 实现；`speak-core.ts` 添加 `speakStream()` 编排 |
| **C3** | **本地 CLI provider** | 无 | STT: 自动探测 `whisper-cli/whisper/sherpa-onnx`；TTS: `extensions/tts-local-cli/` 自定义命令 + `{{Text}}` 模板 | `src/media-understanding/runner.ts` 的 `runCliEntry` + `extensions/tts-local-cli/` |
| **C4** | **HTTP 安全层** | 裸 fetch | `resolveProviderHttpRequestConfig` 统一 SSRF / dispatcherPolicy / allowPrivateNetwork / proxy | `src/media/provider-http/` 新建 |
| **C5** | **API key 轮换** | 单 key | `executeWithApiKeyRotation`：429/quota 错误自动切下一个 key | `src/media/provider-http/key-rotation.ts` 新建 |

### 2.3 范围边界（明确不做的）

| 项 | 不做的原因 | 后续路线 |
|----|-----------|----------|
| **Telephony**（电话音 8kHz） | 当前无 talk channel，需求未对齐 | 详见 [§15.3](#153-本方案明确不涵盖的范围) — 触发条件、归属、入口接口已明确，本方案接口不预留 hook |
| **Persona 系统** | 配置语义复杂（personas 字典 + 每 persona 绑定 provider/voice/lang） | 详见 [§15.3](#153-本方案明确不涵盖的范围) — 触发条件、归属已明确；现状 `agents.list` 已能覆盖跨 agent 的 voice 配置场景 |
| **Realtime Voice**（双向流） | openclaw 的 `realtime-voice-provider` 走 WebRTC/WebSocket，与 channel 主链路解耦较深 | 不在本方案；如未来立项，**强制要求**新建 `src/voice/realtime/` 顶级模块（与 `src/voice/tts/` 平级），不得复用本方案的 `SpeechProviderPlugin` 接口（流式语义和生命周期完全不同）|
| **MediaUnderstanding 全量**（image/video） | 本方案聚焦语音，`audio` 能力先落地 | 与 [docs/image-generation-rearchitecture.md](./image-generation-rearchitecture.md) 联动，`image` capability 由该方案承接 |

### 2.4 关键设计原则

1. **接口优先 OOP 让位 FP**：放弃 `BaseTTSProvider` 抽象基类，改用 `SpeechProviderPlugin` 接口对象 + 工厂函数 `createOpenAiCompatibleSpeechProvider({...})`，与 openclaw 一致。
2. **Provider 自治**：directive 解析、配置归一化、音色列表全部 provider 内闭环，主仓只定义注册协议。
3. **STT 复用多模态框架**：新建 `src/media-understanding/`，`audio` 是其首个落地的 capability。多模态对话模型（如 Gemini、GPT-4o-audio）原生听音可直接接管转写。
4. **HTTP 调用强制走底盘**：所有 provider 的 fetch 必须经 `provider-http`，不允许直接 `fetch()`。lint 规则强制约束。
5. **配置层破坏式升级**：v2.0 release 时直接换 schema，提供 `xopc voice migrate-config` CLI 一键迁移，文档显式声明 breaking change。

---

## 3. 模块清单与目录树

### 3.1 新增模块

```
src/
├── media/                                    # 【新建】媒体相关公共底盘
│   └── provider-http/
│       ├── index.ts                          # barrel
│       ├── request-config.ts                 # resolveProviderHttpRequestConfig
│       ├── post-json.ts                      # postJsonRequest / postTranscriptionRequest
│       ├── ssrf.ts                           # SSRF 守卫 + dispatcher policy
│       ├── key-rotation.ts                   # executeWithApiKeyRotation
│       ├── errors.ts                         # assertOkOrThrowProviderError + ProviderHttpError
│       └── __tests__/
│
├── media-understanding/                      # 【新建】图/音/视频 capability 统一框架
│   ├── index.ts                              # barrel
│   ├── types.ts                              # MediaUnderstandingProvider / AudioTranscriptionRequest 等
│   ├── runner.ts                             # runCapability() 主入口
│   ├── runner.entries.ts                     # runProviderEntry / runCliEntry
│   ├── provider-registry.ts                  # buildMediaUnderstandingRegistry
│   ├── audio-preflight.ts                    # transcribeFirstAudio（替代旧 stt/preflight.ts）
│   ├── audio-transcription-runner.ts         # runAudioTranscription 便捷封装
│   ├── attachments.ts                        # MediaAttachment + isAudioAttachment
│   ├── attachments.cache.ts                  # MediaAttachmentCache（buffer/path 复用）
│   ├── defaults.ts                           # resolveAutoEntries（auto 选 entry 链）
│   ├── openai-compatible-audio.ts            # 通用 multipart 转写客户端
│   ├── shared.ts                             # buildAudioTranscriptionFormData 等 helper
│   └── __tests__/
│
├── voice/
│   └── tts/                                  # 现有目录改造（不再有 stt/）
│       ├── provider-registry.ts              # 【新建】listSpeechProviders + getSpeechProvider
│       ├── provider-types.ts                 # 【新建】SpeechProviderPlugin 等契约
│       ├── openai-compatible-speech.ts       # 【新建】createOpenAiCompatibleSpeechProvider 工厂
│       ├── speak-core.ts                     # 【保留改造】添加 speakStream()，调用走 plugin.synthesize()
│       ├── service.ts                        # 【保留】shouldUseTTS / CHANNEL_OUTPUT_FORMATS
│       ├── payload.ts                        # 【保留改造】内部走新 registry
│       ├── preprocess.ts                     # 【保留】
│       ├── summarize.ts                      # 【保留】
│       ├── directives.ts                     # 【改造】provider.parseDirectiveToken() 委派 + 流式 cleaner
│       ├── status-tracker.ts                 # 【保留】
│       ├── audio.ts                          # 【保留】ffmpeg 压缩降级用（provider 直返合规格式时跳过）
│       └── providers/                        # 【删除】内置 provider 全部下放到 extensions/
│
├── generated/
│   └── bundled-speech-providers.ts           # 【新建】通过 pnpm run generate:bundled-speech 生成
│
└── extensions/sdk/
    ├── speech.ts                             # 【新建】re-export SpeechProviderPlugin / 公共 helper
    └── media-understanding.ts                # 【新建】re-export MediaUnderstandingProvider
```

### 3.2 新增 extensions

```
extensions/                                   # 与 telegram/weixin 平级
├── openai-speech/                            # 【新建】合并 TTS + STT
│   ├── package.json                          # name: @xopc/openai-speech, private: true
│   ├── src/
│   │   ├── index.ts                          # defineSpeechExtensionEntry({ tts, stt })
│   │   ├── tts.ts                            # createOpenAiCompatibleSpeechProvider({...})
│   │   └── stt.ts                            # MediaUnderstandingProvider with transcribeAudio
│   └── __tests__/
├── alibaba-speech/                           # 【新建】qwen-tts + paraformer
├── minimax-speech/                           # 【新建】speech-2.8-hd
├── edge-speech/                              # 【新建】仅 TTS（node-edge-tts）
└── tts-local-cli/                            # 【新建】通用本地 CLI TTS（自定义 command + {{Text}} 模板）
```

### 3.3 删除/废弃文件

| 文件 | 处理 |
|------|------|
| `src/voice/stt/` 整目录 | **删除**，能力迁移到 `src/media-understanding/` |
| `src/voice/tts/factory.ts` | **删除**，由 `provider-registry.ts` 替代 |
| `src/voice/tts/providers/{base,openai,alibaba,edge,minimax}.ts` | **删除**，迁移到 `extensions/<vendor>-speech/` |
| `src/voice/tts/types.ts` 中字面量联合 `'openai' \| 'alibaba' \| 'edge' \| 'minimax'` | **改成** `string`（provider id），具体值由 registry 校验 |
| `src/voice/tts/merge-config.ts` | **改造**：移除 provider 字面量校验，改成调用 `provider.isConfigured()` |

### 3.4 配置文件改动入口

| 文件 | 改动 |
|------|------|
| `src/config/schema.ts` | `tts.provider` 改 `z.string()`；新增 `tts.providers: Record<string, unknown>`、`tools.media.audio: { enabled, language, models[], echoTranscript }` |
| `src/cli/commands/voice.ts`（新建） | `xopc voice migrate-config`、`xopc voice list-providers`、`xopc voice list-voices --provider=<id>` |
| `web/src/features/settings/voice/` | 新增 provider 动态发现 UI（拉 `/api/voice/providers`） |
| `src/gateway/routes/voice.ts`（新建） | `GET /api/voice/providers`、`GET /api/voice/voices?provider=xxx` |

---

## 4. 核心契约：SpeechProviderPlugin

> 完整对应 openclaw 的 `SpeechProviderPlugin`（见 `openclaw/src/tts/provider-types.ts` 与 `openclaw/src/plugins/types.ts:1812`），**裁剪掉 telephony 与 persona 相关字段**。

### 4.1 接口定义（`src/voice/tts/provider-types.ts`）

```typescript
import type { Config } from '../../config/schema.js';

/** Provider 唯一 id，全小写短横线，如 'openai'、'azure-speech'、'tts-local-cli' */
export type SpeechProviderId = string;

/** 合成目标：影响 outputFormat 选择；不引入 telephony */
export type SpeechSynthesisTarget = 'audio-file' | 'voice-note';

export type SpeechProviderConfig = Record<string, unknown>;
export type SpeechProviderOverrides = Record<string, unknown>;

export interface SpeechModelOverridePolicy {
  enabled: boolean;
  allowText: boolean;
  allowProvider: boolean;
  allowVoice: boolean;
  allowModelId: boolean;
  allowVoiceSettings: boolean;
  allowNormalization: boolean;
  allowSeed: boolean;
}

export interface SpeechSynthesisRequest {
  text: string;
  cfg: Config;
  providerConfig: SpeechProviderConfig;
  target: SpeechSynthesisTarget;
  providerOverrides?: SpeechProviderOverrides;
  timeoutMs: number;
}

export interface SpeechSynthesisResult {
  audioBuffer: Buffer;
  outputFormat: string;          // 'mp3' | 'opus' | 'wav' | 'ogg' | ...
  fileExtension: string;         // '.mp3' | '.opus' | ...
  voiceCompatible: boolean;      // 能否作为 telegram voice-note / weixin VoiceItem 直发
}

export interface SpeechSynthesisStreamResult {
  audioStream: ReadableStream<Uint8Array>;
  outputFormat: string;
  fileExtension: string;
  voiceCompatible: boolean;
  release?: () => Promise<void>; // 释放底层连接/临时文件
}

export interface SpeechVoiceOption {
  id: string;
  name?: string;
  category?: string;
  description?: string;
  locale?: string;
  gender?: 'male' | 'female' | 'neutral';
}

export interface SpeechDirectiveTokenParseContext {
  key: string;                                       // 已 lowercase
  value: string;                                     // raw
  policy: SpeechModelOverridePolicy;
  selectedProvider?: SpeechProviderId;
  providerConfig?: SpeechProviderConfig;
  currentOverrides?: SpeechProviderOverrides;
}

export interface SpeechDirectiveTokenParseResult {
  handled: boolean;
  overrides?: SpeechProviderOverrides;
  warnings?: string[];
}

export interface SpeechProviderResolveConfigContext {
  cfg: Config;
  rawConfig: Record<string, unknown>;
  timeoutMs: number;
}

export interface SpeechListVoicesRequest {
  cfg?: Config;
  providerConfig?: SpeechProviderConfig;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Provider 插件契约 - extensions/<vendor>-speech/ 必须导出实现此接口的对象
 */
export interface SpeechProviderPlugin {
  /** 唯一 id */
  readonly id: SpeechProviderId;

  /** UI 显示名 */
  readonly label: string;

  /** 别名（兼容旧 id），可选 */
  readonly aliases?: readonly string[];

  /**
   * 自动选优顺序（升序，越小越优先）。auto fallback 链使用。
   * 推荐值：openai=10、anthropic=15、azure=30、edge=80、tts-local-cli=90
   */
  readonly autoSelectOrder?: number;

  /** 模型字面量列表（仅展示用，校验靠 resolveConfig），可选 */
  readonly models?: readonly string[];

  /** 内置音色列表（与 listVoices 配合，listVoices 优先） */
  readonly voices?: readonly string[];

  // ───── lifecycle ─────

  /** 把 raw config 归一化为 provider 自定义配置对象 */
  resolveConfig(ctx: SpeechProviderResolveConfigContext): SpeechProviderConfig;

  /** 解析 [[tts:foo=bar]] 中的单个 token；不处理就返回 { handled: false } */
  parseDirectiveToken?(ctx: SpeechDirectiveTokenParseContext): SpeechDirectiveTokenParseResult;

  /** 列举可用音色（可远程拉取，如 ElevenLabs / Azure REST） */
  listVoices?(req: SpeechListVoicesRequest): Promise<SpeechVoiceOption[]>;

  /** 配置是否齐全（API key、必填字段等）。decide fallback 时调用 */
  isConfigured(ctx: { cfg: Config; providerConfig: SpeechProviderConfig }): boolean;

  // ───── synthesis ─────

  /** 必选：一次性合成，返回完整 buffer */
  synthesize(req: SpeechSynthesisRequest): Promise<SpeechSynthesisResult>;

  /** 可选：流式合成。speak-core 优先调用此方法（如果调用方要求 stream） */
  synthesizeStream?(req: SpeechSynthesisRequest): Promise<SpeechSynthesisStreamResult>;
}
```

### 4.2 与 openclaw 的差异

| 字段 | openclaw | xopc 本方案 | 说明 |
|------|----------|-------------|------|
| `synthesizeTelephony` | ✅ 有 | ❌ 删除 | 不在本方案范围 |
| `resolveTalkConfig` / `resolveTalkOverrides` | ✅ 有 | ❌ 删除 | 配套 talk 模式（实时通话），不做 |
| `SpeechSynthesisTarget` 取值 | `'audio-file' \| 'voice-note' \| 'telephony'` | `'audio-file' \| 'voice-note'` | 删 telephony |
| `personas` / `getTtsPersona` | ✅ 有 | ❌ 删除 | persona 不做 |
| `cfg` 类型 | `OpenClawConfig` | `Config`（xopc 自己的 zod schema） | 配置 schema 各自管理 |

### 4.3 OpenAI 兼容工厂

绝大多数 OpenAI-compatible TTS（OpenAI 官方、xAI、DeepInfra、OpenRouter、Vydra、Gradium 等）共享 `POST {baseUrl}/audio/speech` 协议，用一个工厂生成 plugin：

```typescript
// src/voice/tts/openai-compatible-speech.ts
export interface OpenAiCompatibleSpeechOptions {
  id: string;
  label: string;
  autoSelectOrder?: number;
  models: readonly string[];
  voices: readonly string[];
  defaultModel: string;
  defaultVoice: string;
  defaultBaseUrl: string;
  envKey: string;                                    // 'OPENAI_API_KEY'
  responseFormats: readonly string[];
  defaultResponseFormat: string;
  voiceCompatibleResponseFormats: readonly string[]; // 能直发 voice-note 的格式
  extraHeaders?: Record<string, string>;
}

export function createOpenAiCompatibleSpeechProvider<
  ExtraConfig extends Record<string, unknown> = Record<string, never>,
>(options: OpenAiCompatibleSpeechProviderOptions<ExtraConfig>): SpeechProviderPlugin {
  const providerConfigKey = options.configKey ?? options.id;
  const normalizeModel =
    options.normalizeModel ?? ((value, fallback) => trimToUndefined(value) ?? fallback);
  const readExtraConfig = options.readExtraConfig ?? (() => ({}) as ExtraConfig);

  function normalizeConfig(rawConfig: Record<string, unknown>) {
    const providers = asObject(rawConfig.providers);
    const raw = asObject(providers?.[providerConfigKey]) ?? asObject(rawConfig[providerConfigKey]);
    return {
      apiKey: normalizeResolvedSecretInputString({
        value: raw?.apiKey,
        path: `messages.tts.providers.${providerConfigKey}.apiKey`,
      }),
      baseUrl:
        trimToUndefined(raw?.baseUrl) == null
          ? undefined
          : normalizeBaseUrl({
              value: raw?.baseUrl,
              fallback: options.defaultBaseUrl,
              policy: options.baseUrlPolicy,
            }),
      model: normalizeModel(trimToUndefined(raw?.model ?? raw?.modelId), options.defaultModel),
      voice: trimToUndefined(raw?.voice ?? raw?.voiceId) ?? options.defaultVoice,
      speed: asFiniteNumber(raw?.speed),
      responseFormat: normalizeResponseFormat({
        providerLabel: options.label,
        responseFormats: options.responseFormats,
        value: raw?.responseFormat,
      }),
      ...readExtraConfig(raw),
    };
  }

  function resolveApiKey(params: { cfg?: unknown; providerConfig: ReturnType<typeof normalizeConfig> }): string | undefined {
    return (
      params.providerConfig.apiKey ??
      readModelProviderConfig(params.cfg, providerConfigKey)?.apiKey ??
      trimToUndefined(process.env[options.envKey])
    );
  }

  function resolveBaseUrl(params: { cfg?: unknown; providerConfig: ReturnType<typeof normalizeConfig> }): string {
    return normalizeBaseUrl({
      value:
        params.providerConfig.baseUrl ??
        trimToUndefined(readModelProviderConfig(params.cfg, providerConfigKey)?.baseUrl),
      fallback: options.defaultBaseUrl,
      policy: options.baseUrlPolicy,
    });
  }

  return {
    id: options.id,
    label: options.label,
    autoSelectOrder: options.autoSelectOrder,
    models: [...options.models],
    voices: [...options.voices],
    resolveConfig: ({ rawConfig }) => normalizeConfig(rawConfig),
    parseDirectiveToken: (ctx) => parseOpenAiCompatibleDirectiveToken(ctx, providerConfigKey),
    listVoices: async () => options.voices.map((voice) => ({ id: voice, name: voice })),
    isConfigured: ({ cfg, providerConfig }) =>
      Boolean(resolveApiKey({ cfg, providerConfig: readProviderConfig(providerConfig) })),
    synthesize: async (req) => {
      const config = readProviderConfig(req.providerConfig);
      const overrides = readSpeechOverrides(req.providerOverrides);
      const apiKey = resolveApiKey({ cfg: req.cfg, providerConfig: config });
      if (!apiKey) {
        throw new Error(options.missingApiKeyError ?? `${options.label} API key missing`);
      }
      const baseUrl = resolveBaseUrl({ cfg: req.cfg, providerConfig: config });
      const responseFormat = config.responseFormat ?? options.defaultResponseFormat;
      const speed = overrides.speed ?? config.speed;

      // 走 §6 HTTP 底盘：附加 SSRF 守卫 + dispatcher policy + 默认 headers
      const { allowPrivateNetwork, headers, dispatcherPolicy } = resolveProviderHttpRequestConfig({
        baseUrl,
        defaultBaseUrl: options.defaultBaseUrl,
        allowPrivateNetwork: false,
        defaultHeaders: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...options.extraHeaders,
        },
        provider: options.id,
        capability: 'audio',
        transport: 'http',
      });

      const { response, release } = await postJsonRequest({
        url: `${baseUrl}/audio/speech`,
        headers,
        body: {
          model: normalizeModel(overrides.model ?? config.model, options.defaultModel),
          input: req.text,
          voice: overrides.voice ?? config.voice,
          response_format: responseFormat,
          ...(speed == null ? {} : { speed }),
          ...buildExtraJsonBodyFields(config, options.extraJsonBodyFields),
        },
        timeoutMs: req.timeoutMs,
        fetchFn: fetch,
        allowPrivateNetwork,
        dispatcherPolicy,
      });
      try {
        await assertOkOrThrowHttpError(
          response,
          options.apiErrorLabel ?? `${options.label} TTS API error`,
        );
        return {
          audioBuffer: Buffer.from(await response.arrayBuffer()),
          outputFormat: responseFormat,
          fileExtension: `.${responseFormat}`,
          voiceCompatible: options.voiceCompatibleResponseFormats.includes(responseFormat),
        };
      } finally {
        await release();
      }
    },
    // synthesizeStream 实现见 §8.3
  };
}
```

> **完整源码参考**：本工厂的实现 1:1 对应 `openclaw/src/tts/openai-compatible-speech-provider.ts`（395 行），xopc 移植时仅删除其中的 `resolveTalkConfig` / `resolveTalkOverrides` 两个 talk 模式方法（[§15.3](#153-本方案明确不涵盖的范围) 已声明不做）。`asObject` / `asFiniteNumber` / `trimToUndefined` / `normalizeResolvedSecretInputString` / `normalizeResponseFormat` / `buildExtraJsonBodyFields` / `parseOpenAiCompatibleDirectiveToken` / `readProviderConfig` / `readSpeechOverrides` / `readModelProviderConfig` / `normalizeBaseUrl` 这些 helper 全部在 `src/voice/tts/openai-compatible-speech.ts` 内部实现，逻辑直接照搬 openclaw 同名文件的 1-200 行（见[附录 A](#附录-aopenclaw-关键文件索引)）。

**示例**（`extensions/openai-speech/src/tts.ts`）：

```typescript
import { createOpenAiCompatibleSpeechProvider } from '@xopcai/xopc/extension-sdk/speech';

export const openaiTtsProvider = createOpenAiCompatibleSpeechProvider({
  id: 'openai',
  label: 'OpenAI TTS',
  autoSelectOrder: 10,
  models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
  voices: ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable', 'juniper', 'marin', 'onyx', 'nova', 'sage', 'shimmer', 'verse'],
  defaultModel: 'tts-1',
  defaultVoice: 'alloy',
  defaultBaseUrl: 'https://api.openai.com/v1',
  envKey: 'OPENAI_API_KEY',
  responseFormats: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'],
  defaultResponseFormat: 'opus',
  voiceCompatibleResponseFormats: ['opus', 'mp3'],
});
```

非 OpenAI 兼容的（Alibaba qwen-tts、MiniMax 自家协议、Azure SSML、Edge node-edge-tts 等）不能用工厂，直接手写 `SpeechProviderPlugin` 对象。完整样例见 §4.5。

### 4.4 手写非 OpenAI 兼容 Provider 样例（Edge TTS）

`extensions/edge-speech/src/tts.ts`（基于 `node-edge-tts` 包，无需 API key）：

```typescript
import { Buffer } from 'node:buffer';
import { EdgeTTS } from 'node-edge-tts';
import type {
  SpeechDirectiveTokenParseContext,
  SpeechProviderConfig,
  SpeechProviderPlugin,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
  SpeechVoiceOption,
} from '@xopcai/xopc/extension-sdk/speech';
import { asObject, asFiniteNumber, trimToUndefined } from '@xopcai/xopc/extension-sdk/speech';

const DEFAULT_EDGE_VOICE = 'en-US-MichelleNeural';
const DEFAULT_EDGE_LANG = 'en-US';
const DEFAULT_EDGE_OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const VOICE_NOTE_OUTPUT_FORMAT = 'webm-24khz-16bit-mono-opus';

interface EdgeProviderConfig {
  voice: string;
  lang: string;
  outputFormat: string;
  pitch?: string;        // '+0Hz' / '-2Hz'
  rate?: string;         // '+0%' / '-15%'
  volume?: string;       // '+0%' / '-30%'
  proxy?: string;
  timeoutMs?: number;
}

function normalizeEdgeProviderConfig(raw: Record<string, unknown>): EdgeProviderConfig {
  const providers = asObject(raw.providers);
  const r = asObject(providers?.edge) ?? asObject(raw.edge) ?? {};
  return {
    voice: trimToUndefined(r.voice) ?? DEFAULT_EDGE_VOICE,
    lang: trimToUndefined(r.lang) ?? DEFAULT_EDGE_LANG,
    outputFormat: trimToUndefined(r.outputFormat) ?? DEFAULT_EDGE_OUTPUT_FORMAT,
    pitch: trimToUndefined(r.pitch),
    rate: trimToUndefined(r.rate),
    volume: trimToUndefined(r.volume),
    proxy: trimToUndefined(r.proxy),
    timeoutMs: asFiniteNumber(r.timeoutMs),
  };
}

function readEdgeProviderConfig(config: SpeechProviderConfig): EdgeProviderConfig {
  const defaults = normalizeEdgeProviderConfig({});
  return {
    voice: trimToUndefined(config.voice) ?? defaults.voice,
    lang: trimToUndefined(config.lang) ?? defaults.lang,
    outputFormat: trimToUndefined(config.outputFormat) ?? defaults.outputFormat,
    pitch: trimToUndefined(config.pitch) ?? defaults.pitch,
    rate: trimToUndefined(config.rate) ?? defaults.rate,
    volume: trimToUndefined(config.volume) ?? defaults.volume,
    proxy: trimToUndefined(config.proxy) ?? defaults.proxy,
    timeoutMs: asFiniteNumber(config.timeoutMs) ?? defaults.timeoutMs,
  };
}

function parseEdgeDirectiveToken(ctx: SpeechDirectiveTokenParseContext) {
  switch (ctx.key) {
    case 'voice': case 'voice_id': case 'voiceid':
    case 'edge_voice': case 'edgevoice':
      if (!ctx.policy.allowVoice) return { handled: true };
      return { handled: true, overrides: { voice: ctx.value } };
    case 'lang': case 'language': case 'languagecode':
      if (!ctx.policy.allowNormalization) return { handled: true };
      return { handled: true, overrides: { lang: ctx.value } };
    case 'pitch':
      if (!ctx.policy.allowVoiceSettings) return { handled: true };
      return { handled: true, overrides: { pitch: ctx.value } };
    case 'rate': case 'speed':
      if (!ctx.policy.allowVoiceSettings) return { handled: true };
      return { handled: true, overrides: { rate: ctx.value } };
    case 'volume':
      if (!ctx.policy.allowVoiceSettings) return { handled: true };
      return { handled: true, overrides: { volume: ctx.value } };
    default:
      return { handled: false };
  }
}

export const edgeTtsProvider: SpeechProviderPlugin = {
  id: 'edge',
  label: 'Microsoft Edge TTS',
  autoSelectOrder: 80,                                  // 无 key、可保底
  voices: [DEFAULT_EDGE_VOICE, 'en-US-AriaNeural', 'zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural'],
  resolveConfig: ({ rawConfig }) => normalizeEdgeProviderConfig(rawConfig),
  parseDirectiveToken: parseEdgeDirectiveToken,
  listVoices: async (): Promise<SpeechVoiceOption[]> => {
    // node-edge-tts 不暴露音色列表 API，使用静态枚举
    return [
      { id: 'en-US-MichelleNeural', name: 'Michelle (US English)', locale: 'en-US', gender: 'female' },
      { id: 'en-US-AriaNeural', name: 'Aria (US English)', locale: 'en-US', gender: 'female' },
      { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 (普通话)', locale: 'zh-CN', gender: 'female' },
      { id: 'zh-CN-YunxiNeural', name: '云希 (普通话)', locale: 'zh-CN', gender: 'male' },
    ];
  },
  isConfigured: () => true,                             // 无需 API key
  synthesize: async (req: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> => {
    const config = readEdgeProviderConfig(req.providerConfig);
    const overrides = asObject(req.providerOverrides) ?? {};
    const outputFormat = req.target === 'voice-note' ? VOICE_NOTE_OUTPUT_FORMAT : config.outputFormat;
    const tts = new EdgeTTS({
      voice: trimToUndefined(overrides.voice) ?? config.voice,
      lang: trimToUndefined(overrides.lang) ?? config.lang,
      outputFormat,
      pitch: trimToUndefined(overrides.pitch) ?? config.pitch,
      rate: trimToUndefined(overrides.rate) ?? config.rate,
      volume: trimToUndefined(overrides.volume) ?? config.volume,
      proxy: config.proxy,
      timeout: req.timeoutMs,
    });
    const audioBuffer = await tts.toBuffer(req.text);
    const isOpus = outputFormat.includes('opus');
    return {
      audioBuffer: Buffer.from(audioBuffer),
      outputFormat: isOpus ? 'opus' : 'mp3',
      fileExtension: isOpus ? '.opus' : '.mp3',
      voiceCompatible: isOpus,
    };
  },
  // synthesizeStream: 不实现（node-edge-tts 内部先写文件再读，无原生流），speak-core 自动降级到 buffer 模式
};
```

> **关键差异**：与 OpenAI 工厂相比，Edge 手写 plugin 完全不调用 `provider-http` 底盘（因为没有 HTTP 调用，全部走 `node-edge-tts` 包），所以 §6 / §7 的 SSRF / key rotation 对它不生效；`isConfigured` 永远返回 `true`，作为 fallback chain 的最末保底。Alibaba qwen-tts、MiniMax 的手写 plugin 结构与此类似，只是各自走 DashScope HTTP / MiniMax `/T2A_v2` REST，需调用 `provider-http`。

### 4.5 注册入口（`extensions/openai-speech/src/index.ts`）

```typescript
import { defineSpeechExtensionEntry } from '@xopcai/xopc/extension-sdk/speech';
import { openaiTtsProvider } from './tts.js';
import { openaiSttProvider } from './stt.js';

export default defineSpeechExtensionEntry({
  id: '@xopc/openai-speech',
  speechProviders: [openaiTtsProvider],
  mediaUnderstandingProviders: [openaiSttProvider],
});
```

`pnpm run generate:bundled-speech` 扫描 `extensions/*-speech/` 生成 `src/generated/bundled-speech-providers.ts`，与现有 `bundled-channel-plugins.ts` 完全对称。

---

## 5. 核心契约：MediaUnderstandingProvider

> 对应 openclaw 的 `MediaUnderstandingProvider`（见 `openclaw/src/media-understanding/types.ts`）。
>
> **本方案的实现边界**：
>
> - **接口契约**：`audio` / `image` / `video` 三个 capability 在 `MediaUnderstandingProvider` 接口中**完整定义方法签名**（字段、类型、可选标记），不存在 `any` 类型逃生口。`describeImage` / `describeVideo` / `describeImages` 是 `?:` 可选方法 —— 未实现就是字面意义的「provider 不声明该方法」，runner 在 `runCapability('image' | 'video', ...)` 时若找不到任何实现该 capability 的 provider，会以 `outcome: 'disabled'` 短路返回（不抛异常、不静默失败）。
> - **本方案落地的 capability**：仅 `audio`（即 STT 转写）。所有内置 provider（OpenAI Whisper、Alibaba Paraformer-v2、本地 whisper-cli / sherpa-onnx）只声明 `transcribeAudio`，**不声明** `describeImage` / `describeVideo` 方法（不是「方法存在但抛 `Not Implemented`」）。
> - **`image` capability 由谁实现**：[docs/image-generation-rearchitecture.md](./image-generation-rearchitecture.md) 落地时，由该方案在同一 `MediaUnderstandingRegistry` 注册新 provider 并声明 `describeImage` / `describeImages` 方法。两个方案共享 registry 与 runner，**接口不变更**。
> - **`video` capability 谁实现**：v2.x 不规划。如未来引入，新 provider 直接声明 `describeVideo` 方法即可（接口已就位）。

### 5.1 接口定义（`src/media-understanding/types.ts`）

```typescript
import type { Config } from '../config/schema.js';

export type MediaCapability = 'image' | 'audio' | 'video';

export interface MediaAttachment {
  /** 本地路径或远程 URL（二选一） */
  path?: string;
  url?: string;
  mime?: string;
  /** 在 inbound message 里的索引（用于 alreadyTranscribed 标记） */
  index: number;
  /** preflight 已转写过；防止 mention check + agent run 重复转写 */
  alreadyTranscribed?: boolean;
}

export interface AudioTranscriptionRequest {
  buffer: Buffer;
  fileName: string;
  mime?: string;
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  /** dispatcher / SSRF / proxy 覆盖 */
  request?: ProviderHttpRequestOverrides;
  model?: string;
  language?: string;
  prompt?: string;
  /** provider 特有 query string，如 deepgram 的 detect_language / smart_format */
  query?: Record<string, string | number | boolean>;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

export interface AudioTranscriptionResult {
  text: string;
  model?: string;
}

/**
 * 每个 capability 的尝试决策（成功/跳过/失败 + 原因）。
 * UI / Log Manager 用此结构展示 fallback chain 全过程。
 */
export interface MediaCapabilityModelDecision {
  type: 'provider' | 'cli';
  provider?: string;
  model?: string;
  outcome: 'success' | 'skipped' | 'failed';
  reason?: string;
}

export interface MediaCapabilityDecision {
  capability: MediaCapability;
  outcome: 'success' | 'failed' | 'skipped' | 'disabled' | 'no-attachment' | 'scope-deny';
  attachments: Array<{
    attachmentIndex: number;
    attempts: MediaCapabilityModelDecision[];
    chosen?: MediaCapabilityModelDecision;
  }>;
}

export interface MediaUnderstandingProvider {
  /** 唯一 id（与 SpeechProviderPlugin 平行命名，如 'openai'、'alibaba'、'gemini'） */
  id: string;
  /** 该 provider 支持的 capability 子集 */
  capabilities?: MediaCapability[];
  /** 默认模型（按 capability 区分） */
  defaultModels?: Partial<Record<MediaCapability, string>>;
  /** auto fallback 选优顺序（升序） */
  autoPriority?: Partial<Record<MediaCapability, number>>;
  /** 原生支持文档输入（如 PDF），跳过 OCR */
  nativeDocumentInputs?: Array<'pdf'>;

  // 各 capability 的实际执行函数。所有方法签名在本接口完整定义；某 provider 不实现某能力时直接不声明该方法即可（runner 检测到 typeof === 'undefined' 跳过该 provider，转而问下一个）
  transcribeAudio?: (req: AudioTranscriptionRequest) => Promise<AudioTranscriptionResult>;
  describeImage?: (req: ImageDescriptionRequest) => Promise<ImageDescriptionResult>;
  describeVideo?: (req: VideoDescriptionRequest) => Promise<VideoDescriptionResult>;
}

// 注：本方案的 v2.0 内置 provider（OpenAI / Alibaba / 本地 CLI 等）只实现 transcribeAudio。
// describeImage / describeVideo 的方法签名在接口里完整定义，是为了让外部 provider（包括未来由
// docs/image-generation-rearchitecture.md 落地的 image describer）可以在不修改本接口的前提下
// 按需声明实现 —— 此处不存在「留作空实现」或「stub 方法体」，未实现就是字面意义的未声明。
```

### 5.2 与对话主模型协同（关键差异）

openclaw 在 `runCapability("audio")` 里会先尝试 **当前对话使用的多模态模型**（`activeModel`），如果该模型原生支持 audio 输入（如 Gemini 2.0 Flash、GPT-4o-audio），就直接用它转写而不再走独立 STT provider。这是 xopc 当前架构没有的关键能力。

xopc 实现路径：
1. `src/agent/service.ts` 已经持有当前 agent 的 `model: ModelRef`，在调用 `transcribeFirstAudio` 时透传 `activeModel`
2. `src/media-understanding/defaults.ts` 中 `resolveAutoEntries({ activeModel, capability: 'audio' })`：
   - 若 `activeModel.provider` 在 registry 中且声明支持 `audio` capability → 优先用它
   - 否则走 `resolveKeyEntry`（按已配置的 API key 顺序）
   - 都不行再尝试本地 CLI（whisper-cli / sherpa-onnx 等）

### 5.3 OpenAI-compatible 转写客户端

绝大多数 STT 厂商（OpenAI、Groq、DeepInfra、Deepgram、本地 vLLM/llama.cpp 等）都兼容 `POST {baseUrl}/audio/transcriptions` 的 multipart 协议：

```typescript
// src/media-understanding/openai-compatible-audio.ts
export async function transcribeOpenAiCompatibleAudio(params: AudioTranscriptionRequest & {
  defaultBaseUrl: string;
  defaultModel: string;
  provider?: string;
}): Promise<AudioTranscriptionResult> {
  const fetchFn = params.fetchFn ?? fetch;
  const { baseUrl, headers, allowPrivateNetwork, dispatcherPolicy } =
    resolveProviderHttpRequestConfig({
      baseUrl: params.baseUrl,
      defaultBaseUrl: params.defaultBaseUrl,
      defaultHeaders: { authorization: `Bearer ${params.apiKey}` },
      provider: params.provider,
      capability: 'audio',
      transport: 'media-understanding',
    });

  const form = buildAudioTranscriptionFormData({
    buffer: params.buffer,
    fileName: params.fileName,
    mime: params.mime,
    fields: { model: params.model ?? params.defaultModel, language: params.language, prompt: params.prompt },
  });

  const { response, release } = await postTranscriptionRequest({
    url: `${baseUrl}/audio/transcriptions`,
    headers,
    body: form,
    timeoutMs: params.timeoutMs,
    fetchFn,
    pinDns: false,
    allowPrivateNetwork,
    dispatcherPolicy,
  });

  try {
    await assertOkOrThrowProviderError(response, 'Audio transcription failed');
    const payload = (await response.json()) as { text?: string };
    const text = requireTranscriptionText(payload.text, 'Audio transcription response missing text');
    return { text, model: params.model ?? params.defaultModel };
  } finally {
    await release();
  }
}
```

**Alibaba Paraformer 例外**：现有 `paraformer-v2` 是 DashScope 异步任务（提交 → 轮询 → 拉 JSON），不能直接用 `transcribeOpenAiCompatibleAudio`。`extensions/alibaba-speech/src/stt.ts` 自行实现 `transcribeAudio`，但同样使用 `provider-http` 底盘做请求，确保 SSRF/超时/key rotation 一致。

### 5.4 入口便捷封装（替代旧 `audioPreflightTranscribe`）

```typescript
// src/media-understanding/audio-preflight.ts
export async function transcribeFirstAudio(params: {
  ctx: MsgContext;
  cfg: Config;
  agentDir?: string;
  activeModel?: ActiveMediaModel;
}): Promise<string | undefined> {
  const audioConfig = params.cfg.tools?.media?.audio;
  if (audioConfig?.enabled === false) return undefined;

  const attachments = normalizeMediaAttachments(params.ctx);
  const firstAudio = attachments.find(a => isAudioAttachment(a) && !a.alreadyTranscribed);
  if (!firstAudio) return undefined;

  try {
    const { transcript } = await runAudioTranscription({
      ctx: params.ctx,
      cfg: params.cfg,
      attachments,
      agentDir: params.agentDir,
      activeModel: params.activeModel,
    });
    if (!transcript) return undefined;

    if (audioConfig?.echoTranscript) {
      await sendTranscriptEcho({ ctx: params.ctx, cfg: params.cfg, transcript });
    }
    firstAudio.alreadyTranscribed = true;
    return transcript;
  } catch (err) {
    log.warn({ err, phase: 'audio_preflight' }, 'Audio preflight transcription failed');
    return undefined;
  }
}
```

旧 `src/voice/stt/preflight.ts` 中的 `checkMentionInTranscription`（"at botname"/"hey botname" 模糊匹配）继续保留，但移到 `src/channels/mention-detection.ts`，与 STT 解耦。

---

## 6. HTTP 底盘（provider-http + SSRF）

> 对应 openclaw 的 `openclaw/plugin-sdk/provider-http` + `ssrf-runtime`。**所有 speech / media-understanding provider 必须经此底盘发起 HTTP**，禁止裸 `fetch()`。

### 6.1 模块边界

```
src/media/provider-http/
├── index.ts              # barrel
├── request-config.ts     # resolveProviderHttpRequestConfig
├── post-json.ts          # postJsonRequest / postTranscriptionRequest
├── ssrf.ts               # SSRF 守卫（基于 cfg.tools.web.fetch.ssrfPolicy）
├── dispatcher.ts         # undici Agent / proxy / TLS 选项
├── key-rotation.ts       # executeWithApiKeyRotation
├── errors.ts             # ProviderHttpError + assertOkOrThrowProviderError
└── __tests__/
```

### 6.2 关键 API

```typescript
// src/media/provider-http/request-config.ts
export interface ProviderHttpRequestOverrides {
  headers?: Record<string, string>;
  auth?:
    | { mode: 'provider-default' }
    | { mode: 'authorization-bearer'; token: string }
    | { mode: 'header'; headerName: string; value: string; prefix?: string };
  proxy?:
    | { mode: 'env-proxy' }
    | { mode: 'explicit-proxy'; url: string };
  tls?: {
    ca?: string; cert?: string; key?: string;
    passphrase?: string; serverName?: string; insecureSkipVerify?: boolean;
  };
  /** 仅可信的 model-provider config 可设；media config 显式拒绝 */
  allowPrivateNetwork?: boolean;
}

export interface ProviderHttpRequestConfig {
  baseUrl: string;
  headers: Record<string, string>;
  allowPrivateNetwork: boolean;
  dispatcherPolicy: DispatcherPolicy;
}

export function resolveProviderHttpRequestConfig(input: {
  baseUrl?: string;
  defaultBaseUrl: string;
  headers?: Record<string, string>;
  defaultHeaders?: Record<string, string>;
  request?: ProviderHttpRequestOverrides;
  provider?: string;
  capability: 'audio' | 'image' | 'video';
  transport: 'http' | 'media-understanding';
  allowPrivateNetwork?: boolean;
}): ProviderHttpRequestConfig;
```

### 6.3 SSRF 守卫策略

复用 xopc 现有的 `cfg.tools.web.fetch.ssrfPolicy`（已经在 `src/agent/tools/web-fetch.ts` 用过），新建 `media/provider-http/ssrf.ts` 提供：

```typescript
export type SsrfPolicy =
  | { mode: 'block-private' }              // 默认：拒绝 RFC1918 / loopback / link-local
  | { mode: 'allow-all' }                  // 仅 self-hosted 场景
  | { mode: 'allowlist'; hostnames: string[] };

export function ssrfPolicyFromHttpBaseUrlAllowedHostname(
  baseUrl: string,
  cfg: Config,
): SsrfPolicy;

export async function fetchWithSsrfGuard(
  url: string,
  init: RequestInit & { dispatcherPolicy?: DispatcherPolicy; ssrfPolicy?: SsrfPolicy },
): Promise<Response>;
```

**默认策略**：
- 公网 baseUrl（OpenAI / Azure / DashScope 等）→ `block-private`
- 同域 baseUrl（与 `cfg.gateway.publicUrl` 同 host）→ allowlist 该 hostname
- 用户在 provider config 显式设了 `request.allowPrivateNetwork: true` 才能突破

### 6.4 错误规范化

```typescript
// src/media/provider-http/errors.ts
export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly statusText: string,
    readonly body?: string,
    readonly retryable?: boolean,
  ) { super(message); }
}

export async function assertOkOrThrowProviderError(
  response: Response,
  label: string,
): Promise<void>;
```

错误分类规则（替代旧 `classifySTTError` 的字符串匹配）：

| HTTP 状态 | reason code | retryable | fallback chain 行为 |
|----------|-------------|-----------|---------------------|
| 200-299 | `success` | - | - |
| 401 / 403 | `not_configured` | false | skip + 切下一 provider |
| 429 | `rate_limited` | true | 先试 key rotation，再 fallback |
| 408 / 504 / AbortError | `timeout` | true | fallback |
| 415 | `unsupported_format` | false | fallback（其他 provider 可能支持） |
| 500-503 | `provider_error` | true | fallback |
| 其他 | `unknown` | false | fallback |

### 6.5 与 xopc 现有基础的复用

| 已有能力 | 来源 | 改动 |
|---------|------|------|
| `cfg.tools.web.fetch.ssrfPolicy` | `src/agent/tools/web-fetch.ts` | 抽离公共部分到 `src/media/provider-http/ssrf.ts` |
| `runWithLogContext` | `src/utils/logger/context.ts` | provider-http 自动透传 `requestId` 到 provider 调用 |
| `createLogger('Provider:OpenAI')` | `src/utils/logger.ts` | 每个 provider plugin 自带 `createLogger(provider.id)` |

### 6.6 Lint 强制约束

新增 ESLint 规则（`eslint.config.mjs`）：

```javascript
{
  files: ['extensions/*-speech/**/*.ts', 'src/media-understanding/**/*.ts', 'src/voice/tts/providers/**/*.ts'],
  rules: {
    'no-restricted-globals': ['error', {
      name: 'fetch',
      message: 'Use postJsonRequest / postTranscriptionRequest from @xopcai/xopc/extension-sdk/speech instead.',
    }],
  },
}
```

允许例外：本地 CLI provider（`tts-local-cli`、`whisper-cli` 等）走 `child_process.spawn`，不涉及 HTTP。

---

## 7. API Key 轮换与鉴权

> 对应 openclaw 的 `executeWithApiKeyRotation` + `collectProviderApiKeysForExecution`。

### 7.1 配置语义

`tts.providers.<id>.apiKey` 与 `models.providers.<id>.apiKey` 同时支持：

```jsonc
{
  "models": {
    "providers": {
      "openai": {
        // 单 key（向后兼容）
        "apiKey": "sk-xxx"
        // 或多 key（新）
        // "apiKey": ["sk-aaa", "sk-bbb", "sk-ccc"]
      }
    }
  },
  "messages": {
    "tts": {
      "providers": {
        "openai": {
          // tts 可独立配 key（不指定则继承 models.providers.openai.apiKey）
          "apiKey": ["sk-tts-1", "sk-tts-2"]
        }
      }
    }
  }
}
```

### 7.2 实现

```typescript
// src/media/provider-http/key-rotation.ts
export interface ApiKeyEntry {
  key: string;
  source: 'literal' | 'env' | 'profile';
  /** 上次失败的 reason code（用于跳过短期失效的 key） */
  lastFailureReason?: string;
  lastFailureAt?: number;
}

export function collectProviderApiKeysForExecution(params: {
  provider: string;
  primaryApiKey: string | string[];
  envFallback?: string;
}): ApiKeyEntry[];

export async function executeWithApiKeyRotation<T>(params: {
  provider: string;
  apiKeys: ApiKeyEntry[];
  execute: (apiKey: string) => Promise<T>;
  /** 何时切下一个 key；默认 401/403/429 切 */
  shouldRotate?: (err: ProviderHttpError) => boolean;
}): Promise<T>;
```

### 7.3 默认轮换条件

| 错误 | 行为 |
|------|------|
| `ProviderHttpError(status=401\|403)` | 标记当前 key `not_configured`，立即切下一个 |
| `ProviderHttpError(status=429)` | 标记当前 key `rate_limited`，5min 内不再尝试，切下一个 |
| `ProviderHttpError(status=500-503)` | 不切 key，由 fallback chain 切下一个 provider |
| `AbortError` / 网络错误 | 不切 key，直接抛出（避免好 key 被冤枉标记） |

### 7.4 key 健康度记忆

进程内 LRU 缓存 `keyHealthCache: Map<provider+keyHash, { lastFailureReason, lastFailureAt }>`，避免每次 fallback 都重试已知失效的 key。**不持久化到磁盘**（避免泄漏 + 重启天然刷新）。

### 7.5 与 pi-ai LLM 鉴权的关系

`@mariozechner/pi-ai` 当前是单 key（`getApiKey(providerId)`）。本方案的 key rotation **仅作用于 voice / media-understanding 链路**，不动 LLM 主链路。这是一个**明确的范围边界**，不是「待办」：

- **本方案不改 LLM key 管理**的具体原因：(1) `pi-ai` 是上游依赖，单 key 假设贯穿其内部所有 provider 适配代码，xopc 这边强行 rotation 会造成上游签名/行为不一致；(2) LLM 调用频率低于 voice（不是 quota 痛点）；(3) 本方案 3 周窗口内不引入对 `pi-ai` 的破坏式改动。
- **未来若需要 LLM key rotation**：属于独立工作项，**不在本方案范围**。该工作的入口是 `src/providers/api-keys.ts`（xopc 现状的 LLM key 解析点），需先与 `pi-ai` 上游协商接口（要么 upstream PR 让 `getApiKey` 接受 `string | string[]`，要么 xopc 包一层 `pi-ai` 适配器）。本方案 [§15.3 不涵盖范围表](#153-本方案明确不涵盖的范围)未列出此项，是因为它与 voice 重构在工程上完全解耦 —— 不做不影响本方案任何验收准则。

---

## 8. 流式 TTS（synthesizeStream）

### 8.1 调用入口与决策

```typescript
// src/voice/tts/speak-core.ts
export interface SpeakStreamOptions extends SpeakOptions {
  /** 调用方明确要求流式输出；provider 不支持时降级为 buffer 模式 */
  preferStream?: boolean;
}

export async function speak(text: string, config: TTSConfig, options?: SpeakOptions): Promise<TTSResultWithTracking>;

export async function speakStream(
  text: string,
  config: TTSConfig,
  options?: SpeakStreamOptions,
): Promise<TTSStreamResultWithTracking>;
```

`speakStream` 与 `speak` 共享 fallback chain 编排逻辑（directive parse → preprocess → summarize → resolveProviderOrder），只在 provider 调用阶段分叉：

```typescript
const provider = registry.getSpeechProvider(providerName);
if (options?.preferStream && provider.synthesizeStream) {
  return provider.synthesizeStream(req);
}
// 不支持流式 → 降级
const result = await provider.synthesize(req);
return wrapBufferAsStream(result);  // 把 Buffer 包成单 chunk 的 ReadableStream
```

### 8.2 调用方场景

| 调用方 | 场景 | 是否启用流式 |
|--------|------|--------------|
| `payload.ts` 的 `maybeApplyTtsToPayload` | outbound 消息整段发出 | ❌ 用 `speak()`（需要完整 buffer 编码 base64 / data url） |
| Telegram `DraftStreamManager` | 边生成边发送 voice draft | ✅ 用 `speakStream()` + 边收边推 chunk 给 Telegram Bot API |
| webchat SSE | 浏览器 `MediaSource` 拼接播放 | ✅ 用 `speakStream()` + SSE 推 base64 chunk |
| `tools/text_to_speech.ts` | agent 主动调工具 | ❌ 用 `speak()`（工具 result 必须是完整 buffer） |
| CLI `xopc speak <text>` | 终端播放 | ✅ 用 `speakStream()` + pipe 给 ffplay/afplay |

### 8.3 Provider 实现示范（OpenAI 兼容）

```typescript
// extensions/openai-speech/src/tts.ts (内部 helper)
async synthesizeStream(req: SpeechSynthesisRequest): Promise<SpeechSynthesisStreamResult> {
  const config = readProviderConfig(req.providerConfig);
  const apiKey = resolveApiKey({ cfg: req.cfg, providerConfig: config });
  const baseUrl = resolveBaseUrl({ cfg: req.cfg, providerConfig: config });
  const responseFormat = config.responseFormat ?? 'opus';

  // OpenAI 的 /audio/speech 本身就支持流式分块（chunked transfer）
  const { response, release } = await postJsonRequest({
    url: `${baseUrl}/audio/speech`,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: { model: config.model, input: req.text, voice: config.voice, response_format: responseFormat, stream: true },
    timeoutMs: req.timeoutMs,
    fetchFn: fetch,
  });

  await assertOkOrThrowProviderError(response, 'OpenAI TTS streaming failed');
  if (!response.body) throw new Error('OpenAI TTS returned no body');

  return {
    audioStream: response.body,                      // ReadableStream<Uint8Array>
    outputFormat: responseFormat,
    fileExtension: `.${responseFormat}`,
    voiceCompatible: ['opus', 'mp3'].includes(responseFormat),
    release,                                          // 必须在 stream 消费完后调用
  };
}
```

### 8.4 不支持流式的 provider 行为

| Provider | `synthesizeStream` 实现 | 备注 |
|----------|------------------------|------|
| `openai` | ✅ 原生支持 | OpenAI `/audio/speech` chunked |
| `alibaba` (qwen-tts) | ❌ v2.0 不实现 | 自动降级为单 chunk 模拟流，明确边界见 §8.4.1 |
| `minimax` | ✅ 原生 SSE | `T2A_v2/stream` 端点 |
| `edge` | ❌ 不实现 | `node-edge-tts` 写文件再读，无流式 API |
| `azure-speech` | ✅ 原生 chunked | Azure REST `cognitive-services/speech` |
| `tts-local-cli` | ⚠️ 可选 | 用户命令支持 stdout 流 → 转发；否则降级 |

`speak-core.ts` 的降级策略保证 caller 总能拿到 `ReadableStream`，即使是单 chunk 模拟流。

### 8.4.1 Alibaba 流式 TTS 的明确边界

- **v2.0 行为**：`alibaba` provider **不实现** `synthesizeStream` 方法（`SpeechProviderPlugin.synthesizeStream` 是 optional `?:`，未实现即代表不支持）。`speak-core.speakStream()` 检测到 `provider.synthesizeStream === undefined` 时，**自动调用 `provider.synthesize()` 拿完整 buffer，再用 `wrapBufferAsStream()` 包装成单 chunk `ReadableStream` 返回**（见 §8.1 的降级分支）。caller 拿到的 stream 形态与原生流式一致，只是 `firstByteMs ≈ durationMs`（监控可识别此模式）。
- **不做原生流式的具体原因**：阿里 DashScope qwen-tts 的流式协议是 WebSocket（`wss://dashscope.aliyuncs.com/api-ws/v1/inference`），需引入 `ws` 依赖、实现握手 / 心跳 / 二进制帧解析 / 错误码映射四个独立链路。本方案的 3 周时间盒已被迭代 1（底盘）+ 迭代 2（4 家 TTS+2 家 STT 迁移、本地 CLI、流式入口）+ 迭代 3（schema v2、迁移工具、Web UI）排满（详见 [§13 分阶段迁移路径](#13-分阶段迁移路径)），无空余 capacity 容纳额外的 WebSocket 客户端实现。**这是显式排除项，不是 "待补"**。
- **如何启用原生流式**：单独发起一个 v2.x 子方案 `docs/voice-alibaba-streaming.md`，落地步骤为：(1) 在 `extensions/alibaba-speech/` 内新增 `qwen-tts-stream.ts` 实现 WebSocket 客户端；(2) 给 `alibaba` provider 添加 `synthesizeStream` 方法；(3) 升级 patch 版本（`2.x.y` → `2.x.y+1`），**用户配置不变**、对外行为仅是「首字节延迟变小」，无需迁移。
- **用户视角的影响**：v2.0 alibaba provider 在 telegram partial mode 下仍可用，只是不分块流式发送（与 v1.x 行为一致），**没有功能退化**。

### 8.5 流式状态追踪

`TTSStreamResultWithTracking` 不再暴露 `audio: Buffer`，但保留 `attempts[]` / `fallbackFrom` 等元数据。stream 消费过程通过 `release()` 回调 + `status-tracker.ts` 上报：

```typescript
const result = await speakStream(text, config, { preferStream: true });
const reader = result.audioStream.getReader();
let totalBytes = 0;
try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    await sendChunkToClient(value);
  }
  recordTtsSuccess({
    provider: result.provider,           // 实际命中的 provider id（fallback 后可能 ≠ 配置的 default）
    model: result.model,                 // 实际命中的 model id
    voice: result.voice,                 // 实际使用的 voice
    outputFormat: result.outputFormat,   // 实际输出格式（'opus' | 'mp3' | ...）
    audioBytes: totalBytes,              // stream 累计字节数（替代 buffer 模式的 audioBuffer.length）
    durationMs: Date.now() - startedAt,  // 端到端耗时（首字节到最后一字节）
    firstByteMs: firstByteAt - startedAt, // 流式特有：首字节延迟（监控 SLA）
    attempts: result.attempts,           // openclaw MediaUnderstandingDecision 同形态：每次 fallback 的 outcome
    fallbackFrom: result.fallbackFrom,   // 若发生 fallback，记录原 provider id
    streamMode: 'stream',                // 区分 'buffer' / 'stream'，便于按模式切片统计
  });
} finally {
  await result.release?.();
}
```

---

## 9. 本地 CLI Provider

> 对应 openclaw 的 `runCliEntry`（STT 自动探测 `whisper-cli/whisper/sherpa-onnx/parakeet-mlx`）+ `extensions/tts-local-cli/`（用户自定义 TTS 命令）。

### 9.1 STT：自动探测本地二进制

`src/media-understanding/defaults.ts` 的 `resolveLocalAudioEntry`：

```typescript
export async function resolveLocalAudioEntry(): Promise<MediaModelEntryConfig | null> {
  // 优先级：sherpa-onnx > whisper-cli (whisper.cpp) > whisper (官方 python)
  const sherpa = await resolveSherpaOnnxEntry();
  if (sherpa) return sherpa;
  const whisperCpp = await resolveLocalWhisperCppEntry();
  if (whisperCpp) return whisperCpp;
  return await resolveLocalWhisperEntry();
}

async function resolveLocalWhisperCppEntry(): Promise<MediaModelEntryConfig | null> {
  if (!(await hasBinary('whisper-cli'))) return null;
  const envModel = process.env.WHISPER_CPP_MODEL?.trim();
  const defaultModel = '/opt/homebrew/share/whisper-cpp/for-tests-ggml-tiny.bin';
  const modelPath = envModel && (await fileExists(envModel)) ? envModel : defaultModel;
  if (!(await fileExists(modelPath))) return null;
  return {
    type: 'cli',
    command: 'whisper-cli',
    args: ['-m', modelPath, '-otxt', '-of', '{{OutputBase}}', '-np', '-nt', '{{MediaPath}}'],
  };
}
```

### 9.2 STT：CLI 执行链路（`runCliEntry`）

```typescript
// src/media-understanding/runner.entries.ts
async function runCliEntry(params: {
  capability: 'audio';
  entry: MediaModelEntryConfig;             // { type: 'cli', command, args }
  cfg: Config;
  ctx: MsgContext;
  attachmentIndex: number;
  cache: MediaAttachmentCache;
}): Promise<MediaUnderstandingOutput | null> {
  // 1) 取附件本地路径（远程 URL 自动下载到临时目录）
  const pathResult = await params.cache.getPath({ attachmentIndex, maxBytes, timeoutMs });
  // 2) whisper-cli 强制要求 wav 16kHz 单声道，自动用 ffmpeg 转码
  const mediaPath = await resolveCliMediaPath({
    capability: 'audio', command: entry.command,
    mediaPath: pathResult.path, outputDir,
  });
  // 3) 模板替换：{{MediaPath}} / {{MediaDir}} / {{OutputDir}} / {{OutputBase}} / {{Prompt}} / {{Language}}
  const argv = [entry.command, ...entry.args].map((part, i) =>
    i === 0 ? part : applyTemplate(part, templateCtx),
  );
  // 4) spawn 执行 + 超时
  const { stdout } = await runExec(argv[0], argv.slice(1), { timeoutMs, maxBuffer });
  // 5) 输出解析：whisper-cli 写 .txt 文件 / sherpa-onnx 解析 stdout / gemini cli 解析 JSON
  const text = await resolveCliOutput({ command, args, stdout, mediaPath });
  return { kind: 'audio.transcription', attachmentIndex, text, provider: 'cli', model: command };
}
```

### 9.3 TTS：通用本地 CLI Provider（`extensions/tts-local-cli/`）

用户在配置里写自定义命令模板，无需改代码：

```jsonc
{
  "messages": {
    "tts": {
      "providers": {
        "tts-local-cli": {
          // 必填：可执行命令 + 参数模板
          "command": "say",                                       // macOS 自带
          "args": ["-v", "Tingting", "-o", "{{OutputPath}}.aiff", "{{Text}}"],
          "outputFormat": "aiff",
          "timeoutMs": 30000,
          // 或 piper TTS：
          // "command": "piper",
          // "args": ["--model", "/opt/piper/zh-CN.onnx", "--output_file", "{{OutputPath}}.wav"],
          // "outputFormat": "wav"
        }
      }
    }
  }
}
```

实现要点（`extensions/tts-local-cli/src/speech-provider.ts`）：

```typescript
export const ttsLocalCliProvider: SpeechProviderPlugin = {
  id: 'tts-local-cli',
  label: 'Local CLI TTS',
  autoSelectOrder: 90,                                            // 仅在所有云端 provider 不可用时兜底
  resolveConfig: ({ rawConfig }) => normalizeCliConfig(rawConfig),
  isConfigured: ({ providerConfig }) => Boolean(providerConfig.command),
  async synthesize(req) {
    const config = readCliConfig(req.providerConfig);
    const tempDir = await mkdtemp(path.join(resolvePreferredOpenClawTmpDir(), 'xopc-tts-cli-'));
    const outputBase = path.join(tempDir, `out-${Date.now()}`);
    try {
      const argv = applyArgsTemplate(config.args ?? [], { Text: req.text, OutputPath: outputBase, OutputDir: tempDir });
      // 文本可能含 shell 危险字符 → 永不 shell:true，永远走 spawn(cmd, args[])
      await runExec(config.command, argv, { timeoutMs: req.timeoutMs, cwd: config.cwd, env: config.env });
      // 扫描 outputDir 找生成的音频文件
      const audioPath = await findGeneratedAudio(tempDir, outputBase, config.outputFormat);
      const audioBuffer = await readFile(audioPath);
      return {
        audioBuffer,
        outputFormat: config.outputFormat ?? 'mp3',
        fileExtension: `.${config.outputFormat ?? 'mp3'}`,
        voiceCompatible: ['mp3', 'opus', 'ogg'].includes(config.outputFormat ?? 'mp3'),
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
  async synthesizeStream(req) {
    // 可选：command 设了 stdoutStream:true 则把进程 stdout 包成 ReadableStream
    // 否则不实现，由 speak-core.ts 降级为 buffer 模式
  },
};
```

### 9.4 安全约束

| 约束 | 实现 |
|------|------|
| 永不 `shell: true` | `spawn(command, args[])` 直接传 argv 数组，避免命令注入 |
| 文本模板转义 | `{{Text}}` 替换前对 `\0` / 控制字符做白名单过滤；超过 100KB 文本拒绝 |
| 临时文件隔离 | 用 `mkdtemp` 创建独立目录，调用 `writeExternalFileWithinRoot` 强制写入限制在该目录内 |
| 命令白名单（可选） | `cfg.security.allowedCliCommands: string[]`，未列入则拒绝执行（默认未启用） |
| 输出大小上限 | `runExec` 的 `maxBuffer` 限制 stdout，防止恶意命令撑爆内存 |

### 9.5 与 OS 集成的快捷示例

| 平台 | 命令 | 备注 |
|------|------|------|
| macOS | `say -v Tingting -o {{OutputPath}}.aiff {{Text}}` | 系统自带，0 配置 |
| Linux | `espeak-ng -v zh -w {{OutputPath}}.wav {{Text}}` | apt install espeak-ng |
| 跨平台 | `piper --model zh-CN.onnx --output_file {{OutputPath}}.wav` | rhasspy/piper，神经 TTS |
| 跨平台 STT | `whisper-cli -m ggml-medium.bin -otxt -of {{OutputBase}} {{MediaPath}}` | whisper.cpp |
| GPU STT | `sherpa-onnx-offline --tokens=... --encoder=... {{MediaPath}}` | 中文识别效果优 |

---

## 10. Directive 自治（[[tts:xxx=yyy]]）

> 对应 openclaw 的 `parseTtsDirectives` + 每个 provider 的 `parseDirectiveToken`。**关键变化**：删除 `src/voice/tts/directives.ts` 中硬编码的 `case 'openai_voice'` 等分支，改成委派给 provider 自治。

### 10.1 总入口（`src/voice/tts/directives.ts` 改造后）

```typescript
import { listSpeechProviders } from './provider-registry.js';
import type { SpeechModelOverridePolicy, SpeechProviderPlugin } from './provider-types.js';

export interface TtsDirectiveOverrides {
  ttsText?: string;
  provider?: string;
  /** 按 provider id 索引的覆盖参数 */
  providerOverrides?: Record<string, Record<string, unknown>>;
}

export interface TtsDirectiveParseResult {
  cleanedText: string;
  ttsText?: string;
  hasDirective: boolean;
  overrides: TtsDirectiveOverrides;
  warnings: string[];
}

export function parseTtsDirectives(
  text: string,
  policy: SpeechModelOverridePolicy,
  options?: {
    cfg?: Config;
    providers?: readonly SpeechProviderPlugin[];
    providerConfigs?: Record<string, Record<string, unknown>>;
    preferredProviderId?: string;
  },
): TtsDirectiveParseResult;
```

### 10.2 解析流程

```
text 输入
   │
   ▼ [[tts:text]]...[[/tts:text]] 块匹配 → overrides.ttsText（替代播报文本）
   │
   ▼ [[tts]]...[[/tts]] 显式播报块 → overrides.ttsText
   │
   ▼ [[tts:provider=xx voice=yy model=zz]] 单行指令
       │
       ├── 1. 先抽 provider= → declaredProviderId
       ├── 2. 决定 directiveProviders（指定了就只问那一家，否则按 autoSelectOrder 全问）
       └── 3. 对每个 token 委派 provider.parseDirectiveToken({ key, value, policy })
              ├── 第一个 handled:true 的 provider 接管
              └── 否则 warnings.push(`unsupported ${declared} key "${key}"`)
   │
   ▼ [[tts]] 裸 tag → 仅标记 hasDirective:true，不改 overrides
   │
   ▼ [[/tts]] 闭合 tag → 同上
   │
   ▼ 所有匹配区域被替换为空（除显式播报块替换为可见文本）
   │
   ▼ 输出 cleanedText（用于显示）+ ttsText（用于合成）
```

### 10.3 Markdown code block 防护

openclaw 的关键设计：在 markdown 代码块（``` / ~~~ / 4 空格 / 行内 `code`）**内部** 不解析指令。原因：用户/模型粘贴 `[[tts:voice=alloy]]` 到代码示例里时不应触发实际的 TTS 行为。

```typescript
// src/voice/tts/directives.ts
function collectMarkdownCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  ranges.push(...matchAll(text, /```[\s\S]*?```/g));
  ranges.push(...matchAll(text, /~~~[\s\S]*?~~~/g));
  ranges.push(...matchAll(text, /^(?: {4}|\t).*$/gm));
  ranges.push(...matchAll(text, /`+[^`\n]*`+/g));
  return ranges.toSorted((a, b) => a.start - b.start);
}

function replaceOutsideMarkdownCode(text, regex, replace) {
  const codeRanges = collectMarkdownCodeRanges(text);
  return text.replace(regex, (match, ...args) => {
    const offset = args.at(-2);
    if (typeof offset === 'number' && isInsideRange(offset, codeRanges)) return match;
    return replace(match, args.slice(0, -2));
  });
}
```

### 10.4 流式 cleaner

LLM 流式输出时，`[[tts:text]]...[[/tts:text]]` 可能跨多个 chunk 到达。`createTtsDirectiveTextStreamCleaner()` 在边收边发的同时剥离这些 hidden 标签：

```typescript
export interface TtsDirectiveTextStreamCleaner {
  push(text: string): string;       // 输入 chunk → 输出可显示部分（hidden 块吞掉）
  flush(): string;                  // 流结束时 flush pending buffer
  hasBufferedDirectiveText(): boolean;
}
```

**用法**（Telegram draft streaming + webchat SSE 共用）：

```typescript
const cleaner = createTtsDirectiveTextStreamCleaner();
for await (const chunk of llmStream) {
  const visible = cleaner.push(chunk.text);
  if (visible) await sendChunkToClient(visible);
}
const tail = cleaner.flush();
if (tail) await sendChunkToClient(tail);
```

### 10.5 Provider 自治示范

每家 provider 在 `parseDirectiveToken` 里只处理自己的语义：

```typescript
// extensions/openai-speech/src/tts.ts (createOpenAiCompatibleSpeechProvider 内置)
parseDirectiveToken: (ctx) => {
  switch (ctx.key) {
    case 'voice': case 'voice_id': case 'voiceid':
    case 'openai_voice': case 'openaivoice':
      if (!ctx.policy.allowVoice) return { handled: true };
      return { handled: true, overrides: { voice: ctx.value } };
    case 'model': case 'model_id': case 'modelid':
    case 'openai_model': case 'openaimodel':
      if (!ctx.policy.allowModelId) return { handled: true };
      return { handled: true, overrides: { model: ctx.value } };
    case 'speed':
      if (!ctx.policy.allowVoiceSettings) return { handled: true };
      const speed = parseFloat(ctx.value);
      if (isFinite(speed) && speed >= 0.25 && speed <= 4.0) {
        return { handled: true, overrides: { speed } };
      }
      return { handled: true, warnings: [`Invalid speed "${ctx.value}" (must be 0.25-4.0)`] };
    default:
      return { handled: false };
  }
},
```

```typescript
// extensions/elevenlabs-speech/src/tts.ts
parseDirectiveToken: (ctx) => {
  switch (ctx.key) {
    case 'stability':
      if (!ctx.policy.allowVoiceSettings) return { handled: true };
      return { handled: true, overrides: { voiceSettings: { ...ctx.currentOverrides?.voiceSettings, stability: parseFloat(ctx.value) } } };
    case 'similarity': case 'similarityboost': case 'similarity_boost': {
      if (!ctx.policy.allowVoiceSettings) return { handled: true };
      const value = parseFloat(ctx.value);
      if (!isFinite(value)) return { handled: true, warnings: ['invalid similarityBoost'] };
      requireInRange(value, 0, 1, 'similarityBoost');
      return { handled: true, overrides: mergeVoiceSettingsOverride(ctx, { similarityBoost: value }) };
    }
    case 'style': {
      if (!ctx.policy.allowVoiceSettings) return { handled: true };
      const value = parseFloat(ctx.value);
      if (!isFinite(value)) return { handled: true, warnings: ['invalid style'] };
      requireInRange(value, 0, 1, 'style');
      return { handled: true, overrides: mergeVoiceSettingsOverride(ctx, { style: value }) };
    }
    case 'speed': {
      if (!ctx.policy.allowVoiceSettings) return { handled: true };
      const value = parseFloat(ctx.value);
      if (!isFinite(value)) return { handled: true, warnings: ['invalid speed'] };
      requireInRange(value, 0.5, 2, 'speed');
      return { handled: true, overrides: mergeVoiceSettingsOverride(ctx, { speed: value }) };
    }
    case 'speakerboost': case 'speaker_boost':
    case 'usespeakerboost': case 'use_speaker_boost': {
      if (!ctx.policy.allowVoiceSettings) return { handled: true };
      const value = parseBooleanValue(ctx.value);
      if (value == null) return { handled: true, warnings: ['invalid useSpeakerBoost'] };
      return { handled: true, overrides: mergeVoiceSettingsOverride(ctx, { useSpeakerBoost: value }) };
    }
    case 'normalize':
    case 'applytextnormalization': case 'apply_text_normalization':
      if (!ctx.policy.allowNormalization) return { handled: true };
      return {
        handled: true,
        overrides: { ...ctx.currentOverrides, applyTextNormalization: normalizeApplyTextNormalization(ctx.value) },
      };
    case 'language': case 'languagecode': case 'language_code':
      if (!ctx.policy.allowNormalization) return { handled: true };
      return {
        handled: true,
        overrides: { ...ctx.currentOverrides, languageCode: normalizeLanguageCode(ctx.value) },
      };
    case 'seed':
      if (!ctx.policy.allowSeed) return { handled: true };
      return {
        handled: true,
        overrides: { ...ctx.currentOverrides, seed: normalizeSeed(parseInt(ctx.value, 10)) },
      };
    default:
      return { handled: false };
  }
},
```

> **完整源码参考**：上述 ElevenLabs `parseDirectiveToken` 完整覆盖了 `voice / voiceId / elevenlabs_voice / elevenlabsvoice / model / modelId / elevenlabs_model / elevenlabsmodel / stability / similarity / similarityboost / similarity_boost / style / speed / speakerboost / speaker_boost / usespeakerboost / use_speaker_boost / normalize / applytextnormalization / apply_text_normalization / language / languagecode / language_code / seed` 共 21 个 token alias，1:1 对应 `openclaw/extensions/elevenlabs/speech-provider.ts` 的 200-330 行（见[附录 A](#附录-aopenclaw-关键文件索引)）。`mergeVoiceSettingsOverride` / `parseBooleanValue` / `requireInRange` / `normalizeApplyTextNormalization` / `normalizeLanguageCode` / `normalizeSeed` 是 `extensions/sdk/speech.ts` 的内置 helper（迁自 openclaw `plugin-sdk/speech`）。

### 10.6 与现状的破坏性差异

| 现状 | 改造后 |
|------|--------|
| `[[tts:openai_voice=alloy]]` 在 directives.ts 硬编码识别 | 委派给 `openai` provider 的 `parseDirectiveToken` |
| 加新 provider 必须改 `directives.ts` 的 switch case | 完全不动主仓代码 |
| 不区分 markdown code block | 代码块内 `[[tts:...]]` 不再误触发 |
| 无流式 cleaner（整段才能剥离） | 流式 cleaner 边发边剥 |

---

## 11. 插件 Registry 与发现

### 11.1 双 registry 设计

| Registry | 文件 | 内容 |
|----------|------|------|
| **SpeechProviderRegistry** | `src/voice/tts/provider-registry.ts` | TTS 插件 — `SpeechProviderPlugin` 列表 |
| **MediaUnderstandingRegistry** | `src/media-understanding/provider-registry.ts` | STT/图/视频插件 — `MediaUnderstandingProvider` 列表 |

两者完全平行，因为 STT 与 TTS 的契约形态不一样（前者要返回 text，后者要返回 audio buffer），且 STT 复用了图像理解的多模态框架。

### 11.2 静态注册（bundled）

参考 xopc 现有 `src/generated/bundled-channel-plugins.ts` 的模式：

```typescript
// src/generated/bundled-speech-providers.ts （由 pnpm run generate:bundled-speech 生成）
import openaiSpeech from '../../extensions/openai-speech/src/index.js';
import alibabaSpeech from '../../extensions/alibaba-speech/src/index.js';
import minimaxSpeech from '../../extensions/minimax-speech/src/index.js';
import edgeSpeech from '../../extensions/edge-speech/src/index.js';
import ttsLocalCli from '../../extensions/tts-local-cli/src/index.js';

export const BUNDLED_SPEECH_EXTENSIONS = [
  openaiSpeech, alibabaSpeech, minimaxSpeech, edgeSpeech, ttsLocalCli,
];
```

生成脚本（新增 `scripts/generate-bundled-speech.mjs`）：

```javascript
// 扫描 extensions/*-speech/package.json + extensions/tts-local-cli/package.json
// 输出 src/generated/bundled-speech-providers.ts
// 同时校验：每个 extension 必须 default export defineSpeechExtensionEntry({...}) 的结果
```

### 11.3 Registry 实现

```typescript
// src/voice/tts/provider-registry.ts
import type { Config } from '../../config/schema.js';
import { BUNDLED_SPEECH_EXTENSIONS } from '../../generated/bundled-speech-providers.js';
import type { SpeechProviderPlugin } from './provider-types.js';

export interface SpeechExtensionEntry {
  id: string;                                      // '@xopc/openai-speech'
  speechProviders?: SpeechProviderPlugin[];
  mediaUnderstandingProviders?: MediaUnderstandingProvider[];
}

export function defineSpeechExtensionEntry(entry: SpeechExtensionEntry): SpeechExtensionEntry {
  // 校验：id 唯一、每个 plugin 都有 id 和 synthesize 等
  return entry;
}

let cachedRegistry: SpeechProviderRegistry | undefined;

export function getSpeechProviderRegistry(cfg?: Config): SpeechProviderRegistry {
  if (cachedRegistry) return cachedRegistry;
  const allProviders = BUNDLED_SPEECH_EXTENSIONS.flatMap(ext => ext.speechProviders ?? []);
  // 用户在 cfg.extensions 里禁用某些（如 disable: ['edge']）
  const enabled = filterEnabled(allProviders, cfg);
  cachedRegistry = createRegistry(enabled);
  return cachedRegistry;
}

interface SpeechProviderRegistry {
  list(): SpeechProviderPlugin[];
  get(id: string): SpeechProviderPlugin | undefined;
  /** 按 autoSelectOrder 升序排列 + 配置可用的 provider */
  resolveAutoOrder(cfg: Config): SpeechProviderPlugin[];
}

export function listSpeechProviders(cfg?: Config): SpeechProviderPlugin[] {
  return getSpeechProviderRegistry(cfg).list();
}

export function getSpeechProvider(id: string, cfg?: Config): SpeechProviderPlugin | undefined {
  const registry = getSpeechProviderRegistry(cfg);
  // 直接 id / aliases 双匹配
  const provider = registry.get(id);
  if (provider) return provider;
  return registry.list().find(p => p.aliases?.includes(id));
}
```

### 11.4 用户自定义 Provider

用户可在 `cfg.extensions` 里挂载自己的 npm 包：

```jsonc
{
  "extensions": {
    "speechProviders": [
      "@my-company/internal-tts",                 // 内部 npm 包
      "/Users/me/dev/my-tts/dist/index.js"        // 本地路径
    ]
  }
}
```

启动时，`extension-loader.ts` 动态 `import()` 这些路径，校验导出格式后合并到 registry：

```typescript
// src/extensions/loader.ts
async function loadUserSpeechExtensions(cfg: Config): Promise<SpeechExtensionEntry[]> {
  const paths = cfg.extensions?.speechProviders ?? [];
  const entries: SpeechExtensionEntry[] = [];
  for (const p of paths) {
    try {
      const mod = await import(resolveImportPath(p));
      const entry = mod.default;
      if (!entry?.id || !Array.isArray(entry.speechProviders)) {
        log.warn({ path: p }, 'Speech extension missing required exports');
        continue;
      }
      entries.push(entry);
    } catch (err) {
      log.error({ err, path: p }, 'Failed to load user speech extension');
    }
  }
  return entries;
}
```

### 11.5 发现 API（gateway）

```typescript
// src/gateway/routes/voice.ts
GET  /api/voice/providers
     → [{ id, label, autoSelectOrder, configured: boolean, hasStream: boolean }]

GET  /api/voice/voices?provider=<id>
     → SpeechVoiceOption[]   // 调用 plugin.listVoices(req)

POST /api/voice/test-tts
     body: { provider, text, voice?, model? }
     → { audioBase64, format, durationMs }
```

Web UI（`web/src/features/settings/voice/`）调这三个端点动态渲染下拉框，不再 hardcode provider 列表。

### 11.6 与 channels registry 的对称性

| 层 | Channels | Speech / Media-Understanding |
|----|----------|------------------------------|
| 接口契约 | `ChannelPlugin` | `SpeechProviderPlugin` / `MediaUnderstandingProvider` |
| 助手函数 | `defineChannelPluginEntry` | `defineSpeechExtensionEntry` |
| Bundled 生成 | `bundled-channel-plugins.ts` | `bundled-speech-providers.ts` |
| 生成脚本 | `pnpm run generate:bundled-channels` | `pnpm run generate:bundled-speech` |
| Bundled barrel | `src/channels/plugins/bundled.ts` | `src/voice/tts/provider-registry.ts` 内联 |
| 用户扩展 | `cfg.extensions.channels` | `cfg.extensions.speechProviders` |

完全对称，便于现有团队心智迁移。

---

## 12. 配置 Schema 演进与破坏式升级

> **明确策略**：发 v2.0 major 版本，**直接更换 schema**，提供一键迁移工具，不做运行时 v1 兼容（避免代码长期背包袱）。

### 12.1 Schema 对比

#### 旧 schema (v1.x)

```jsonc
{
  "tts": {
    "enabled": true,
    "provider": "openai",                          // 字面量联合
    "trigger": "always",
    "fallback": { "enabled": true, "order": ["openai", "alibaba", "minimax", "edge"] },
    "openai":   { "apiKey": "sk-xxx", "model": "tts-1", "voice": "alloy" },
    "alibaba":  { "apiKey": "...", "model": "qwen-tts", "voice": "Cherry" },
    "edge":     { "enabled": true, "voice": "en-US-MichelleNeural" },
    "minimax":  { "apiKey": "...", "model": "speech-2.8-hd", "voice": "male-qn-qingse" },
    "maxTextLength": 512
  },
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": { "apiKey": "...", "model": "paraformer-v2" },
    "openai":  { "apiKey": "...", "model": "whisper-1" },
    "fallback": { "enabled": true, "order": ["alibaba", "openai"] }
  }
}
```

#### 新 schema (v2.0)

```jsonc
{
  "messages": {                                    // ← 新增顶层命名空间
    "tts": {
      "enabled": true,
      "auto": "always",                            // 旧 trigger 改名 auto（与 openclaw 对齐）
      "provider": "openai",                        // 仍保留默认 provider
      "fallback": { "enabled": true, "order": ["openai", "alibaba", "minimax", "edge"] },
      "maxTextLength": 512,
      "timeoutMs": 30000,
      "summarization": { "enabled": true },
      "modelOverrides": {
        "enabled": true, "allowText": true, "allowVoice": true, "allowModelId": true,
        "allowProvider": false, "allowVoiceSettings": false, "allowNormalization": false, "allowSeed": false
      },
      "providers": {                               // ← 改成 Record<string, unknown>，每家自治
        "openai":  { "apiKey": "sk-xxx", "model": "tts-1", "voice": "alloy", "responseFormat": "opus" },
        "alibaba": { "apiKey": "...", "model": "qwen-tts", "voice": "Cherry" },
        "edge":    { "voice": "en-US-MichelleNeural", "outputFormat": "audio-24khz-48kbitrate-mono-mp3" },
        "minimax": { "apiKey": "...", "model": "speech-2.8-hd", "voice": "male-qn-qingse" },
        "tts-local-cli": { "command": "say", "args": ["-v", "Tingting", "-o", "{{OutputPath}}.aiff", "{{Text}}"], "outputFormat": "aiff" }
      }
    }
  },
  "tools": {
    "media": {                                     // ← 新增（替代 stt 顶层）
      "audio": {
        "enabled": true,
        "language": "zh",                          // 可选语言提示
        "echoTranscript": false,                   // 是否把识别文本回显到 channel
        "models": [                                // ← 显式列表（覆盖 auto 策略），可省
          { "provider": "alibaba", "model": "paraformer-v2" },
          { "provider": "openai", "model": "whisper-1" }
        ],
        "providers": {                             // 覆盖 models.providers.<id> 中的字段
          "alibaba": { "apiKey": "..." }
        },
        "scope": { "channel": ["telegram", "weixin"] },     // 限定作用 channel（可选）
        "timeoutSeconds": 30,
        "deepgram": { "punctuate": true, "smartFormat": true }   // provider 特有 query
      }
      // 本方案 v2.0 仅在 tools.media 下定义 `audio` 子键。
      // 不预留 image / video 占位键 —— 引入新 capability 时按需新增（zod schema 用 .strict() 守护，避免拼写漏洞被静默吞掉）。
    }
  }
}
```

### 12.2 关键变更点

| 字段 | 旧 → 新 | 说明 |
|------|--------|------|
| `tts.trigger` | `tts.auto` 或 `messages.tts.auto` | 与 openclaw 对齐用语 |
| `tts.<provider>` | `messages.tts.providers.<id>` | 全部下沉到 `providers` 字典 |
| `stt` 顶层 | `tools.media.audio` | 与图像理解、视频理解共享 namespace |
| `stt.<provider>` | `tools.media.audio.providers.<id>` | 同上 |
| `tts.openai.apiKey` | 多 key 数组：`messages.tts.providers.openai.apiKey: ["sk-a", "sk-b"]` | API key rotation |
| `tts.edge.enabled: false` | `extensions.disabled: ['edge-speech']` | 启停粒度上沉到 extension 级 |
| - | `messages.tts.modelOverrides` | 7 字段策略，控制 directive 能改什么 |

### 12.3 zod schema 落地

```typescript
// src/config/schema.ts （v2.0 改造）
import { z } from 'zod';

const SpeechProviderConfigSchema = z.record(z.unknown());      // 每 provider 自定义字段，主仓不强校验

const MessagesTtsSchema = z.object({
  enabled: z.boolean().default(false),
  auto: z.enum(['off', 'always', 'inbound', 'tagged']).default('off'),
  provider: z.string().optional(),                              // ← 改成 string；registry 校验
  fallback: z.object({
    enabled: z.boolean().default(true),
    order: z.array(z.string()).default([]),
  }).optional(),
  maxTextLength: z.number().int().positive().default(4096),
  timeoutMs: z.number().int().positive().default(30000),
  summarization: z.object({
    enabled: z.boolean().default(true),
    targetLength: z.number().int().positive().optional(),
    threshold: z.number().int().positive().optional(),
    model: z.string().optional(),
  }).optional(),
  modelOverrides: z.object({
    enabled: z.boolean().default(true),
    allowText: z.boolean().default(true),
    allowProvider: z.boolean().default(false),
    allowVoice: z.boolean().default(true),
    allowModelId: z.boolean().default(true),
    allowVoiceSettings: z.boolean().default(false),
    allowNormalization: z.boolean().default(false),
    allowSeed: z.boolean().default(false),
  }).optional(),
  providers: z.record(SpeechProviderConfigSchema).optional(),
});

const ToolsMediaAudioSchema = z.object({
  enabled: z.boolean().default(true),
  language: z.string().optional(),
  echoTranscript: z.boolean().default(false),
  echoFormat: z.enum(['inline', 'separate']).default('separate'),
  models: z.array(z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    type: z.enum(['provider', 'cli']).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
  })).optional(),
  providers: z.record(z.unknown()).optional(),
  scope: z.object({ channel: z.array(z.string()).optional() }).optional(),
  timeoutSeconds: z.number().int().positive().optional(),
});

// v2.0 ToolsConfigSchema 在 v1 基础上新增 media 子树
const ToolsConfigSchemaV2 = ToolsConfigSchemaV1.extend({
  media: z.object({
    audio: ToolsMediaAudioSchema.optional(),
    // 仅声明 audio。未来增加 image / video 时在此处显式扩展（z.object 保持 strict，禁止隐式键名）
  }).strict().optional(),
});

// v2.0 新增的根级 messages 子树（承载 TTS 配置）
const MessagesConfigSchema = z.object({
  tts: MessagesTtsSchema.optional(),
}).strict();

// 旧版顶级 stt / tts 字段：v2.0 启动校验阶段直接 fatal exit（见 §12.4 一键迁移工具）。
// 这里用 z.never() 显式拒绝；zod parse 时若用户配置仍含这两个 key，错误信息会精确指向迁移命令
export const ConfigSchema = z.object({
  agents: AgentsConfigSchema,
  bindings: BindingsConfigSchema,
  session: SessionConfigSchema,
  channels: ChannelsConfigSchema,
  gateway: GatewayConfigSchema,
  tools: ToolsConfigSchemaV2,                       // ← 内嵌 tools.media.audio（STT 新位置）
  cron: CronConfigSchema,
  goals: GoalsConfigSchema.optional(),
  extensions: ExtensionsConfigSchema.default({}),
  modelsDev: ModelsDevConfigSchema,
  messages: MessagesConfigSchema.optional(),        // ← v2.0 新增；内嵌 messages.tts（TTS 新位置）
  update: UpdateConfigSchema,
  stt: z.never({ message: 'stt has been removed in v2.0; run `xopc voice migrate-config`' }).optional(),
  tts: z.never({ message: 'tts has been removed in v2.0; run `xopc voice migrate-config`' }).optional(),
});
```

### 12.4 一键迁移工具

```bash
$ xopc voice migrate-config

[INFO] Detected v1.x schema in ~/.xopc/xopc.json
[INFO] Backup written to ~/.xopc/xopc.json.bak.20260508
[INFO] Migrating:
  ✓ tts.trigger        → messages.tts.auto
  ✓ tts.openai.*       → messages.tts.providers.openai.*
  ✓ tts.alibaba.*      → messages.tts.providers.alibaba.*
  ✓ tts.edge.*         → messages.tts.providers.edge.*
  ✓ tts.minimax.*      → messages.tts.providers.minimax.*
  ✓ stt.alibaba.*      → tools.media.audio.providers.alibaba.* + models[]
  ✓ stt.openai.*       → tools.media.audio.providers.openai.* + models[]

[INFO] Schema validation: PASS
[INFO] Done. Restart xopc to apply.
```

实现位置：`src/cli/commands/voice.ts` 的 `migrateConfigCommand`。**幂等**（已是 v2 schema 时报 `Already migrated`，不做改动）。

### 12.5 启动时 schema 校验

```typescript
// src/config/loader.ts
const result = ConfigSchema.safeParse(rawConfig);
if (!result.success) {
  // 检测是否为 v1.x 旧 schema
  if (looksLikeV1Schema(rawConfig)) {
    console.error(`
============================================================
⚠ Detected v1.x voice configuration

xopc 2.0 changed the voice config schema. Run:

  xopc voice migrate-config

to migrate ~/.xopc/xopc.json automatically. A backup will be
written before any changes.

See docs/voice-rearchitecture.md §12 for details.
============================================================
    `);
    process.exit(1);
  }
  throw new ConfigValidationError(result.error);
}
```

### 12.6 Web UI 的破坏式提示

Settings → Voice 页面顶部 banner：检测到 v1.x 字段（`/api/config/raw` 返回 raw 后比对）时，给一键 migration 按钮 + 链接到本文档。

---

## 13. 分阶段迁移路径

整体节奏：**3 个迭代，每个迭代 ~1 周**。每个迭代结束都能合主干、能发预发版、能回滚（feature flag 控制）。中间不发布稳定版到生产，只在 v2.0.0 RC 时打破坏式标签。

### 迭代 1：底盘搭建（不影响现有功能）

**目标**：把公共底盘准备好，老代码继续跑、不动。完成后内核内置 4+2 的 provider **行为零变化**。

| 任务 | 产出 | 风险 |
|------|------|------|
| 新建 `src/voice/tts/provider-types.ts`、`src/voice/tts/registry.ts`（空 registry） | `SpeechProviderPlugin` 接口 + `SpeechProviderRegistry` 类 | 低，纯新增 |
| 新建 `src/media-understanding/{types,runner,registry,provider-registry}.ts` | `MediaUnderstandingProvider` 接口 + `MediaUnderstandingRegistry` + `runCapability` 入口 | 低，纯新增 |
| 新建 `src/media-shared/http/`：迁移 `src/voice/stt/http-utils.ts` + 补 SSRF 守卫（参考 openclaw `provider-http.ts`） | `resolveProviderHttpRequestConfig` + `assertSafeUrl` | 中，需要确认 xopc 内部其它模块对 http-utils 的引用，**保留旧 export 别名** 1 个迭代 |
| 新建 `src/media-shared/api-key-rotation.ts`：迁移自 openclaw（无业务依赖） | `executeWithApiKeyRotation` + `KeyRotationContext` | 低 |
| 新建 `extensions/sdk/speech.ts` 桥接 export | `defineSpeechProviderEntry`、`SpeechProviderPlugin` 类型从 SDK 暴露 | 低 |
| 文档：`docs/voice.md` 增加「v2 预告」chapter，告知用户 v2 即将到来 | docs 改一段 | 无 |

**Exit 准则**：

- `pnpm test` 全绿
- `pnpm run dev -- agent -i` 行为与改动前完全一致
- 新增的 registry 在启动时为空（无 provider 注册），不被任何业务路径调用

---

### 迭代 2：内置 provider 迁移到插件 + 流式 + 本地 CLI

**目标**：把现有 4 家 TTS、2 家 STT 全部改造成符合新接口的 plugin，注册到 registry。**调用方仍走旧 facade**（`tts-core.ts` / `transcribe-core.ts` 内部切换实现），外部 API 表面不变。

| 任务 | 产出 | 风险 |
|------|------|------|
| 把 `src/voice/tts/providers/openai/` 重写为 `extensions/openai-speech/speech-provider.ts`，实现 `synthesize` + `synthesizeStream` + `parseDirectiveToken` + `listVoices` | 1 个 extension package（私有 workspace） | 中，需要保留对现有 `BaseTTSProvider` 行为的等价（特别是 ffmpeg 压缩链路） |
| 同上：`alibaba`、`edge-tts`、`minimax` 各拆成 `extensions/<vendor>-speech/` | 4 个 extension package | 中，每家 directive 命名空间差异详见[附录 C](#附录-c每家-provider-directive-命名空间差异表) |
| 同上：STT 的 `openai`（whisper）、`alibaba`（paraformer）拆成 `extensions/openai-speech/` 复用包、`extensions/alibaba-speech/` 复用包（**同一 vendor 的 STT+TTS 合到同一 extension**） | 复用迭代 2 已建的 package | 低 |
| 新建 `extensions/tts-local-cli/` 与 `extensions/stt-local-cli/`（whisper-cli 自动探测） | 2 个 extension package | 中，需要在多平台跑通（mac arm64 / linux x64 至少） |
| 新建 `src/generated/bundled-speech-providers.ts`（参照 `bundled-channel-plugins.ts`）+ `pnpm run generate:bundled-speech` 脚本 | 自动生成的 import 列表 | 低 |
| 新建 `src/voice/tts/bundled.ts`、`src/media-understanding/bundled.ts`：启动时把 generated 列表注册进 registry | 启动期注入 | 低 |
| 改造 `src/voice/tts/tts-core.ts`：内部把 `payload.engine` 翻译成 registry lookup，**对外 API 不变** | facade 层改造 | 中，关键路径，需要充分测试 |
| 改造 `src/voice/stt/transcribe-core.ts`：同上，内部走 `runCapability('audioTranscription', ...)` | facade 层改造 | 中 |
| 把 `src/voice/tts/directives.ts` 改成「按 directive token 询问已注册 provider」的 dispatcher（删硬编码 case） | directives.ts 简化 50% 行数 | 中，验证清单见[附录 D](#附录-ddirective-兼容性验证清单) |
| 在 `tts-core` 增加 `synthesizeStream` 入口（仅在 channel 显式声明 `streamMode='partial'` 时启用），老路径仍走 `synthesize` | 新 API + feature flag | 中 |

**Exit 准则**：

- 所有现有用户配置（v1.x 格式）依然能跑（`tts-core` / `transcribe-core` 做兼容映射）
- `pnpm test` 全绿，新增 4 家 TTS plugin 各 1 个 contract test、2 家 STT plugin 各 1 个
- 流式 TTS 在 telegram channel partial mode 跑通（端到端手测 + 一个 e2e test）
- 本地 CLI 在 mac arm64 上能合成 + 转写一段 5 秒音频
- 移除 `src/voice/tts/providers/`、`src/voice/stt/factory.ts` 等旧目录（git rm，留一个 commit 单独评审）

---

### 迭代 3：破坏式 schema + 配置迁移工具 + 用户暴露

**目标**：把内部 facade 的兼容层扔掉，配置 schema 升到 v2，提供一键迁移 CLI。这是 **v2.0.0 的主版本切换点**。

| 任务 | 产出 | 风险 |
|------|------|------|
| `src/config/schema.ts` 新增 `messages.tts` / `tools.media.audio` 命名空间，旧 `voice.tts` / `voice.stt` 路径标记 deprecated 但解析时报错（带 migration 提示） | schema v2 落地 | 高，会真正打破老用户配置 |
| 新建 `src/cli/commands/voice-migrate-config.ts`：一键迁移老配置（详见 [§12.4](#124-用户配置一键迁移工具)） | `xopc voice migrate-config` 命令 | 中，需要覆盖所有已知 v1 字段路径 |
| 内核 facade `tts-core` / `transcribe-core` 删除 v1 字段兼容映射代码 | 删除 ~200 行 dead code | 中 |
| 启动时调用 `validateVoiceConfig`：发现旧字段直接 fatal exit + 打印迁移命令 | 启动校验 | 中 |
| Web UI（`web/src/features/settings/voice/`）：用 registry 发现接口动态渲染 provider 列表，不再硬编码 4 家 | 设置页改造 | 中，配合后端 `/api/voice/providers` |
| 后端新增 `/api/voice/providers`、`/api/voice/voices`、`/api/voice/test-synthesize`、`/api/media-understanding/providers` 路由 | gateway API | 中 |
| 文档：`docs/voice.md` 改写为 v2 用户文档，增加「从 v1 迁移」节；本方案文档移到附录引用 | docs 重写 | 低 |
| 发布 `@xopcai/xopc@2.0.0` candidate，CHANGELOG 标注 BREAKING | npm 发版 | 高，需走灰度（先 npm tag `next`） |

**Exit 准则**：

- `xopc voice migrate-config --dry-run` 能正确迁移所有内部测试配置
- 升级后启动遇到旧 schema → 明确错误信息 + 退出码 ≠ 0
- Web UI 上添加一个新 provider extension（手测 nuwa-speech 或类似）能立即在下拉框出现
- 文档更新发布到 `docs/_sidebar.md`
- 至少 1 个外部 dogfood 用户（团队内部）跑过完整迁移路径

---

### 节奏总览

```
Week 1  ┃ 迭代 1：底盘搭建            ┃ flag: voice.v2.scaffold
Week 2  ┃ 迭代 2：provider 迁移 + 流式 ┃ flag: voice.v2.useRegistry
Week 3  ┃ 迭代 3：v2 schema + CLI 工具 ┃ 无 flag，直接破坏式
────────┃─────────────────────────────┃
Week 4  ┃ Buffer / 用户反馈修复 / 文档 ┃ 发布 v2.0.0 stable
```

**Feature flag 控制**：迭代 1、2 全程通过 `XOPC_VOICE_V2=1` 环境变量切换新老链路，默认 off。迭代 3 删 flag。这样任何一个迭代都能在主干上 **零影响合并**。

---

## 14. 验收清单与测试矩阵

### 14.1 功能验收清单（功能性 DoD）

按「能力 × 维度」打勾。**所有项必须为 ✅ 才能发 v2.0.0 stable**。

| # | 验收项 | 验证方式 |
|---|--------|---------|
| F1 | 新增一个 TTS provider 只需在 `extensions/<vendor>-speech/` 写一个文件，不改内核代码 | 团队内 dogfood：用 1 小时新增一个虚构 vendor，PR diff 仅触及 extensions/ |
| F2 | 同上，新增一个 STT provider 只需实现 `MediaUnderstandingProvider.transcribeAudio` | 同上 |
| F3 | 流式 TTS：channel `streamMode='partial'` 模式下，首字节延迟 < 500ms（OpenAI 为基线） | 手测 + e2e timing log |
| F4 | 本地 whisper-cli 自动探测：在装了 whisper-cpp 的机器上，**不写任何配置**就能完成转写 | 干净环境手测 |
| F5 | 本地 TTS CLI：用户在配置里写 `command: ['piper', '-m', '...', '-o', '{output}']`，能合成出 wav | 配置驱动手测 |
| F6 | API key 轮换：配置 3 个 key、人为让前 2 个 401，能自动切到第 3 个 | mock provider unit test |
| F7 | SSRF 守卫：provider base_url 设为 `http://127.0.0.1:8080` 时，启动期校验失败 | unit test + integration test |
| F8 | Directive 自治：在 `extensions/aliyun-speech/` 里声明 `parseDirectiveToken('voice', 'longwan')`，prompt 里 `[[tts:voice=longwan]]` 能命中 | unit test + 端到端 |
| F9 | Registry 发现 API：`GET /api/voice/providers` 返回所有已注册 provider 的元信息（vendor、capabilities、voices 数量） | curl + Web UI 手测 |
| F10 | 配置迁移工具：`xopc voice migrate-config --dry-run` 能正确处理 5 个真实用户 v1 配置样本 | 内部沉淀的配置样本测试集 |
| F11 | v1 schema 启动报错：装 v2.0.0 + 旧 `xopc.json`，启动时 fatal exit 且报错信息包含迁移命令 | integration test |
| F12 | Web UI 动态渲染：手动注册一个新 provider，**无需重启** Web UI 就能在 `/settings/voice` 下拉框看到（依赖 SSE 推送 `voice.providers.changed`） | 手测 |

### 14.2 测试矩阵

#### Unit tests（vitest，与现有 `src/**/__tests__/*.test.ts` 同位置）

| 模块 | 测试覆盖点 | 估算 case 数 |
|------|-----------|------------|
| `src/voice/tts/registry.ts` | 注册、覆盖警告、查找、列举、匹配 directive | 8 |
| `src/voice/tts/directives.ts` | dispatch 到 provider、未注册 token 报错、markdown code block 防护、流式 cleaner | 12 |
| `src/media-understanding/runner.ts` | provider 链 fallback、错误分类、不支持 capability 时报错 | 6 |
| `src/media-shared/http/ssrf.ts` | 私有 IP 拒绝、IPv6、DNS rebinding、proxy 例外 | 10 |
| `src/media-shared/api-key-rotation.ts` | 401 切换、429 退避、全部失败时聚合错误 | 6 |
| `extensions/openai-speech/speech-provider.ts` | synthesize、synthesizeStream、listVoices、directive parsing | 8 |
| `extensions/alibaba-speech/speech-provider.ts` | 同上 + DashScope 异步轮询 | 10 |
| `extensions/edge-tts/speech-provider.ts` | 同上（无 key、无网络） | 6 |
| `extensions/minimax-speech/speech-provider.ts` | 同上 | 6 |
| `extensions/tts-local-cli/speech-provider.ts` | 命令模板渲染、文本转义、临时文件清理、超时 | 8 |
| `extensions/stt-local-cli/speech-provider.ts` | whisper-cli / sherpa-onnx 自动探测、stdout 解析 | 6 |
| `src/cli/commands/voice-migrate-config.ts` | 5 个 v1 配置样本 → v2 输出对比 | 5 |
| `src/config/schema.ts`（voice 部分） | v2 schema 校验、v1 字段触发 fatal | 8 |

**总计**：~99 unit cases，目标覆盖率 **核心模块 > 85%**（`src/voice/`、`src/media-understanding/`、`src/media-shared/`）。

#### Integration tests（`src/**/__tests__/*.integration.test.ts`，需打 `INTEGRATION=1` 才跑）

| 场景 | 涉及模块 | 网络/外部依赖 |
|------|---------|--------------|
| 端到端 OpenAI TTS（非流式） | tts-core + extensions/openai-speech + provider-http | 真实 OpenAI API key |
| 端到端 OpenAI TTS（流式） | 同上 + synthesizeStream pipeline | 同上 |
| 端到端 Whisper STT | runner + extensions/openai-speech + audio-preflight | 同上 |
| 端到端阿里 Paraformer-v2 | runner + extensions/alibaba-speech | DashScope API key |
| 本地 whisper-cli 转写 | extensions/stt-local-cli | 装了 whisper-cpp |
| Telegram channel partial mode + 流式 TTS | channel + tts-core + DraftStreamManager | mock telegram bot |

**CI 策略**：integration test 默认在 main 分支夜跑，PR 不强制（避免阻塞，但失败发钉钉群）。

#### E2E tests（手测 checklist，发版前过一遍）

发版前由 owner 在 mac arm64 + linux x64 各跑一遍：

1. 全新装 → 跑 `xopc agents add` → 配置 OpenAI TTS → telegram bot 收 voice 消息能播
2. 装了 v1 配置 → 启动报错 → 跑 `xopc voice migrate-config` → 能正常启动
3. Web UI `/settings/voice` 显示 provider 列表，能切换 default、test-synthesize 试听
4. 在 `extensions/` 手写一个 provider，`pnpm run build && pnpm start`，立刻在 UI 出现
5. 网络断开 → STT 走本地 whisper-cli fallback → 能转写

### 14.3 性能基线（不退化即可）

| 指标 | v1 基线 | v2 目标 |
|------|---------|---------|
| OpenAI TTS 首字节延迟（非流式） | ~800ms | ≤ v1（不允许退化）|
| OpenAI TTS 首字节延迟（流式） | N/A | < 500ms |
| Whisper STT 5s 音频转写延迟 | ~2.5s | ≤ v1 + 100ms（接口转发开销）|
| Provider 注册启动开销 | N/A | < 50ms（10 个 provider 的全量启动注册）|
| 配置 schema 校验开销 | ~5ms | < 10ms |

---

## 15. 风险、回滚与未涵盖项

### 15.1 主要风险与缓解

| # | 风险 | 影响 | 缓解措施 |
|---|------|------|---------|
| R1 | **破坏式升级激怒老用户**（v1 配置启动报错） | 升级阻力大、负反馈 | ① 提供 `xopc voice migrate-config` 一键工具；② 启动报错信息明确给出迁移命令；③ 发版前在 README + CHANGELOG 顶部置顶；④ 老版本 `1.x` 留分支至少 6 个月接受安全 patch |
| R2 | **本地 CLI 跨平台坑**（whisper-cli 在 windows 编译困难、edge-tts 依赖 python） | 部分用户用不了本地 fallback | ① v2.0 仅承诺 mac arm64 / linux x64 跑通；② windows 留 issue tracker，社区 PR；③ 文档明确「本地 CLI 是 nice-to-have，云端 provider 仍是主路径」 |
| R3 | **provider 接口设计不收敛**，迭代 2 写到一半发现接口需要再变 | 返工、延期 | ① 接口先按 openclaw 现行版本 1:1 抄过来（已工业验证）；② 迭代 1 把 4 家最复杂的 provider（OpenAI / 阿里 / Edge / MiniMax）的 contract test 先写出来跑通，验证接口够用；③ 留 `extra: Record<string, unknown>` 逃生口 |
| R4 | **流式 TTS 与现有 channel 出口冲突**（telegram draft-stream 已经有自己的字节缓冲） | partial mode 下声音断断续续 / 重复 | ① 复用 `DraftStreamManager` 的水位线机制，不另起一套；② 增加 `synthesizeStream` 的 `signal: AbortSignal` 让 channel 能取消上游；③ 集成 test 覆盖 |
| R5 | **SSRF 守卫误伤合法的内网 provider**（如自部署 whisper server） | 企业用户配置 `http://192.168.x.x` 启动失败 | ① SSRF 守卫提供 `allowPrivateNetworks: true` 配置项（per-provider）；② 默认严格、明确文档；③ 报错信息提示如何放行 |
| R6 | **Key 轮换导致计费/审计混乱**（用户分不清哪笔请求用了哪个 key） | 财务/合规问题 | ① 每次 rotation 在 log 里带 `keyHashPrefix`（不打全 key）；② Web UI 增加 per-key 用量统计页（v2.1，不阻塞 v2.0）|
| R7 | **registry 启动期循环依赖**（extension A 依赖 extension B 的工具函数） | 启动失败 | ① bundled-speech-providers.ts 由脚本生成，import 顺序固定；② extension 之间禁止互相 import（lint 规则）；③ 共享逻辑统一沉到 `src/media-shared/` |
| R8 | **directive 解析在多 provider 场景冲突**（A 和 B 都声明 handle `voice` token） | 行为未定义 | ① registry 注册时检测重复 directive token，warning + 后注册者覆盖；② 配置层允许 `directives.priority` 显式排序 |
| R9 | **测试用例对外部 API key 依赖**，CI 跑不动 integration | CI 红 / 跳过太多 | ① integration test 默认 skip，仅夜跑；② 每个 provider 维护一个 mock fixture；③ 发版前手测 e2e checklist 兜底 |
| R10 | **Web UI 改动量大**（settings/voice 整页重写） | 前端进度拖累发版 | ① 迭代 3 启动时**前后端并行**，后端 API mock 出来前端就能开工；② 万一前端没赶上 v2.0，可以留旧 UI 一周（功能能通过 CLI 用）|

### 15.2 回滚预案

**触发条件**：v2.0.0 stable 发布后 48 小时内出现：

- 任何 P0：用户配置数据损坏 / 启动 100% 失败 / 内核崩溃
- 任何 P1 集中爆发：3 个以上独立用户报告同一个 bug

**回滚步骤**：

1. **npm 层面**：把 `latest` tag 回切到 `1.x.y`（最后一个 v1 stable），同时 `2.x` 走 `next` tag 继续修复
2. **配置兼容**：v2 的 schema 改动**不会**写回到用户的 `xopc.json`（迁移工具只输出新文件，原文件不动），所以回滚 v1 时配置自动可用
3. **Electron 桌面端**：auto-updater 触发 rollback 通道（`electron/auto-updater.ts` 现有机制），用户下次启动自动降级
4. **公告**：CHANGELOG + GitHub release notes 标注「已知问题，建议暂缓升级」
5. **复盘**：48 小时内出 RCA + fix forward 计划

**保留期**：v1.x 分支至少维护 6 个月，期间只接受 security patch，不接新功能。

### 15.3 本方案明确不涵盖的范围

下面这些是 openclaw 有但 xopc v2.0 **不做** 的，记录在此避免后续同学重复讨论。如有需求请单独立项。

| 未涵盖项 | 来源 | 不做的原因 | 后续计划 |
|---------|------|----------|---------|
| **电话音合成**（`synthesizeTelephony`，G.711/G.722 编码、SIP 出口） | openclaw `src/tts/tts-core.ts` | xopc 当前没有电话/SIP channel，做了也没出口 | **触发条件**：`channels/` 下有任一电话/SIP channel 进入 `bundled.ts` 列表；**归属**：channel owner 立项 RFC `docs/voice-telephony.md`，本方案不预留 hook |
| **Persona 系统**（角色化 voice profile、多角色对话切换） | openclaw `src/persona/` | xopc 走 agents.list 多 agent 路线，每个 agent 各自配 voice 已经够用 | **触发条件**：单 agent 内需要按对话角色切换 voice 的产品需求落地；**归属**：agent 模块 owner 立项 RFC `docs/voice-persona.md`，本方案不预留 hook（现状 agents.list 已能覆盖跨 agent 场景）|
| **Realtime Voice**（OpenAI Realtime API 双工流） | openclaw `src/realtime-voice/` | 实现复杂、协议未稳定（OpenAI Beta），且需 channel 侧支持双工传输 | **触发条件**：OpenAI Realtime API GA **且** `channels/` 下至少一个 channel 支持双工 wss；**归属**：voice 模块 owner 立项 RFC `docs/voice-realtime.md`，强制新建 `src/voice/realtime/` 顶级模块（不复用本方案 `SpeechProviderPlugin` 接口，见 [§2.3](#23-范围边界明确不做的)）|
| **Voice cloning / 自定义音色训练** | openclaw `src/tts/voice-cloning/` | 涉及音频上传、训练 job 管理、跨 provider 抽象成本高 | **触发条件**：无（永不抽到公共接口）；**归属**：每个 `extensions/<vendor>-speech/` 自行在 provider 内部实现，通过 directive 暴露给用户（如 `[[tts:voice=cloned:my-voice-id]]`），主仓不感知 |
| **TTS 缓存层**（按文本 hash 缓存合成结果，省钱） | openclaw `src/tts/cache/` | 收益场景有限（用户多数文本一次性），实现要考虑磁盘 LRU + 跨 session | **触发条件**：上线后 30 天内观测到单个用户日均重复合成 ≥10 次（指标见 [§14 验收清单](#14-验收清单)的可观测性要求）；**归属**：voice 模块 owner 立项 RFC `docs/voice-cache.md` |
| **音频 SSML 解析与归一化** | openclaw `src/tts/ssml/` | 各 provider 对 SSML 支持差异巨大，统一抽象意义不大 | **触发条件**：无（永不抽到公共接口）；**归属**：每个 `extensions/<vendor>-speech/` 在 provider 的 `synthesize` 方法内自行处理 SSML 透传 / 转义 / 降级 |
| **STT diarization（说话人分离）** | openclaw `src/media-understanding/diarization/` | xopc 当前用例（语音消息转写）不需要 | **触发条件**：会议纪要 / 多人语音转写产品需求落地；**归属**：media-understanding 模块 owner 立项 RFC `docs/stt-diarization.md`，扩展 `AudioTranscriptionResult` 增加 `speakers?: SpeakerSegment[]` 字段（本方案接口已是 `?:` 可选字段就位） |
| **15+ 家 provider 全量迁移**（openclaw 现有的 ElevenLabs / Cartesia / Deepgram / Groq / Replicate / 火山 / 腾讯云 / 讯飞 / sherpa-cloud / Cloudflare Workers AI / Fish Audio / PlayHT / Azure / Vapi / Resemble / Speechify 等） | openclaw `extensions/` | xopc v2.0 只承诺现有 4+2 家迁移到新接口；社区/团队按需追加 | 接口稳定后**任何同学**都能 1 小时内移植一家 |

### 15.4 决策记录指针

本方案落地过程中如有争议，请在以下文件追加 ADR（Architecture Decision Record）：

- 接口签名变更 → `docs/adr/voice-NNN-<topic>.md`
- 配置 schema 字段命名 → 同上
- 与 `image-generation-rearchitecture.md` 共享底盘的边界讨论 → 在两份文档间互相 cross-reference

---

## 附录 A：openclaw 关键文件索引

> 路径前缀均为 `/Users/michaelxu/develop/github/openclaw/`。本节供实施期对照参考，**不要直接 copy-paste**，须按 xopc 命名/风格改写。

### A.1 TTS 核心

| 文件 | 作用 | xopc 对应位置 |
|------|------|--------------|
| `src/tts/tts.ts` | 公共入口 facade，对外暴露 `synthesize` / `synthesizeStream` / `listVoices` | `src/voice/tts/tts.ts`（重写）|
| `src/tts/tts-core.ts` | 内部调度：根据 directive + 默认配置解析 provider，调用 plugin | `src/voice/tts/tts-core.ts`（重写）|
| `src/tts/tts-types.ts` | 公共类型：`TTSPayload` / `TTSSegment` / `TTSResult` / `TTSStreamChunk` | `src/voice/tts/types.ts` |
| `src/tts/provider-types.ts` | **`SpeechProviderPlugin` 接口定义**（核心契约） | `src/voice/tts/provider-types.ts` |
| `src/tts/provider-registry.ts` | `SpeechProviderRegistry` 类 | `src/voice/tts/registry.ts` |
| `src/tts/openai-compatible-speech-provider.ts` | OpenAI 风格 HTTP 通用骨架（multipart / json + auth） | 拆到 `src/media-shared/http/openai-compatible-tts.ts` |
| `src/tts/directives.ts` | `[[tts:xxx=yyy]]` 解析 + dispatch | `src/voice/tts/directives.ts`（去硬编码版）|
| `src/tts/tts-auto-mode.ts` | `auto` 模式选 provider 的策略 | `src/voice/tts/auto-mode.ts` |
| `src/plugin-sdk/tts-runtime.ts` | 给 extension 用的 SDK helper（`defineSpeechProviderEntry` 等）| `extensions/sdk/speech.ts` |

### A.2 Media Understanding（STT 所属框架）

| 文件 | 作用 | xopc 对应位置 |
|------|------|--------------|
| `src/media-understanding/types.ts` | `MediaUnderstandingProvider` 接口 + `MediaCapability` 枚举 | `src/media-understanding/types.ts` |
| `src/media-understanding/runner.ts` | 统一入口 `runCapability(capability, input, opts)` | `src/media-understanding/runner.ts` |
| `src/media-understanding/runner.entries.ts` | 按 capability 分发到具体 runner | `src/media-understanding/runner.entries.ts` |
| `src/media-understanding/audio-transcription-runner.ts` | 音频转写专用 runner（fallback / preflight 装配） | `src/media-understanding/audio-transcription-runner.ts` |
| `src/media-understanding/audio-preflight.ts` | 音频前置：duration 探测、采样率检查、超长截断警告 | `src/media-understanding/audio-preflight.ts`（直接搬）|
| `src/media-understanding/openai-compatible-audio.ts` | OpenAI Whisper 风格 multipart 上传通用实现 | `src/media-shared/http/openai-compatible-audio.ts` |
| `src/media-understanding/provider-registry.ts` | `MediaUnderstandingRegistry` | `src/media-understanding/registry.ts` |

### A.3 公共底盘

| 文件 | 作用 | xopc 对应位置 |
|------|------|--------------|
| `src/shared/provider-http.ts` | `resolveProviderHttpRequestConfig` + SSRF 守卫 | `src/media-shared/http/provider-http.ts` |
| `src/shared/api-key-rotation.ts` | `executeWithApiKeyRotation` | `src/media-shared/api-key-rotation.ts`（直接搬）|
| `src/shared/ssrf.ts` | URL 安全校验、私有网段检测 | `src/media-shared/http/ssrf.ts` |

### A.4 Extension 实现样板（重点参考）

| Extension | 关键看点 | 移植到 xopc 时的注意点 |
|-----------|---------|----------------------|
| `extensions/openai/speech-provider.ts` | OpenAI 标准 TTS + Whisper STT，最简洁 | xopc 现有 `src/voice/tts/providers/openai/` 已成熟，迁移时**主要是接口套壳** |
| `extensions/azure-speech/speech-provider.ts` | Azure 双区域、SSML、自定义音色 | xopc 当前没有 Azure，可不做（可选）|
| `extensions/elevenlabs/speech-provider.ts` | 流式 TTS 范本（`/v1/text-to-speech/{id}/stream`）+ voice 列表分页 | **流式 TTS 实现的最佳参考**，xopc 写 OpenAI streaming 时对照 |
| `extensions/tts-local-cli/speech-provider.ts` | 本地 CLI 通用 provider（命令模板、进程管理、临时文件） | **直接照搬**到 `extensions/tts-local-cli/`（仅改 import 路径）|
| `extensions/aliyun-dashscope/speech-provider.ts` | DashScope 异步任务模式（提交 → 轮询 → 下载）+ Paraformer-v2 STT | xopc 现有 `src/voice/stt/AlibabaProvider.ts` 是同一思路，**两套合并**到一个 extension |

### A.5 文档参考

- `docs/tts.md`（openclaw）：TTS 用户文档。**本方案的 [§13 迭代 3](#迭代-3破坏式-schema--配置迁移工具--用户暴露)** 已把 `docs/voice.md` v2 重写列为强制交付物，参考此文结构。
- `docs/media-understanding.md`（openclaw）：STT/图片/视频统一文档。**本方案不交付** xopc 版同名文档（v2.0 仅落地 audio capability，写一个跨 audio/image/video 的统一文档时机未到）；待 [docs/image-generation-rearchitecture.md](./image-generation-rearchitecture.md) 落地后由该方案统一编写。
- `docs/extensions.md`（openclaw）：extension 开发者文档。**本方案的 [§13 迭代 3](#迭代-3破坏式-schema--配置迁移工具--用户暴露)** 已把"在 xopc 现有 `docs/extensions.md` 增加 speech provider 章节"列为强制交付物。

---

## 附录 B：xopc 当前可复用基础

> 列出 xopc 已经存在、可以**直接复用或最小改造**的现有模块，避免重复造轮子。路径前缀 `/Users/michaelxu/develop/github/xopc/`。

### B.1 现有可直接复用（零改动）

| 文件 / 模块 | 在新架构中的角色 |
|------------|-----------------|
| `src/voice/stt/audio-preflight.ts` | 音频前置（已实现 duration / 大小检查），迁到 `src/media-understanding/audio-preflight.ts` |
| `src/voice/tts/payload.ts` 中的 ffmpeg 压缩链路 | 抽到 `src/media-shared/audio-postprocess.ts`，给所有 TTS provider 复用 |
| `src/utils/logger.ts` + `createLogger` | 所有新 provider 直接 `createLogger('SpeechProvider:openai')` |
| `src/utils/logger/context.ts` 的 `runWithLogContext` | gateway voice API 路由复用，自动带 `requestId` |
| `src/infra/retry/` | provider HTTP 调用统一 retry 策略 |
| `src/infra/bus/` | 用于 `voice.providers.changed` 等事件广播（Web UI SSE）|
| `src/config/loader.ts` | schema v2 直接挂在现有 loader，无需改动 loader 本身 |
| `src/config/paths.ts` | 临时音频文件目录解析（`~/.xopc/cache/voice/`）|
| `src/extensions/sdk/` 桥接机制 | `defineSpeechProviderEntry` 走同一个 SDK 出口 |
| `src/channels/manager.ts` 的 `streamMode` 配置 | 流式 TTS 复用现有 `off | partial | block` 三态 |
| `src/channels/telegram/draft-stream.ts` 的 `DraftStreamManager` | 流式 TTS 在 telegram channel 的水位线/缓冲管理直接复用 |

### B.2 现有需小改造（< 1 天工作量）

| 文件 / 模块 | 现状 | 改造点 |
|------------|------|--------|
| `src/voice/stt/http-utils.ts` | 已有 base URL 解析、headers 构造，但**无 SSRF 守卫** | 加 `assertSafeUrl` 调用，挪到 `src/media-shared/http/` |
| `src/providers/index.ts` 的 `getApiKey` | 现仅支持单 key | 兼容数组形式 + 暴露 `getApiKeys(provider): string[]` 给 key rotation 用 |
| `src/voice/tts/providers/openai/index.ts` | OOP `extends BaseTTSProvider` | 改写成函数式 `defineSpeechProviderEntry({...})`，逻辑 90% 可保留 |
| `src/voice/tts/providers/alibaba/index.ts` | 同上 + DashScope 异步 | 改写 + 与 STT 的 `AlibabaProvider` 合到同一 extension |
| `src/voice/tts/directives.ts` | 硬编码 4 个 case | 改成 dispatcher，遍历 registry 找接收者（详见 [§10](#10-directive-自治tts-xxxyyy)）|
| `src/cli/commands/voice/` | 只有 `tts-test` 一个子命令 | 增加 `voice migrate-config`、`voice list-providers`、`voice list-voices` |
| `web/src/features/settings/voice/` | 硬编码 4 个下拉框选项 | 改成 SWR 拉 `/api/voice/providers`，动态渲染 |
| `src/gateway/hono/routes/` | 无 voice 专属路由 | 新增 `voice.routes.ts`（list providers / list voices / test synthesize）|

### B.3 现有需大改造或废弃

| 文件 / 模块 | 处理方式 |
|------------|---------|
| `src/voice/tts/providers/BaseTTSProvider.ts`（OOP 基类） | **废弃**，新接口走 plain object + 函数式，不再继承 |
| `src/voice/tts/factory.ts` 的 switch case | **删除**，由 registry 取代 |
| `src/voice/stt/factory.ts` 的 switch case | **删除**，由 `MediaUnderstandingRegistry` 取代 |
| `src/voice/stt/{AlibabaProvider,OpenAIProvider}.ts` | **迁移**到 `extensions/<vendor>-speech/`，原位置 git rm |
| `src/voice/tts/providers/{openai,alibaba,edge-tts,minimax}/` | **迁移** + git rm |
| `src/config/schema.ts` 中 `voice.tts` / `voice.stt` 字段 | **重命名**为 `messages.tts` / `tools.media.audio`（破坏式）|

### B.4 与其他重构方案的协同

| 联动方案 | 共享什么 | 谁先谁后 |
|---------|---------|---------|
| [docs/image-generation-rearchitecture.md](./image-generation-rearchitecture.md) | `src/media-shared/http/`、`src/media-understanding/` 框架本身（图片描述也是 capability）、Registry 抽象的设计模式 | **本方案先行**，跑通后图像方案复用 `src/media-understanding/` 改造图像描述链路 |
| `docs/extensions.md` | extension 注册机制、bundled 自动生成脚本 | 本方案直接复用现有 `bundled-channel-plugins.ts` 的 generate 模式，扩展到 speech |
| `docs/web-migration-plan.md` | Web UI `settings/voice` 整页改造 | 本方案在迭代 3 单独完成 voice 页，不阻塞主迁移 |

---

## 附录 C：每家 Provider Directive 命名空间差异表

> 本表覆盖 v2.0 内置的 4 家 TTS provider，列出**所有** directive token alias 与对应的 provider 内部字段，作为迁移时 1:1 校对清单。来源：xopc 现状 `src/voice/tts/directives.ts`（行 60-128）+ openclaw 各 provider 的 `parseDirectiveToken`（`extensions/openai/`、`extensions/alibaba-dashscope/`、`extensions/minimax/`、`extensions/azure-speech/`）。

### C.1 Token alias 对照矩阵

| Directive token alias | `openai` | `alibaba` | `minimax` | `edge` | `azure-speech`（v2.0 不内置）|
|----------------------|---------|----------|----------|--------|---------|
| `voice` / `voiceid` / `voice_id` | → `voice` | → `voice` | → `voiceId` | → `voice` | → `voice` |
| `<vendor>_voice` / `<vendor>voice` | `openai_voice` `openaivoice` | `alibaba_voice` `alibabavoice` | `minimax_voice` `minimaxvoice` | `edge_voice` `edgevoice` | `azure_voice` `azurevoice` `azure_speech_voice` |
| `model` / `modelid` / `model_id` | → `model` | → `model` | → `model` | ❌ 不支持 | ❌ 不支持 |
| `<vendor>_model` / `<vendor>model` | `openai_model` `openaimodel` | `alibaba_model` `alibabamodel` | `minimax_model` `minimaxmodel` | ❌ | ❌ |
| `speed` | → `speed` (0.25-4.0) | → `speed`（DashScope 不支持，warning）| → `speed` (0.5-2.0) | → `rate`（字符串：`-15%`）| ❌ |
| `rate` | ❌ | ❌ | ❌ | → `rate`（字符串）| ❌ |
| `vol` / `volume` | ❌ | ❌ | → `vol` (0-10) | → `volume`（字符串：`+0%`）| ❌ |
| `pitch` | ❌ | ❌ | → `pitch` (-12 to 12) | → `pitch`（字符串：`+0Hz`）| ❌ |
| `lang` / `language` / `languagecode` / `language_code` | ❌ | ❌ | ❌ | → `lang` | → `lang` (`azure_lang` `azure_language`) |
| `output_format` / `outputformat` | → `responseFormat` | ❌ | ❌ | → `outputFormat` | → `outputFormat` (`azure_format` `azure_output_format`) |

### C.2 命名规则统一约定（迁移后必须遵守）

每个 provider 的 `parseDirectiveToken` **必须**支持以下 4 种命名形态（与 openclaw 工厂的 `parseDirectiveToken` 行为对齐）：

1. **通用形态**：`voice`、`voiceid`、`voice_id`、`model`、`modelid`、`model_id`
2. **下划线带 vendor 前缀**：`<vendor>_voice`、`<vendor>_model`（如 `openai_voice`）
3. **紧凑形态**：`<vendor>voice`、`<vendor>model`（如 `openaivoice`，`<vendor>` 取 `id` 字段去除非字母数字字符后小写）
4. **provider 自有字段**：必须用 vendor 前缀避免冲突（如 `minimax_vol`、`azure_lang`）

### C.3 优先级与冲突解决

- registry 注册时**禁止**两个 provider 同时声明同一个无前缀 token（例如 `voice`），但允许多个 provider 都声明 `voice`，因为 directive 解析阶段已通过 `[[tts:provider=xx ...]]` 显式选定 provider。
- 当 directive 未指定 provider（`[[tts:voice=alloy]]`）时，按 `autoSelectOrder` 升序问到第一个 `handled:true` 即停（详见 §10.2 的解析流程）。
- 任何 provider 在 `parseDirectiveToken` 返回 `handled:true` + `warnings:[...]` 时，warnings 会聚合到 `TtsDirectiveParseResult.warnings` 上抛给调用方，不抛异常。

---

## 附录 D：Directive 兼容性验证清单

> 迭代 2 把 `directives.ts` 从硬编码 switch case 改造成「问 provider」的 dispatcher 时，必须**逐家 provider 跑完以下清单**才能合并。每条清单项对应一个 vitest 用例（建议放在 `extensions/<vendor>-speech/__tests__/directives.test.ts`）。

### D.1 Per-Provider 验证矩阵（每家都要过的 8 条）

| # | 验证项 | 输入 | 期望输出 | 失败处理 |
|---|--------|------|---------|---------|
| D1 | 通用 voice token 命中 | `[[tts:voice=<provider 默认 voice>]]hello` | `overrides.voice = '<voice>'`，`cleanedText = 'hello'` | 不命中 → 改 provider id 不一致 |
| D2 | vendor-prefixed voice 命中 | `[[tts:<vendor>_voice=xxx]]` | 同 D1 | 不命中 → 检查 token alias 是否齐全 |
| D3 | 紧凑 voice 命中 | `[[tts:<vendor>voice=xxx]]` | 同 D1 | 不命中 → vendor compact 形态丢失 |
| D4 | 未声明 token 返回 `handled:false` | `[[tts:bogus_key=xxx]]` | warnings 含 `unsupported "bogus_key"` | 命中 → provider 越权处理 |
| D5 | policy 关闭时静默吞掉 | `policy.allowVoice=false` + `[[tts:voice=xxx]]` | `handled:true`、`overrides` 不变更 | overrides 被改 → policy 未生效 |
| D6 | 数值越界返回 warnings | `[[tts:speed=99]]` | `warnings` 非空 + `overrides` 不变 | 静默接受 → 边界校验缺失 |
| D7 | code block 内不解析 | <code>\`\`\`<br>[[tts:voice=xxx]]<br>\`\`\`</code> | `overrides` 不变 + `cleanedText` 保留原文 | 解析了 → markdown 防护失效 |
| D8 | 流式 cleaner 跨 chunk 拼接 | 把 `[[tts:text]]hidden[[/tts:text]]` 切成 3 段 push | 全部 `visible` 拼接后不含 hidden | 包含 hidden → cleaner buffer 逻辑错 |

### D.2 Cross-Provider 验证矩阵（registry 层 5 条）

| # | 验证项 | 期望 |
|---|--------|------|
| C1 | 显式 provider 指定时只问该家 | `[[tts:provider=alibaba voice=xxx]]` 不会路由到 openai |
| C2 | 未指定 provider 时按 autoSelectOrder 排序 | `openai`(10) → `azure`(30) → `minimax`(40) → `edge`(80) → `tts-local-cli`(90) |
| C3 | 第一个 `handled:true` 短路 | provider A handled 后不再询问 B/C |
| C4 | 未注册的 provider id 静默忽略 + warning | `[[tts:provider=不存在]]` 走 fallback chain，不抛 |
| C5 | 多 provider 都声明 `voice` 时按 prefix 优先 | `[[tts:openai_voice=xx]]` 必命中 openai，不会被 alibaba 抢先 |

### D.3 与 v1 行为的回归用例（必跑）

| # | v1 行为 | v2 必须等价 |
|---|--------|------------|
| R1 | `[[tts:openai_voice=alloy model=tts-1-hd]]` | overrides = `{ voice: 'alloy', model: 'tts-1-hd' }` |
| R2 | `[[tts:alibaba_voice=Cherry alibaba_model=qwen-tts]]` | overrides = `{ voice: 'Cherry', model: 'qwen-tts' }` |
| R3 | `[[tts:edge_voice=zh-CN-XiaoxiaoNeural]]` | overrides = `{ voice: 'zh-CN-XiaoxiaoNeural' }` |
| R4 | `[[tts:minimax_voice=male-qn-qingse]]` | overrides = `{ voiceId: 'male-qn-qingse' }`（注意 minimax 字段名是 `voiceId` 不是 `voice`）|
| R5 | `[[tts:provider=openai voice=alloy]]` | provider 选定 openai，overrides voice='alloy' |
| R6 | `[[tts]]plain text[[/tts]]` | `overrides.ttsText = 'plain text'`，`hasDirective:true` |
| R7 | `[[tts:text]]hidden[[/tts:text]]hello` | `overrides.ttsText = 'hidden'`，`cleanedText = 'hello'` |

> **R 系列回归用例的具体输入/输出**应该在迁移前先从 v1 现状跑一遍，把实际结果固化为 fixture（`__tests__/fixtures/v1-directive-snapshots.json`），v2 必须 byte-equal 通过。

---

> **EOF** — 本方案 v0.1 完稿。落地过程中欢迎在仓库 issue 里讨论，或直接 PR 修改本文档。

---

_Last updated: 2026-05-08_
