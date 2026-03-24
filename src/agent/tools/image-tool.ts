import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { Config } from '../../config/schema.js';
import { describeImagesWithPiAi } from '../image/describe-images.js';
import {
  buildImageToolTextResult,
  coerceImageModelConfig,
  resolvePromptAndModelOverride,
} from '../image/image-helpers.js';
import { runWithImageModelFallback } from '../image/image-model-fallback.js';
import { loadImageForToolInput } from '../image/load-image-media.js';
import {
  buildToolModelConfigFromCandidates,
  coerceToolModelConfig,
  hasToolModelConfig,
  resolveDefaultModelRef,
  type ToolModelConfig,
} from '../image/tool-model-config.js';
import { getModelsByProvider } from '../../providers/index.js';

const DEFAULT_PROMPT = 'Describe the image.';
const DEFAULT_MAX_IMAGES = 20;

function firstVisionModelRef(provider: string): string | undefined {
  const m = getModelsByProvider(provider).find((x) => x.input?.includes('image'));
  return m ? `${provider}/${m.id}` : undefined;
}

/**
 * Effective image model config: explicit `agents.defaults.imageModel`, else inferred from provider credentials.
 */
export function resolveImageModelConfigForTool(params: { cfg?: Config }): ToolModelConfig | null {
  const explicit = coerceImageModelConfig(params.cfg);
  if (hasToolModelConfig(explicit)) {
    return explicit;
  }

  const primary = resolveDefaultModelRef(params.cfg);
  const primaryCandidates: string[] = [];
  const vision = firstVisionModelRef(primary.provider);
  if (vision) {
    primaryCandidates.push(vision);
  }
  if (primary.provider === 'openai') {
    primaryCandidates.push('openai/gpt-4o-mini');
  }
  if (primary.provider === 'anthropic') {
    primaryCandidates.push('anthropic/claude-sonnet-4-5');
  }
  if (primary.provider === 'google') {
    primaryCandidates.push('google/gemini-2.0-flash');
  }

  return buildToolModelConfigFromCandidates({
    explicit,
    candidates: [
      ...primaryCandidates,
      firstVisionModelRef('openai') ?? 'openai/gpt-4o-mini',
      firstVisionModelRef('anthropic') ?? 'anthropic/claude-sonnet-4-5',
    ],
  });
}

function pickMaxBytes(cfg?: Config, maxBytesMb?: number): number {
  if (typeof maxBytesMb === 'number' && Number.isFinite(maxBytesMb) && maxBytesMb > 0) {
    return Math.floor(maxBytesMb * 1024 * 1024);
  }
  const configured = cfg?.agents?.defaults?.mediaMaxMb;
  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured * 1024 * 1024);
  }
  return 20 * 1024 * 1024;
}

export function createImageTool(options: {
  config?: Config;
  workspace: string;
  /** When true, session model already receives images in the user message. */
  modelHasVision?: boolean;
}): AgentTool<any, Record<string, unknown>> | null {
  const imageModelConfig = resolveImageModelConfigForTool({ cfg: options.config });
  if (!imageModelConfig) {
    return null;
  }

  const description = options.modelHasVision
    ? 'Analyze one or more images with a vision model. Use `image` for a single path/URL, or `images` for multiple (up to 20). Only use when images were NOT already in the user message.'
    : 'Analyze one or more images using the configured image model (agents.defaults.imageModel). Use `image` or `images` for paths/URLs; optional `prompt` for what to extract.';

  const localRoots = [options.workspace];

  return {
    name: 'image',
    label: 'Image',
    description,
    parameters: Type.Object({
      prompt: Type.Optional(Type.String()),
      image: Type.Optional(Type.String({ description: 'Single image path or URL.' })),
      images: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Multiple image paths or URLs (up to maxImages, default 20).',
        }),
      ),
      model: Type.Optional(Type.String({ description: 'Optional provider/model override.' })),
      maxBytesMb: Type.Optional(Type.Number()),
      maxImages: Type.Optional(Type.Number()),
    }),
    async execute(
      _toolCallId: string,
      args: Record<string, unknown>,
    ): Promise<AgentToolResult<Record<string, unknown>>> {
      const record = args && typeof args === 'object' ? args : {};

      const imageCandidates: string[] = [];
      if (typeof record.image === 'string') {
        imageCandidates.push(record.image);
      }
      if (Array.isArray(record.images)) {
        imageCandidates.push(...record.images.filter((v): v is string => typeof v === 'string'));
      }

      const seenImages = new Set<string>();
      const imageInputs: string[] = [];
      for (const candidate of imageCandidates) {
        const trimmedCandidate = candidate.trim();
        const normalizedForDedupe = trimmedCandidate.startsWith('@')
          ? trimmedCandidate.slice(1).trim()
          : trimmedCandidate;
        if (!normalizedForDedupe || seenImages.has(normalizedForDedupe)) {
          continue;
        }
        seenImages.add(normalizedForDedupe);
        imageInputs.push(trimmedCandidate);
      }

      if (imageInputs.length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: provide `image` or `images`.' }],
          details: { error: 'missing_image' },
        };
      }

      const maxImagesRaw = typeof record.maxImages === 'number' ? record.maxImages : undefined;
      const maxImages =
        typeof maxImagesRaw === 'number' && Number.isFinite(maxImagesRaw) && maxImagesRaw > 0
          ? Math.floor(maxImagesRaw)
          : DEFAULT_MAX_IMAGES;
      if (imageInputs.length > maxImages) {
        return {
          content: [
            {
              type: 'text',
              text: `Too many images: ${imageInputs.length} (max ${maxImages}).`,
            },
          ],
          details: { error: 'too_many_images', count: imageInputs.length, max: maxImages },
        };
      }

      const { prompt: promptRaw, modelOverride } = resolvePromptAndModelOverride(
        record,
        DEFAULT_PROMPT,
      );
      const maxBytesMb = typeof record.maxBytesMb === 'number' ? record.maxBytesMb : undefined;
      const maxBytes = pickMaxBytes(options.config, maxBytesMb);

      const loadedImages: Array<{ buffer: Buffer; mimeType: string; resolvedImage: string }> = [];

      for (const imageRawInput of imageInputs) {
        const trimmed = imageRawInput.trim();
        const imageRaw = trimmed.startsWith('@') ? trimmed.slice(1).trim() : trimmed;
        if (!imageRaw) {
          return {
            content: [{ type: 'text', text: 'Error: empty image entry.' }],
            details: { error: 'empty_image' },
          };
        }

        const looksLikeWindowsDrivePath = /^[a-zA-Z]:[\\/]/.test(imageRaw);
        const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(imageRaw);
        const isFileUrl = /^file:/i.test(imageRaw);
        const isHttpUrl = /^https?:\/\//i.test(imageRaw);
        const isDataUrl = /^data:/i.test(imageRaw);
        if (hasScheme && !looksLikeWindowsDrivePath && !isFileUrl && !isHttpUrl && !isDataUrl) {
          return {
            content: [
              {
                type: 'text',
                text: `Unsupported image reference: ${imageRawInput}. Use a path, file://, data:, or http(s) URL.`,
              },
            ],
            details: { error: 'unsupported_image_reference', image: imageRawInput },
          };
        }

        try {
          const media = await loadImageForToolInput(imageRaw, {
            maxBytes,
            workspace: options.workspace,
            localRoots,
          });
          loadedImages.push({
            buffer: media.buffer,
            mimeType: media.mimeType,
            resolvedImage: imageRaw,
          });
        } catch (e) {
          return {
            content: [
              {
                type: 'text',
                text: `Failed to load image (${imageRawInput}): ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
            details: { error: 'load_failed', image: imageRawInput },
          };
        }
      }

      const runResult = await runWithImageModelFallback({
        toolConfig: imageModelConfig,
        modelOverride,
        run: async (modelRef) => {
          const { text, provider, model } = await describeImagesWithPiAi({
            modelRef,
            prompt: promptRaw,
            images: loadedImages.map((img) => ({ buffer: img.buffer, mimeType: img.mimeType })),
            timeoutMs: 60_000,
          });
          return { text, provider, model };
        },
      });

      const { result: inner, attempts } = runResult;
      const result = {
        text: inner.text,
        provider: inner.provider,
        model: inner.model,
        attempts,
      };

      const imageDetails =
        loadedImages.length === 1
          ? { image: loadedImages[0].resolvedImage }
          : {
              images: loadedImages.map((img) => ({ image: img.resolvedImage })),
            };

      return buildImageToolTextResult(result, imageDetails);
    },
  };
}
