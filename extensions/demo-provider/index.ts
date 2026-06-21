/**
 * Demo Provider — mock streaming provider for docs and local verification.
 * @see .docs/extension-provider-demo.md
 */

import type { ExtensionApi } from '@xopcai/xopc/extension-sdk';
import type {
  ProviderPlugin,
  ProviderModelDefinition,
  ProviderStreamChunk,
  ProviderStreamParams,
} from '@xopcai/xopc/extension-sdk';

const MODELS: ProviderModelDefinition[] = [
  {
    id: 'demo-chat-7b',
    name: 'Demo Chat 7B',
    contextWindow: 32768,
    maxOutputTokens: 4096,
    supportsImages: false,
    supportsTools: true,
    supportsStreaming: true,
    supportsJson: true,
    pricing: { input: 0.5, output: 1.5 },
  },
];

function extractLastUserText(messages: ProviderStreamParams['messages']): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const c = m.content;
    if (typeof c === 'string') return c.trim();
    if (Array.isArray(c)) {
      const parts: string[] = [];
      for (const block of c) {
        if (block && typeof block === 'object' && 'type' in block && (block as { type: string }).type === 'text') {
          const t = (block as { text?: string }).text;
          if (typeof t === 'string') parts.push(t);
        }
      }
      return parts.join('').trim();
    }
  }
  return '';
}

async function* mockCreateStream(params: ProviderStreamParams): AsyncGenerator<ProviderStreamChunk> {
  const user = extractLastUserText(params.messages);
  const snippet = user.length > 200 ? `${user.slice(0, 200)}…` : user;
  const body = `I'm **${params.model}** from the Demo Provider extension. You said: "${snippet || '(empty)'}" This is a mock response with no real LLM call.`;

  const tokens = body.split(/(\s+)/);
  for (const piece of tokens) {
    if (params.signal?.aborted) {
      yield { type: 'error', error: 'Request aborted' };
      return;
    }
    if (piece) {
      yield { type: 'text', text: piece };
    }
  }

  yield {
    type: 'usage',
    usage: {
      input: 32,
      output: Math.min(256, Math.ceil(body.length / 4)),
      total: 32 + Math.min(256, Math.ceil(body.length / 4)),
    },
  };
}

function createDemoProvider(_config: { baseUrl: string; apiKey: string }): ProviderPlugin {
  return {
    id: 'demo',
    name: 'Demo Provider',
    description: 'Mock LLM provider bundled with xopc for extension provider examples.',
    models: MODELS,
    defaultModel: 'demo-chat-7b',

    createStream(params: ProviderStreamParams): AsyncIterable<ProviderStreamChunk> {
      return mockCreateStream(params);
    },

    isConfigured(_extensionConfig: Record<string, unknown>): boolean {
      // Mock provider: always ready so CLI/Web can try demo/demo-chat-7b without keys.
      return true;
    },

    requiredEnvVars(): string[] {
      return ['DEMO_API_KEY'];
    },
  };
}

export default function register(api: ExtensionApi) {
  const extensionConfig = api.extensionConfig as {
    baseUrl?: string;
    apiKey?: string;
  };

  const baseUrl =
    typeof extensionConfig.baseUrl === 'string' && extensionConfig.baseUrl.trim()
      ? extensionConfig.baseUrl.trim()
      : 'https://api.demo-llm.example.com/v1';
  const apiKey =
    typeof extensionConfig.apiKey === 'string' && extensionConfig.apiKey.trim()
      ? extensionConfig.apiKey.trim()
      : (process.env.DEMO_API_KEY ?? '');

  const provider = createDemoProvider({ baseUrl, apiKey });
  api.registerProviderPlugin(provider);

  api.logger.info(
    `Registered provider: ${provider.id} with models: ${provider.models.map((m) => m.id).join(', ')}`,
  );
}
