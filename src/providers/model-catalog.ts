/**
 * Model Catalog
 *
 * 模型能力系统 - 声明式模型定义
 * - 支持多模态能力声明
 * - 支持定价信息
 * - 支持能力匹配和筛选
 */

// ============================================
// 基础类型定义
// ============================================

/** 支持的模态类型 */
export type Modality = 'text' | 'image' | 'audio' | 'video' | 'document' | 'pdf';

/** 模型能力特性 */
export interface ModelFeatures {
  /** 流式输出 */
  streaming: boolean;
  /** 函数调用 */
  functionCalling: boolean;
  /** JSON 模式 */
  jsonMode: boolean;
  /** 推理能力 */
  reasoning: boolean;
  /** 系统提示词 */
  systemPrompt: boolean;
  /** 工具调用 */
  tools: boolean;
  /** 视觉理解 */
  vision: boolean;
  /** 长文档理解 */
  documentUnderstanding: boolean;
  /** 代码执行 */
  codeExecution: boolean;
  /** 图像生成 */
  imageGeneration: boolean;
  /** 音频理解 */
  audioUnderstanding: boolean;
  /** 视频理解 */
  videoUnderstanding: boolean;
}

/** 模型限制 */
export interface ModelLimits {
  /** 上下文窗口大小 */
  contextWindow: number;
  /** 最大输出 token */
  maxOutputTokens: number;
  /** 最大输入文件大小（MB） */
  maxFileSize?: number;
  /** 单请求最大图像数 */
  maxImagesPerRequest?: number;
  /** 支持的图像类型 */
  supportedImageTypes?: string[];
  /** 支持的视频类型 */
  supportedVideoTypes?: string[];
  /** 支持音频类型 */
  supportedAudioTypes?: string[];
  /** 支持文档类型 */
  supportedDocumentTypes?: string[];
}

/** 模型定价 */
export interface ModelPricing {
  /** 输入每 1K token 价格（美元） */
  inputPer1k: number;
  /** 输出每 1K token 价格（美元） */
  outputPer1k: number;
  /** 缓存读取折扣（如 0.5 表示半价） */
  cacheReadDiscount?: number;
  /** 缓存写入费用 */
  cacheWritePer1k?: number;
}

/** 模型性能指标（估算） */
export interface ModelPerformance {
  /** 质量评分 1-10 */
  qualityScore?: number;
  /** 速度评分 1-10 */
  speedScore?: number;
  /** 典型响应延迟（毫秒） */
  typicalLatency?: number;
  /** 适合的任务类型 */
  recommendedFor?: string[];
}

// ============================================
// 模型定义
// ============================================

export interface ModelDefinition {
  /** 模型 ID（在 provider 内唯一） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 所属 Provider */
  provider: string;
  /** 描述 */
  description?: string;
  /** 模型版本 */
  version?: string;
  /** 模型系列 */
  family?: string;
  
  /** 支持输入模态 */
  inputModalities: Modality[];
  /** 支持输出模态 */
  outputModalities: Modality[];
  /** 功能特性 */
  features: ModelFeatures;
  /** 限制 */
  limits: ModelLimits;
  /** 定价（可选，如不提供则从 provider 估算） */
  pricing?: ModelPricing;
  /** 性能指标（可选） */
  performance?: ModelPerformance;
  
  /** 模型特定参数覆盖 */
  defaultParams?: Record<string, unknown>;
  /** 是否推荐 */
  recommended?: boolean;
  /** 是否 Deprecated */
  deprecated?: boolean;
}

// ============================================
// 模型注册表
// ============================================

export const MODEL_CATALOG: ModelDefinition[] = [
  // ============================================
  // OpenAI Models
  // ============================================
  
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    description: 'OpenAI 旗舰多模态模型，性能与效率平衡',
    family: 'GPT-4',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: false,
      systemPrompt: true,
      tools: true,
      vision: true,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 128000,
      maxOutputTokens: 4096,
      maxFileSize: 20,
      maxImagesPerRequest: 10,
      supportedImageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    },
    pricing: { inputPer1k: 0.0025, outputPer1k: 0.01 },
    performance: {
      qualityScore: 9,
      speedScore: 8,
      recommendedFor: ['general', 'vision', 'coding', 'analysis'],
    },
    recommended: true,
  },
  
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    description: '轻量级多模态模型，成本效益高',
    family: 'GPT-4',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: false,
      systemPrompt: true,
      tools: true,
      vision: true,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 128000,
      maxOutputTokens: 4096,
      maxFileSize: 20,
      maxImagesPerRequest: 10,
      supportedImageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    },
    pricing: { inputPer1k: 0.00015, outputPer1k: 0.0006 },
    performance: {
      qualityScore: 7,
      speedScore: 9,
      recommendedFor: ['fast', 'cheap', 'simple'],
    },
    recommended: true,
  },
  
  {
    id: 'gpt-5',
    name: 'GPT-5',
    provider: 'openai',
    description: 'OpenAI 最新旗舰模型',
    family: 'GPT-5',
    inputModalities: ['text', 'image', 'audio'],
    outputModalities: ['text', 'audio'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: true,
      systemPrompt: true,
      tools: true,
      vision: true,
      documentUnderstanding: true,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: true,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 256000,
      maxOutputTokens: 16384,
      maxFileSize: 50,
    },
    pricing: { inputPer1k: 0.01, outputPer1k: 0.03 },
    performance: {
      qualityScore: 10,
      speedScore: 7,
      recommendedFor: ['complex', 'reasoning', 'analysis', 'creative'],
    },
    recommended: true,
  },
  
  {
    id: 'o1',
    name: 'o1',
    provider: 'openai',
    description: 'OpenAI 推理模型，适合复杂任务',
    family: 'o1',
    inputModalities: ['text'],
    outputModalities: ['text'],
    features: {
      streaming: false,  // o1 不支持流式
      functionCalling: true,
      jsonMode: true,
      reasoning: true,
      systemPrompt: false,  // o1 不支持 system prompt
      tools: true,
      vision: false,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 200000,
      maxOutputTokens: 100000,
    },
    pricing: { inputPer1k: 0.015, outputPer1k: 0.06 },
    performance: {
      qualityScore: 10,
      speedScore: 5,
      recommendedFor: ['math', 'science', 'coding', 'complex-reasoning'],
    },
  },
  
  {
    id: 'o3-mini',
    name: 'o3 Mini',
    provider: 'openai',
    description: '轻量级推理模型',
    family: 'o3',
    inputModalities: ['text'],
    outputModalities: ['text'],
    features: {
      streaming: false,
      functionCalling: true,
      jsonMode: true,
      reasoning: true,
      systemPrompt: false,
      tools: true,
      vision: false,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 200000,
      maxOutputTokens: 100000,
    },
    pricing: { inputPer1k: 0.0011, outputPer1k: 0.0044 },
    performance: {
      qualityScore: 9,
      speedScore: 6,
      recommendedFor: ['reasoning', 'math', 'coding'],
    },
  },

  // ============================================
  // Anthropic Models
  // ============================================
  
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    description: 'Anthropic 平衡型模型，速度快性能好',
    family: 'Claude 4.5',
    inputModalities: ['text', 'image', 'pdf'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: false,
      reasoning: false,
      systemPrompt: true,
      tools: true,
      vision: true,
      documentUnderstanding: true,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 200000,
      maxOutputTokens: 8192,
      maxFileSize: 32,
      maxImagesPerRequest: 20,
      supportedImageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      supportedDocumentTypes: ['application/pdf'],
    },
    pricing: { inputPer1k: 0.003, outputPer1k: 0.015, cacheReadDiscount: 0.1 },
    performance: {
      qualityScore: 9,
      speedScore: 9,
      recommendedFor: ['general', 'coding', 'analysis', 'document'],
    },
    recommended: true,
  },
  
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    provider: 'anthropic',
    description: 'Anthropic 最强模型，适合复杂任务',
    family: 'Claude 4.5',
    inputModalities: ['text', 'image', 'pdf'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: false,
      reasoning: true,
      systemPrompt: true,
      tools: true,
      vision: true,
      documentUnderstanding: true,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 200000,
      maxOutputTokens: 8192,
      maxFileSize: 32,
      maxImagesPerRequest: 20,
    },
    pricing: { inputPer1k: 0.015, outputPer1k: 0.075, cacheReadDiscount: 0.1 },
    performance: {
      qualityScore: 10,
      speedScore: 7,
      recommendedFor: ['complex', 'analysis', 'creative', 'research'],
    },
  },
  
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    description: 'Anthropic 轻量级模型，速度极快',
    family: 'Claude 4.5',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: false,
      reasoning: false,
      systemPrompt: true,
      tools: true,
      vision: true,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 200000,
      maxOutputTokens: 4096,
    },
    pricing: { inputPer1k: 0.00025, outputPer1k: 0.00125, cacheReadDiscount: 0.1 },
    performance: {
      qualityScore: 7,
      speedScore: 10,
      recommendedFor: ['fast', 'cheap', 'simple', 'summarization'],
    },
  },

  // ============================================
  // Google Gemini Models
  // ============================================
  
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    description: 'Google 最强多模态模型，支持视频',
    family: 'Gemini 2.5',
    inputModalities: ['text', 'image', 'video', 'audio', 'pdf'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: true,
      systemPrompt: true,
      tools: true,
      vision: true,
      documentUnderstanding: true,
      codeExecution: true,
      imageGeneration: false,
      audioUnderstanding: true,
      videoUnderstanding: true,
    },
    limits: {
      contextWindow: 1000000,  // 1M context!
      maxOutputTokens: 8192,
      maxFileSize: 20,
      maxImagesPerRequest: 100,
      supportedImageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
      supportedVideoTypes: ['video/mp4', 'video/mpeg', 'video/mov', 'video/avi', 'video/x-flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gpp'],
      supportedAudioTypes: ['audio/wav', 'audio/mp3', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac'],
      supportedDocumentTypes: ['application/pdf'],
    },
    pricing: { inputPer1k: 0.00125, outputPer1k: 0.01 },
    performance: {
      qualityScore: 9,
      speedScore: 8,
      recommendedFor: ['long-context', 'video', 'multimodal', 'document'],
    },
    recommended: true,
  },
  
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    description: 'Google 快速多模态模型',
    family: 'Gemini 2.5',
    inputModalities: ['text', 'image', 'video', 'audio', 'pdf'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: true,
      systemPrompt: true,
      tools: true,
      vision: true,
      documentUnderstanding: true,
      codeExecution: true,
      imageGeneration: false,
      audioUnderstanding: true,
      videoUnderstanding: true,
    },
    limits: {
      contextWindow: 1000000,
      maxOutputTokens: 8192,
    },
    pricing: { inputPer1k: 0.000075, outputPer1k: 0.0003 },
    performance: {
      qualityScore: 8,
      speedScore: 9,
      recommendedFor: ['fast', 'cheap', 'multimodal', 'long-context'],
    },
    recommended: true,
  },
  
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'google',
    description: 'Google 2.0 系列快速模型',
    family: 'Gemini 2.0',
    inputModalities: ['text', 'image', 'video', 'audio'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: false,
      systemPrompt: true,
      tools: true,
      vision: true,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: true,
      videoUnderstanding: true,
    },
    limits: {
      contextWindow: 1000000,
      maxOutputTokens: 8192,
    },
    pricing: { inputPer1k: 0.0001, outputPer1k: 0.0004 },
    performance: {
      qualityScore: 8,
      speedScore: 10,
      recommendedFor: ['fast', 'cheap', 'multimodal'],
    },
  },

  // ============================================
  // Qwen (通义千问)
  // ============================================
  
  {
    id: 'qwen-plus',
    name: 'Qwen Plus',
    provider: 'qwen',
    description: '通义千问 Plus，综合能力强劲',
    family: 'Qwen',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: false,
      systemPrompt: true,
      tools: true,
      vision: true,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 131072,
      maxOutputTokens: 8192,
      maxImagesPerRequest: 10,
    },
    pricing: { inputPer1k: 0.0008, outputPer1k: 0.002 },
    recommended: true,
  },
  
  {
    id: 'qwen-max',
    name: 'Qwen Max',
    provider: 'qwen',
    description: '通义千问 Max，最强能力',
    family: 'Qwen',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: true,
      systemPrompt: true,
      tools: true,
      vision: true,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 32768,
      maxOutputTokens: 8192,
    },
    pricing: { inputPer1k: 0.002, outputPer1k: 0.006 },
    recommended: true,
  },
  
  {
    id: 'qwen3-235b',
    name: 'Qwen3 235B',
    provider: 'qwen',
    description: 'Qwen3 235B 参数模型',
    family: 'Qwen3',
    inputModalities: ['text'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: true,
      systemPrompt: true,
      tools: true,
      vision: false,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 128000,
      maxOutputTokens: 8192,
    },
    pricing: { inputPer1k: 0.001, outputPer1k: 0.003 },
  },

  // ============================================
  // Kimi (月之暗面)
  // ============================================
  
  {
    id: 'kimi-k2.5',
    name: 'Kimi K2.5',
    provider: 'kimi',
    description: 'Kimi K2.5，长上下文专家',
    family: 'Kimi',
    inputModalities: ['text'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: false,
      systemPrompt: true,
      tools: true,
      vision: false,
      documentUnderstanding: true,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 256000,
      maxOutputTokens: 4096,
    },
    pricing: { inputPer1k: 0.002, outputPer1k: 0.006 },
    performance: {
      qualityScore: 9,
      speedScore: 8,
      recommendedFor: ['long-context', 'document', 'coding'],
    },
    recommended: true,
  },
  
  {
    id: 'kimi-k2-thinking',
    name: 'Kimi K2 Thinking',
    provider: 'kimi',
    description: 'Kimi K2 推理版',
    family: 'Kimi',
    inputModalities: ['text'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: true,
      systemPrompt: true,
      tools: true,
      vision: false,
      documentUnderstanding: true,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 256000,
      maxOutputTokens: 4096,
    },
    pricing: { inputPer1k: 0.002, outputPer1k: 0.006 },
  },

  // ============================================
  // MiniMax
  // ============================================
  
  {
    id: 'minimax-m2.5',
    name: 'MiniMax M2.5',
    provider: 'minimax',
    description: 'MiniMax M2.5',
    family: 'MiniMax',
    inputModalities: ['text'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: false,
      systemPrompt: true,
      tools: true,
      vision: false,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 1000000,
      maxOutputTokens: 4096,
    },
    recommended: true,
  },
  
  {
    id: 'minimax-m2.1',
    name: 'MiniMax M2.1',
    provider: 'minimax',
    description: 'MiniMax M2.1',
    family: 'MiniMax',
    inputModalities: ['text'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: false,
      systemPrompt: true,
      tools: true,
      vision: false,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 1000000,
      maxOutputTokens: 4096,
    },
  },

  // ============================================
  // Zhipu (智谱)
  // ============================================
  
  {
    id: 'glm-4',
    name: 'GLM-4',
    provider: 'zhipu',
    description: '智谱 GLM-4',
    family: 'GLM-4',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: false,
      systemPrompt: true,
      tools: true,
      vision: true,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 128000,
      maxOutputTokens: 4096,
    },
    recommended: true,
  },
  
  {
    id: 'glm-4v-flash',
    name: 'GLM-4V Flash',
    provider: 'zhipu',
    description: 'GLM-4V Flash，视觉版',
    family: 'GLM-4',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: false,
      systemPrompt: true,
      tools: true,
      vision: true,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 8192,
      maxOutputTokens: 4096,
    },
  },
  
  {
    id: 'glm-5',
    name: 'GLM-5',
    provider: 'zhipu',
    description: '智谱 GLM-5',
    family: 'GLM-5',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: true,
      systemPrompt: true,
      tools: true,
      vision: true,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 128000,
      maxOutputTokens: 8192,
    },
  },

  // ============================================
  // DeepSeek
  // ============================================
  
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    provider: 'deepseek',
    description: 'DeepSeek 对话模型',
    family: 'DeepSeek',
    inputModalities: ['text'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: false,
      systemPrompt: true,
      tools: true,
      vision: false,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 64000,
      maxOutputTokens: 8192,
    },
    pricing: { inputPer1k: 0.00014, outputPer1k: 0.00028 },
    recommended: true,
  },
  
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    provider: 'deepseek',
    description: 'DeepSeek 推理模型（R1）',
    family: 'DeepSeek',
    inputModalities: ['text'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: false,
      jsonMode: true,
      reasoning: true,
      systemPrompt: true,
      tools: false,
      vision: false,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 64000,
      maxOutputTokens: 8192,
    },
    pricing: { inputPer1k: 0.00055, outputPer1k: 0.00219 },
  },

  // ============================================
  // Bailian Coding Plan (百炼)
  // ============================================
  
  {
    id: 'qwen3-max-2026-01-23',
    name: 'Qwen3 Max (Coding Plan)',
    provider: 'bailian',
    description: '阿里云百炼 Coding Plan qwen3-max-thinking',
    family: 'Qwen3',
    inputModalities: ['text'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: true,
      systemPrompt: true,
      tools: true,
      vision: false,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 262144,
      maxOutputTokens: 65536,
    },
    recommended: true,
  },
  
  {
    id: 'qwen3.5-plus',
    name: 'Qwen3.5 Plus (Coding Plan)',
    provider: 'bailian',
    description: '阿里云百炼 Coding Plan qwen3.5-plus',
    family: 'Qwen3.5',
    inputModalities: ['text'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: true,
      systemPrompt: true,
      tools: true,
      vision: false,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 131072,
      maxOutputTokens: 32768,
    },
  },

  // ============================================
  // Groq
  // ============================================
  
  {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    provider: 'groq',
    description: 'Meta Llama 3.3 70B，极速推理',
    family: 'Llama',
    inputModalities: ['text'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: false,
      systemPrompt: true,
      tools: true,
      vision: false,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 128000,
      maxOutputTokens: 4096,
    },
    pricing: { inputPer1k: 0.00059, outputPer1k: 0.00079 },
    performance: {
      qualityScore: 8,
      speedScore: 10,
      recommendedFor: ['fast', 'cheap'],
    },
    recommended: true,
  },

  // ============================================
  // xAI
  // ============================================
  
  {
    id: 'grok-3',
    name: 'Grok 3',
    provider: 'xai',
    description: 'xAI Grok 3',
    family: 'Grok',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    features: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      reasoning: true,
      systemPrompt: true,
      tools: true,
      vision: true,
      documentUnderstanding: false,
      codeExecution: false,
      imageGeneration: false,
      audioUnderstanding: false,
      videoUnderstanding: false,
    },
    limits: {
      contextWindow: 128000,
      maxOutputTokens: 4096,
    },
  },
];

// ============================================
// 辅助函数
// ============================================

/**
 * 获取所有模型
 */
export function getAllModels(): ModelDefinition[] {
  return MODEL_CATALOG;
}

/**
 * 根据 ID 查找模型
 */
export function findModel(id: string): ModelDefinition | undefined {
  return MODEL_CATALOG.find(m => m.id === id);
}

/**
 * 根据 Provider 获取模型
 */
export function getModelsByProvider(providerId: string): ModelDefinition[] {
  return MODEL_CATALOG.filter(m => m.provider === providerId);
}

/**
 * 根据 Provider 和模型 ID 查找
 */
export function findModelByProvider(providerId: string, modelId: string): ModelDefinition | undefined {
  return MODEL_CATALOG.find(m => m.provider === providerId && m.id === modelId);
}

/**
 * 获取推荐的模型
 */
export function getRecommendedModels(): ModelDefinition[] {
  return MODEL_CATALOG.filter(m => m.recommended && !m.deprecated);
}

/**
 * 获取支持特定能力的模型
 */
export function getModelsByCapability(
  capability: keyof ModelFeatures
): ModelDefinition[] {
  return MODEL_CATALOG.filter(m => m.features[capability] && !m.deprecated);
}

/**
 * 获取支持特定模态的模型
 */
export function getModelsByModality(modality: Modality): ModelDefinition[] {
  return MODEL_CATALOG.filter(m => 
    m.inputModalities.includes(modality) && !m.deprecated
  );
}

/**
 * 获取支持视觉的模型
 */
export function getVisionModels(): ModelDefinition[] {
  return getModelsByCapability('vision');
}

/**
 * 获取支持函数调用的模型
 */
export function getFunctionCallingModels(): ModelDefinition[] {
  return getModelsByCapability('functionCalling');
}

/**
 * 根据任务类型推荐模型
 */
export type TaskType = 
  | 'general'      // 通用对话
  | 'coding'       // 代码生成
  | 'vision'       // 图像理解
  | 'fast'         // 快速响应
  | 'cheap'        // 低成本
  | 'long-context' // 长上下文
  | 'reasoning'    // 复杂推理
  | 'document'     // 文档处理
  | 'multimodal';  // 多模态

export function getModelsForTask(task: TaskType): ModelDefinition[] {
  switch (task) {
    case 'vision':
      return getVisionModels().sort((a, b) => 
        (b.performance?.qualityScore || 0) - (a.performance?.qualityScore || 0)
      );
    case 'coding':
      return MODEL_CATALOG.filter(m => 
        m.performance?.recommendedFor?.includes('coding') && !m.deprecated
      );
    case 'fast':
      return MODEL_CATALOG.filter(m => 
        m.performance?.recommendedFor?.includes('fast') && !m.deprecated
      ).sort((a, b) => 
        (b.performance?.speedScore || 0) - (a.performance?.speedScore || 0)
      );
    case 'cheap':
      return MODEL_CATALOG.filter(m => !m.deprecated)
        .sort((a, b) => (a.pricing?.inputPer1k || Infinity) - (b.pricing?.inputPer1k || Infinity));
    case 'long-context':
      return MODEL_CATALOG.filter(m => !m.deprecated)
        .sort((a, b) => b.limits.contextWindow - a.limits.contextWindow);
    case 'reasoning':
      return getModelsByCapability('reasoning');
    case 'multimodal':
      return MODEL_CATALOG.filter(m => 
        m.inputModalities.length > 1 && !m.deprecated
      );
    case 'document':
      return MODEL_CATALOG.filter(m => 
        (m.inputModalities.includes('pdf') || m.features.documentUnderstanding) && !m.deprecated
      );
    default:
      return getRecommendedModels();
  }
}

/**
 * 检查模型是否支持特定模态
 */
export function modelSupportsModality(
  modelId: string, 
  modality: Modality
): boolean {
  const model = findModel(modelId);
  if (!model) return false;
  return model.inputModalities.includes(modality);
}

/**
 * 检查模型是否支持特定功能
 */
export function modelSupportsFeature(
  modelId: string, 
  feature: keyof ModelFeatures
): boolean {
  const model = findModel(modelId);
  if (!model) return false;
  return model.features[feature];
}

/**
 * 估算请求成本
 */
export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number | undefined {
  const model = findModel(modelId);
  if (!model?.pricing) return undefined;
  
  const inputCost = (inputTokens / 1000) * model.pricing.inputPer1k;
  const outputCost = (outputTokens / 1000) * model.pricing.outputPer1k;
  
  return inputCost + outputCost;
}

/**
 * 模型对比信息（用于 UI 展示）
 */
export interface ModelComparisonInfo {
  id: string;
  name: string;
  provider: string;
  description?: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsVision: boolean;
  supportsFunctions: boolean;
  supportsStreaming: boolean;
  inputPrice?: number;
  outputPrice?: number;
  recommended: boolean;
}

export function getModelComparisonInfo(): ModelComparisonInfo[] {
  return MODEL_CATALOG
    .filter(m => !m.deprecated)
    .map(m => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      description: m.description,
      contextWindow: m.limits.contextWindow,
      maxOutputTokens: m.limits.maxOutputTokens,
      supportsVision: m.features.vision,
      supportsFunctions: m.features.functionCalling,
      supportsStreaming: m.features.streaming,
      inputPrice: m.pricing?.inputPer1k,
      outputPrice: m.pricing?.outputPer1k,
      recommended: m.recommended || false,
    }));
}

/**
 * 注册自定义模型（运行时扩展）
 */
export function registerCustomModel(model: ModelDefinition): void {
  // 检查是否已存在
  const existingIndex = MODEL_CATALOG.findIndex(m => 
    m.id === model.id && m.provider === model.provider
  );
  
  if (existingIndex >= 0) {
    MODEL_CATALOG[existingIndex] = model;
  } else {
    MODEL_CATALOG.push(model);
  }
}

/**
 * 从远程获取模型列表（用于 OpenRouter 等动态 provider）
 */
export async function fetchRemoteModels(
  providerId: string,
  apiKey: string,
  baseUrl: string
): Promise<ModelDefinition[]> {
  // TODO: 实现远程获取逻辑
  // 对于 OpenRouter，调用 /v1/models
  // 对于其他 provider，类似处理
  
  return [];
}

/**
 * 获取完整模型引用（provider/model）
 */
export function getFullModelRef(model: ModelDefinition): string {
  return `${model.provider}/${model.id}`;
}

/**
 * 解析模型引用
 */
export function parseModelReference(ref: string): { provider?: string; modelId: string } {
  if (ref.includes('/')) {
    const [provider, ...modelParts] = ref.split('/');
    return { provider, modelId: modelParts.join('/') };
  }
  return { modelId: ref };
}

/**
 * 查找模型（支持完整引用格式）
 */
export function findModelByRef(ref: string): ModelDefinition | undefined {
  const { provider, modelId } = parseModelReference(ref);
  
  if (provider) {
    return findModelByProvider(provider, modelId);
  }
  
  // 只提供 modelId，尝试在所有 provider 中查找
  return findModel(modelId);
}
