/**
 * Local Model Data
 * 
 * Contains all model definitions for xopcbot.
 * Built-in models from models.dev + additional providers.
 * 
 * Generated at: 2026-02-16T02:03:39.482Z
 */

import type { Api, Model } from '@mariozechner/pi-ai';

export const LOCAL_MODELS_DEV_DATA: Record<string, Model<Api>[]> = {
  "groq": [
    {
      "id": "mistral-saba-24b",
      "name": "Mistral Saba 24B",
      "api": "openai-completions",
      "provider": "groq",
      "baseUrl": "https://api.groq.com/openai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.79,
        "output": 0.79,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 32768,
      "maxTokens": 32768
    }
  ],
  "mistral": [
    {
      "id": "mistral-medium-2505",
      "name": "Mistral Medium 3",
      "api": "openai-completions",
      "provider": "mistral",
      "baseUrl": "https://api.mistral.ai/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.4,
        "output": 2,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 131072
    },
    {
      "id": "mistral-embed",
      "name": "Mistral Embed",
      "api": "openai-completions",
      "provider": "mistral",
      "baseUrl": "https://api.mistral.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.1,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 8000,
      "maxTokens": 3072
    },
    {
      "id": "mistral-medium-2508",
      "name": "Mistral Medium 3.1",
      "api": "openai-completions",
      "provider": "mistral",
      "baseUrl": "https://api.mistral.ai/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.4,
        "output": 2,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 262144,
      "maxTokens": 262144
    }
  ],
  "deepseek": [
    {
      "id": "deepseek-reasoner",
      "name": "DeepSeek Reasoner",
      "api": "openai-completions",
      "provider": "deepseek",
      "baseUrl": "https://api.deepseek.com/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.28,
        "output": 0.42,
        "cacheRead": 0.028,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 128000
    },
    {
      "id": "deepseek-chat",
      "name": "DeepSeek Chat",
      "api": "openai-completions",
      "provider": "deepseek",
      "baseUrl": "https://api.deepseek.com/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.28,
        "output": 0.42,
        "cacheRead": 0.028,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 8192
    }
  ],
  "openrouter": [
    {
      "id": "kwaipilot/kat-coder-pro:free",
      "name": "Kat Coder Pro (free)",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
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
      "contextWindow": 256000,
      "maxTokens": 65536
    },
    {
      "id": "openrouter/sherlock-think-alpha",
      "name": "Sherlock Think Alpha",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 1840000,
      "maxTokens": 8192
    },
    {
      "id": "openrouter/sherlock-dash-alpha",
      "name": "Sherlock Dash Alpha",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 1840000,
      "maxTokens": 8192
    },
    {
      "id": "openrouter/aurora-alpha",
      "name": "Aurora Alpha",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 50000
    },
    {
      "id": "google/gemini-2.5-flash-lite-preview-09-2025",
      "name": "Gemini 2.5 Flash Lite Preview 09-25",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
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
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "google/gemini-2.5-pro-preview-06-05",
      "name": "Gemini 2.5 Pro Preview 06-05",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.31,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "google/gemini-2.5-flash-preview-09-2025",
      "name": "Gemini 2.5 Flash Preview 09-25",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.3,
        "output": 2.5,
        "cacheRead": 0.031,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "google/gemini-2.5-pro-preview-05-06",
      "name": "Gemini 2.5 Pro Preview 05-06",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.31,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "google/gemini-2.5-flash",
      "name": "Gemini 2.5 Flash",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.3,
        "output": 2.5,
        "cacheRead": 0.0375,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "google/gemini-2.0-flash-001",
      "name": "Gemini 2.0 Flash",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
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
      "contextWindow": 1048576,
      "maxTokens": 8192
    },
    {
      "id": "google/gemini-3-flash-preview",
      "name": "Gemini 3 Flash Preview",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.5,
        "output": 3,
        "cacheRead": 0.05,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "google/gemini-2.5-flash-lite",
      "name": "Gemini 2.5 Flash Lite",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
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
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "google/gemini-2.0-flash-exp:free",
      "name": "Gemini 2.0 Flash Experimental (free)",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 1048576
    },
    {
      "id": "google/gemini-3-pro-preview",
      "name": "Gemini 3 Pro Preview",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 2,
        "output": 12,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 1050000,
      "maxTokens": 66000
    },
    {
      "id": "google/gemini-2.5-pro",
      "name": "Gemini 2.5 Pro",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.31,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "qwen/qwen3-coder-flash",
      "name": "Qwen3 Coder Flash",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.3,
        "output": 1.5,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 66536
    },
    {
      "id": "qwen/qwen3-max",
      "name": "Qwen3 Max",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 1.2,
        "output": 6,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 262144,
      "maxTokens": 32768
    },
    {
      "id": "x-ai/grok-3",
      "name": "Grok 3",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 3,
        "output": 15,
        "cacheRead": 0.75,
        "cacheWrite": 15
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "x-ai/grok-code-fast-1",
      "name": "Grok Code Fast 1",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.2,
        "output": 1.5,
        "cacheRead": 0.02,
        "cacheWrite": 0
      },
      "contextWindow": 256000,
      "maxTokens": 10000
    },
    {
      "id": "x-ai/grok-4-fast",
      "name": "Grok 4 Fast",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.2,
        "output": 0.5,
        "cacheRead": 0.05,
        "cacheWrite": 0.05
      },
      "contextWindow": 2000000,
      "maxTokens": 30000
    },
    {
      "id": "x-ai/grok-4",
      "name": "Grok 4",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 3,
        "output": 15,
        "cacheRead": 0.75,
        "cacheWrite": 15
      },
      "contextWindow": 256000,
      "maxTokens": 64000
    },
    {
      "id": "x-ai/grok-4.1-fast",
      "name": "Grok 4.1 Fast",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.2,
        "output": 0.5,
        "cacheRead": 0.05,
        "cacheWrite": 0.05
      },
      "contextWindow": 2000000,
      "maxTokens": 30000
    },
    {
      "id": "x-ai/grok-3-mini-beta",
      "name": "Grok 3 Mini Beta",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.3,
        "output": 0.5,
        "cacheRead": 0.075,
        "cacheWrite": 0.5
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "x-ai/grok-3-mini",
      "name": "Grok 3 Mini",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.3,
        "output": 0.5,
        "cacheRead": 0.075,
        "cacheWrite": 0.5
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "x-ai/grok-3-beta",
      "name": "Grok 3 Beta",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 3,
        "output": 15,
        "cacheRead": 0.75,
        "cacheWrite": 15
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "mistralai/mistral-medium-3",
      "name": "Mistral Medium 3",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.4,
        "output": 2,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 131072
    },
    {
      "id": "mistralai/mistral-medium-3.1",
      "name": "Mistral Medium 3.1",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.4,
        "output": 2,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 262144,
      "maxTokens": 262144
    },
    {
      "id": "openai/gpt-5-codex",
      "name": "GPT-5 Codex",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.125,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "openai/gpt-5-pro",
      "name": "GPT-5 Pro",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 15,
        "output": 120,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 272000
    },
    {
      "id": "openai/gpt-4o-mini",
      "name": "GPT-4o-mini",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.15,
        "output": 0.6,
        "cacheRead": 0.08,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    {
      "id": "openai/gpt-5.1-codex-max",
      "name": "GPT-5.1-Codex-Max",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.1,
        "output": 9,
        "cacheRead": 0.11,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "openai/gpt-5.2-codex",
      "name": "GPT-5.2-Codex",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.75,
        "output": 14,
        "cacheRead": 0.175,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "openai/gpt-5.1",
      "name": "GPT-5.1",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.125,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "openai/gpt-5.2-chat",
      "name": "GPT-5.2 Chat",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.75,
        "output": 14,
        "cacheRead": 0.175,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    {
      "id": "openai/gpt-5-chat",
      "name": "GPT-5 Chat (latest)",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "openai/gpt-5.1-chat",
      "name": "GPT-5.1 Chat",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.125,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    {
      "id": "openai/gpt-5-image",
      "name": "GPT-5 Image",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 5,
        "output": 10,
        "cacheRead": 1.25,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "openai/gpt-5.1-codex-mini",
      "name": "GPT-5.1-Codex-Mini",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.25,
        "output": 2,
        "cacheRead": 0.025,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 100000
    },
    {
      "id": "openai/gpt-5.2",
      "name": "GPT-5.2",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.75,
        "output": 14,
        "cacheRead": 0.175,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "openai/gpt-4.1",
      "name": "GPT-4.1",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 2,
        "output": 8,
        "cacheRead": 0.5,
        "cacheWrite": 0
      },
      "contextWindow": 1047576,
      "maxTokens": 32768
    },
    {
      "id": "openai/gpt-5",
      "name": "GPT-5",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "openai/o4-mini",
      "name": "o4 Mini",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.1,
        "output": 4.4,
        "cacheRead": 0.28,
        "cacheWrite": 0
      },
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    {
      "id": "openai/gpt-4.1-mini",
      "name": "GPT-4.1 Mini",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.4,
        "output": 1.6,
        "cacheRead": 0.1,
        "cacheWrite": 0
      },
      "contextWindow": 1047576,
      "maxTokens": 32768
    },
    {
      "id": "openai/gpt-oss-safeguard-20b",
      "name": "GPT OSS Safeguard 20B",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.075,
        "output": 0.3,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 65536
    },
    {
      "id": "openai/gpt-5.1-codex",
      "name": "GPT-5.1-Codex",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.125,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "openai/gpt-5.2-pro",
      "name": "GPT-5.2 Pro",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 21,
        "output": 168,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "openai/gpt-5-mini",
      "name": "GPT-5 Mini",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.25,
        "output": 2,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "openai/gpt-5-nano",
      "name": "GPT-5 Nano",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.05,
        "output": 0.4,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "anthropic/claude-3.7-sonnet",
      "name": "Claude Sonnet 3.7",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
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
      "maxTokens": 128000
    },
    {
      "id": "anthropic/claude-opus-4.1",
      "name": "Claude Opus 4.1",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
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
      "maxTokens": 32000
    },
    {
      "id": "anthropic/claude-haiku-4.5",
      "name": "Claude Haiku 4.5",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1,
        "output": 5,
        "cacheRead": 0.1,
        "cacheWrite": 1.25
      },
      "contextWindow": 200000,
      "maxTokens": 64000
    },
    {
      "id": "anthropic/claude-3.5-haiku",
      "name": "Claude Haiku 3.5",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.8,
        "output": 4,
        "cacheRead": 0.08,
        "cacheWrite": 1
      },
      "contextWindow": 200000,
      "maxTokens": 8192
    },
    {
      "id": "anthropic/claude-opus-4.5",
      "name": "Claude Opus 4.5",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 5,
        "output": 25,
        "cacheRead": 0.5,
        "cacheWrite": 6.25
      },
      "contextWindow": 200000,
      "maxTokens": 32000
    },
    {
      "id": "anthropic/claude-opus-4",
      "name": "Claude Opus 4",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
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
      "maxTokens": 32000
    },
    {
      "id": "anthropic/claude-sonnet-4",
      "name": "Claude Sonnet 4",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
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
      "maxTokens": 64000
    },
    {
      "id": "anthropic/claude-sonnet-4.5",
      "name": "Claude Sonnet 4.5",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
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
      "contextWindow": 1000000,
      "maxTokens": 64000
    },
    {
      "id": "anthropic/claude-opus-4.6",
      "name": "Claude Opus 4.6",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 5,
        "output": 25,
        "cacheRead": 0.5,
        "cacheWrite": 6.25
      },
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    {
      "id": "black-forest-labs/flux.2-pro",
      "name": "FLUX.2 Pro",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 46864,
      "maxTokens": 46864
    },
    {
      "id": "black-forest-labs/flux.2-flex",
      "name": "FLUX.2 Flex",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 67344,
      "maxTokens": 67344
    },
    {
      "id": "black-forest-labs/flux.2-max",
      "name": "FLUX.2 Max",
      "api": "openai-completions",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 46864,
      "maxTokens": 46864
    }
  ],
  "google": [
    {
      "id": "gemini-embedding-001",
      "name": "Gemini Embedding 001",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.15,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 2048,
      "maxTokens": 3072
    },
    {
      "id": "gemini-2.5-flash-lite-preview-09-2025",
      "name": "Gemini 2.5 Flash Lite Preview 09-25",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
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
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "gemini-2.5-pro-preview-06-05",
      "name": "Gemini 2.5 Pro Preview 06-05",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.31,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "gemini-2.5-flash-preview-04-17",
      "name": "Gemini 2.5 Flash Preview 04-17",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.15,
        "output": 0.6,
        "cacheRead": 0.0375,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "gemini-2.5-flash-preview-09-2025",
      "name": "Gemini 2.5 Flash Preview 09-25",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.3,
        "output": 2.5,
        "cacheRead": 0.075,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "gemini-2.5-pro-preview-05-06",
      "name": "Gemini 2.5 Pro Preview 05-06",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.31,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "gemini-2.5-flash-preview-05-20",
      "name": "Gemini 2.5 Flash Preview 05-20",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.15,
        "output": 0.6,
        "cacheRead": 0.0375,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "gemini-2.5-flash",
      "name": "Gemini 2.5 Flash",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.3,
        "output": 2.5,
        "cacheRead": 0.075,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "gemini-live-2.5-flash",
      "name": "Gemini Live 2.5 Flash",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
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
      "contextWindow": 128000,
      "maxTokens": 8000
    },
    {
      "id": "gemini-3-flash-preview",
      "name": "Gemini 3 Flash Preview",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.5,
        "output": 3,
        "cacheRead": 0.05,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "gemini-live-2.5-flash-preview-native-audio",
      "name": "Gemini Live 2.5 Flash Preview Native Audio",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
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
      "contextWindow": 131072,
      "maxTokens": 65536
    },
    {
      "id": "gemini-2.5-flash-lite",
      "name": "Gemini 2.5 Flash Lite",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
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
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "gemini-2.5-flash-preview-tts",
      "name": "Gemini 2.5 Flash Preview TTS",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.5,
        "output": 10,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 8000,
      "maxTokens": 16000
    },
    {
      "id": "gemini-flash-latest",
      "name": "Gemini Flash Latest",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.3,
        "output": 2.5,
        "cacheRead": 0.075,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "gemini-2.5-flash-lite-preview-06-17",
      "name": "Gemini 2.5 Flash Lite Preview 06-17",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
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
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "gemini-2.5-flash-image",
      "name": "Gemini 2.5 Flash Image",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.3,
        "output": 30,
        "cacheRead": 0.075,
        "cacheWrite": 0
      },
      "contextWindow": 32768,
      "maxTokens": 32768
    },
    {
      "id": "gemini-2.5-pro-preview-tts",
      "name": "Gemini 2.5 Pro Preview TTS",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 1,
        "output": 20,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 8000,
      "maxTokens": 16000
    },
    {
      "id": "gemini-2.5-flash-image-preview",
      "name": "Gemini 2.5 Flash Image (Preview)",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.3,
        "output": 30,
        "cacheRead": 0.075,
        "cacheWrite": 0
      },
      "contextWindow": 32768,
      "maxTokens": 32768
    },
    {
      "id": "gemini-1.5-flash-8b",
      "name": "Gemini 1.5 Flash-8B",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.0375,
        "output": 0.15,
        "cacheRead": 0.01,
        "cacheWrite": 0
      },
      "contextWindow": 1000000,
      "maxTokens": 8192
    },
    {
      "id": "gemini-3-pro-preview",
      "name": "Gemini 3 Pro Preview",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 2,
        "output": 12,
        "cacheRead": 0.2,
        "cacheWrite": 0
      },
      "contextWindow": 1000000,
      "maxTokens": 64000
    },
    {
      "id": "gemini-2.0-flash-lite",
      "name": "Gemini 2.0 Flash Lite",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.075,
        "output": 0.3,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 8192
    },
    {
      "id": "gemini-1.5-flash",
      "name": "Gemini 1.5 Flash",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
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
      "id": "gemini-flash-lite-latest",
      "name": "Gemini Flash-Lite Latest",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
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
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "gemini-2.5-pro",
      "name": "Gemini 2.5 Pro",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.31,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    {
      "id": "gemini-2.0-flash",
      "name": "Gemini 2.0 Flash",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
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
      "contextWindow": 1048576,
      "maxTokens": 8192
    },
    {
      "id": "gemini-1.5-pro",
      "name": "Gemini 1.5 Pro",
      "api": "openai-completions",
      "provider": "google",
      "baseUrl": "https://generativelanguage.googleapis.com/v1",
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
      "contextWindow": 1000000,
      "maxTokens": 8192
    }
  ],
  "zhipu": [
    {
      "id": "glm-5",
      "name": "GLM-5",
      "api": "openai-completions",
      "provider": "zhipu",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 1,
        "output": 3.2,
        "cacheRead": 0.2,
        "cacheWrite": 0
      },
      "contextWindow": 204800,
      "maxTokens": 131072
    }
  ],
  "openai": [
    {
      "id": "gpt-4o-2024-11-20",
      "name": "GPT-4o (2024-11-20)",
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
      "id": "gpt-5.3-codex",
      "name": "GPT-5.3 Codex",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.75,
        "output": 14,
        "cacheRead": 0.175,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "gpt-5-codex",
      "name": "GPT-5-Codex",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.125,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "gpt-5-pro",
      "name": "GPT-5 Pro",
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
        "output": 120,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 272000
    },
    {
      "id": "gpt-4o-mini",
      "name": "GPT-4o mini",
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
        "cacheRead": 0.08,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    {
      "id": "text-embedding-ada-002",
      "name": "text-embedding-ada-002",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.1,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 8192,
      "maxTokens": 1536
    },
    {
      "id": "gpt-5-chat-latest",
      "name": "GPT-5 Chat (latest)",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "codex-mini-latest",
      "name": "Codex Mini",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 1.5,
        "output": 6,
        "cacheRead": 0.375,
        "cacheWrite": 0
      },
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    {
      "id": "gpt-5.1-codex-max",
      "name": "GPT-5.1 Codex Max",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.125,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "gpt-4o-2024-05-13",
      "name": "GPT-4o (2024-05-13)",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 5,
        "output": 15,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 4096
    },
    {
      "id": "gpt-5.2-chat-latest",
      "name": "GPT-5.2 Chat",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.75,
        "output": 14,
        "cacheRead": 0.175,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    {
      "id": "gpt-5.2-codex",
      "name": "GPT-5.2 Codex",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.75,
        "output": 14,
        "cacheRead": 0.175,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "o3-deep-research",
      "name": "o3-deep-research",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 10,
        "output": 40,
        "cacheRead": 2.5,
        "cacheWrite": 0
      },
      "contextWindow": 200000,
      "maxTokens": 100000
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
      "id": "gpt-5.1",
      "name": "GPT-5.1",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.13,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "o4-mini-deep-research",
      "name": "o4-mini-deep-research",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 2,
        "output": 8,
        "cacheRead": 0.5,
        "cacheWrite": 0
      },
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    {
      "id": "gpt-5.3-codex-spark",
      "name": "GPT-5.3 Codex Spark",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.75,
        "output": 14,
        "cacheRead": 0.175,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 32000
    },
    {
      "id": "o3",
      "name": "o3",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 2,
        "output": 8,
        "cacheRead": 0.5,
        "cacheWrite": 0
      },
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    {
      "id": "text-embedding-3-small",
      "name": "text-embedding-3-small",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.02,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 8191,
      "maxTokens": 1536
    },
    {
      "id": "gpt-4.1-nano",
      "name": "GPT-4.1 nano",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.1,
        "output": 0.4,
        "cacheRead": 0.03,
        "cacheWrite": 0
      },
      "contextWindow": 1047576,
      "maxTokens": 32768
    },
    {
      "id": "text-embedding-3-large",
      "name": "text-embedding-3-large",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.13,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 8191,
      "maxTokens": 3072
    },
    {
      "id": "gpt-3.5-turbo",
      "name": "GPT-3.5-turbo",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.5,
        "output": 1.5,
        "cacheRead": 1.25,
        "cacheWrite": 0
      },
      "contextWindow": 16385,
      "maxTokens": 4096
    },
    {
      "id": "gpt-5.1-codex-mini",
      "name": "GPT-5.1 Codex mini",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.25,
        "output": 2,
        "cacheRead": 0.025,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "gpt-5.2",
      "name": "GPT-5.2",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.75,
        "output": 14,
        "cacheRead": 0.175,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "gpt-4.1",
      "name": "GPT-4.1",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 2,
        "output": 8,
        "cacheRead": 0.5,
        "cacheWrite": 0
      },
      "contextWindow": 1047576,
      "maxTokens": 32768
    },
    {
      "id": "o3-pro",
      "name": "o3-pro",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 20,
        "output": 80,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    {
      "id": "gpt-4-turbo",
      "name": "GPT-4 Turbo",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 10,
        "output": 30,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 4096
    },
    {
      "id": "gpt-5",
      "name": "GPT-5",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.125,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "o4-mini",
      "name": "o4-mini",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.1,
        "output": 4.4,
        "cacheRead": 0.28,
        "cacheWrite": 0
      },
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    {
      "id": "gpt-4.1-mini",
      "name": "GPT-4.1 mini",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.4,
        "output": 1.6,
        "cacheRead": 0.1,
        "cacheWrite": 0
      },
      "contextWindow": 1047576,
      "maxTokens": 32768
    },
    {
      "id": "o1-preview",
      "name": "o1-preview",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 15,
        "output": 60,
        "cacheRead": 7.5,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 32768
    },
    {
      "id": "o1-pro",
      "name": "o1-pro",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 150,
        "output": 600,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    {
      "id": "gpt-5.1-codex",
      "name": "GPT-5.1 Codex",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.125,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "gpt-5.2-pro",
      "name": "GPT-5.2 Pro",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 21,
        "output": 168,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "o3-mini",
      "name": "o3-mini",
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
    },
    {
      "id": "gpt-4o-2024-08-06",
      "name": "GPT-4o (2024-08-06)",
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
      "id": "gpt-5-mini",
      "name": "GPT-5 Mini",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.25,
        "output": 2,
        "cacheRead": 0.025,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "gpt-5.1-chat-latest",
      "name": "GPT-5.1 Chat",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1.25,
        "output": 10,
        "cacheRead": 0.125,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    {
      "id": "gpt-4",
      "name": "GPT-4",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 30,
        "output": 60,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 8192,
      "maxTokens": 8192
    },
    {
      "id": "gpt-5-nano",
      "name": "GPT-5 Nano",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.05,
        "output": 0.4,
        "cacheRead": 0.005,
        "cacheWrite": 0
      },
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    {
      "id": "o1-mini",
      "name": "o1-mini",
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
      "contextWindow": 128000,
      "maxTokens": 65536
    },
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
    }
  ],
  "anthropic": [
    {
      "id": "claude-opus-4-5-20251101",
      "name": "Claude Opus 4.5",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 5,
        "output": 25,
        "cacheRead": 0.5,
        "cacheWrite": 6.25
      },
      "contextWindow": 200000,
      "maxTokens": 64000
    },
    {
      "id": "claude-3-5-haiku-latest",
      "name": "Claude Haiku 3.5 (latest)",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.8,
        "output": 4,
        "cacheRead": 0.08,
        "cacheWrite": 1
      },
      "contextWindow": 200000,
      "maxTokens": 8192
    },
    {
      "id": "claude-opus-4-1",
      "name": "Claude Opus 4.1 (latest)",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": true,
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
      "maxTokens": 32000
    },
    {
      "id": "claude-3-5-sonnet-20241022",
      "name": "Claude Sonnet 3.5 v2",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
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
      "id": "claude-3-sonnet-20240229",
      "name": "Claude Sonnet 3",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 3,
        "output": 15,
        "cacheRead": 0.3,
        "cacheWrite": 0.3
      },
      "contextWindow": 200000,
      "maxTokens": 4096
    },
    {
      "id": "claude-opus-4-6",
      "name": "Claude Opus 4.6",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 5,
        "output": 25,
        "cacheRead": 0.5,
        "cacheWrite": 6.25
      },
      "contextWindow": 200000,
      "maxTokens": 128000
    },
    {
      "id": "claude-sonnet-4-0",
      "name": "Claude Sonnet 4 (latest)",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": true,
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
      "maxTokens": 64000
    },
    {
      "id": "claude-opus-4-20250514",
      "name": "Claude Opus 4",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": true,
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
      "maxTokens": 32000
    },
    {
      "id": "claude-sonnet-4-5-20250929",
      "name": "Claude Sonnet 4.5",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": true,
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
      "maxTokens": 64000
    },
    {
      "id": "claude-opus-4-0",
      "name": "Claude Opus 4 (latest)",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": true,
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
      "maxTokens": 32000
    },
    {
      "id": "claude-3-5-haiku-20241022",
      "name": "Claude Haiku 3.5",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.8,
        "output": 4,
        "cacheRead": 0.08,
        "cacheWrite": 1
      },
      "contextWindow": 200000,
      "maxTokens": 8192
    },
    {
      "id": "claude-3-5-sonnet-20240620",
      "name": "Claude Sonnet 3.5",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
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
      "id": "claude-3-7-sonnet-latest",
      "name": "Claude Sonnet 3.7 (latest)",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": true,
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
      "maxTokens": 64000
    },
    {
      "id": "claude-3-7-sonnet-20250219",
      "name": "Claude Sonnet 3.7",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": true,
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
      "maxTokens": 64000
    },
    {
      "id": "claude-3-haiku-20240307",
      "name": "Claude Haiku 3",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.25,
        "output": 1.25,
        "cacheRead": 0.03,
        "cacheWrite": 0.3
      },
      "contextWindow": 200000,
      "maxTokens": 4096
    },
    {
      "id": "claude-haiku-4-5-20251001",
      "name": "Claude Haiku 4.5",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1,
        "output": 5,
        "cacheRead": 0.1,
        "cacheWrite": 1.25
      },
      "contextWindow": 200000,
      "maxTokens": 64000
    },
    {
      "id": "claude-haiku-4-5",
      "name": "Claude Haiku 4.5 (latest)",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 1,
        "output": 5,
        "cacheRead": 0.1,
        "cacheWrite": 1.25
      },
      "contextWindow": 200000,
      "maxTokens": 64000
    },
    {
      "id": "claude-opus-4-5",
      "name": "Claude Opus 4.5 (latest)",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 5,
        "output": 25,
        "cacheRead": 0.5,
        "cacheWrite": 6.25
      },
      "contextWindow": 200000,
      "maxTokens": 64000
    },
    {
      "id": "claude-3-opus-20240229",
      "name": "Claude Opus 3",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
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
      "maxTokens": 4096
    },
    {
      "id": "claude-sonnet-4-5",
      "name": "Claude Sonnet 4.5 (latest)",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": true,
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
      "maxTokens": 64000
    },
    {
      "id": "claude-sonnet-4-20250514",
      "name": "Claude Sonnet 4",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": true,
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
      "maxTokens": 64000
    },
    {
      "id": "claude-opus-4-1-20250805",
      "name": "Claude Opus 4.1",
      "api": "openai-completions",
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "reasoning": true,
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
      "maxTokens": 32000
    }
  ],
  "xai": [
    {
      "id": "grok-2-1212",
      "name": "Grok 2 (1212)",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 2,
        "output": 10,
        "cacheRead": 2,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "grok-2",
      "name": "Grok 2",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 2,
        "output": 10,
        "cacheRead": 2,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "grok-3-fast-latest",
      "name": "Grok 3 Fast Latest",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 5,
        "output": 25,
        "cacheRead": 1.25,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "grok-2-vision",
      "name": "Grok 2 Vision",
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
        "cacheRead": 2,
        "cacheWrite": 0
      },
      "contextWindow": 8192,
      "maxTokens": 4096
    },
    {
      "id": "grok-3",
      "name": "Grok 3",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 3,
        "output": 15,
        "cacheRead": 0.75,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "grok-code-fast-1",
      "name": "Grok Code Fast 1",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.2,
        "output": 1.5,
        "cacheRead": 0.02,
        "cacheWrite": 0
      },
      "contextWindow": 256000,
      "maxTokens": 10000
    },
    {
      "id": "grok-2-vision-1212",
      "name": "Grok 2 Vision (1212)",
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
        "cacheRead": 2,
        "cacheWrite": 0
      },
      "contextWindow": 8192,
      "maxTokens": 4096
    },
    {
      "id": "grok-4-1-fast-non-reasoning",
      "name": "Grok 4.1 Fast (Non-Reasoning)",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.2,
        "output": 0.5,
        "cacheRead": 0.05,
        "cacheWrite": 0
      },
      "contextWindow": 2000000,
      "maxTokens": 30000
    },
    {
      "id": "grok-beta",
      "name": "Grok Beta",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 5,
        "output": 15,
        "cacheRead": 5,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 4096
    },
    {
      "id": "grok-3-mini-fast",
      "name": "Grok 3 Mini Fast",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.6,
        "output": 4,
        "cacheRead": 0.15,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "grok-4-fast",
      "name": "Grok 4 Fast",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.2,
        "output": 0.5,
        "cacheRead": 0.05,
        "cacheWrite": 0
      },
      "contextWindow": 2000000,
      "maxTokens": 30000
    },
    {
      "id": "grok-4",
      "name": "Grok 4",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 3,
        "output": 15,
        "cacheRead": 0.75,
        "cacheWrite": 0
      },
      "contextWindow": 256000,
      "maxTokens": 64000
    },
    {
      "id": "grok-3-latest",
      "name": "Grok 3 Latest",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 3,
        "output": 15,
        "cacheRead": 0.75,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "grok-4-1-fast",
      "name": "Grok 4.1 Fast",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": true,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.2,
        "output": 0.5,
        "cacheRead": 0.05,
        "cacheWrite": 0
      },
      "contextWindow": 2000000,
      "maxTokens": 30000
    },
    {
      "id": "grok-2-vision-latest",
      "name": "Grok 2 Vision Latest",
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
        "cacheRead": 2,
        "cacheWrite": 0
      },
      "contextWindow": 8192,
      "maxTokens": 4096
    },
    {
      "id": "grok-3-mini-latest",
      "name": "Grok 3 Mini Latest",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.3,
        "output": 0.5,
        "cacheRead": 0.075,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "grok-3-mini",
      "name": "Grok 3 Mini",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.3,
        "output": 0.5,
        "cacheRead": 0.075,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "grok-3-mini-fast-latest",
      "name": "Grok 3 Mini Fast Latest",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": true,
      "input": [
        "text"
      ],
      "cost": {
        "input": 0.6,
        "output": 4,
        "cacheRead": 0.15,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "grok-2-latest",
      "name": "Grok 2 Latest",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 2,
        "output": 10,
        "cacheRead": 2,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    {
      "id": "grok-4-fast-non-reasoning",
      "name": "Grok 4 Fast (Non-Reasoning)",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0.2,
        "output": 0.5,
        "cacheRead": 0.05,
        "cacheWrite": 0
      },
      "contextWindow": 2000000,
      "maxTokens": 30000
    },
    {
      "id": "grok-vision-beta",
      "name": "Grok Vision Beta",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 5,
        "output": 15,
        "cacheRead": 5,
        "cacheWrite": 0
      },
      "contextWindow": 8192,
      "maxTokens": 4096
    },
    {
      "id": "grok-3-fast",
      "name": "Grok 3 Fast",
      "api": "openai-completions",
      "provider": "xai",
      "baseUrl": "https://api.x.ai/v1",
      "reasoning": false,
      "input": [
        "text"
      ],
      "cost": {
        "input": 5,
        "output": 25,
        "cacheRead": 1.25,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 8192
    }
  ],
  "qwen": [
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
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 16384
    },
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
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 16384
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
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
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
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 1048576,
      "maxTokens": 8192
    },
    {
      "id": "qwq-32b",
      "name": "QwQ 32B",
      "api": "openai-completions",
      "provider": "qwen",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "reasoning": true,
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
      "id": "qwen3-235b",
      "name": "Qwen3 235B",
      "api": "openai-completions",
      "provider": "qwen",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "reasoning": true,
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
      "maxTokens": 16384
    },
    {
      "id": "qwen3-30b",
      "name": "Qwen3 30B",
      "api": "openai-completions",
      "provider": "qwen",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "reasoning": true,
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
      "maxTokens": 16384
    },
    {
      "id": "qwen3-8b",
      "name": "Qwen3 8B",
      "api": "openai-completions",
      "provider": "qwen",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "reasoning": true,
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
      "maxTokens": 16384
    },
    {
      "id": "qwen3-4b",
      "name": "Qwen3 4B",
      "api": "openai-completions",
      "provider": "qwen",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "reasoning": true,
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
      "maxTokens": 16384
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
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 2000000,
      "maxTokens": 8192
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
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 200000,
      "maxTokens": 32768
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
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    {
      "id": "kimi-latest",
      "name": "Kimi Latest",
      "api": "openai-completions",
      "provider": "kimi",
      "baseUrl": "https://api.moonshot.cn/v1",
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
      "contextWindow": 128000,
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
        "input": 0,
        "output": 0,
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
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 32000,
      "maxTokens": 16384
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
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 32768
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
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 8192
    },
    {
      "id": "glm-4-flash",
      "name": "GLM-4 Flash",
      "api": "openai-completions",
      "provider": "zhipu-cn",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
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
      "contextWindow": 128000,
      "maxTokens": 8192
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
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 8192
    },
    {
      "id": "glm-4-flashx",
      "name": "GLM-4 FlashX",
      "api": "openai-completions",
      "provider": "zhipu-cn",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
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
      "contextWindow": 128000,
      "maxTokens": 8192
    },
    {
      "id": "glm-4v-flash",
      "name": "GLM-4V Flash",
      "api": "openai-completions",
      "provider": "zhipu-cn",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
      "reasoning": false,
      "input": [
        "text",
        "image"
      ],
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 8192
    },
    {
      "id": "glm-5",
      "name": "GLM-5",
      "api": "openai-completions",
      "provider": "zhipu-cn",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
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
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    {
      "id": "glm-5-flash",
      "name": "GLM-5 Flash",
      "api": "openai-completions",
      "provider": "zhipu-cn",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
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
      "contextWindow": 128000,
      "maxTokens": 16384
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
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 8192,
      "maxTokens": 4096
    },
    {
      "id": "llama-3.1-70b",
      "name": "Llama 3.1 70B",
      "api": "openai-completions",
      "provider": "cerebras",
      "baseUrl": "https://api.cerebras.ai/v1",
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
      "contextWindow": 128000,
      "maxTokens": 4096
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
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 4096
    }
  ],
  "ollama": [
    {
      "id": "llama3",
      "name": "Llama 3",
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
    },
    {
      "id": "llama3.1",
      "name": "Llama 3.1",
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
      "contextWindow": 128000,
      "maxTokens": 4096
    },
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
      "contextWindow": 128000,
      "maxTokens": 4096
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
      "id": "qwen2.5-coder",
      "name": "Qwen 2.5 Coder",
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
      "id": "mistral",
      "name": "Mistral",
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
    },
    {
      "id": "phi3",
      "name": "Phi-3",
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
      "contextWindow": 4096,
      "maxTokens": 4096
    },
    {
      "id": "codellama",
      "name": "CodeLlama",
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
      "contextWindow": 16384,
      "maxTokens": 4096
    },
    {
      "id": "deepseek-llm",
      "name": "DeepSeek LLM",
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
      "id": "deepseek-coder",
      "name": "DeepSeek Coder",
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
      "contextWindow": 16384,
      "maxTokens": 4096
    }
  ]
};

export type LocalModelsDevData = typeof LOCAL_MODELS_DEV_DATA;
