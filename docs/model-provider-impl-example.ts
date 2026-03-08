/**
 * 简化版 Model Provider 实现示例
 * 
 * 这是新设计的参考实现，展示如何替换现有的复杂系统
 */

import {
  getModel as getPiAiModel,
  getModels as getPiAiModels,
  getProviders as getPiAiProviders,
  type Model,
  type Api,
  type KnownProvider,
} from '@mariozechner/pi-ai';
import { getConfigApiKey } from '../config/schema.js';
import type { Config } from '../config/schema.js';

// ============================================================================
// 类型定义（极简）
// ============================================================================

/**
 * 用户自定义模型配置
 */
export interface CustomModel {
  id: string;
  provider: string;
  baseUrl?: string;
  api?: Api;
  headers?: Record<string, string>;
  name?: string;
  reasoning?: boolean;
  input?: ('text' | 'image')[];
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextWindow?: number;
  maxTokens?: number;
}

/**
 * 简化的配置格式
 */
export interface SimpleModelConfig {
  /** 自定义模型列表（覆盖或追加到 pi-ai 内置模型） */
  customModels?: CustomModel[];
}

// ============================================================================
// 核心类：ModelResolver
// ============================================================================

export class ModelResolver {
  private customModels: CustomModel[];
  private config: Config | null;

  constructor(config?: { customModels?: CustomModel[]; config?: Config | null }) {
    this.customModels = config?.customModels ?? [];
    this.config = config?.config ?? null;
  }

  /**
   * 解析模型引用
   * 
   * 支持格式：
   * - "provider/modelId" → 精确指定
   * - "modelId" → 自动检测 provider
   */
  resolve(ref: string): Model<Api> | undefined {
    const { provider, modelId } = this.parseRef(ref);

    // 1. 先查自定义模型
    const custom = this.customModels.find(
      m => m.provider === provider && m.id === modelId
    );
    if (custom) {
      return this.toModel(custom);
    }

    // 2. 回退到 pi-ai 内置
    try {
      return getPiAiModel(provider as any, modelId as any);
    } catch {
      return undefined;
    }
  }

  /**
   * 获取所有模型（内置 + 自定义）
   */
  getAll(): Model<Api>[] {
    const result = new Map<string, Model<Api>>();

    // 1. 添加所有 pi-ai 内置模型
    for (const provider of getPiAiProviders()) {
      try {
        const models = getPiAiModels(provider);
        for (const model of models) {
          const key = `${model.provider}/${model.id}`;
          result.set(key, model as Model<Api>);
        }
      } catch {
        // 跳过无法加载的 provider
      }
    }

    // 2. 用自定义模型覆盖
    for (const custom of this.customModels) {
      const key = `${custom.provider}/${custom.id}`;
      result.set(key, this.toModel(custom));
    }

    return Array.from(result.values());
  }

  /**
   * 获取指定 provider 的所有模型
   */
  getByProvider(provider: string): Model<Api>[] {
    return this.getAll().filter(m => m.provider === provider);
  }

  /**
   * 获取所有 provider 列表
   */
  getProviders(): string[] {
    const all = this.getAll();
    return [...new Set(all.map(m => m.provider))];
  }

  /**
   * 检查模型是否可用（有配置 API key）
   */
  isAvailable(model: Model<Api>): boolean {
    // Ollama 等本地模型总是可用
    if (model.provider === 'ollama') return true;

    // 检查是否有 API key 配置
    if (this.config) {
      const key = getConfigApiKey(this.config, model.provider);
      if (key) return true;
    }

    // 检查环境变量
    const envKey = this.getEnvApiKey(model.provider);
    if (envKey) return true;

    return false;
  }

  /**
   * 获取可用的模型列表
   */
  getAvailable(): Model<Api>[] {
    return this.getAll().filter(m => this.isAvailable(m));
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  private parseRef(ref: string): { provider: string; modelId: string } {
    const slashIndex = ref.indexOf('/');

    if (slashIndex === -1) {
      // 无 provider 前缀，尝试自动检测
      const modelId = ref;
      const provider = this.detectProvider(modelId);
      if (provider) {
        return { provider, modelId };
      }
      // 默认回退到 openai
      return { provider: 'openai', modelId };
    }

    const provider = ref.substring(0, slashIndex);
    const modelId = ref.substring(slashIndex + 1);
    return { provider, modelId };
  }

  private detectProvider(modelId: string): string | undefined {
    // 简单启发式检测
    const patterns: Record<string, string[]> = {
      openai: ['gpt-', 'o1', 'o3', 'o4'],
      anthropic: ['claude-'],
      google: ['gemini-'],
      xai: ['grok-'],
      groq: ['llama-', 'mixtral-'],
      deepseek: ['deepseek-'],
      qwen: ['qwen-', 'qwq-'],
      kimi: ['kimi-'],
      zhipu: ['glm-'],
      minimax: ['minimax-', 'MiniMax-'],
      mistral: ['mistral-'],
    };

    const lowerId = modelId.toLowerCase();
    for (const [provider, prefixes] of Object.entries(patterns)) {
      if (prefixes.some(p => lowerId.startsWith(p))) {
        return provider;
      }
    }

    // 检查是否匹配自定义模型
    for (const custom of this.customModels) {
      if (custom.id === modelId) {
        return custom.provider;
      }
    }

    return undefined;
  }

  private toModel(custom: CustomModel): Model<Api> {
    // 获取基础模型（如果是覆盖内置模型）
    let base: Partial<Model<Api>> = {};
    try {
      base = getPiAiModel(custom.provider as any, custom.id as any) || {};
    } catch {
      // 忽略，使用完全自定义
    }

    return {
      id: custom.id,
      name: custom.name || base.name || custom.id,
      api: custom.api || base.api || 'openai-completions',
      provider: custom.provider as KnownProvider,
      baseUrl: custom.baseUrl || base.baseUrl,
      reasoning: custom.reasoning ?? base.reasoning ?? false,
      input: custom.input || base.input || ['text'],
      cost: {
        input: custom.cost?.input ?? base.cost?.input ?? 0,
        output: custom.cost?.output ?? base.cost?.output ?? 0,
        cacheRead: custom.cost?.cacheRead ?? base.cost?.cacheRead ?? 0,
        cacheWrite: custom.cost?.cacheWrite ?? base.cost?.cacheWrite ?? 0,
      },
      contextWindow: custom.contextWindow ?? base.contextWindow ?? 128000,
      maxTokens: custom.maxTokens ?? base.maxTokens ?? 4096,
      headers: custom.headers || base.headers,
    } as Model<Api>;
  }

  private getEnvApiKey(provider: string): string | undefined {
    const envVars: Record<string, string[]> = {
      openai: ['OPENAI_API_KEY'],
      anthropic: ['ANTHROPIC_API_KEY'],
      google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      xai: ['XAI_API_KEY'],
      groq: ['GROQ_API_KEY'],
      deepseek: ['DEEPSEEK_API_KEY'],
      qwen: ['QWEN_API_KEY'],
      kimi: ['KIMI_API_KEY'],
      zhipu: ['ZHIPU_API_KEY'],
      minimax: ['MINIMAX_API_KEY'],
      mistral: ['MISTRAL_API_KEY'],
      openrouter: ['OPENROUTER_API_KEY'],
      cerebras: ['CEREBRAS_API_KEY'],
      ollama: ['OLLAMA_API_KEY'],
    };

    const vars = envVars[provider] || [];
    for (const v of vars) {
      const val = process.env[v];
      if (val) return val;
    }
    return undefined;
  }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 快速解析模型（常用场景）
 */
export function resolveModel(
  ref: string,
  customModels?: CustomModel[]
): Model<Api> {
  const resolver = new ModelResolver({ customModels });
  const model = resolver.resolve(ref);
  if (!model) {
    throw new Error(`Model not found: ${ref}`);
  }
  return model;
}

/**
 * 创建 Ollama 自定义模型配置
 */
export function createOllamaModel(
  name: string,
  baseUrl: string = 'http://localhost:11434/v1'
): CustomModel {
  return {
    id: name,
    provider: 'ollama',
    name: `${name} (Ollama)`,
    baseUrl,
    api: 'openai-completions',
    reasoning: name.toLowerCase().includes('r1'),
    input: ['text'],
    cost: { input: 0, output: 0 },
    contextWindow: 131072,
    maxTokens: 4096,
  };
}

/**
 * 创建 LiteLLM 代理模型配置
 */
export function createLiteLLMModel(
  id: string,
  name: string,
  baseUrl: string = 'http://localhost:4000/v1',
  options?: Partial<CustomModel>
): CustomModel {
  return {
    id,
    provider: 'openai', // LiteLLM 使用 OpenAI 兼容 API
    name,
    baseUrl,
    api: 'openai-completions',
    input: ['text'],
    cost: { input: 0, output: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    ...options,
  };
}

// ============================================================================
// 使用示例
// ============================================================================

async function examples() {
  // 示例 1：基本使用
  {
    const resolver = new ModelResolver({
      customModels: [
        createOllamaModel('llama3.2'),
        createOllamaModel('qwen2.5', 'http://192.168.1.100:11434/v1'),
      ],
    });

    // 获取内置模型
    const gpt4o = resolver.resolve('openai/gpt-4o');
    console.log(gpt4o?.name); // "GPT-4o"

    // 获取自定义模型
    const llama = resolver.resolve('ollama/llama3.2');
    console.log(llama?.baseUrl); // "http://localhost:11434/v1"

    // 自动检测 provider
    const claude = resolver.resolve('claude-sonnet-4-5');
    console.log(claude?.provider); // "anthropic"
  }

  // 示例 2：与 pi-ai 一起使用
  {
    import { complete, stream } from '@mariozechner/pi-ai';

    const resolver = new ModelResolver();
    const model = resolver.resolve('gpt-4o-mini');

    if (model) {
      const response = await complete(model, {
        messages: [{ role: 'user', content: 'Hello!' }],
      });

      console.log(response.content[0]);
    }
  }

  // 示例 3：列出可用模型
  {
    const config = {
      /* ... 从 config.json 加载 ... */
    };

    const resolver = new ModelResolver({
      customModels: config.customModels,
      config: config as Config,
    });

    // 所有模型
    const all = resolver.getAll();
    console.log(`Total models: ${all.length}`);

    // 仅已配置 API key 的
    const available = resolver.getAvailable();
    console.log(`Available models: ${available.length}`);

    // 按 provider 分组
    const byProvider = Map.groupBy(available, (m) => m.provider);
    for (const [provider, models] of byProvider) {
      console.log(`${provider}: ${models.length} models`);
    }
  }

  // 示例 4：覆盖内置模型配置
  {
    const resolver = new ModelResolver({
      customModels: [
        {
          id: 'gpt-4o',
          provider: 'openai',
          baseUrl: 'https://my-proxy.example.com/v1',
          headers: {
            'X-Custom-Auth': 'secret-token',
          },
        },
      ],
    });

    const model = resolver.resolve('openai/gpt-4o');
    console.log(model?.baseUrl); // "https://my-proxy.example.com/v1"
    console.log(model?.headers); // { "X-Custom-Auth": "secret-token" }
  }
}

export { examples };
