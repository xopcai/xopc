# 自定义模型配置

xopcbot 通过 `~/.xopcbot/models.json` 支持自定义模型提供商。

## 目录

- [快速开始](#快速开始)
- [配置](#配置)
- [支持的 API](#支持的-api)
- [提供商配置](#提供商配置)
- [模型配置](#模型配置)
- [覆盖内置提供商](#覆盖内置提供商)
- [API Key 解析方式](#api-key-解析方式)
- [前端界面](#前端界面)
- [配置示例](#配置示例)
- [API 端点](#api-端点)
- [故障排除](#故障排除)

## 快速开始

创建 `~/.xopcbot/models.json`：

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

`~/.xopcbot/models.json`（或通过 `XOPCBOT_MODELS_JSON` 环境变量设置）

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

## 提供商配置

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
| `api` | 否 | 提供商的 `api` | 覆盖提供商的 API |
| `reasoning` | 否 | `false` | 支持扩展思考能力 |
| `input` | 否 | `["text"]` | 输入类型：`["text"]` 或 `["text", "image"]` |
| `contextWindow` | 否 | `128000` | 上下文窗口大小 |
| `maxTokens` | 否 | `16384` | 最大输出 token 数 |
| `cost` | 否 | 全为 0 | `{input, output, cacheRead, cacheWrite}` 每百万 token |
| `headers` | 否 | - | 模型专用的自定义请求头 |
| `compat` | 否 | - | OpenAI 兼容性设置 |

## 覆盖内置提供商

### 覆盖 Base URL

将内置提供商路由到代理：

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

`apiKey` 字段支持三种格式：

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
3. 使用可视化编辑器配置提供商和模型

### 提供商管理

#### 添加提供商

点击 **"添加提供商"** 打开提供商配置对话框：

**使用预设快速设置：**
- **Ollama** - 本地 LLM (`http://localhost:11434/v1`)
- **LM Studio** - LM Studio 本地服务器 (`http://localhost:1234/v1`)
- **OpenRouter** - 多提供商聚合 (`https://openrouter.ai/api/v1`)
- **Vercel AI Gateway** - Vercel AI Gateway (`https://ai-gateway.vercel.sh/v1`)
- **vLLM** - vLLM 推理服务器 (`http://localhost:8000/v1`)
- **自定义** - 手动配置

选择预设会自动填写基础 URL 和 API 类型。

**配置字段：**
- **提供商 ID** - 唯一标识符（小写字母、数字、连字符，下划线）
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
  - 提供商顺序 - 优先级列表（如 `anthropic, openai`）
  - 允许的提供商 - 白名单（如 `amazon-bedrock`）

### API Key 测试

每个提供商显示 API key 类型标签（literal/env/shell）。点击 **"测试"** 可以：
- 验证 key 是否正确解析
- 查看解析后的值类型
- 检查错误（如缺少环境变量）

### 统计信息显示

工具栏显示实时统计：
- **提供商数量** - 自定义提供商数量（>0 时高亮蓝色）
- **模型数量** - 所有提供商的模型总数

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
- `config.json` 包含内置提供商的 API keys（简单字符串格式）
- `models.json` 包含自定义提供商配置（带模型）

这种分离允许：
- 不同的文件权限来保护敏感的 API keys
- 更方便管理自定义模型配置
- 热重载模型而不影响其他设置