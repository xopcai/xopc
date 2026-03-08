# 内置 API Key 和 OAuth 快速配置设计方案

## 当前架构分析

### 1. 内置模型定义 (src/config/schema.ts)
```typescript
export const BUILTIN_MODELS: BuiltinModel[] = [
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' },
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
  // ...
];

export const PROVIDER_OPTIONS: ProviderOption[] = [
  { name: 'OpenAI (GPT-4, o1)', value: 'openai', envKey: 'OPENAI_API_KEY', models: [...] },
  { name: 'Anthropic (Claude)', value: 'anthropic', envKey: 'ANTHROPIC_API_KEY', models: [...] },
  // ...
];
```

### 2. OAuth Providers (src/auth/oauth/)
- 已支持：Anthropic, Qwen, Kimi, MiniMax, MiniMax-CN, GitHub Copilot, Google Gemini
- 接口：`OAuthProviderInterface` - `login()`, `refreshToken()`, `getApiKey()`

### 3. 配置结构
```json
{
  "models": {
    "providers": {
      "openai": {
        "baseUrl": "https://api.openai.com/v1",
        "api": "openai-completions",
        "apiKey": "sk-...",
        "models": [...]
      }
    }
  },
  "auth": {
    "profiles": {
      "minimax-portal:default": {
        "provider": "minimax-portal",
        "mode": "oauth"
      }
    }
  }
}
```

## UI 设计方案

### 方案 A: Providers Section 顶部快速配置区

在 Providers section 顶部添加「快速配置」区域：

```
┌─────────────────────────────────────────────┐
│ Providers                                   │
├─────────────────────────────────────────────┤
│ Quick Setup                                 │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│ │ OpenAI  │ │Kimi OAuth│ │  Zhipu  │        │
│ │[API Key]│ │ [Login] │ │[API Key]│        │
│ └─────────┘ └─────────┘ └─────────┘        │
│                                             │
│ [+ Show More Providers...]                  │
├─────────────────────────────────────────────┤
│ ▼ Custom Providers                          │
│   (existing provider cards)                 │
└─────────────────────────────────────────────┘
```

### 方案 B: 新建 Provider 时选择模板

在「Add Provider」模态框中添加「选择模板」步骤：

```
┌─────────────────────────────────────────────┐
│ Add Provider                                │
├─────────────────────────────────────────────┤
│ Select Provider Template:                   │
│                                             │
│ ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│ │  OpenAI  │  │  Kimi    │  │  Qwen    │   │
│ │ API Key  │  │  OAuth   │  │  OAuth   │   │
│ └──────────┘  └──────────┘  └──────────┘   │
│                                             │
│ ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│ │Anthropic │  │ MiniMax  │  │  Custom  │   │
│ │ API Key  │  │  OAuth   │  │  Manual  │   │
│ └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────┘
```

## 推荐实现：方案 B（Provider 模板选择）

### 1. 定义 Provider 模板配置

```typescript
// src/config/provider-templates.ts

export interface ProviderTemplate {
  id: string;
  name: string;
  icon: string;
  authType: 'api_key' | 'oauth';
  oauthProvider?: string;  // OAuth provider ID for auth flow
  defaultConfig: {
    baseUrl: string;
    api: string;
    models: ModelConfig[];
  };
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    icon: 'openai',
    authType: 'api_key',
    defaultConfig: {
      baseUrl: 'https://api.openai.com/v1',
      api: 'openai-completions',
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', capabilities: { text: true, image: true, reasoning: false }, contextWindow: 128000, maxTokens: 16384 },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', capabilities: { text: true, image: true, reasoning: false }, contextWindow: 128000, maxTokens: 16384 },
      ],
    },
  },
  {
    id: 'kimi',
    name: 'Kimi',
    icon: 'kimi',
    authType: 'oauth',
    oauthProvider: 'kimi-coding',
    defaultConfig: {
      baseUrl: 'https://api.moonshot.cn/v1',
      api: 'openai-completions',
      models: [
        { id: 'kimi-k2.5', name: 'Kimi K2.5', capabilities: { text: true, image: false, reasoning: false }, contextWindow: 200000, maxTokens: 8192 },
      ],
    },
  },
  // ... more templates
];
```

### 2. 后端 API 端点

```typescript
// GET /api/auth/providers - 获取支持的 OAuth providers
// POST /api/auth/oauth/:provider/login - 启动 OAuth 登录流程
// POST /api/auth/oauth/:provider/callback - OAuth 回调处理
```

### 3. UI 实现步骤

**步骤 1**: 修改「Add Provider」模态框为两步流程
- Step 1: 选择 Provider 模板
- Step 2: 配置认证（API Key 或 OAuth）

**步骤 2**: API Key Provider 配置
```
┌─────────────────────────────────────────────┐
│ Add Provider - OpenAI                       │
├─────────────────────────────────────────────┤
│                                             │
│ [Back to Templates]                         │
│                                             │
│ API Key: [                           ]      │
│          [sk-...                    ]       │
│                                             │
│ ℹ️ Your API key is stored locally           │
│                                             │
│ Models:                                     │
│ ☑ GPT-4o                                    │
│ ☑ GPT-4o Mini                               │
│ ☑ GPT-4                                     │
│                                             │
│        [Cancel]    [Add Provider]           │
└─────────────────────────────────────────────┘
```

**步骤 3**: OAuth Provider 配置
```
┌─────────────────────────────────────────────┐
│ Add Provider - Kimi                         │
├─────────────────────────────────────────────┤
│                                             │
│ [Back to Templates]                         │
│                                             │
│ ┌─────────────────────────────────────┐     │
│ │                                     │     │
│ │    [Click to Login with Kimi]      │     │
│ │                                     │     │
│ │    使用 Kimi 账号授权访问           │     │
│ │                                     │     │
│ └─────────────────────────────────────┘     │
│                                             │
│ ℹ️ You will be redirected to Kimi to       │
│    authorize access.                        │
│                                             │
│ Models:                                     │
│ ☑ Kimi K2.5                                 │
│                                             │
│        [Cancel]    [Add Provider]           │
└─────────────────────────────────────────────┘
```

**OAuth 流程**:
1. 用户点击「Login with Kimi」
2. 前端调用 `POST /api/auth/oauth/kimi/login`
3. 后端返回 OAuth URL
4. 前端打开弹窗/新标签页访问 OAuth URL
5. 用户授权后，后端接收 callback 并获取 token
6. 前端轮询或接收 WebSocket 通知获取 token
7. 完成 Provider 配置

### 4. 需要修改的文件

**后端**:
- `src/gateway/hono/app.ts` - 添加 OAuth 相关 API 端点
- `src/auth/oauth/` - 确保所有 OAuth providers 可用

**前端**:
- `ui/src/pages/SettingsPage.ts` - 重构 Add Provider 模态框
- `ui/src/utils/icons.ts` - 添加 provider 图标
- `ui/src/i18n/*.json` - 添加翻译

### 5. 简化版实现（推荐先实现）

**Phase 1**: API Key 快速配置
- 提供 Provider 模板选择
- 预填 baseUrl 和默认模型
- 用户只需输入 API Key

**Phase 2**: OAuth 集成
- 添加 OAuth 登录按钮
- 实现 OAuth 回调处理
- 自动填充 token 到配置

## 实施建议

1. **先实现简化版**：只支持 API Key 快速配置
2. **使用现有 OAuth 逻辑**：复用 `src/auth/oauth/` 的 providers
3. **模板配置复用**：使用现有的 `PROVIDER_OPTIONS` 和 `BUILTIN_MODELS`
