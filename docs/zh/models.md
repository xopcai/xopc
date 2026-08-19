# 模型与服务商

xopc 可以直接使用内置 LLM 服务商；只有在添加自定义服务商、本地推理服务或覆盖模型元数据时，才需要编辑 `~/.xopc/models.json`。

## 内置 LLM 服务商（pi-ai）

网关控制台 **设置 → 服务商**、**`xopc providers`** 和 **`xopc models`** 使用同一套 `@earendil-works/pi-ai` 内置 provider id。多数用户应优先使用内置服务商，而不是一开始就改 `models.json`。

**推荐起步模型**：建议使用 **DeepSeek V4 Flash**，模型引用为 `deepseek/deepseek-v4-flash`。这是控制台推荐的快速路径，价格/性能比较好，并且只需要配置 API Key。

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
        "workflows": {},
        "boundaries": { "requiresConfirmation": [], "forbidden": [], "escalation": [] }
      }
    ]
  },
  "providers": {
    "deepseek": "${DEEPSEEK_API_KEY}"
  }
}
```

也可以直接在终端设置同一个 key：

```bash
export DEEPSEEK_API_KEY="sk-..."
```

**默认对话模型**：xopc 从 `agents.default` 与 `agents.list` 解析当前 agent。模型角色放在 `agents.list[].models.roles` 下；workflow 可以引用这些 typed roles，避免在每个步骤里硬编码模型。

当前内置覆盖（节选）：**DeepSeek**、**OpenAI**、**Anthropic**、**Google / Vertex**、**Azure OpenAI**、**AWS Bedrock**、**Groq**、**xAI**、**Mistral**、**Cerebras**、**OpenRouter**、**Vercel AI Gateway**、**智谱 z.ai**、**MiniMax**（国际/国内）、**Kimi Coding**、**Moonshot**（`moonshotai` / `moonshotai-cn`）、**Hugging Face**、**Fireworks**、**Together**、**OpenCode / OpenCode Go**、**Cloudflare Workers AI** 与 **Cloudflare AI Gateway**、**GitHub Copilot**、**OpenAI Codex**（OAuth）、**Google Gemini CLI / Antigravity**、**小米 MiMo**。**`dashscope`** 为 xopc 侧文生图/语音等 HTTP 能力的环境 id，不是 pi-ai 的 LLM `KnownProvider`。

### 内置服务商凭据

内置服务商凭据可以来自 OAuth、已保存 API Key、`xopc.json` 或环境变量。解析顺序如下：

| 优先级 | 来源 | 示例 | 适合场景 |
|--------|------|------|----------|
| 1 | 控制台、`xopc auth` 或 `xopc providers set-key` 保存的 auth profile | OAuth access token 或粘贴的 API Key | 桌面端/控制台配置，以及可刷新的 OAuth |
| 2 | `xopc.json` 的 `providers` 配置 | `"deepseek": "${DEEPSEEK_API_KEY}"` | 可复现的工作区配置，同时不提交密钥 |
| 3 | `PROVIDER_ENV_MAP` 中的环境变量 | `DEEPSEEK_API_KEY`、`OPENAI_API_KEY`、`ANTHROPIC_OAUTH_TOKEN` | Shell、CI、容器和服务器部署 |

服务商需要浏览器登录或短期 token 时使用 OAuth；DeepSeek、OpenAI、OpenRouter 和多数 OpenAI-compatible 服务通常使用 API Key；不希望密钥写入配置文件时使用环境变量。

常见 OAuth/API Key 情况：

| Provider id | 凭据路径 |
|-------------|----------|
| `xopc-cloud` | 仅 OAuth；使用 `/login xopc-cloud`、`xopc auth login xopc-cloud` 或 Settings → Providers，access token 会自动刷新 |
| `deepseek` | Settings → Providers、`xopc providers set-key deepseek`、`providers.deepseek` 或 `DEEPSEEK_API_KEY` |
| `openai` | 已保存 key、配置文件或 `OPENAI_API_KEY` |
| `anthropic` | OAuth token 或 API Key；环境变量支持 `ANTHROPIC_OAUTH_TOKEN` 与 `ANTHROPIC_API_KEY` |
| `openai-codex` | 正常 Codex 访问为 OAuth-only；本地 Gateway 使用浏览器回调，远端或反向代理 Gateway 自动使用设备码。需要在 ChatGPT 安全设置或工作区设置中启用设备码登录。 |
| `google-gemini-cli` / `google-antigravity` | 按使用方式选择 OAuth token 或 API Key |
| `github-copilot` | 视配置使用 GitHub token 环境变量或 OAuth |

小米 MiMo 仍可通过 `xiaomi` 与 `xiaomi-token-plan-*` 使用；选择与你的接口和 token 套餐匹配的 provider id。

远程登录 `openai-codex` 时，请打开页面显示的验证地址并输入一次性设备码。如果设备码不可用，可在 CLI 中选择浏览器登录，将最终的完整 `http://localhost:1455/auth/callback?...` 地址粘贴到提示处，或者通过 SSH 转发 1455 端口。

## 目录

- [内置 LLM 服务商（pi-ai）](#内置-llm-服务商pi-ai)
- [自定义服务商快速开始](#自定义服务商快速开始)
- [配置](#配置)
- [支持的 API](#支持的-api)
- [服务商配置](#提供商配置)
- [模型配置](#模型配置)
- [覆盖内置服务商](#覆盖内置提供商)
- [API Key 解析方式](#api-key-解析方式)
- [前端界面](#前端界面)
- [配置示例](#配置示例)
- [API 端点](#api-端点)
- [故障排除](#故障排除)

## 自定义服务商快速开始

创建 `~/.xopc/models.json`：

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "llama3.1:8b" },
        { "id": "qwen2.5-coder:7b" }
      ]
    }
  }
}
```

`apiKey` 是必需的，但 Ollama 会忽略它，所以任意值都可以。

## 配置

### 文件位置

`~/.xopc/models.json`（或通过 `XOPC_MODELS_JSON` 环境变量设置）

### 最小配置示例

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

### 完整配置示例

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        {
          "id": "llama3.1:8b",
          "name": "Llama 3.1 8B (本地)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 32000,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    },
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "OPENROUTER_API_KEY",
      "api": "openai-completions",
      "models": [
        {
          "id": "anthropic/claude-3.5-sonnet",
          "name": "Claude 3.5 Sonnet (OR)",
          "compat": {
            "openRouterRouting": {
              "only": ["anthropic"]
            }
          }
        }
      ]
    }
  }
}
```

## 支持的 API

| API | 说明 |
|-----|------|
| `openai-completions` | OpenAI Chat Completions（最兼容） |
| `openai-responses` | OpenAI Responses API |
| `anthropic-messages` | Anthropic Messages API |
| `google-generative-ai` | Google Generative AI |
| `azure-openai-responses` | Azure OpenAI |
| `bedrock-converse-stream` | AWS Bedrock |
| `openai-codex-responses` | OpenAI Codex |
| `google-gemini-cli` | Google Gemini CLI |
| `google-vertex` | Google Vertex AI |

## 自定义图片生成服务

自定义图片生成只支持一个明确协议：`openai-images`。xopc 会向 `/images/generations` 和 `/images/edits` 发送标准 OpenAI Images 请求，不猜测厂商响应字段，也不执行兼容转换。

```json
{
  "providers": {
    "studio-images": {
      "baseUrl": "https://images.example.com/v1",
      "imageGeneration": {
        "api": "openai-images",
        "name": "Studio Images",
        "documentationUrl": "https://images.example.com/docs",
        "apiKeyUrl": "https://images.example.com/keys",
        "defaultModel": "image-1",
        "auth": { "type": "bearer" },
        "models": [
          {
            "id": "image-1",
            "capabilities": {
              "generate": { "maxCount": 1, "supportsSize": true },
              "edit": { "enabled": true, "maxInputImages": 1 }
            },
            "defaults": { "size": "1024x1024", "outputFormat": "png" }
          }
        ]
      }
    }
  }
}
```

`auth.type` 可选 `bearer`、`header`（同时设置 `headerName`）或 `none`。图片服务 API Key 只保存到网关凭据存储，不写入上述图片 Provider 定义；静态 `headers` 也不能包含认证 Header。

私网和回环地址默认阻止。若需要连接可信的本地服务，只列出精确主机名或 IP：

```json
"network": { "allowedHosts": ["127.0.0.1", "image-server.lan"] }
```

网关将 OpenAI Images JSON 响应限制为 64 MiB，单张解码图片限制为 32 MiB，单次响应全部图片合计限制为 64 MiB。可在 **设置 → 能力 → 图片** 中添加服务、管理凭据、执行一次真实生成测试，并把模型分配给 Agent。`xopc doctor` 会报告非法定义、被阻止的私网端点和缺失凭据。

## 服务商配置 {#提供商配置}

| 字段 | 说明 |
|------|------|
| `baseUrl` | API 端点 URL |
| `api` | API 类型（见上表） |
| `apiKey` | API Key（见下方解析方式） |
| `headers` | 自定义请求头 |
| `authHeader` | 设为 `true` 自动添加 `Authorization: Bearer <apiKey>` |
| `models` | 模型配置数组 |
| `modelOverrides` | 覆盖内置模型的配置 |

## 模型配置

| 字段 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | 是 | - | 模型标识符（传给 API 的值） |
| `name` | 否 | `id` | 显示名称 |
| `api` | 否 | 服务商的 `api` | 覆盖服务商的 API |
| `reasoning` | 否 | `false` | 支持扩展思考能力 |
| `input` | 否 | `["text"]` | 输入类型：`["text"]` 或 `["text", "image"]` |
| `contextWindow` | 否 | `128000` | 上下文窗口大小 |
| `maxTokens` | 否 | `16384` | 最大输出 Token 数 |
| `cost` | 否 | 全为 0 | `{input, output, cacheRead, cacheWrite}` 每百万 token |
| `headers` | 否 | - | 模型专用的自定义请求头 |
| `compat` | 否 | - | OpenAI 兼容性设置 |

## 覆盖内置服务商 {#覆盖内置提供商}

### 覆盖 Base URL

若需经由自建兼容网关、反向代理或中转服务访问内置服务商，可覆盖其 `baseUrl`：

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://my-proxy.example.com/v1"
    }
  }
}
```

### 模型覆盖

自定义特定内置模型：

```json
{
  "providers": {
    "openrouter": {
      "modelOverrides": {
        "anthropic/claude-sonnet-4": {
          "name": "Claude Sonnet 4 (Bedrock 路由)",
          "compat": {
            "openRouterRouting": {
              "only": ["amazon-bedrock"]
            }
          }
        }
      }
    }
  }
}
```

## API Key 解析方式

对于 `models.json` 中的自定义服务商，`apiKey` 字段支持三种格式：

### 1. Shell 命令

前缀 `!` 执行 shell 命令：

```json
{
  "apiKey": "!op read 'op://vault/item/credential'"
}
```

### 2. 环境变量

使用环境变量名称（全大写）：

```json
{
  "apiKey": "ANTHROPIC_API_KEY"
}
```

### 3. 字面量值

直接使用值：

```json
{
  "apiKey": "sk-..."
}
```

## 前端界面

在 Web UI 中访问模型配置：

1. 打开 Web UI（默认 http://localhost:18790）
2. 进入 **设置** → **模型**
3. 使用可视化编辑器配置服务商和模型

### 服务商管理

#### 添加服务商

点击 **"添加服务商"** 打开服务商配置对话框：

**使用预设快速设置：**
- **Ollama** - 本地 LLM (`http://localhost:11434/v1`)
- **LM Studio** - LM Studio 本地服务器 (`http://localhost:1234/v1`)
- **OpenRouter** - 聚合多家服务商 API（`https://openrouter.ai/api/v1`）
- **Vercel AI Gateway** - Vercel AI Gateway (`https://ai-gateway.vercel.sh/v1`)
- **vLLM** - vLLM 推理服务器 (`http://localhost:8000/v1`)
- **自定义** - 手动配置

选择预设会自动填写基础 URL 和 API 类型。

**配置字段：**
- **服务商 ID** - 唯一标识符（小写字母、数字、连字符，下划线）
- **API 类型** - API 协议（OpenAI Completions、Anthropic Messages 等）
- **基础 URL** - API 端点 URL（OpenAI 兼容 API 应以 `/v1` 结尾）
- **API Key** - 支持字面量值、环境变量（大写）或 shell 命令 (`!command`)

**高级选项：**
- **自动添加 Authorization 请求头** - 自动添加 `Authorization: Bearer {apiKey}`
- **自定义请求头** - JSON 格式的自定义请求头

### 模型管理

#### 添加/编辑模型

点击 **"添加模型"** 或现有模型的编辑图标打开模型编辑器对话框：

**基础标签页：**
- **模型 ID** - 唯一标识符（如 `llama3.1:8b`、`gpt-4o`）
- **显示名称** - 人类可读的名称
- **输入类型** - 仅文本或文本+视觉
- **支持推理** - 启用具有扩展思考能力的模型
- **上下文窗口** - 最大上下文 token 数（默认：128000）
- **最大输出 Token** - 最大响应 token 数（默认：16384）

**高级标签页：**
- **成本配置** - 每百万 token 定价：
  - 输入 / 输出 / 缓存读取 / 缓存写入
- **自定义请求头** - 模型专用的请求头（JSON 格式）

**兼容性标签页：**
- **OpenAI Completions 设置：**
  - 支持 Store
  - 支持 Developer Role
  - 流式响应中支持 Usage
  - Max Tokens 字段（自动检测 / max_completion_tokens / max_tokens）
- **路由配置**（用于 OpenRouter/Vercel）：
  - 服务商顺序 - 优先级列表（如 `anthropic, openai`）
  - 允许的服务商 - 白名单（如 `amazon-bedrock`）

### API Key 测试

每个服务商显示 API key 类型标签（literal/env/shell）。点击 **"测试"** 可以：
- 验证 key 是否正确解析
- 查看解析后的值类型
- 检查错误（如缺少环境变量）

### 统计信息显示

工具栏显示实时统计：
- **服务商数量** - 自定义服务商数量（>0 时高亮蓝色）
- **模型数量** - 所有服务商的模型总数

### 操作按钮

- **验证** - 检查配置错误而不保存
- **保存** - 保存更改到 models.json
- **重新加载** - 热重载配置无需重启
- **显示/隐藏 JSON** - 查看原始 JSON 配置

### 热重载

在 UI 中保存更改后会自动重新加载。无需重启。

## 配置示例

### Ollama（本地）

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "llama3.1:8b" },
        { "id": "qwen2.5-coder:7b" }
      ]
    }
  }
}
```

### OpenRouter

```json
{
  "providers": {
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "OPENROUTER_API_KEY",
      "api": "openai-completions",
      "models": [
        {
          "id": "anthropic/claude-3.5-sonnet",
          "compat": {
            "openRouterRouting": {
              "order": ["anthropic", "openai"]
            }
          }
        }
      ]
    }
  }
}
```

### Vercel AI Gateway

```json
{
  "providers": {
    "vercel-ai-gateway": {
      "baseUrl": "https://ai-gateway.vercel.sh/v1",
      "apiKey": "AI_GATEWAY_API_KEY",
      "api": "openai-completions",
      "models": [
        {
          "id": "moonshotai/kimi-k2.5",
          "name": "Kimi K2.5 (Fireworks via Vercel)",
          "compat": {
            "vercelGatewayRouting": {
              "only": ["fireworks", "novita"]
            }
          }
        }
      ]
    }
  }
}
```

### LM Studio

```json
{
  "providers": {
    "lmstudio": {
      "baseUrl": "http://localhost:1234/v1",
      "api": "openai-completions",
      "apiKey": "lmstudio",
      "models": [
        { "id": "local-model" }
      ]
    }
  }
}
```

## API 端点

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/models-json` | 获取 models.json 配置 |
| POST | `/api/models-json/validate` | 验证 models.json 配置 |
| PATCH | `/api/models-json` | 保存 models.json |
| POST | `/api/models-json/reload` | 热重载 |
| POST | `/api/models-json/test-api-key` | 测试 API key 解析 |
| GET | `/api/image-generation/custom-providers` | 列出自定义图片服务（不返回密钥） |
| PUT | `/api/image-generation/custom-providers/:providerId` | 创建或替换自定义图片服务 |
| DELETE | `/api/image-generation/custom-providers/:providerId` | 删除自定义图片服务定义 |
| PUT | `/api/image-generation/providers/:providerId/credential` | 保存图片服务 API Key |
| POST | `/api/image-generation/providers/:providerId/reveal-api-key` | 查看本机保存的图片服务密钥 |
| DELETE | `/api/image-generation/providers/:providerId/credential` | 删除图片服务凭据 |
| POST | `/api/image-generation/providers/:providerId/test` | 执行一次真实图片生成测试 |

## 故障排除

### 模型未显示

1. 检查浏览器控制台是否有错误
2. 验证 `models.json` 语法是否为有效 JSON
3. 检查设置 → 模型页面是否有验证错误
4. 确保 API Key 正确解析（使用测试按钮）

### API Key 不生效

1. 使用"测试"按钮验证解析
2. 检查环境变量是否设置
3. 对于 shell 命令，确保手动运行时有效
4. 检查日志中的命令执行错误

### 更改未生效

1. 点击 UI 中的"重新加载"强制刷新
2. 检查 `models.json` 文件是否正确保存
3. 如需可重启网关

### 与 config.json 分离

**注意：** `models.json` 与 `config.json` 是分开的：
- `config.json` 包含内置服务商的 API keys（简单字符串格式）
- `models.json` 包含自定义服务商配置（带模型）

这种分离允许：
- 不同的文件权限来保护敏感的 API keys
- 更方便管理自定义模型配置
- 热重载模型而不影响其他设置
