/**
 * Provider Templates
 * 
 * Pre-configured provider templates for quick setup.
 */

import type { ModelConfig } from '../pages/SettingsPage.js';

export interface ProviderTemplate {
  id: string;
  name: string;
  authType: 'api_key' | 'oauth';
  oauthProviderId?: string;
  baseUrl: string;
  api: string;
  models: ModelConfig[];
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    authType: 'api_key',
    baseUrl: 'https://api.openai.com/v1',
    api: 'openai-completions',
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: { text: true, image: true, reasoning: false },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        capabilities: { text: true, image: true, reasoning: false },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        capabilities: { text: true, image: true, reasoning: false },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    authType: 'api_key',
    baseUrl: 'https://api.anthropic.com/v1',
    api: 'anthropic-messages',
    models: [
      {
        id: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        capabilities: { text: true, image: true, reasoning: false },
        contextWindow: 200000,
        maxTokens: 8192,
      },
      {
        id: 'claude-opus-4-5',
        name: 'Claude Opus 4.5',
        capabilities: { text: true, image: true, reasoning: false },
        contextWindow: 200000,
        maxTokens: 16384,
      },
      {
        id: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        capabilities: { text: true, image: true, reasoning: false },
        contextWindow: 200000,
        maxTokens: 8192,
      },
    ],
  },
  {
    id: 'google',
    name: 'Google (Gemini)',
    authType: 'api_key',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    api: 'google-generative-ai',
    models: [
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        capabilities: { text: true, image: true, reasoning: false },
        contextWindow: 1000000,
        maxTokens: 8192,
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        capabilities: { text: true, image: true, reasoning: false },
        contextWindow: 1000000,
        maxTokens: 8192,
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    authType: 'api_key',
    baseUrl: 'https://api.deepseek.com/v1',
    api: 'openai-completions',
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        capabilities: { text: true, image: false, reasoning: false },
        contextWindow: 64000,
        maxTokens: 8192,
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        capabilities: { text: true, image: false, reasoning: true },
        contextWindow: 64000,
        maxTokens: 8192,
      },
    ],
  },
  {
    id: 'qwen',
    name: 'Qwen (通义千问)',
    authType: 'oauth',
    oauthProviderId: 'alibaba-cloud',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api: 'openai-completions',
    models: [
      {
        id: 'qwen-max',
        name: 'Qwen Max',
        capabilities: { text: true, image: false, reasoning: false },
        contextWindow: 32000,
        maxTokens: 8192,
      },
      {
        id: 'qwen-plus',
        name: 'Qwen Plus',
        capabilities: { text: true, image: false, reasoning: false },
        contextWindow: 32000,
        maxTokens: 8192,
      },
      {
        id: 'qwen-vl-max',
        name: 'Qwen VL Max',
        capabilities: { text: true, image: true, reasoning: false },
        contextWindow: 32000,
        maxTokens: 8192,
      },
    ],
  },
  {
    id: 'kimi',
    name: 'Kimi (月之暗面)',
    authType: 'oauth',
    oauthProviderId: 'kimi-coding',
    baseUrl: 'https://api.moonshot.cn/v1',
    api: 'openai-completions',
    models: [
      {
        id: 'kimi-k2.5',
        name: 'Kimi K2.5',
        capabilities: { text: true, image: false, reasoning: false },
        contextWindow: 200000,
        maxTokens: 8192,
      },
      {
        id: 'kimi-k2-thinking',
        name: 'Kimi K2 Thinking',
        capabilities: { text: true, image: false, reasoning: true },
        contextWindow: 200000,
        maxTokens: 8192,
      },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    authType: 'oauth',
    oauthProviderId: 'minimax-portal',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    api: 'anthropic-messages',
    models: [
      {
        id: 'MiniMax-M2.1',
        name: 'MiniMax M2.1',
        capabilities: { text: true, image: false, reasoning: false },
        contextWindow: 200000,
        maxTokens: 8192,
      },
    ],
  },
  {
    id: 'minimax-cn',
    name: 'MiniMax CN (国内)',
    authType: 'oauth',
    oauthProviderId: 'minimax-cn',
    baseUrl: 'https://platform.minimax.chat/anthropic',
    api: 'anthropic-messages',
    models: [
      {
        id: 'MiniMax-M2.1',
        name: 'MiniMax M2.1',
        capabilities: { text: true, image: false, reasoning: false },
        contextWindow: 200000,
        maxTokens: 8192,
      },
    ],
  },
  {
    id: 'zhipu',
    name: 'Zhipu (智谱)',
    authType: 'api_key',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    api: 'openai-completions',
    models: [
      {
        id: 'glm-4',
        name: 'GLM-4',
        capabilities: { text: true, image: false, reasoning: false },
        contextWindow: 128000,
        maxTokens: 8192,
      },
      {
        id: 'glm-4v',
        name: 'GLM-4V',
        capabilities: { text: true, image: true, reasoning: false },
        contextWindow: 128000,
        maxTokens: 8192,
      },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    authType: 'api_key',
    baseUrl: 'https://api.groq.com/openai/v1',
    api: 'openai-completions',
    models: [
      {
        id: 'llama-3.3-70b',
        name: 'Llama 3.3 70B',
        capabilities: { text: true, image: false, reasoning: false },
        contextWindow: 128000,
        maxTokens: 8192,
      },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    authType: 'api_key',
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
    models: [
      {
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        capabilities: { text: true, image: true, reasoning: false },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    authType: 'api_key',
    baseUrl: 'http://localhost:11434/v1',
    api: 'ollama',
    models: [], // User adds their own models
  },
  {
    id: 'custom',
    name: 'Custom Provider',
    authType: 'api_key',
    baseUrl: '',
    api: 'openai-completions',
    models: [],
  },
];

export function getProviderTemplate(id: string): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find(t => t.id === id);
}

export function getApiKeyTemplates(): ProviderTemplate[] {
  return PROVIDER_TEMPLATES.filter(t => t.authType === 'api_key');
}

export function getOAuthTemplates(): ProviderTemplate[] {
  return PROVIDER_TEMPLATES.filter(t => t.authType === 'oauth');
}
