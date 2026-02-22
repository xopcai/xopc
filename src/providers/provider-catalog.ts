export type ProviderCategory = 'native' | 'openai-compatible' | 'anthropic-compatible' | 'local';

export type AuthType = 'api_key' | 'oauth' | 'token' | 'none';

export type ApiType = 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom';

export type ApiStrategy = 'openai-completions' | 'anthropic-messages' | 'google-generative-ai' | 'github-copilot';

export interface ProviderAuth {
  type: AuthType;
  envKeys: string[];
  headerName?: string;
  headerPrefix?: string;
  supportsOAuth?: boolean;
}

export interface ProviderApi {
  type: ApiType;
  baseUrl: string;
  strategy: ApiStrategy;
  endpoints?: {
    chat?: string;
    models?: string;
  };
}

export interface ProviderCapabilities {
  multimodal: boolean;
  streaming: boolean;
  functionCalling: boolean;
  vision: boolean;
  reasoning: boolean;
  jsonMode: boolean;
  systemPrompt: boolean;
  tools: boolean;
  imageGeneration?: boolean;
}

export interface ProviderDefaults {
  temperature: number;
  maxTokens: number;
  timeout: number;
  contextWindow?: number;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  category: ProviderCategory;
  description?: string;
  /** Logo URL */
  logo?: string;
  /** Authentication configuration */
  auth: ProviderAuth;
  /** API configuration */
  api: ProviderApi;
  /** Capability declaration */
  capabilities: ProviderCapabilities;
  /** Default parameters */
  defaults: ProviderDefaults;
  /** Model ID prefixes (for auto-detection) */
  modelPrefixes?: string[];
  /** Whether special configuration is required */
  requiresConfig?: boolean;
}

// ============================================
// Provider Registry
// ============================================

export const PROVIDER_CATALOG: Record<string, ProviderDefinition> = {
  // ============================================
  // Native Providers
  // ============================================
  
  openai: {
    id: 'openai',
    name: 'OpenAI',
    category: 'native',
    description: 'OpenAI API - GPT-4, o1, o3 系列',
    auth: {
      type: 'api_key',
      envKeys: ['OPENAI_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: false,
    },
    api: {
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      strategy: 'openai-completions',
    },
    capabilities: {
      multimodal: true,
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
      imageGeneration: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 60000,
      contextWindow: 128000,
    },
    modelPrefixes: ['gpt-', 'o1', 'o3', 'o4'],
  },

  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    category: 'native',
    description: 'Anthropic Claude 系列',
    auth: {
      type: 'api_key',
      envKeys: ['ANTHROPIC_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: true,
    },
    api: {
      type: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      strategy: 'anthropic-messages',
    },
    capabilities: {
      multimodal: true,
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      jsonMode: false,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 8192,
      timeout: 60000,
      contextWindow: 200000,
    },
    modelPrefixes: ['claude-'],
  },

  google: {
    id: 'google',
    name: 'Google',
    category: 'native',
    description: 'Google Gemini 系列',
    auth: {
      type: 'api_key',
      envKeys: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
      headerPrefix: '',
      supportsOAuth: false,
    },
    api: {
      type: 'google',
      baseUrl: 'https://generativelanguage.googleapis.com/v1',
      strategy: 'google-generative-ai',
    },
    capabilities: {
      multimodal: true,
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 8192,
      timeout: 60000,
      contextWindow: 1000000,
    },
    modelPrefixes: ['gemini-', 'gemma-'],
  },

  // ============================================
  // OpenAI-Compatible Providers
  // ============================================

  qwen: {
    id: 'qwen',
    name: 'Qwen (通义千问)',
    category: 'openai-compatible',
    description: '阿里云通义千问',
    auth: {
      type: 'api_key',
      envKeys: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: true,
    },
    api: {
      type: 'openai',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      strategy: 'openai-completions',
    },
    capabilities: {
      multimodal: true,
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 60000,
      contextWindow: 128000,
    },
    modelPrefixes: ['qwen', 'qwq'],
  },

  kimi: {
    id: 'kimi',
    name: 'Kimi (月之暗面)',
    category: 'openai-compatible',
    description: 'Moonshot Kimi 系列',
    auth: {
      type: 'api_key',
      envKeys: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: true,
    },
    api: {
      type: 'openai',
      baseUrl: 'https://api.moonshot.cn/v1',
      strategy: 'openai-completions',
    },
    capabilities: {
      multimodal: false,
      streaming: true,
      functionCalling: true,
      vision: false,
      reasoning: true,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 60000,
      contextWindow: 256000,
    },
    modelPrefixes: ['kimi'],
  },

  moonshot: {
    id: 'moonshot',
    name: 'Moonshot AI',
    category: 'openai-compatible',
    description: 'Moonshot AI',
    auth: {
      type: 'api_key',
      envKeys: ['MOONSHOT_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: false,
    },
    api: {
      type: 'openai',
      baseUrl: 'https://api.moonshot.ai/v1',
      strategy: 'openai-completions',
    },
    capabilities: {
      multimodal: false,
      streaming: true,
      functionCalling: true,
      vision: false,
      reasoning: true,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 60000,
      contextWindow: 128000,
    },
    modelPrefixes: ['moonshot'],
  },

  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'openai-compatible',
    description: 'DeepSeek 大模型',
    auth: {
      type: 'api_key',
      envKeys: ['DEEPSEEK_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: false,
    },
    api: {
      type: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      strategy: 'openai-completions',
    },
    capabilities: {
      multimodal: false,
      streaming: true,
      functionCalling: true,
      vision: false,
      reasoning: true,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 8192,
      timeout: 60000,
      contextWindow: 64000,
    },
    modelPrefixes: ['deepseek', 'r1'],
  },

  groq: {
    id: 'groq',
    name: 'Groq',
    category: 'openai-compatible',
    description: 'Groq 高速推理',
    auth: {
      type: 'api_key',
      envKeys: ['GROQ_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: false,
    },
    api: {
      type: 'openai',
      baseUrl: 'https://api.groq.com/openai/v1',
      strategy: 'openai-completions',
    },
    capabilities: {
      multimodal: false,
      streaming: true,
      functionCalling: true,
      vision: false,
      reasoning: false,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 30000,
      contextWindow: 128000,
    },
    modelPrefixes: ['llama', 'mixtral', 'gemma'],
  },

  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'openai-compatible',
    description: 'OpenRouter 模型聚合',
    auth: {
      type: 'api_key',
      envKeys: ['OPENROUTER_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: false,
    },
    api: {
      type: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      strategy: 'openai-completions',
    },
    capabilities: {
      multimodal: true,
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 60000,
      contextWindow: 128000,
    },
    modelPrefixes: [],
  },

  xai: {
    id: 'xai',
    name: 'xAI (Grok)',
    category: 'openai-compatible',
    description: 'xAI Grok 系列',
    auth: {
      type: 'api_key',
      envKeys: ['XAI_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: false,
    },
    api: {
      type: 'openai',
      baseUrl: 'https://api.x.ai/v1',
      strategy: 'openai-completions',
    },
    capabilities: {
      multimodal: true,
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 60000,
      contextWindow: 128000,
    },
    modelPrefixes: ['grok'],
  },

  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    category: 'openai-compatible',
    description: 'Cerebras 推理',
    auth: {
      type: 'api_key',
      envKeys: ['CEREBRAS_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: false,
    },
    api: {
      type: 'openai',
      baseUrl: 'https://api.cerebras.ai/v1',
      strategy: 'openai-completions',
    },
    capabilities: {
      multimodal: false,
      streaming: true,
      functionCalling: false,
      vision: false,
      reasoning: false,
      jsonMode: true,
      systemPrompt: true,
      tools: false,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 30000,
      contextWindow: 8192,
    },
    modelPrefixes: [],
  },

  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    category: 'openai-compatible',
    description: 'Mistral 大模型',
    auth: {
      type: 'api_key',
      envKeys: ['MISTRAL_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: false,
    },
    api: {
      type: 'openai',
      baseUrl: 'https://api.mistral.ai/v1',
      strategy: 'openai-completions',
    },
    capabilities: {
      multimodal: false,
      streaming: true,
      functionCalling: true,
      vision: false,
      reasoning: false,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 60000,
      contextWindow: 32000,
    },
    modelPrefixes: ['mistral'],
  },

  // ============================================
  // Anthropic-Compatible Providers
  // ============================================

  minimax: {
    id: 'minimax',
    name: 'MiniMax',
    category: 'anthropic-compatible',
    description: 'MiniMax 海外版',
    auth: {
      type: 'api_key',
      envKeys: ['MINIMAX_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: true,
    },
    api: {
      type: 'openai',
      baseUrl: 'https://api.minimax.io/anthropic',
      strategy: 'anthropic-messages',
    },
    capabilities: {
      multimodal: false,
      streaming: true,
      functionCalling: true,
      vision: false,
      reasoning: true,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 60000,
      contextWindow: 1000000,
    },
    modelPrefixes: ['minimax'],
  },

  'minimax-cn': {
    id: 'minimax-cn',
    name: 'MiniMax CN',
    category: 'anthropic-compatible',
    description: 'MiniMax 国内版',
    auth: {
      type: 'api_key',
      envKeys: ['MINIMAX_CN_API_KEY', 'MINIMAX_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: false,
    },
    api: {
      type: 'openai',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      strategy: 'anthropic-messages',
    },
    capabilities: {
      multimodal: false,
      streaming: true,
      functionCalling: true,
      vision: false,
      reasoning: true,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 60000,
      contextWindow: 1000000,
    },
    modelPrefixes: ['minimax-cn'],
  },

  zhipu: {
    id: 'zhipu',
    name: 'Zhipu (智谱)',
    category: 'openai-compatible',
    description: '智谱 GLM 系列',
    auth: {
      type: 'api_key',
      envKeys: ['ZHIPU_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: false,
    },
    api: {
      type: 'openai',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      strategy: 'openai-completions',
    },
    capabilities: {
      multimodal: true,
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: false,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 60000,
      contextWindow: 128000,
    },
    modelPrefixes: ['glm-'],
  },

  'zhipu-cn': {
    id: 'zhipu-cn',
    name: 'Zhipu CN',
    category: 'openai-compatible',
    description: '智谱国内版',
    auth: {
      type: 'api_key',
      envKeys: ['ZHIPU_CN_API_KEY', 'ZHIPU_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: false,
    },
    api: {
      type: 'openai',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      strategy: 'openai-completions',
    },
    capabilities: {
      multimodal: true,
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: false,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 60000,
      contextWindow: 128000,
    },
    modelPrefixes: ['glm-'],
  },

  // ============================================
  // Local Providers
  // ============================================

  ollama: {
    id: 'ollama',
    name: 'Ollama',
    category: 'local',
    description: '本地 Ollama 模型',
    auth: {
      type: 'api_key',
      envKeys: ['OLLAMA_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: false,
    },
    api: {
      type: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      strategy: 'openai-completions',
    },
    capabilities: {
      multimodal: true,
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 60000,
      contextWindow: 128000,
    },
    modelPrefixes: [],
  },

  // ============================================
  // Special Providers
  // ============================================

  'github-copilot': {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    category: 'native',
    description: 'GitHub Copilot Chat',
    auth: {
      type: 'token',
      envKeys: ['GITHUB_COPILOT_TOKEN'],
      headerPrefix: 'token ',
      supportsOAuth: true,
    },
    api: {
      type: 'custom',
      baseUrl: '',
      strategy: 'github-copilot',
    },
    capabilities: {
      multimodal: false,
      streaming: true,
      functionCalling: false,
      vision: false,
      reasoning: false,
      jsonMode: false,
      systemPrompt: true,
      tools: false,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 60000,
      contextWindow: 128000,
    },
    modelPrefixes: [],
  },

  // ============================================
  // Bailian Coding Plan
  // ============================================

  bailian: {
    id: 'bailian',
    name: 'Bailian Coding Plan',
    category: 'openai-compatible',
    description: '阿里云百炼 Coding Plan 专属 API',
    auth: {
      type: 'api_key',
      envKeys: ['BAILIAN_API_KEY', 'BAILIAN_CODING_API_KEY'],
      headerPrefix: 'Bearer ',
      supportsOAuth: false,
    },
    api: {
      type: 'openai',
      baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
      strategy: 'openai-completions',
    },
    capabilities: {
      multimodal: false,
      streaming: true,
      functionCalling: true,
      vision: false,
      reasoning: true,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 65536,
      timeout: 120000,
      contextWindow: 262144,
    },
    modelPrefixes: ['qwen3'],
  },
};

export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDER_CATALOG[id];
}

export function getAllProviders(): ProviderDefinition[] {
  return Object.values(PROVIDER_CATALOG);
}

export function detectProviderByModel(modelId: string): string | undefined {
  const lowerId = modelId.toLowerCase();
  
  for (const [providerId, provider] of Object.entries(PROVIDER_CATALOG)) {
    if (provider.modelPrefixes?.some(prefix => lowerId.startsWith(prefix.toLowerCase()))) {
      return providerId;
    }
    if (lowerId.includes(providerId.toLowerCase())) {
      return providerId;
    }
  }
  
  return undefined;
}

export function isProviderConfigured(id: string): boolean {
  const provider = PROVIDER_CATALOG[id];
  if (!provider) return false;
  
  return provider.auth.envKeys.some(key => {
    const value = process.env[key];
    return value && value.length > 0;
  });
}

export function getConfiguredProviders(): ProviderDefinition[] {
  return getAllProviders().filter(p => isProviderConfigured(p.id));
}

export function getProviderApiKey(id: string): string | undefined {
  const provider = PROVIDER_CATALOG[id];
  if (!provider) return undefined;
  
  for (const key of provider.auth.envKeys) {
    const value = process.env[key];
    if (value && value.length > 0) return value;
  }
  
  return undefined;
}

export interface ProviderDisplayInfo {
  id: string;
  name: string;
  description: string;
  envKeys: string[];
  authType: AuthType;
  supportsOAuth: boolean;
  baseUrl: string;
  logo?: string;
  configured: boolean;
}

export function getProviderDisplayInfo(id: string): ProviderDisplayInfo | undefined {
  const provider = PROVIDER_CATALOG[id];
  if (!provider) return undefined;
  
  return {
    id: provider.id,
    name: provider.name,
    description: provider.description || '',
    envKeys: provider.auth.envKeys,
    authType: provider.auth.type,
    supportsOAuth: provider.auth.supportsOAuth || false,
    baseUrl: provider.api.baseUrl,
    logo: provider.logo,
    configured: isProviderConfigured(id),
  };
}

export function getAllProviderDisplayInfo(): ProviderDisplayInfo[] {
  return getAllProviders()
    .map(p => getProviderDisplayInfo(p.id))
    .filter((p): p is ProviderDisplayInfo => p !== undefined);
}

export interface ParsedModelRef {
  provider: string;
  model: string;
  isFullRef: boolean;
}

export function parseModelRef(modelRef: string): ParsedModelRef {
  if (modelRef.includes('/')) {
    const [provider, ...modelParts] = modelRef.split('/');
    return {
      provider,
      model: modelParts.join('/'),
      isFullRef: true,
    };
  }
  
  const detected = detectProviderByModel(modelRef);
  if (detected) {
    return {
      provider: detected,
      model: modelRef,
      isFullRef: false,
    };
  }
  
  return {
    provider: 'openai',
    model: modelRef,
    isFullRef: false,
  };
}

export function registerCustomProvider(definition: ProviderDefinition): void {
  PROVIDER_CATALOG[definition.id] = definition;
}

export function createCustomProviderFromConfig(
  id: string,
  name: string,
  config: {
    baseUrl: string;
    apiKey?: string;
    envKey?: string;
    strategy?: ApiStrategy;
    category?: ProviderCategory;
  }
): ProviderDefinition {
  return {
    id,
    name,
    category: config.category || 'openai-compatible',
    auth: {
      type: 'api_key',
      envKeys: config.envKey ? [config.envKey] : [`${id.toUpperCase().replace(/-/g, '_')}_API_KEY`],
      headerPrefix: 'Bearer ',
    },
    api: {
      type: 'openai',
      baseUrl: config.baseUrl,
      strategy: config.strategy || 'openai-completions',
    },
    capabilities: {
      multimodal: false,
      streaming: true,
      functionCalling: true,
      vision: false,
      reasoning: false,
      jsonMode: true,
      systemPrompt: true,
      tools: true,
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 60000,
    },
  };
}
