# 配置参考

xopc 所有配置集中在 `~/.xopc/xopc.json` 文件中。

## 快速开始

运行交互式设置向导：

```bash
xopc onboard
```

或手动创建：

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5",
      "max_tokens": 8192,
      "temperature": 0.7
    }
  },
  "providers": {
    "anthropic": "${ANTHROPIC_API_KEY}"
  }
}
```

---

## 完整配置示例

```json
{
  "agents": {
    "defaults": {
      "workspace": "~/.xopc/workspace",
      "model": {
        "primary": "anthropic/claude-sonnet-4-5",
        "fallbacks": ["openai/gpt-4o", "minimax/minimax-m2.1"]
      },
      "max_tokens": 8192,
      "temperature": 0.7,
      "max_tool_iterations": 20
    }
  },
  "providers": {
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}",
    "deepseek": "${DEEPSEEK_API_KEY}",
    "groq": "${GROQ_API_KEY}",
    "google": "${GOOGLE_API_KEY}",
    "minimax": "${MINIMAX_API_KEY}"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "personal": {
          "name": "Personal Bot",
          "botToken": "BOT_TOKEN",
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": [123456789],
          "streamMode": "partial"
        }
      }
    }
  },
  "gateway": {
    "host": "0.0.0.0",
    "port": 18790
  },
  "tools": {
    "web": {
      "search": {
        "maxResults": 5,
        "providers": [{ "type": "brave", "apiKey": "BSA_your_key_here" }]
      }
    }
  },
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": {
      "apiKey": "${DASHSCOPE_API_KEY}",
      "model": "paraformer-v1"
    }
  },
  "tts": {
    "enabled": true,
    "provider": "openai",
    "trigger": "inbound",
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "tts-1",
      "voice": "alloy"
    }
  },
  "heartbeat": {
    "enabled": true,
    "intervalMs": 300000
  }
}
```

---

## 配置章节

### agents

智能体配置分为三部分：可选的顶层 **`default`**（默认 agent id）、共享的 **`defaults`**、以及 **`list`** 中的多条身份。路由与 session key 的**第一段**即为 agent id；运行时会把 **`agents.defaults`** 与 `list` 里匹配且 **enabled** 的条目**合并**成该会话的**有效配置**（模型、工作区、工具、提示词等）。

#### 顶层 `agents` 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `default` | string | 可选。未在会话键/API 中指定 agent 时使用的默认 id。未设置时：取 **`list` 中带 `default: true` 的条目**，否则 **`list` 中第一个 enabled 的 id**，否则 **`main`**。 |
| `defaults` | object | 全局基线，见下文 **agents.defaults**。 |
| `list` | array | 多条 agent 身份；每条可覆盖字段，见 **agents.list 条目**。 |

#### `agents.list` 条目

每条至少包含 **`id`**，其余字段均为可选覆盖（与 `defaults` 中同类字段形状一致）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 智能体 id（`agentId`，也是 session key 的第一段）。 |
| `default` | boolean | 可选。为 `true` 时，在**未**设置顶层 **`agents.default`** 的情况下将该条目标记为默认 agent。 |
| `name` | string | 显示名称。 |
| `enabled` | boolean | 默认 `true`。为 `false` 时该 id 不参与路由默认，且有效配置解析会回退到默认 agent。 |
| `workspace` | string | 可选。该 agent 的 **Markdown 工作区**根路径（支持 `~`）。工具 `cwd`、按日的 `memory/` 与用户文件在此。引导 Markdown、入站/TTS 与托管 `memories/` 解析在 **`agents/<id>/`**（agent 主目录），不在此目录内。 |
| `agentDir` | string | 可选。覆盖 **内部** agent 状态目录（凭证、`agent.json`、收件箱、pid 等），默认 `<stateDir>/agents/<id>/agent`。 |
| `model` | string \| object | 同 `agents.defaults.model`（字符串或 `{ primary, fallbacks }`）。 |
| `thinkingDefault` | string | 可选：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`adaptive`。 |
| `reasoningDefault` | string | 可选：`off`、`on`、`stream`。 |
| `verboseDefault` | string | 可选：`off`、`on`、`full`。 |
| `systemPromptOverride` | string | 可选。若设置，则替换常规基础系统提示词；技能 XML 仍会追加（受 `skills` 白名单约束）。 |
| `skills` | string[] | 可选。技能 **名称** 白名单，仅这些会出现在 `<available_skills>`。 |
| `tools` | object | 可选。`{ "disable": ["工具名", ...] }`，按内置工具的 **name** 禁用（如 `shell`、`web_search`、`session_search`、`image`；禁用扩展工具用 `extensions`）。 |
| `params` | object | 可选，预留。 |

同类可选字段也可写在 **`agents.defaults`** 里作为全局默认（例如 `agents.defaults.tools.disable` 会与每条 list 的 disable **合并**）。

**说明：** 磁盘路径（`~/.xopc/agents/<id>/` 下的会话与内部状态、以及各 agent 的 Markdown 工作区，即 **`agents.defaults.workspace/<agentId>`** 或 **`<状态目录>/workspace/<agentId>`**）均按 **`config.json`** 解析（`agents.list`、`agents.defaults`、可选的 `agentDir`）。请使用 **`xopc agents add`** / **`agents delete`** 管理列表与目录；**不存在**独立于配置之外的 agent「注册表」。

#### agents.defaults

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `workspace` | string | `~/.xopc/workspace` | Markdown 工作区的**父目录**；每个智能体解析为 `<展开路径>/<agentId>/`（如 `~/.xopc/workspace/main`） |
| `model` | string/object | `anthropic/claude-sonnet-4-5` | 默认模型 |
| `max_tokens` | number | `8192` | 最大输出 tokens |
| `temperature` | number | `0.7` | 温度参数 (0-2) |
| `max_tool_iterations` | number | `20` | 最大工具调用次数 |
| `imageModel` | string \| object | — | `image` 工具及**主模型不支持视觉**时对入站图做描述的视觉模型。格式与 `model` 相同（字符串或 `{ primary, fallbacks }`）。详见 [图像与视觉](image-multimodal.md)。 |
| `imageGenerationModel` | string \| object | — | `image_generate` 的文生图模型链（如 `openai/gpt-image-1`、`dashscope/wan2.6-t2i`）。格式与 `model` 相同。详见 [图像与视觉](image-multimodal.md)。 |
| `mediaMaxMb` | number | — | 可选。`image` 工具从路径或 URL 加载单张图片时的最大体积（**MB**）。 |

#### agents.defaults.model

模型配置支持两种格式：

**简单格式：**
```json
{
  "model": "anthropic/claude-sonnet-4-5"
}
```

**对象格式（带备用模型）：**
```json
{
  "model": {
    "primary": "anthropic/claude-sonnet-4-5",
    "fallbacks": ["openai/gpt-4o", "minimax/minimax-m2.1"]
  }
}
```

模型 ID 格式：`provider/model-id`（如 `anthropic/claude-opus-4-5`）。

**`imageModel`**、**`imageGenerationModel`** 也可使用与 **`model`** 相同的 **`{ primary, fallbacks }`** 对象，以配置视觉或文生图的有序降级链。

#### agents.defaults.memory

**`agents/<agentId>/memories/`** 下的托管长期记忆（`MEMORY.md` / `USER.md`）、可选的 **stub** 外部记忆后端（用于接线测试），以及用户轮次上 **prefetch** 注入（在用户消息前加 `<memory-context>` 围栏）的控制项。目录说明见 [托管记忆](workspace.md#curated-memory)。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 总开关。为 `false` 时：无 curated 快照、无 `curated_memory` 工具、不加载外部 memory 提供方、不做 prefetch/sync。 |
| `useEnhancedSystem` | boolean | `true` | 为 `false` 时：关闭 curated 快照与 `curated_memory`；工作区引导里的根目录 `MEMORY.md` 仍会通过 bootstrap 参与提示。 |
| `userProfileEnabled` | boolean | `true` | 为 `false` 时：系统提示不包含 `USER.md`；`curated_memory` 不能修改 `user` 目标（仍可读）。 |
| `memoryCharLimit` | number | `2200` | `MEMORY.md` 条目合计字符上限。 |
| `userCharLimit` | number | `1375` | `USER.md` 条目合计字符上限。 |
| `provider` | string | `none` | 外部提供方：`none` 或 `stub`（`enabled` 为 `false` 时不生效）。 |
| `injectionFrequency` | string | `every-turn` | Prefetch 注入策略：`every-turn` 或 `first-turn`（仅会话中第一条用户消息）。 |
| `contextCadence` | number | `1` | 当 `injectionFrequency` 为 `every-turn` 时，在第 1、1+N、1+2N… 轮注入 prefetch（最小为 `1`）。 |
| `dialecticCadence` | number | — | 预留字段，供将来外部 dialectic 同步节奏使用（尚未接线）。 |

#### agents.defaults.sessionSearch

跨会话 transcript 检索（`session_search` 工具，需会话持久化可用时注册）。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `summaryModel` | string | — | 按会话摘要所用模型（如 `openai/gpt-4o-mini`）。设置后优先于环境变量 `XOPC_SESSION_SEARCH_MODEL`。 |

---

### providers

配置 LLM 服务商 API 密钥。使用环境变量引用：

```json
{
  "providers": {
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}",
    "deepseek": "sk-...",
    "groq": "${GROQ_API_KEY}"
  }
}
```

**支持的服务商：**

| 服务商 | 环境变量 |
|--------|----------|
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `google` | `GOOGLE_API_KEY` 或 `GEMINI_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `deepseek` | `DEEPSEEK_API_KEY` |
| `minimax` | `MINIMAX_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `cerebras` | `CEREBRAS_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `huggingface` | `HF_TOKEN` 或 `HUGGINGFACE_TOKEN` |

> **注意:** 环境变量优先于配置文件中的值。

查看 [模型文档](/zh/models) 了解自定义服务商配置。

---

### bindings

可选的规则数组，用于将入站流量分配到指定 **`agentId`**。按 **`priority`** 从高到低匹配；每条 **`match`** 中的 **`channel`** 须为精确通道 id（如 `telegram`），**`peerId`** 可使用 `*` 通配。若无匹配，默认 agent id 为：**已设置的 `agents.default`** → 否则 **`agents.list` 中第一个 enabled 的 id** → 否则 **`main`**。详见 [Session 路由系统](/zh/routing-system)。

---

### session

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `dmScope` | string | `main` | DM 会话合并/拆分策略：`main`、`per-peer`、`per-channel-peer`、`per-account-channel-peer` |
| `identityLinks` | object | - | 规范 id → `["channel:peerId", …]` 别名，用于跨通道身份 |
| `storage` | object | - | 可选会话存储调优（`pruneAfterMs`、`maxEntries`） |

更多说明与示例见 [Session 路由系统](/zh/routing-system)。

---

### channels

通信通道配置。

`channels` 下的键取决于你启用的通道类型。内置 **Telegram**、**微信** 的字段说明见 [通道配置](/zh/channels)；其它键可能来自扩展，以扩展文档为准。

#### channels.telegram

多账户 Telegram 配置：

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "personal": {
          "name": "Personal Bot",
          "botToken": "BOT_TOKEN",
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": [123456789],
          "streamMode": "partial"
        }
      }
    }
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 Telegram |
| `accounts` | object | - | 多账户配置 |
| `accounts.<id>.name` | string | - | 显示名称 |
| `accounts.<id>.botToken` | string | - | Bot token |
| `accounts.<id>.dmPolicy` | string | `open` | DM 策略 |
| `accounts.<id>.groupPolicy` | string | `open` | 群组策略 |
| `accounts.<id>.allowFrom` | array | `[]` | 允许的用户 ID |
| `accounts.<id>.streamMode` | string | `partial` | 流式模式 |

**DM 策略**: `pairing` | `allowlist` | `open` | `disabled`

**群组策略**: `open` | `allowlist` | `disabled`

**流式模式**: `off` | `partial` | `block`

#### channels.feishu

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "APP_ID",
      "appSecret": "APP_SECRET",
      "verificationToken": "VERIFICATION_TOKEN"
    }
  }
}
```

---

### gateway

HTTP API 网关配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `host` | string | `0.0.0.0` | 绑定地址 |
| `port` | number | `18790` | 端口号 |
| `auth` | object | - | 认证配置 |
| `cors` | object | - | CORS 设置 |

#### gateway.auth

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `mode` | string | `token` | 认证模式：`none`、`token`、`password` |
| `token` | string | 自动生成 | `mode: "token"` 时使用的 Bearer / `X-Api-Key` 凭证 |
| `password` | string | - | `mode: "password"` 时使用的密码凭证 |
| `rateLimit` | object | 默认启用 | 认证失败限流（防暴力破解） |

说明：
- `gateway.auth.token` 与 `gateway.auth.password` 互斥，同时设置会在启动时报错。
- `token` 模式下未显式配置 token 时，xopc 会在启动时自动生成随机 token。
- 弱口令/示例占位 token（如 `your-secret-token-here`）以及长度小于 16 的 token 会被拒绝。
- 可通过环境变量覆盖：`XOPC_GATEWAY_AUTH_MODE`、`XOPC_GATEWAY_TOKEN`、`XOPC_GATEWAY_PASSWORD`。

#### gateway.auth.rateLimit

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 启用认证失败限流 |
| `maxAttempts` | number | `5` | 窗口内最大失败次数 |
| `windowMs` | number | `900000` | 滚动时间窗口（毫秒） |
| `blockDurationMs` | number | `300000` | 临时封禁时长（毫秒） |

#### gateway.corsOrigins

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `gateway.corsOrigins` | string[] | `[]` | 浏览器来源白名单（精确 origin，如 `http://localhost:5173`） |

安全行为：
- 带 `Origin` 头的浏览器请求会执行来源校验，不通过则拒绝。
- 不带 `Origin` 的非浏览器请求（CLI/服务间）由认证中间件校验。
- `corsOrigins` 配置为 `"*"` 虽可用，但会在启动安全审计日志中提示风险。

---

### tools

工具配置。

#### tools.web

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `search` | object | - | 网页搜索配置 |
| `browse` | object | - | 网页浏览配置 |

##### tools.web.search

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `maxResults` | number | `5` | 工具未传 `count` 时的默认条数 |
| `providers` | array | `[]` | 按顺序尝试的搜索后端（`brave`、`tavily`、`bing`、`searxng`）。空数组则仅 HTML 兜底 |

每项可含 `type`、可选 `apiKey`、SearXNG 可选 `url`、可选 `disabled`。

---

### stt

语音转文字（STT）配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 STT |
| `provider` | string | `alibaba` | 服务商：`alibaba`, `openai` |
| `alibaba` | object | - | 阿里云 DashScope 配置 |
| `openai` | object | - | OpenAI Whisper 配置 |
| `fallback` | object | - | 回退配置 |

#### stt.alibaba

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | DashScope API 密钥 |
| `model` | string | `paraformer-v1` | 模型：`paraformer-v1`, `paraformer-8k-v1` |

#### stt.openai

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | OpenAI API 密钥 |
| `model` | string | `whisper-1` | 模型：`whisper-1` |

#### stt.fallback

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 启用回退 |
| `order` | array | `["alibaba", "openai"]` | 回退顺序 |

失败时会按顺序尝试各 provider，并记录结构化 **attempts**（provider、结果、耗时、原因）便于诊断。

**示例：**
```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": {
      "apiKey": "${DASHSCOPE_API_KEY}",
      "model": "paraformer-v1"
    },
    "fallback": {
      "enabled": true,
      "order": ["alibaba", "openai"]
    }
  }
}
```

---

### tts

文字转语音（TTS）配置；启用时还会注册智能体工具 **`text_to_speech`**。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 TTS |
| `provider` | string | `openai` | 主服务商：`openai`, `alibaba`, `edge` |
| `trigger` | string | `always` | `off`, `always`, `inbound`, `tagged`（历史值 `auto` 会当作 `inbound`） |
| `maxTextLength` | number | `512` | 送入各 TTS 提供方的最大字符数（可按 provider 上限调高） |
| `timeoutMs` | number | `30000` | 单次请求超时（毫秒） |
| `fallback` | object | - | 失败时的回退顺序 |
| `summarization` | object | - | 超长文本在 TTS 前经 LLM 摘要 |
| `modelOverrides` | object | - | 是否允许模型使用 `[[tts:...]]` 指令 |
| `openai` | object | - | OpenAI TTS |
| `alibaba` | object | - | 阿里云 DashScope TTS |
| `edge` | object | - | Edge TTS（无需 API Key） |

#### tts.openai

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | OpenAI API 密钥 |
| `model` | string | `tts-1` | 模型：`tts-1`, `tts-1-hd` |
| `voice` | string | `alloy` | 音色：`alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer` |

#### tts.alibaba

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | DashScope API 密钥 |
| `model` | string | `qwen-tts` | TTS 模型 id |
| `voice` | string | `Cherry` | 音色 id |

#### tts.edge

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 为 `false` 时从链中排除 Edge |
| `voice` | string | `en-US-MichelleNeural` | Edge 音色 |
| `lang` | string | `en-US` | BCP-47 语言 |
| `outputFormat` | string | 见 schema | Edge 输出格式字符串 |
| `proxy` | string | - | 可选 HTTP(S) 代理 |
| `timeoutMs` | number | - | 仅针对 Edge 的超时覆盖 |

#### tts.fallback

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 启用回退 |
| `order` | array | `["openai","alibaba","edge"]` | 顺序（会与主 provider 去重） |

#### tts.summarization

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 超长时先摘要再 TTS |
| `threshold` | number | 同 `maxTextLength` | 超过此长度触发摘要 |
| `targetLength` | number | 同 `maxTextLength` | 摘要目标长度 |
| `model` | string | - | 摘要用模型引用；未设可用环境变量 `XOPC_TTS_SUMMARIZE_MODEL` |

**触发模式：**
- `off`：不对出站自动 TTS
- `always`：满足管道条件时尽量 TTS
- `inbound`：仅当用户本轮带语音入站时 TTS
- `tagged`：仅当助手文本含 `[[tts]]` 时 TTS

详见 [语音功能 (STT/TTS)](/zh/voice)（含 Telegram 群语音 @、`/tts status`、通道格式）。

---

### heartbeat

定期健康检查配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 启用心跳 |
| `intervalMs` | number | `300000` | 间隔毫秒数（5 分钟） |

---

### cron

定时任务配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 启用 cron |
| `jobs` | array | `[]` | 定时任务列表 |

查看 [Cron 文档](/zh/cron) 了解任务配置。

---

### extensions

扩展启用/禁用配置。

```json
{
  "extensions": {
    "enabled": ["telegram-channel", "weather-tool"],
    "disabled": ["deprecated-extension"],
    "telegram-channel": {
      "token": "bot-token-here"
    },
    "weather-tool": true
  }
}
```

| 字段 | 类型 | 说明 |
|-------|------|------|
| `enabled` | string[] | 要启用的扩展 ID 列表 |
| `disabled` | string[] | （可选）禁用的扩展 ID 列表 |
| `[extension-id]` | object/boolean | 扩展特定配置 |

查看 [扩展文档](/zh/extensions) 了解详情。

---

## 环境变量

xopc 支持环境变量存储敏感数据：

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | OpenAI API 密钥 |
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 |
| `GOOGLE_API_KEY` | Google AI API 密钥 |
| `GROQ_API_KEY` | Groq API 密钥 |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 |
| `MINIMAX_API_KEY` | MiniMax API 密钥 |
| `DASHSCOPE_API_KEY` | 阿里云 DashScope API 密钥（STT/TTS） |
| `XOPC_TTS_SUMMARIZE_MODEL` | 未配置 `tts.summarization.model` 时，TTS 长文本摘要使用的模型引用 |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `XOPC_CONFIG` | 自定义配置文件路径 |
| `XOPC_WORKSPACE` | 自定义工作区目录 |
| `XOPC_SESSION_SEARCH_MODEL` | 未设置 `agents.defaults.sessionSearch.summaryModel` 时，`session_search` 摘要使用的默认模型 |
| `XOPC_LOG_LEVEL` | 日志级别（trace/debug/info/warn/error/fatal） |
| `XOPC_LOG_DIR` | 日志目录路径 |
| `XOPC_LOG_CONSOLE` | 启用控制台输出（true/false） |
| `XOPC_LOG_FILE` | 启用文件输出（true/false） |
| `XOPC_LOG_RETENTION_DAYS` | 日志文件保留天数 |
| `XOPC_PRETTY_LOGS` | 开发环境美化日志输出 |

环境变量优先于配置文件中的值。

---

## 配置管理

### 验证配置

```bash
xopc config --validate
```

### 查看配置

```bash
xopc config --show
```

### 编辑配置

```bash
xopc config --edit
```

---

## 常见问题

### Q: 如何使用多个服务商？

使用 `providers` 配置定义多个 API 密钥。运行时将根据模型 ID 自动选择合适的服务商：

```json
{
  "providers": {
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}"
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

### Q: 如何使用 Ollama（本地模型）？

在 `~/.xopc/models.json` 中配置自定义服务商：

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "llama3.1:8b" }
      ]
    }
  }
}
```

查看 [模型文档](/zh/models) 了解详情。

### Q: 如何配置 OAuth？

xopc 支持某些服务商的 OAuth 认证：

**Kimi（设备码流程）：**
```json
{
  "providers": {
    "kimi": {
      "auth": {
        "type": "oauth",
        "clientId": "your-client-id"
      }
    }
  }
}
```

Kimi 使用设备码流程 - CLI 会提示访问 `auth.kimi.com` 并输入代码。

### Q: 如何使用环境变量？

在配置中使用 `${VAR_NAME}` 语法：

```json
{
  "providers": {
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}"
  }
}
```

或直接设置环境变量而不添加到配置中。
