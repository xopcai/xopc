# Model Provider 简化设计文档

## 现状问题

当前 xopcbot 的 provider 系统过于复杂，包含以下问题：

1. **多层合并逻辑** - built-in manifest + pi-ai npm + user config + Ollama 发现，难以追踪模型来源
2. **重复的类型定义** - `models.types.ts`、`types.ts`、pi-ai 自带类型，三层类型转换
3. **复杂的 ModelRegistry 类** - 300+ 行代码，包含 OAuth、AuthProfiles、配置合并等混杂逻辑
4. **冗余的配置层** - `models.json` 和 config.json 的 `models.providers` 重复定义
5. **过度抽象** - 为了灵活性牺牲了简单性，实际上 90% 场景只需要 pi-ai 内置模型 + 少量自定义

## 设计目标

1. **极简核心** - 直接复用 pi-ai 的模型注册表，零重复定义
2. **显式配置** - 用户配置只做一件事：覆盖/添加模型
3. **类型安全** - 直接使用 pi-ai 的 `Model<Api>` 类型，无中间层
4. **易于理解** - 新人能在 5 分钟内理解模型解析流程

## 新设计方案

### 核心原则

```
┌─────────────────────────────────────────────────────────────┐
│  pi-ai (source of truth)                                    │
│  ├── getProviders()                                         │
│  ├── getModels(provider)                                    │
│  ├── getModel(provider, modelId)                            │
│  └── Model<Api> type                                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  xopcbot config.json (user overrides only)                  │
│  {                                                          │
│    "customModels": [  ← 只保留这一个字段                     │
│      {                                                      │
│        "id": "my-model",                                    │
│        "provider": "ollama",  ← 或任何现有 provider         │
│        "baseUrl": "http://localhost:11434/v1"               │
│      }                                                      │
│    ]                                                        │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  ModelResolver (简单合并)                                    │
│  1. 从 pi-ai 获取所有内置模型                                │
│  2. 用 customModels 覆盖/追加                                │
│  3. 返回 Model<Api>[]                                        │
└─────────────────────────────────────────────────────────────┘
```

### API 设计

```typescript
// src/providers/index.ts
import type { Model, Api, KnownProvider } from '@mariozechner/pi-ai';

/**
 * 用户自定义模型配置
 */
export interface CustomModel {
  /** 模型 ID，如 "llama3.1-8b" */
  id: string;
  /** 所属 provider，如 "ollama"、"openai" */
  provider: string;
  /** 可选：覆盖 baseUrl */
  baseUrl?: string;
  /** 可选：覆盖 API 类型 */
  api?: Api;
  /** 可选：自定义请求头 */
  headers?: Record<string, string>;
  /** 可选：其他 Model 字段覆盖 */
  name?: string;
  reasoning?: boolean;
  input?: ('text' | 'image')[];
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  contextWindow?: number;
  maxTokens?: number;
}

/**
 * 模型解析器 - 简化版
 * 
 * 职责：
 * 1. 从 pi-ai 获取内置模型
 * 2. 合并用户自定义模型
 * 3. 提供查询方法
 */
export class ModelResolver {
  private customModels: CustomModel[];
  
  constructor(customModels: CustomModel[] = []) {
    this.customModels = customModels;
  }
  
  /**
   * 获取所有可用模型（内置 + 自定义）
   */
  getAll(): Model<Api>[];
  
  /**
   * 获取指定 provider 的所有模型
   */
  getByProvider(provider: string): Model<Api>[];
  
  /**
   * 解析模型引用
   * 
   * 支持格式：
   * - "openai/gpt-4o" → 从 pi-ai 获取
   * - "gpt-4o" → 自动检测 provider
   * - "ollama/llama3.1" → 自定义模型
   */
  resolve(ref: string): Model<Api> | undefined;
  
  /**
   * 检查模型是否可用（有 API key 配置）
   */
  isAvailable(model: Model<Api>): boolean;
}

/**
 * 快速获取模型（常用场景）
 */
export function resolveModel(ref: string, customModels?: CustomModel[]): Model<Api>;

/**
 * 创建 Ollama 自定义模型配置
 */
export function createOllamaModel(name: string, baseUrl?: string): CustomModel;
```

### 配置格式

```jsonc
// ~/.xopcbot/config.json
{
  // 移除复杂的 models.providers 结构
  // 只保留简单的 customModels 数组
  
  "customModels": [
    // 示例 1：Ollama 本地模型
    {
      "id": "llama3.2",
      "provider": "ollama",
      "baseUrl": "http://localhost:11434/v1",
      "name": "Llama 3.2 (Local)"
    },
    
    // 示例 2：覆盖 OpenAI 的 baseUrl（使用代理）
    {
      "id": "gpt-4o",
      "provider": "openai",
      "baseUrl": "https://my-proxy.example.com/v1"
    },
    
    // 示例 3：LiteLLM 代理上的新模型
    {
      "id": "claude-3-opus",
      "provider": "openai",  // 使用 openai-completions API
      "baseUrl": "http://localhost:4000/v1",
      "name": "Claude 3 Opus (via LiteLLM)",
      "api": "openai-completions",
      "reasoning": true,
      "input": ["text", "image"],
      "contextWindow": 200000,
      "cost": { "input": 15, "output": 75 }
    }
  ],
  
  // 保留 API key 配置（简化版）
  "apiKeys": {
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}"
    // ... 其他 provider
  }
}
```

### 与 pi-ai 的关系

```typescript
import { getModel, getModels, getProviders } from '@mariozechner/pi-ai';
import type { Model, Api } from '@mariozechner/pi-ai';

class ModelResolver {
  /**
   * 核心逻辑：优先从自定义列表查找，否则回退到 pi-ai
   */
  resolve(ref: string): Model<Api> | undefined {
    // 解析引用格式
    const { provider, modelId } = this.parseRef(ref);
    
    // 1. 先查自定义模型
    const custom = this.findCustom(provider, modelId);
    if (custom) return this.toModel(custom);
    
    // 2. 回退到 pi-ai 内置
    try {
      return getModel(provider as any, modelId as any);
    } catch {
      return undefined;
    }
  }
  
  /**
   * 获取所有模型：pi-ai 内置 + 自定义
   */
  getAll(): Model<Api>[] {
    const builtIn = getProviders().flatMap(p => {
      try {
        return getModels(p);
      } catch {
        return [];
      }
    });
    
    const custom = this.customModels.map(m => this.toModel(m));
    
    // 自定义模型覆盖同名内置模型
    const customRefs = new Set(custom.map(m => `${m.provider}/${m.id}`));
    const filtered = builtIn.filter(m => !customRefs.has(`${m.provider}/${m.id}`));
    
    return [...filtered, ...custom];
  }
}
```

### 废弃内容

以下模块/功能将被完全移除：

| 模块 | 原因 |
|------|------|
| `models.json` | 重复定义 pi-ai 已包含的信息 |
| `models-loader.ts` | 4层合并逻辑过于复杂 |
| `models.types.ts` | 中间层类型，直接使用 pi-ai 类型 |
| `registry.ts` ModelRegistry | 300+行复杂类，替换为 50 行 ModelResolver |
| `auto-discovery.ts` | Ollama 发现改为用户显式配置 |
| `api-strategies.ts` | pi-ai 内部已处理 API 差异 |
| `config.ts` providerConfig | 合并到主配置 |
| `pi-ai.ts` | 直接导入使用 |
| `types.ts` | 合并到 `index.ts` |

### 迁移指南

**旧配置（废弃）：**
```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "openai": {
        "baseUrl": "...",
        "models": [{ "id": "...", "name": "..." }]
      }
    }
  }
}
```

**新配置：**
```json
{
  "customModels": [
    { "id": "...", "provider": "openai", "baseUrl": "..." }
  ]
}
```

### 代码示例

#### 场景 1：获取模型并调用

```typescript
import { resolveModel } from './providers/index.js';
import { complete } from '@mariozechner/pi-ai';
import { readConfig } from './config/index.js';

const config = readConfig();
const resolver = new ModelResolver(config.customModels);

// 使用完整引用
const model = resolver.resolve('openai/gpt-4o');

// 或使用简写（自动检测 provider）
const model2 = resolver.resolve('gpt-4o');

// 直接调用
const response = await complete(model, {
  messages: [{ role: 'user', content: 'Hello' }]
});
```

#### 场景 2：列出所有可用模型

```typescript
import { ModelResolver } from './providers/index.js';

const resolver = new ModelResolver(config.customModels);

// 所有模型（含未配置 API key 的）
const all = resolver.getAll();

// 仅已配置 API key 的
const available = all.filter(m => resolver.isAvailable(m));

// 按 provider 分组
const byProvider = Map.groupBy(available, m => m.provider);
```

#### 场景 3：Ollama 本地模型

```typescript
import { createOllamaModel, ModelResolver } from './providers/index.js';

const config = {
  customModels: [
    createOllamaModel('llama3.2'),
    createOllamaModel('qwen2.5', 'http://192.168.1.100:11434/v1')
  ]
};

const resolver = new ModelResolver(config.customModels);
const model = resolver.resolve('ollama/llama3.2');
```

## 实施计划

### Phase 1: 新建简化模块
1. 创建 `src/providers/resolver.ts` - ModelResolver 类
2. 更新 `src/providers/index.ts` - 新 API 导出
3. 更新 `src/config/schema.ts` - 新的配置格式

### Phase 2: 迁移调用方
1. 更新 `src/agent/service.ts` - 使用新 resolver
2. 更新 `src/gateway/` - API 端点使用新 resolver
3. 更新 `src/ui/` - 前端配置使用新格式

### Phase 3: 删除旧代码
1. 删除 `src/providers/models.json`
2. 删除 `src/providers/models-loader.ts`
3. 删除 `src/providers/models.types.ts`
4. 删除 `src/providers/registry.ts`
5. 删除 `src/providers/auto-discovery.ts`
6. 删除 `src/providers/api-strategies.ts`
7. 删除 `src/providers/config.ts`
8. 删除 `src/providers/pi-ai.ts`
9. 删除 `src/providers/types.ts`

### Phase 4: 文档更新
1. 更新 `AGENTS.md` provider 相关章节
2. 添加配置迁移指南
3. 更新示例配置

## 预期收益

| 指标 | 之前 | 之后 | 变化 |
|------|------|------|------|
| 代码行数 | ~1500 | ~150 | -90% |
| 配置文件复杂度 | 多层嵌套 | 扁平数组 | -80% |
| 类型定义层数 | 3 层 | 1 层 | -67% |
| 理解时间 | 30 分钟 | 5 分钟 | -83% |
| 维护成本 | 高 | 极低 | -90% |

## 向后兼容性

**不兼容变更**：新设计是破坏性变更，需要：
1. 大版本号更新 (v2.0.0)
2. 提供配置迁移脚本
3. 详细的迁移文档

**迁移脚本示例：**
```bash
# 自动将旧配置转换为新配置
npx xopcbot migrate-config --from ~/.xopcbot/config.json --to ~/.xopcbot/config.v2.json
```
