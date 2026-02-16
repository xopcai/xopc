# 模型配置

xopcbot 通过统一的配置系统支持多个 LLM 提供商。

## 配置文件

所有模型配置存储在 `~/.xopcbot/config.json` 中：

```json
{
  "providers": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "baseUrl": "https://api.openai.com/v1",
      "models": ["gpt-4o", "gpt-4o-mini", "gpt-5", "o1", "o3"]
    },
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}",
      "models": ["claude-sonnet-4-5", "claude-opus-4-5"]
    },
    "qwen": {
      "apiKey": "${QWEN_API_KEY}",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "models": ["qwen-plus", "qwen-max"]
    },
    "ollama": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:11434/v1",
      "models": ["qwen2.5:7b"],
      "autoDiscovery": true
    }
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

## 提供商配置

### 通用选项

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `apiKey` | string | 否 | API 密钥，支持 `${ENV_VAR}` 语法 |
| `baseUrl` | string | 否 | API 基础 URL（可选，有默认值） |
| `api` | string | 否 | API 类型：`openai-completions`、`anthropic-messages`、`google-generative-ai` |
| `models` | string[] | 否 | 自定义模型列表（扩展内置模型） |

### 内置提供商

| 提供商 | API Key 环境变量 | 基础 URL | 备注 |
|--------|------------------|----------|------|
| `openai` | `OPENAI_API_KEY` | `https://api.openai.com/v1` | GPT-4, o1, o3 |
| `anthropic` | `ANTHROPIC_API_KEY` | - | Claude 模型 |
| `google` | `GOOGLE_API_KEY` | - | Gemini 模型 |
| `qwen` | `QWEN_API_KEY` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 通义千问 |
| `kimi` | `KIMI_API_KEY` | `https://api.moonshot.cn/v1` | 月之暗面 |
| `moonshot` | `MOONSHOT_API_KEY` | `https://api.moonshot.ai/v1` | Moonshot AI |
| `minimax` | `MINIMAX_API_KEY` | `https://api.minimax.io/anthropic` | MiniMax |
| `minimax-cn` | `MINIMAX_CN_API_KEY` | `https://api.minimaxi.com/anthropic` | MiniMax 国内版 |
| `deepseek` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` | DeepSeek |
| `groq` | `GROQ_API_KEY` | `https://api.groq.com/openai/v1` | Llama, Mixtral |
| `openrouter` | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` | 多提供商聚合 |
| `xai` | `XAI_API_KEY` | `https://api.x.ai/v1` | Grok |
| `bedrock` | AWS 凭证 | - | Amazon Bedrock |

### Ollama 配置

Ollama 默认支持自动发现：

```json
{
  "providers": {
    "ollama": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:11434/v1",
      "autoDiscovery": true,
      "models": ["qwen2.5:7b"]
    }
  }
}
```

**选项：**

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 启用/禁用 Ollama 提供商 |
| `baseUrl` | string | `http://127.0.0.1:11434/v1` | Ollama 服务器 URL |
| `autoDiscovery` | boolean | `true` | 自动检测本地运行的模型 |
| `models` | string[] | [] | 手动指定模型 |

## 环境变量

在配置中使用 `${ENV_VAR}` 语法引用环境变量：

```json
{
  "providers": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}"
    }
  }
}
```

然后设置环境变量：
```bash
export OPENAI_API_KEY="sk-..."
```

## CLI 命令

### 列出可用模型

```bash
xopcbot models list
xopcbot models list --all    # 显示所有模型
xopcbot models list --json   # 输出为 JSON
```

### 设置默认模型

```bash
xopcbot models set openai/gpt-4o
```

### 添加自定义模型

```bash
# 添加模型到现有提供商
xopcbot models add --provider openai --model gpt-4.1

# 添加带自定义基础 URL 的提供商
xopcbot models add --provider custom --baseUrl https://api.example.com/v1 --model my-model
```

### 删除模型

```bash
# 删除特定模型
xopcbot models remove openai/gpt-4o

# 删除整个提供商配置
xopcbot models remove openai
```

### 管理 API 密钥

```bash
# 设置 API 密钥
xopcbot models auth set openai ${OPENAI_API_KEY}

# 列出已配置的提供商
xopcbot models auth list
```

## 内置模型

以下模型默认可用：

| 提供商 | 模型 |
|--------|------|
| openai | gpt-4o, gpt-4o-mini, gpt-5, o1, o3 |
| anthropic | claude-sonnet-4-5, claude-haiku-4-5, claude-opus-4-5 |
| google | gemini-2.5-pro, gemini-2.5-flash |
| qwen | qwen-plus, qwen-max, qwen3-235b |
| kimi | kimi-k2.5, kimi-k2-thinking |
| minimax | minimax-m2.1, minimax-m2 |
| deepseek | deepseek-chat, deepseek-reasoner |
| groq | llama-3.3-70b |

## Models.dev 集成

xopcbot 集成了 [models.dev](https://models.dev/)，这是一个综合性的开源 AI 模型规格数据库。此功能**默认启用**，无需在运行时发起网络请求即可提供额外的模型信息。

### 配置

```json
{
  "modelsDev": {
    "enabled": true
  }
}
```

要禁用 models.dev 集成：

```json
{
  "modelsDev": {
    "enabled": false
  }
}
```

### 支持的提供商

本地 models.dev 数据包含以下提供商的模型：

- **openai** - GPT 模型
- **anthropic** - Claude 模型
- **google** - Gemini 模型
- **groq** - Llama, Mixtral 模型
- **deepseek** - DeepSeek 模型
- **openrouter** - 多提供商路由
- **xai** - Grok 模型
- **zhipu** - GLM 模型

### 工作原理

启用后，xopcbot 会在启动时自动从内置的本地缓存加载模型数据。这提供了：

1. **更快的启动** - 加载模型列表无需网络请求
2. **离线支持** - 可以在没有网络连接的情况下工作
3. **最新模型** - 本地数据预先从 models.dev API 获取

本地数据存储在 `src/providers/models-dev-data.ts` 中，可以通过从 models.dev API 获取新数据来重新生成。

## 模型引用

使用 `提供商/模型ID` 格式引用模型：

- `openai/gpt-4o`
- `anthropic/claude-sonnet-4-5`
- `qwen/qwen-plus`

或者仅使用 ID 进行自动检测：
- `gpt-4o` (自动检测为 openai)
- `claude-sonnet-4-5` (自动检测为 anthropic)
