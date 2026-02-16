/**
 * Local Model Data
 * 
 * Contains all model definitions for xopcbot.
 * Built-in models from models.dev + additional providers.
 * 
 * Updated at: 2026-02-16T03:52:15.288Z
 */

import type { Api, Model } from '@mariozechner/pi-ai';

export const LOCAL_MODELS_DEV_DATA: Record<string, Model<Api>[]> = {
  "deepseek": [
    {
      "id": "deepseek-reasoner",
      "name": "DeepSeek Reasoner (R1)",
      "api": "openai-completions",
      "provider": "deepseek",
      "baseUrl": "https://api.deepseek.com/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.14,
        "output": 2.19,
        "cacheRead": 0.014,
        "cacheWrite": 0
      },
      "contextWindow": 64000,
      "maxTokens": 8192
    },
    {
      "id": "deepseek-chat",
      "name": "DeepSeek Chat (V3)",
      "api": "openai-completions",
      "provider": "deepseek",
      "baseUrl": "https://api.deepseek.com/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.07,
        "output": 0.28,
        "cacheRead": 0.007,
        "cacheWrite": 0
      },
      "contextWindow": 64000,
      "maxTokens": 8192
    }
  ],
  "qwen": [
    {
      "id": "qwen-max",
      "name": "Qwen Max",
      "api": "openai-completions",
      "provider": "qwen",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.345,
        "output": 1.377,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 32768,
      "maxTokens": 8192
    },
    {
      "id": "qwen-plus",
      "name": "Qwen Plus",
      "api": "openai-completions",
      "provider": "qwen",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.115,
        "output": 0.287,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "qwen-turbo",
      "name": "Qwen Turbo",
      "api": "openai-completions",
      "provider": "qwen",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.044,
        "output": 0.087,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 1000000,
      "maxTokens": 16384
    },
    {
      "id": "qwen-long",
      "name": "Qwen Long",
      "api": "openai-completions",
      "provider": "qwen",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.072,
        "output": 0.287,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 10000000,
      "maxTokens": 8192
    }
  ],
  "anthropic": [
    {
      "id": "claude-opus-4-5-20251101",
      "name": "Claude Opus 4.5",
      "api": "anthropic-messages",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 15,
        "output": 75,
        "cacheRead": 1.5,
        "cacheWrite": 18.75
      },
      "contextWindow": 200000,
      "maxTokens": 8192
    },
    {
      "id": "claude-sonnet-4-5-20251022",
      "name": "Claude Sonnet 4.5",
      "api": "anthropic-messages",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 3,
        "output": 15,
        "cacheRead": 0.3,
        "cacheWrite": 3.75
      },
      "contextWindow": 200000,
      "maxTokens": 8192
    },
    {
      "id": "claude-haiku-4-5-20251101",
      "name": "Claude Haiku 4.5",
      "api": "anthropic-messages",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.5,
        "output": 2.5,
        "cacheRead": 0.05,
        "cacheWrite": 0.625
      },
      "contextWindow": 200000,
      "maxTokens": 8192
    }
  ],
  "openai": [
    {
      "id": "gpt-4o",
      "name": "GPT-4o",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 2.5,
        "output": 10,
        "cacheRead": 1.25,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    {
      "id": "gpt-4o-mini",
      "name": "GPT-4o Mini",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.15,
        "output": 0.6,
        "cacheRead": 0.075,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    {
      "id": "o1",
      "name": "o1",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 15,
        "output": 60,
        "cacheRead": 7.5,
        "cacheWrite": 0
      },
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    {
      "id": "o3-mini",
      "name": "o3 Mini",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 1.1,
        "output": 4.4,
        "cacheRead": 0.55,
        "cacheWrite": 0
      },
      "contextWindow": 200000,
      "maxTokens": 100000
    }
  ],
  "google": [
    {
      "id": "gemini-2.0-flash",
      "name": "Gemini 2.0 Flash",
      "api": "google-generative-ai",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.1,
        "output": 0.4,
        "cacheRead": 0.025,
        "cacheWrite": 0
      },
      "contextWindow": 1000000,
      "maxTokens": 8192
    },
    {
      "id": "gemini-2.0-flash-lite",
      "name": "Gemini 2.0 Flash Lite",
      "api": "google-generative-ai",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.075,
        "output": 0.3,
        "cacheRead": 0.01875,
        "cacheWrite": 0
      },
      "contextWindow": 1000000,
      "maxTokens": 8192
    },
    {
      "id": "gemini-2.0-pro",
      "name": "Gemini 2.0 Pro",
      "api": "google-generative-ai",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.3125,
        "cacheWrite": 0
      },
      "contextWindow": 2000000,
      "maxTokens": 8192
    },
    {
      "id": "gemini-1.5-flash",
      "name": "Gemini 1.5 Flash",
      "api": "google-generative-ai",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.075,
        "output": 0.3,
        "cacheRead": 0.01875,
        "cacheWrite": 0
      },
      "contextWindow": 1000000,
      "maxTokens": 8192
    },
    {
      "id": "gemini-1.5-pro",
      "name": "Gemini 1.5 Pro",
      "api": "google-generative-ai",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 5,
        "cacheRead": 0.3125,
        "cacheWrite": 0
      },
      "contextWindow": 2000000,
      "maxTokens": 8192
    }
  ],
  "groq": [
    {
      "id": "llama-3.3-70b-versatile",
      "name": "Llama 3.3 70B Versatile",
      "api": "openai-completions",
      "provider": "groq",
      "baseUrl": "https://api.groq.com/openai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.59,
        "output": 0.79,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 32768
    },
    {
      "id": "llama-3.1-8b-instant",
      "name": "Llama 3.1 8B Instant",
      "api": "openai-completions",
      "provider": "groq",
      "baseUrl": "https://api.groq.com/openai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.05,
        "output": 0.08,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 8192
    },
    {
      "id": "mixtral-8x7b-32768",
      "name": "Mixtral 8x7B",
      "api": "openai-completions",
      "provider": "groq",
      "baseUrl": "https://api.groq.com/openai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.24,
        "output": 0.24,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 32768,
      "maxTokens": 32768
    }
  ],
  "mistral": [
    {
      "id": "mistral-large-2",
      "name": "Mistral Large 2",
      "api": "openai-completions",
      "provider": "mistral",
      "baseUrl": "https://api.mistral.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 2,
        "output": 6,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 8192
    },
    {
      "id": "pixtral-large",
      "name": "Pixtral Large",
      "api": "openai-completions",
      "provider": "mistral",
      "baseUrl": "https://api.mistral.ai/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 2,
        "output": 6,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 8192
    },
    {
      "id": "codestral-2501",
      "name": "Codestral 2501",
      "api": "openai-completions",
      "provider": "mistral",
      "baseUrl": "https://api.mistral.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.3,
        "output": 0.9,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 256000,
      "maxTokens": 8192
    }
  ],
  "moonshot": [
    {
      "id": "moonshot-v1-8k",
      "name": "Moonshot V1 8K",
      "api": "openai-completions",
      "provider": "moonshot",
      "baseUrl": "https://api.moonshot.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.5,
        "output": 0.5,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 8192,
      "maxTokens": 4096
    },
    {
      "id": "moonshot-v1-32k",
      "name": "Moonshot V1 32K",
      "api": "openai-completions",
      "provider": "moonshot",
      "baseUrl": "https://api.moonshot.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 1,
        "output": 1,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 32768,
      "maxTokens": 8192
    },
    {
      "id": "moonshot-v1-128k",
      "name": "Moonshot V1 128K",
      "api": "openai-completions",
      "provider": "moonshot",
      "baseUrl": "https://api.moonshot.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 2,
        "output": 2,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 8192
    }
  ],
  "zhipu": [
    {
      "id": "glm-4",
      "name": "GLM-4",
      "api": "openai-completions",
      "provider": "zhipu",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.5,
        "output": 0.5,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 4096
    },
    {
      "id": "glm-4-plus",
      "name": "GLM-4 Plus",
      "api": "openai-completions",
      "provider": "zhipu",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.25,
        "output": 0.25,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 4096
    },
    {
      "id": "glm-4-flash",
      "name": "GLM-4 Flash",
      "api": "openai-completions",
      "provider": "zhipu",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.05,
        "output": 0.05,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 4096
    },
    {
      "id": "glm-4v",
      "name": "GLM-4V",
      "api": "openai-completions",
      "provider": "zhipu",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.25,
        "output": 0.25,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 8192,
      "maxTokens": 2048
    }
  ],
  "zhipu-cn": [
    {
      "id": "glm-4",
      "name": "GLM-4",
      "api": "openai-completions",
      "provider": "zhipu-cn",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.5,
        "output": 0.5,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 4096
    },
    {
      "id": "glm-4-plus",
      "name": "GLM-4 Plus",
      "api": "openai-completions",
      "provider": "zhipu-cn",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.25,
        "output": 0.25,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 4096
    }
  ],
  "cerebras": [
    {
      "id": "llama-3.3-70b",
      "name": "Llama 3.3 70B",
      "api": "openai-completions",
      "provider": "cerebras",
      "baseUrl": "https://api.cerebras.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.85,
        "output": 1.2,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 8192
    },
    {
      "id": "llama-3.1-8b",
      "name": "Llama 3.1 8B",
      "api": "openai-completions",
      "provider": "cerebras",
      "baseUrl": "https://api.cerebras.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.1,
        "output": 0.1,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 8192,
      "maxTokens": 4096
    }
  ],
  "openrouter": [
    {
      "id": "anthropic/claude-3.5-sonnet",
      "name": "Claude 3.5 Sonnet (OpenRouter)",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 3,
        "output": 15,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 200000,
      "maxTokens": 8192
    },
    {
      "id": "openai/gpt-4o",
      "name": "GPT-4o (OpenRouter)",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 2.5,
        "output": 10,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 8192
    }
  ],
  "xai": [
    {
      "id": "grok-2",
      "name": "Grok 2",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 2,
        "output": 10,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 8192
    },
    {
      "id": "grok-2-mini",
      "name": "Grok 2 Mini",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.6,
        "output": 2.4,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 8192
    }
  ],
  "ollama": [
    {
      "id": "llama3.2",
      "name": "Llama 3.2",
      "api": "openai-completions",
      "provider": "ollama",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "qwen2.5",
      "name": "Qwen 2.5",
      "api": "openai-completions",
      "provider": "ollama",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 32768,
      "maxTokens": 4096
    },
    {
      "id": "gemma2",
      "name": "Gemma 2",
      "api": "openai-completions",
      "provider": "ollama",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 8192,
      "maxTokens": 4096
    }
  ],
  "kimi": [
    {
      "id": "kimi-k2.5",
      "name": "Kimi K2.5",
      "api": "openai-completions",
      "provider": "kimi",
      "baseUrl": "https://api.moonshot.cn/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.6,
        "output": 3,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 256000,
      "maxTokens": 32768
    },
    {
      "id": "kimi-k2-thinking",
      "name": "Kimi K2 Thinking",
      "api": "openai-completions",
      "provider": "kimi",
      "baseUrl": "https://api.moonshot.cn/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.4,
        "output": 1.75,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 256000,
      "maxTokens": 32768
    },
    {
      "id": "kimi-k2",
      "name": "Kimi K2",
      "api": "openai-completions",
      "provider": "kimi",
      "baseUrl": "https://api.moonshot.cn/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.4,
        "output": 1.9,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 256000,
      "maxTokens": 262144
    },
    {
      "id": "kimi-k1.5",
      "name": "Kimi K1.5",
      "api": "openai-completions",
      "provider": "kimi",
      "baseUrl": "https://api.moonshot.cn/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.6,
        "output": 2.4,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 256000,
      "maxTokens": 16384
    }
  ],
  "minimax": [
    {
      "id": "minimax-m2.1",
      "name": "MiniMax M2.1",
      "api": "openai-completions",
      "provider": "minimax",
      "baseUrl": "https://api.minimax.chat/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.1,
        "output": 4.4,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 1000000,
      "maxTokens": 8192
    },
    {
      "id": "minimax-m2.5",
      "name": "MiniMax M2.5",
      "api": "openai-completions",
      "provider": "minimax",
      "baseUrl": "https://api.minimax.chat/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.1,
        "output": 4.4,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 1000000,
      "maxTokens": 8192
    },
    {
      "id": "minimax-m2.5-lightning",
      "name": "MiniMax M2.5 Lightning",
      "api": "openai-completions",
      "provider": "minimax",
      "baseUrl": "https://api.minimax.chat/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.5,
        "output": 2,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 1000000,
      "maxTokens": 8192
    },
    {
      "id": "minimax-text-01",
      "name": "MiniMax Text 01",
      "api": "openai-completions",
      "provider": "minimax",
      "baseUrl": "https://api.minimax.chat/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 1,
        "output": 4,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 1000000,
      "maxTokens": 8192
    },
    {
      "id": "minimax-vision-01",
      "name": "MiniMax Vision 01",
      "api": "openai-completions",
      "provider": "minimax",
      "baseUrl": "https://api.minimax.chat/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.1,
        "output": 4.4,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 1000000,
      "maxTokens": 8192
    }
  ]
};

export type LocalModelsDevData = typeof LOCAL_MODELS_DEV_DATA;
