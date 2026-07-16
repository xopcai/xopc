# 配置参考

xopc 所有配置集中在 `~/.xopc/xopc.json` 文件中。

如果你是在完成具体任务，请优先看 how-to：

| 任务 | 指南 |
| --- | --- |
| 配置模型 | [如何配置第一个模型](how-to/configure-first-model.md) |
| 接入 Telegram | [如何接入 Telegram](how-to/connect-telegram.md) |
| 从其它设备访问 gateway | [如何安全暴露 gateway](how-to/expose-gateway-safely.md) |
| 添加另一个 agent | [如何创建第二个 agent](how-to/create-second-agent.md) |
| 排查损坏的设置 | [如何诊断损坏的设置](how-to/diagnose-broken-setup.md) |

完整字段参考见 [配置参考](./reference/configuration.md)。

本页其余内容是 `xopc.json` 结构参考。

## 快速开始

运行交互式设置向导：

```bash
xopc onboard
```

或手动创建：

```json
{
  "agents": {
    "default": "main",
    "defaultPreset": "default",
    "capabilityPresets": {
      "default": {
        "id": "default",
        "name": "全局默认能力",
        "models": {
          "defaultRole": "deep",
          "roles": {
            "deep": { "model": "anthropic/claude-sonnet-4-5" }
          }
        }
      }
    },
    "list": [
      {
        "id": "main",
        "identity": {
          "name": "Main",
          "role": "General assistant",
          "language": "zh-CN",
          "tone": "direct"
        },
        "responsibilities": {
          "primary": ["帮助用户完成任务"]
        },
        "workspace": { "root": "~/.xopc/workspace/main" },
        "tools": { "builtin": {} },
        "skills": { "mode": "all" },
        "memory": {
          "mode": "confirmWrite",
          "sources": ["session", "curated"],
          "writePolicy": { "curated": "confirm" },
          "understanding": { "enabled": true, "adaptiveCadence": true, "reviewIntervalTurns": 10 }
        },
        "workflows": {},
        "boundaries": { "requiresConfirmation": [], "forbidden": [], "escalation": [] }
      }
    ]
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
    "default": "main",
    "list": [
      {
        "id": "main",
        "identity": { "name": "Main", "role": "General assistant" },
        "responsibilities": { "primary": ["Help the user complete tasks"] },
        "workspace": { "root": "~/.xopc/workspace/main" },
        "models": {
          "defaultRole": "deep",
          "roles": {
            "deep": { "model": "deepseek/deepseek-v4-flash" }
          }
        },
        "tools": { "builtin": {} },
        "skills": { "mode": "all" },
        "memory": { "mode": "confirmWrite", "sources": ["session"] },
        "workflows": {},
        "boundaries": { "requiresConfirmation": [], "forbidden": [], "escalation": [] }
      }
    ]
  },
  "providers": {
    "deepseek": "${DEEPSEEK_API_KEY}"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "defaults": {
        "dmPolicy": "pairing",
        "groupPolicy": "open",
        "streaming": { "mode": "partial" }
      },
      "accounts": {
        "personal": {
          "name": "Personal Bot",
          "botToken": "BOT_TOKEN",
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": [123456789],
          "streaming": { "mode": "partial" }
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
    },
    "media": {
      "audio": {
        "enabled": true,
        "provider": "alibaba",
        "alibaba": {
          "apiKey": "${DASHSCOPE_API_KEY}",
          "model": "paraformer-v2"
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
        "apiKey": "${OPENAI_API_KEY}",
        "model": "tts-1",
        "voice": "alloy"
      }
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

智能体配置是 manifest-first。可运行条目位于 **`agents.list`**；每个条目都是一个 Agent Capability Manifest。路由与 session key 的**第一段**即为 agent id。可复用的 **`capabilityPresets`** 和 **`defaultPreset`** 是可选策略补丁机制。当前配置模型里没有 `agents.defaults` 合并层。

#### 顶层 `agents` 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `default` | string | 可选。未在会话键/API 中指定 agent 时使用的默认 id。未设置时：取 **`list` 中第一个 enabled 的 id**，否则 **`main`**。 |
| `defaultPreset` | string | 可选。每个 agent 自身 `extends` 之前应用的全局 preset id。省略时默认 `default`。仅在需要共享基础能力时使用。 |
| `capabilityPresets` | object | 可选。按 preset id 索引的可复用策略补丁。可包含模型角色、工具、技能、记忆、工作流、边界和运行时限制等。 |
| `list` | array | 具体的 Agent Capability Manifest。每条可以独立完整配置，包括自己的 `models`。 |

#### `agents.list` 条目

每条至少包含 **`id`**、**`identity`**、**`responsibilities`**、**`workspace`**、**`tools`**、**`skills`**、**`memory`**、**`workflows`** 和 **`boundaries`**。当 agent 自己拥有模型角色时，直接在该条目上配置 **`models`**。长文本 profile 仍可放在 **`agents/<id>/profile/`**，但结构化 manifest 是运行时策略的来源。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 智能体 id（`agentId`，也是 session key 的第一段）。 |
| `extends` | string[] | 可选。引用 `agents.capabilityPresets` 中的 preset id，后面的 preset 和 manifest 本身会覆盖前面的字段。 |
| `enabled` | boolean | 默认 `true`。为 `false` 时不参与路由和运行时解析。 |
| `identity` | object | 结构化身份：`name`、`role`，以及可选的 `description`、`language`、`tone`、`avatar`。 |
| `responsibilities` | object | `primary`，以及可选的 `secondary`、`outOfScope`。 |
| `workspace.root` | string | 该 agent 的 Markdown 工作区根路径（支持 `~`）。工具 `cwd`、按日记忆和用户文件在此。 |
| `models.defaultRole` | string | 工作流或会话未指定模型角色时使用的默认角色 id。 |
| `models.roles` | object | 命名模型角色。每个角色形如 `{ "model": "provider/model", "description": "..." }`。 |
| `tools.builtin` | object | 内置工具策略：`{ "mode": "allow" \| "confirm" \| "deny", "scope"?: "readonly" \| "workspace" \| "unrestricted" }`。 |
| `tools.mcp` | object | 可选 MCP server/tool 策略。 |
| `skills` | object | 技能可见性策略：`all`、`allowlist`、`denylist` 或 `off`。 |
| `memory` | object | 记忆模式、来源、写入策略、保留策略和隐私设置。 |
| `workflows` | object | 可选的默认/允许/建议工作流策略。 |
| `boundaries` | object | 需要确认、禁止和升级处理的边界规则。 |
| `runtime` | object | 可选运行时限制，如 `maxTurns`、`timeoutMs`、`maxToolFailuresPerTurn`。 |
| `prompt` | object | 可选结构化 prompt 自定义。 |

请使用 **`xopc agents add`** / **`xopc agents delete`** 管理 `agents.list` 和目录；不存在独立于配置文件之外的 agent 注册表。

#### `agents.list[].models`

```json
{
  "models": {
    "defaultRole": "deep",
    "roles": {
      "small": {
        "model": "openai/gpt-4o-mini",
        "description": "快速低成本模型"
      },
      "large": {
        "model": "anthropic/claude-sonnet-4-5"
      }
    }
  }
}
```

模型 ID 格式：`provider/model-id`（如 `anthropic/claude-opus-4-5`）。

模型角色是 manifest 局部配置，也可以由 `capabilityPresets` 提供。工作流可引用这些角色名，而不是硬编码具体 `provider/model`。

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

**内置服务商 id** 与 **`@earendil-works/pi-ai` 的 `KnownProvider`** 一致；环境变量名以仓库 **`src/providers/env-keys.ts`** 的 **`PROVIDER_ENV_MAP`** 为准，下表与之同步。其它厂商（如仅 DashScope HTTP 能力）一般在 **`models.json`** 中配置。

| 服务商 id | 环境变量（按 `PROVIDER_ENV_MAP` 顺序检测） |
|-----------|---------------------------------------------|
| `amazon-bedrock` | `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_REGION` 等（见 pi-ai / AWS SDK） |
| `anthropic` | `ANTHROPIC_OAUTH_TOKEN`、`ANTHROPIC_API_KEY` |
| `azure-openai-responses` | `AZURE_OPENAI_API_KEY`、`AZURE_OPENAI_BASE_URL` |
| `cloudflare-ai-gateway` | `CLOUDFLARE_API_KEY`（模型 `baseUrl` 可能还需账号/网关 id，见 pi-ai） |
| `cloudflare-workers-ai` | `CLOUDFLARE_API_KEY` |
| `cerebras` | `CEREBRAS_API_KEY` |
| `dashscope` | `DASHSCOPE_API_KEY`（文生图/STT/TTS；非 pi-ai LLM `KnownProvider`） |
| `deepseek` | `DEEPSEEK_API_KEY` |
| `fireworks` | `FIREWORKS_API_KEY` |
| `github-copilot` | `COPILOT_GITHUB_TOKEN`、`GH_TOKEN`、`GITHUB_TOKEN`、`GITHUB_COPILOT_TOKEN` |
| `google` | `GEMINI_API_KEY`、`GOOGLE_API_KEY` |
| `google-antigravity` | `ANTIGRAVITY_API_KEY` |
| `google-gemini-cli` | `GEMINI_CLI_TOKEN`、`GOOGLE_TOKEN` |
| `google-vertex` | `GOOGLE_CLOUD_API_KEY`、`GOOGLE_CLOUD_PROJECT`、`GOOGLE_CLOUD_LOCATION` |
| `groq` | `GROQ_API_KEY` |
| `huggingface` | `HF_TOKEN`、`HUGGINGFACE_TOKEN` |
| `kimi-coding` | `KIMI_API_KEY`、`MOONSHOT_API_KEY` |
| `minimax` | `MINIMAX_API_KEY` |
| `minimax-cn` | `MINIMAX_CN_API_KEY`、`MINIMAX_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `moonshotai` | `MOONSHOT_API_KEY` |
| `moonshotai-cn` | `MOONSHOT_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `openai-codex` | *（无静态 env 映射—使用 OAuth / `xopc auth login openai-codex`）* |
| `opencode` | `OPENCODE_API_KEY` |
| `opencode-go` | `OPENCODE_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `together` | `TOGETHER_API_KEY` |
| `vercel-ai-gateway` | `AI_GATEWAY_API_KEY`、`VERCEL_AI_GATEWAY_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `xiaomi` | `XIAOMI_API_KEY` |
| `xiaomi-token-plan-cn` | `XIAOMI_TOKEN_PLAN_CN_API_KEY` |
| `xiaomi-token-plan-ams` | `XIAOMI_TOKEN_PLAN_AMS_API_KEY` |
| `xiaomi-token-plan-sgp` | `XIAOMI_TOKEN_PLAN_SGP_API_KEY` |
| `zai` | `ZAI_API_KEY` |

小米四条线的区别见 [模型文档 — 内置 LLM](/zh/models#内置-llm-服务商pi-ai)。

> **注意:** 环境变量优先于配置文件中的值。

查看 [模型文档](/zh/models) 了解自定义服务商与 `models.json`。

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
      "defaults": {
        "dmPolicy": "pairing",
        "groupPolicy": "open",
        "streaming": { "mode": "partial" }
      },
      "accounts": {
        "personal": {
          "name": "Personal Bot",
          "botToken": "BOT_TOKEN",
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": [123456789],
          "streaming": { "mode": "partial" }
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
| `defaults.dmPolicy` | string | `pairing` | 账号默认私聊策略 |
| `defaults.groupPolicy` | string | `open` | 账号默认群组策略 |
| `defaults.streaming.mode` | string | `partial` | 账号默认流式模式 |
| `accounts.<id>.dmPolicy` | string | inherits `defaults.dmPolicy` | DM 策略 |
| `accounts.<id>.groupPolicy` | string | inherits `defaults.groupPolicy` | 群组策略 |
| `accounts.<id>.allowFrom` | array | `[]` | 允许的用户 ID |
| `accounts.<id>.streaming.mode` | string | inherits `defaults.streaming.mode` | 流式模式 |

**DM 策略**（`pairing` \| `allowlist` \| `open` \| `disabled`）：

- **`pairing`**（推荐）：未在允许列表中的用户 **不会** 进入智能体管线。Telegram 的允许来源是 **`channels.telegram.accounts.<账号>.allowFrom`**，并会合并执行 **`xopc channels pairing approve`** 后写入的 **Telegram allowFrom 凭证文件**（与配置在运行时合并）。用户首次私聊会收到 **配对码**。详见 [消息通道 — DM 私聊配对](./channels/index.md#dm-pairing) 与 [CLI — channels](./cli.md#channels)。
- **`allowlist`**：同样合并配置与凭证文件中的 id，但 **不会** 发送配对码；未命中则静默丢弃。
- **`open`**：任意用户可私聊（公开机器人上慎用）。
- **`disabled`**：不接受私聊。

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
| `bind` | string | `loopback` | `auto`、`loopback`、`lan`、`tailnet`、`custom` |
| `customBindHost` | string | - | 当 `bind` 为 `custom` 时的 IPv4 地址 |
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

#### 频道连接延后

相关字段在 **`gateway`** 下：`channelConnectDeferMode`、`channelConnectDeferIds`、`channelConnectDeferSkipIds`。使用 **`xopc gateway`**（`GatewayServer` 启动路径）时，部分外连型通道（Telegram、微信、飞书）可将 **`ChannelPlugin.start()`** 延后到 **HTTP 端口已成功监听之后**，让控制台与 REST 先可用。是否延后由通道插件 **`meta.deferConnectUntilAfterListen`** 声明；可用下列配置覆盖。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `channelConnectDeferMode` | `"auto"` \| `"off"` \| `"explicit"` | 未写视为 `auto` | **`auto`**：延后集合 = 已启用且插件 meta 要求延后的通道，再减去 `channelConnectDeferSkipIds`。 **`off`**：不延后，全部在第一阶段 `start()`。 **`explicit`**：仅延后 `channelConnectDeferIds` 中的 id（列表为空则等价于不延后任何通道）。 |
| `channelConnectDeferIds` | string[] | - | 最多 24 项；仅在 **`explicit`** 模式下使用。 |
| `channelConnectDeferSkipIds` | string[] | - | 最多 24 项；在 **`auto`** 或 **`explicit`** 算出集合后再剔除这些 id。 |

启动阶段会打结构化日志（`phase: "gateway.channel_startup"`）：

- **`stage: "phase1"`**：含 `channelInitMs`、`deferPlanMs`、`channelPhase1StartMs`、`replayOutboundMs`（若在 listen 后重放则为 `null`）、`channelConnectDeferMode`、`channelConnectDeferSource`（`meta` \| `explicit` \| `off`）、`deferredChannelIds` 等。
- **`stage: "phase2"`**：HTTP 监听成功后：`channelPhase2DeferredMs`、`replayOutboundMs`、`onHttpListeningTotalMs` 及同样的 defer 模式快照。

检索示例：日志中带 `gateway.channel_startup` 或文案 `phase-1 complete` / `phase-2 complete`。

更多说明见 [网关 — 频道启动与 HTTP 监听顺序](gateway.md#频道启动与-http-监听顺序)。

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

### tools.media.audio (STT)

语音转文字（STT）配置。位于 **`tools.media.audio`** 路径下（网关 REST 仍以
`stt` 字段名暴露，便于表单与脚本兼容）。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 STT |
| `provider` | string | `alibaba` | 主服务商：`alibaba`、`openai` |
| `alibaba` | object | - | 阿里云 DashScope 配置 |
| `openai` | object | - | OpenAI Whisper 配置 |
| `fallback` | object | - | 回退配置 |
| `timeoutMs` | number | `60000` | 单次调用 HTTP 超时（毫秒） |

#### tools.media.audio.alibaba

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | DashScope API 密钥（环境变量：`DASHSCOPE_API_KEY`） |
| `model` | string | `paraformer-v2` | 模型 id |

#### tools.media.audio.openai

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | OpenAI API 密钥（环境变量：`OPENAI_API_KEY`） |
| `model` | string | `whisper-1` | Whisper 模型 id |

#### tools.media.audio.fallback

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 启用回退 |
| `order` | array | `["alibaba", "openai"]` | 回退顺序 |

失败时会按顺序尝试各 provider，并记录结构化 **attempts**（provider、结果、耗时、原因）便于诊断。所有 HTTP 调用都走共享的 `media-shared/http` 底盘，启用了 **SSRF 防护**（`fetchWithTimeoutGuarded`）。

**示例：**
```json
{
  "tools": {
    "media": {
      "audio": {
        "enabled": true,
        "provider": "alibaba",
        "alibaba": {
          "apiKey": "${DASHSCOPE_API_KEY}",
          "model": "paraformer-v2"
        },
        "fallback": {
          "enabled": true,
          "order": ["alibaba", "openai"]
        }
      }
    }
  }
}
```

---

### messages.tts (TTS)

文字转语音（TTS）配置。位于 **`messages.tts`** 路径下（网关 REST 仍以 `tts`
字段名暴露）。启用时还会注册智能体工具 **`text_to_speech`**。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 TTS |
| `provider` | string | `openai` | 主服务商：`openai`、`alibaba`、`edge`、`minimax`、`tts-local-cli`，或任何已注册的 SpeechProviderPlugin id |
| `trigger` | string | `always` | `off`、`always`、`inbound`、`tagged` |
| `maxTextLength` | number | `512` | 送入各 TTS 提供方的最大字符数。保守默认值兼顾所有内置 provider（阿里 qwen-tts 上限 512）；如主用 provider 上限更高可上调。 |
| `timeoutMs` | number | `60000` | 单次请求 HTTP 超时（毫秒）。范围 `1000`–`180000`。MiniMax 内部会自动提到 ≥150s 走异步轮询。 |
| `fallback` | object | - | 失败时的回退顺序 |
| `summarization` | object | - | 超长文本在 TTS 前经 LLM 摘要 |
| `modelOverrides` | object | - | 是否允许模型使用 `[[tts:...]]` 指令 |
| `openai` | object | - | OpenAI TTS |
| `alibaba` | object | - | 阿里云 DashScope TTS |
| `edge` | object | - | Microsoft Edge TTS（无需 API Key） |
| `minimax` | object | - | MiniMax T2A 异步 TTS |
| `tts-local-cli` | object | - | 本地 CLI provider（内置扩展） |

#### messages.tts.openai

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | OpenAI API 密钥（环境变量：`OPENAI_API_KEY`） |
| `baseUrl` | string | `https://api.openai.com/v1` | 覆盖 base URL（环境变量：`OPENAI_TTS_BASE_URL`），用于 OpenAI 兼容厂商 |
| `model` | string | `tts-1` | 模型：`tts-1`、`tts-1-hd`、`gpt-4o-mini-tts` |
| `voice` | string | `alloy` | 音色：`alloy`、`echo`、`fable`、`onyx`、`nova`、`shimmer`、`coral`、`verse` … |

#### messages.tts.alibaba

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | DashScope API 密钥（环境变量：`DASHSCOPE_API_KEY`） |
| `model` | string | `qwen-tts` | TTS 模型 id |
| `voice` | string | `longxiaochun` | 音色 id（`Cherry`、`Ethan`、`longxiaochun`、`longxiaobai` …） |

#### messages.tts.edge

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 为 `false` 时从链中排除 Edge |
| `voice` | string | `en-US-MichelleNeural` | Edge 音色 id |
| `lang` | string | `en-US` | BCP-47 语言 |
| `outputFormat` | string | `audio-24khz-48kbitrate-mono-mp3` | Edge 输出格式字符串 |
| `proxy` | string | - | 可选 HTTP(S) 代理 |

#### messages.tts.minimax

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | MiniMax API 密钥（环境变量：`MINIMAX_API_KEY`） |
| `baseUrl` | string | `https://api.minimaxi.com/v1` | 覆盖 base URL |
| `model` | string | `speech-2.8-hd` | 模型 id（`speech-2.8-hd`、`speech-2.8-turbo` …） |
| `voice` | string | `male-qn-qingse` | 音色 id |
| `groupId` | string | - | 企业版前向兼容字段 |

#### messages.tts.tts-local-cli

由内置扩展 **`tts-local-cli`** 提供（权威 JSON Schema 见
`extensions/tts-local-cli/xopc.extension.json`）。spawn 任意本地 TTS 二进制
（mlx-audio、sherpa-onnx-tts、piper 等）并读取产物文件。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `command` | string | **必填** | Shell 命令模板；占位符 `{{Text}}`、`{{OutputPath}}`、`{{OutputDir}}`、`{{OutputBase}}`（大小写不敏感） |
| `args` | string[] | `[]` | 在解析后的 command 末尾追加的额外参数 |
| `cwd` | string | - | spawn 进程的工作目录 |
| `outputFormat` | enum | `wav` | CLI 产物的文件扩展名：`mp3` \| `opus` \| `wav` |
| `timeoutMs` | number | `120000` | 强制 kill 的超时（毫秒） |
| `env` | object | - | 合入 spawn 进程 env 的额外变量（`Record<string,string>`） |

Voice 设置 UI 暴露常用字段（`command`、`cwd`、`outputFormat`、`timeoutMs`）；
`args` 与 `env` 属高级字段 — 请直接编辑 `~/.xopc/xopc.json` 设置。

#### messages.tts.fallback

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 启用回退 |
| `order` | array | `["openai","alibaba","edge","minimax"]` | 顺序（会与主 provider 去重） |

回退列表接受**任意已注册 SpeechProviderPlugin 的 id**，包括扩展 provider（如 `tts-local-cli`）。

#### messages.tts.summarization

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

### mcp

出站 MCP 服务器配置与入站 stdio 桥接。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `sessionIdleTtlMs` | number | `600000` | 会话级 MCP 运行时空闲回收（10 分钟）；`0` 关闭 |
| `servers` | object | `{}` | 服务器 id → 连接定义（stdio 或 HTTP） |

完整说明、控制台操作与安全注意点见 [MCP 文档](/zh/mcp)。

---

### heartbeat

定期健康检查配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 启用心跳 |
| `intervalMs` | number | `300000` | 间隔毫秒数（5 分钟） |

---

### automations

自动化存储在 SQLite 中，并通过网关控制台/API 管理，不通过 `xopc.json` 配置。打开 `#/automations`，或使用 `/api/automations` 与 `/api/automation-runs`。

触发器、动作、可靠性与运行历史见 [自动化](/zh/automations)。

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
| `ANTHROPIC_OAUTH_TOKEN` | Anthropic OAuth 令牌（若使用 OAuth） |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Google AI（Gemini）密钥 |
| `GROQ_API_KEY` | Groq API 密钥 |
| `CEREBRAS_API_KEY` | Cerebras API 密钥 |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 |
| `MINIMAX_API_KEY` | MiniMax API 密钥 |
| `MOONSHOT_API_KEY` | 月之暗面 / Kimi 系（详见 `PROVIDER_ENV_MAP` 中 `moonshotai*` 与 `kimi-coding`） |
| `FIREWORKS_API_KEY` | Fireworks AI |
| `TOGETHER_API_KEY` | Together AI |
| `CLOUDFLARE_API_KEY` | Cloudflare Workers AI / AI Gateway |
| `XIAOMI_API_KEY` | 小米 MiMo 按量；Token 套餐见 `XIAOMI_TOKEN_PLAN_*_API_KEY` |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway（亦支持 `VERCEL_AI_GATEWAY_API_KEY`） |
| `DASHSCOPE_API_KEY` | 阿里云 DashScope API 密钥（STT/TTS） |
| `XOPC_TTS_SUMMARIZE_MODEL` | 未配置 `tts.summarization.model` 时，TTS 长文本摘要使用的模型引用 |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `XOPC_CONFIG` | 自定义配置文件路径 |
| `XOPC_WORKSPACE` | 自定义工作区目录 |
| `XOPC_SESSION_SEARCH_MODEL` | `session_search` 需要生成会话摘要时使用的默认模型 |
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
xopc config validate
# 兼容旧写法：
xopc config --validate
```

### 查看配置

```bash
xopc config show
# 兼容旧写法：
xopc config --show
```

使用 `xopc config set` / `xopc config unset` 修改配置，或通过 `xopc config path` 在编辑器中打开文件。

---

## update（更新）

控制版本检查、可选自动安装及更新后 gateway 重启。详见 [更新](./update.md)。

```json
{
  "update": {
    "channel": "stable",
    "checkOnStart": true,
    "auto": {
      "enabled": false,
      "stableDelayHours": 6,
      "stableJitterHours": 12,
      "betaCheckIntervalHours": 1
    }
  },
  "commands": {
    "restart": true
  }
}
```

| 键 | 默认值 | 说明 |
|----|--------|------|
| `update.channel` | `stable` | `stable` \| `beta` \| `dev`，对应 npm 标签 `latest` / `beta` / `dev` |
| `update.checkOnStart` | `true` | Gateway 启动时查询 registry |
| `update.auto.enabled` | `false` | 由 Gateway 自动安装（仅 stable/beta 的全局 npm，不含 git 工作区） |
| `update.auto.stableDelayHours` | `6` | 稳定版首次发现后的等待时间 |
| `update.auto.stableJitterHours` | `12` | 稳定版自动更新的随机额外延迟 |
| `update.auto.betaCheckIntervalHours` | `1` | 同一 beta 版本两次自动尝试的最小间隔（小时） |
| `commands.restart` | `true` | 为 `false` 时禁用更新后重启及 SIGUSR1 重启 |

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
