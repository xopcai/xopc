import type { Config } from '../config/schema.js';
import { listImageGenerationProvidersSummary } from '../agent/image/generation/runtime.js';
import { isProviderConfigured } from '../providers/index.js';

export type ImageProviderCapability = {
  provider: string;
  configured: boolean;
  models: Array<{
    id: string;
    name: string;
    ref: string;
  }>;
};

const VISION_MODELS: Record<string, Array<{ id: string; name: string }>> = {
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-3-5', name: 'Claude Haiku 3.5' },
  ],
  google: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
  ],
  qwen: [
    { id: 'qwen-vl-max', name: 'Qwen VL Max' },
    { id: 'qwen2.5-vl-72b-instruct', name: 'Qwen 2.5 VL 72B' },
  ],
};

export async function resolveImageGenerationCapabilities(_config: Config): Promise<ImageProviderCapability[]> {
  const results: ImageProviderCapability[] = [];
  const summaries = listImageGenerationProvidersSummary();

  for (const s of summaries) {
    const configured = await isProviderConfigured(s.id);
    results.push({
      provider: s.id,
      configured,
      models: (s.models ?? []).map((id) => ({
        id,
        name: id,
        ref: `${s.id}/${id}`,
      })),
    });
  }

  return results;
}

export async function resolveImageUnderstandingCapabilities(_config: Config): Promise<ImageProviderCapability[]> {
  const results: ImageProviderCapability[] = [];

  for (const [providerId, models] of Object.entries(VISION_MODELS)) {
    const configured = await isProviderConfigured(providerId);
    results.push({
      provider: providerId,
      configured,
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        ref: `${providerId}/${m.id}`,
      })),
    });
  }

  return results;
}
