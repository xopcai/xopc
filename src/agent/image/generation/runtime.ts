import { parseModelRef } from '../../../config/schema.js';
import type { Config } from '../../../config/schema.js';
import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
} from '../../../config/model-input.js';
import {
  getImageGenerationProvider,
  listImageGenerationProvidersSummary as listProvidersSummaryFromRegistry,
} from './provider-registry.js';
import { OPENAI_DEFAULT_IMAGE_MODEL } from './constants.js';
import type { ImageGenFallbackAttempt, ImageGenerationResult, ImageGenerationSourceImage } from './types.js';

import './openai-generate.js';
import './dashscope-generate.js';
import './minimax-generate.js';

export type GenerateImageParams = {
  cfg?: Config;
  prompt: string;
  modelOverride?: string;
  count?: number;
  size?: string;
  signal?: AbortSignal;
  inputImages?: ImageGenerationSourceImage[];
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
      'No image-generation model configured. Set agents.defaults.imageGenerationModel.primary or fallbacks (e.g. openai/gpt-image-1 or dashscope/wan2.6-t2i).',
    );
  }

  const wantsEdit = Boolean(params.inputImages?.length);
  const attempts: ImageGenFallbackAttempt[] = [];
  let lastError: unknown;

  for (const candidate of candidates) {
    const provider = getImageGenerationProvider(candidate.provider);
    if (!provider) {
      const errorMessage = `Image generation provider not registered: ${candidate.provider}`;
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: errorMessage,
      });
      lastError = new Error(errorMessage);
      continue;
    }

    if (wantsEdit && provider.capabilities?.supportsEdit === false) {
      const errorMessage = `Image-to-image not supported for provider: ${candidate.provider}`;
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: errorMessage,
      });
      lastError = new Error(errorMessage);
      continue;
    }

    try {
      const result = await provider.generateImage({
        provider: candidate.provider,
        model: candidate.model,
        prompt: params.prompt,
        cfg: params.cfg,
        count: params.count,
        size: params.size,
        signal: params.signal,
        inputImages: params.inputImages,
      });
      if (!result.images?.length) {
        throw new Error('Image generation returned no images');
      }
      return {
        images: result.images,
        provider: candidate.provider,
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

export function listImageGenerationProvidersSummary(): ReturnType<
  typeof listProvidersSummaryFromRegistry
> {
  return listProvidersSummaryFromRegistry();
}
