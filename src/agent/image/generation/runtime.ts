import { parseModelRef } from '../../../config/schema.js';
import type { Config } from '../../../config/schema.js';
import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
} from '../../../config/model-input.js';
import { getApiKey } from '../../../providers/index.js';
import { OPENAI_DEFAULT_IMAGE_MODEL } from './constants.js';
import { runOpenAiImageGeneration } from './openai-generate.js';
import type { ImageGenFallbackAttempt, ImageGenerationResult } from './types.js';

export type GenerateImageParams = {
  cfg?: Config;
  prompt: string;
  modelOverride?: string;
  count?: number;
  size?: string;
  signal?: AbortSignal;
};

export type GenerateImageRuntimeResult = {
  images: ImageGenerationResult['images'];
  provider: string;
  model: string;
  attempts: ImageGenFallbackAttempt[];
};

function parseCandidates(params: {
  cfg: Config | undefined;
  modelOverride?: string;
}): Array<{ provider: string; model: string }> {
  const candidates: Array<{ provider: string; model: string }> = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    const p = raw?.trim();
    if (!p) {
      return;
    }
    const parsed = parseModelRef(p);
    if (!parsed) {
      return;
    }
    const key = `${parsed.provider}/${parsed.model}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(parsed);
  };

  add(params.modelOverride);
  add(resolveAgentModelPrimaryValue(params.cfg?.agents?.defaults?.imageGenerationModel));
  for (const f of resolveAgentModelFallbackValues(params.cfg?.agents?.defaults?.imageGenerationModel)) {
    add(f);
  }
  if (candidates.length === 0) {
    add(`openai/${OPENAI_DEFAULT_IMAGE_MODEL}`);
  }
  return candidates;
}

export async function generateImage(params: GenerateImageParams): Promise<GenerateImageRuntimeResult> {
  const candidates = parseCandidates({ cfg: params.cfg, modelOverride: params.modelOverride });
  if (candidates.length === 0) {
    throw new Error(
      'No image-generation model configured. Set agents.defaults.imageGenerationModel.primary or fallbacks (e.g. openai/gpt-image-1).',
    );
  }

  const attempts: ImageGenFallbackAttempt[] = [];
  let lastError: unknown;

  for (const candidate of candidates) {
    if (candidate.provider !== 'openai') {
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: 'Only OpenAI image generation is supported in this build.',
      });
      lastError = new Error('unsupported provider');
      continue;
    }

    try {
      const apiKey = await getApiKey('openai');
      if (!apiKey) {
        throw new Error('OpenAI API key missing');
      }
      const result = await runOpenAiImageGeneration({
        provider: 'openai',
        model: candidate.model,
        prompt: params.prompt,
        cfg: params.cfg,
        apiKey,
        count: params.count,
        size: params.size,
        signal: params.signal,
      });
      if (!result.images?.length) {
        throw new Error('Image generation returned no images');
      }
      return {
        images: result.images,
        provider: 'openai',
        model: result.model ?? candidate.model,
        attempts,
      };
    } catch (err) {
      lastError = err;
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary = attempts.map((a) => `${a.provider}/${a.model}: ${a.error}`).join(' | ');
  throw new Error(`All image generation models failed (${attempts.length}): ${summary}`, {
    cause: lastError instanceof Error ? lastError : undefined,
  });
}

export function listImageGenerationProvidersSummary(): Array<{
  id: string;
  defaultModel?: string;
  models: string[];
}> {
  return [
    {
      id: 'openai',
      defaultModel: OPENAI_DEFAULT_IMAGE_MODEL,
      models: [OPENAI_DEFAULT_IMAGE_MODEL, 'dall-e-3', 'dall-e-2'],
    },
  ];
}
