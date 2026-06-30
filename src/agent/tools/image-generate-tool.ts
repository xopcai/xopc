import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Config } from '../../config/schema.js';
import { isFailoverError } from '../failover-error.js';
import {
  imageAssetFromDataUrl,
  imageFileExtensionForMimeType,
  mimeTypeFromFileName,
  parseImageDataUrl,
  sniffImageMimeType,
} from '../image/generation/image-assets.js';
import {
  generateImage,
  listImageGenerationProvidersSummary,
} from '../image/generation/runtime.js';
import { getImageGenerationProvider } from '../image/generation/provider-registry.js';
import type {
  ImageGenerationBackground,
  ImageGenerationOutputFormat,
  ImageGenerationProviderOptions,
  ImageGenerationQuality,
  ImageGenerationResolution,
  ImageGenerationSourceImage,
} from '../image/generation/types.js';
import { applyImageGenerationModelConfigDefaults } from '../image/image-helpers.js';
import type { ToolModelConfig } from '../image/tool-model-config.js';

const DEFAULT_COUNT = 1;
const MAX_COUNT = 9;
const ALLOWED_QUALITIES: ImageGenerationQuality[] = ['low', 'medium', 'high', 'auto'];
const ALLOWED_OUTPUT_FORMATS: ImageGenerationOutputFormat[] = ['png', 'jpeg', 'webp'];
const ALLOWED_BACKGROUNDS: ImageGenerationBackground[] = ['transparent', 'opaque', 'auto'];
const ALLOWED_RESOLUTIONS: ImageGenerationResolution[] = ['1K', '2K', '4K'];

const ImageGenerateToolSchema = Type.Object({
  action: Type.Optional(
    Type.String({
      description: 'Optional: "generate" (default) or "list" available image-generation providers.',
    }),
  ),
  prompt: Type.Optional(Type.String({ description: 'Image generation prompt.' })),
  model: Type.Optional(
    Type.String({
      description:
        'Optional provider/model override, e.g. openai/gpt-image-1 / dashscope/wan2.7-image-pro / minimax/image-01.',
    }),
  ),
  filename: Type.Optional(Type.String({ description: 'Optional basename hint for saved files.' })),
  size: Type.Optional(Type.String({ description: 'Optional pixel size, e.g. 1024x1024.' })),
  aspectRatio: Type.Optional(
    Type.String({ description: 'Optional aspect ratio, e.g. 16:9 / 9:16 / 1:1.' }),
  ),
  resolution: Type.Optional(
    Type.String({
      description: 'Optional resolution tier: 1K / 2K / 4K (provider-dependent).',
    }),
  ),
  count: Type.Optional(
    Type.Number({ minimum: 1, maximum: MAX_COUNT, description: `Number of images (1–${MAX_COUNT}).` }),
  ),
  quality: Type.Optional(
    Type.String({ description: 'Optional quality: low / medium / high / auto.' }),
  ),
  outputFormat: Type.Optional(
    Type.String({ description: 'Optional output format: png / jpeg / webp.' }),
  ),
  background: Type.Optional(
    Type.String({ description: 'Optional background: transparent / opaque / auto.' }),
  ),
  inputImages: Type.Optional(
    Type.Array(
      Type.Object({
        source: Type.String({
          description: 'Workspace-relative file path or `data:image/...;base64,...` URL.',
        }),
      }),
      { description: 'Reference images for edit mode (provider must support edit).' },
    ),
  ),
  providerOptions: Type.Optional(
    Type.Object({
      openai: Type.Optional(
        Type.Object({
          moderation: Type.Optional(Type.String()),
          outputCompression: Type.Optional(Type.Number()),
          user: Type.Optional(Type.String()),
        }),
      ),
    }),
  ),
});

function readStringParam(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function readEnumParam<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: ReadonlyArray<T>,
): T | undefined {
  const raw = readStringParam(args, key);
  if (!raw) return undefined;
  const lower = raw.toLowerCase() as T;
  return allowed.includes(lower) ? lower : undefined;
}

function readResolutionParam(args: Record<string, unknown>): ImageGenerationResolution | undefined {
  const raw = readStringParam(args, 'resolution');
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  return (ALLOWED_RESOLUTIONS as ReadonlyArray<string>).includes(upper)
    ? (upper as ImageGenerationResolution)
    : undefined;
}

function readProviderOptions(args: Record<string, unknown>): ImageGenerationProviderOptions | undefined {
  const raw = args.providerOptions;
  if (!raw || typeof raw !== 'object') return undefined;
  const out: ImageGenerationProviderOptions = {};
  const oa = (raw as Record<string, unknown>).openai;
  if (oa && typeof oa === 'object') {
    const oaRec = oa as Record<string, unknown>;
    const moderation = typeof oaRec.moderation === 'string' ? oaRec.moderation.toLowerCase() : undefined;
    const outputCompression =
      typeof oaRec.outputCompression === 'number' && Number.isFinite(oaRec.outputCompression)
        ? oaRec.outputCompression
        : undefined;
    const user = typeof oaRec.user === 'string' && oaRec.user.trim() ? oaRec.user.trim() : undefined;
    out.openai = {
      ...(moderation === 'low' || moderation === 'auto' ? { moderation: moderation as 'low' | 'auto' } : {}),
      ...(outputCompression !== undefined ? { outputCompression } : {}),
      ...(user ? { user } : {}),
    };
    if (Object.keys(out.openai).length === 0) delete out.openai;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

class ToolInputError extends Error {}

async function loadInputImages(params: {
  workspace: string;
  sources: ReadonlyArray<{ source: string }>;
}): Promise<ImageGenerationSourceImage[]> {
  if (!params.sources?.length) return [];
  const out: ImageGenerationSourceImage[] = [];
  const workspaceAbs = path.resolve(params.workspace);
  for (const entry of params.sources) {
    const source = entry?.source;
    if (typeof source !== 'string' || !source.trim()) {
      throw new ToolInputError('inputImages[].source is required.');
    }
    const trimmed = source.trim();
    if (/^data:image\//i.test(trimmed)) {
      const parsed = imageAssetFromDataUrl(trimmed);
      if (!parsed) throw new ToolInputError('Invalid data URL in inputImages[].source.');
      out.push(parsed);
      continue;
    }
    if (/^https?:\/\//i.test(trimmed)) {
      throw new ToolInputError('Sandboxed image_generate does not allow remote URLs.');
    }
    const resolved = path.resolve(workspaceAbs, trimmed);
    if (resolved !== workspaceAbs && !resolved.startsWith(workspaceAbs + path.sep)) {
      throw new ToolInputError('inputImages[].source escapes workspace.');
    }
    let buffer: Buffer;
    try {
      buffer = await readFile(resolved);
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      throw new ToolInputError(`inputImages[].source not readable: ${em}`);
    }
    const mimeType = mimeTypeFromFileName(resolved) ?? sniffImageMimeType(buffer).mimeType;
    out.push({ buffer, mimeType, fileName: path.basename(resolved) });
  }
  return out;
}

// Re-exported for callers / tests; no behavioural change vs imported helper.
export { parseImageDataUrl };

export function resolveImageGenerationModelConfigForTool(params: { cfg?: Config }): ToolModelConfig | null {
  // Step 2: tool default = enumerate every provider whose isConfigured() is true,
  // ordered as registered. No more hard-coded openai/dashscope fallback.
  const providers = listImageGenerationProvidersSummary(params.cfg);
  const candidates: string[] = [];
  for (const providerSummary of providers) {
    const provider = getImageGenerationProvider(providerSummary.id, params.cfg);
    let configured = false;
    try {
      configured = provider?.isConfigured?.({ cfg: params.cfg }) ?? false;
    } catch {
      configured = false;
    }
    const modelRef = `${providerSummary.id}/${providerSummary.defaultModel ?? providerSummary.models[0] ?? ''}`;
    if (configured && /^[a-z0-9-]+\/.+/.test(modelRef) && !candidates.includes(modelRef)) {
      candidates.push(modelRef);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return {
    primary: candidates[0],
    ...(candidates.length > 1 ? { fallbacks: candidates.slice(1) } : {}),
  };
}

async function saveGeneratedImages(params: {
  workspace: string;
  images: Array<{ buffer: Buffer; mimeType: string; fileName?: string }>;
  filenameHint?: string;
}): Promise<string[]> {
  const dir = path.join(params.workspace, 'media', 'generated');
  await mkdir(dir, { recursive: true });
  const out: string[] = [];
  const random = randomBytes(4).toString('hex');
  let i = 0;
  for (const img of params.images) {
    i += 1;
    const ext = imageFileExtensionForMimeType(img.mimeType);
    const base = (params.filenameHint?.replace(/[^\w.-]/g, '') || 'image') + `-${random}`;
    const name = `${base}-${i}.${ext}`;
    const full = path.join(dir, name);
    await writeFile(full, img.buffer);
    out.push(full);
  }
  return out;
}

export function createImageGenerateTool(options: {
  config?: Config;
  workspace: string;
}): AgentTool<any, Record<string, unknown>> | null {
  const imageGenerationModelConfig = resolveImageGenerationModelConfigForTool({ cfg: options.config });
  if (!imageGenerationModelConfig) {
    return null;
  }

  const effectiveCfg =
    applyImageGenerationModelConfigDefaults(options.config, imageGenerationModelConfig) ??
    options.config;

  return {
    name: 'image_generate',
    label: 'Image Generation',
    description:
      'Generate images with the configured image-generation model (default OpenAI). Use action="list" to see providers. Saves files under workspace/media/generated/.',
    parameters: ImageGenerateToolSchema,
    async execute(
      _toolCallId: string,
      args: Record<string, unknown>,
    ): Promise<AgentToolResult<Record<string, unknown>>> {
      const params = args as Record<string, unknown>;
      const action = (readStringParam(params, 'action') || 'generate').toLowerCase();
      if (action === 'list') {
        const providers = listImageGenerationProvidersSummary(effectiveCfg);
        const lines = providers.flatMap((p) => [
          `${p.id}${p.defaultModel ? ` (default ${p.defaultModel})` : ''}`,
          `  models: ${p.models.join(', ')}`,
        ]);
        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          details: { providers },
        };
      }
      if (action !== 'generate') {
        return {
          content: [{ type: 'text', text: 'action must be "generate" or "list".' }],
          details: { error: 'bad_action' },
        };
      }

      const prompt = readStringParam(params, 'prompt');
      if (!prompt) {
        return {
          content: [{ type: 'text', text: 'prompt is required for image generation.' }],
          details: { error: 'missing_prompt' },
        };
      }

      const modelOverride = readStringParam(params, 'model');
      const filename = readStringParam(params, 'filename');
      const size = readStringParam(params, 'size');
      const aspectRatio = readStringParam(params, 'aspectRatio');
      const resolution = readResolutionParam(params);
      const quality = readEnumParam(params, 'quality', ALLOWED_QUALITIES);
      const outputFormat = readEnumParam(params, 'outputFormat', ALLOWED_OUTPUT_FORMATS);
      const background = readEnumParam(params, 'background', ALLOWED_BACKGROUNDS);
      const providerOptions = readProviderOptions(params);

      const countRaw = params.count;
      const count =
        typeof countRaw === 'number' && Number.isFinite(countRaw)
          ? Math.min(MAX_COUNT, Math.max(1, Math.floor(countRaw)))
          : DEFAULT_COUNT;

      let inputImages: ImageGenerationSourceImage[] = [];
      try {
        inputImages = await loadInputImages({
          workspace: options.workspace,
          sources: (params.inputImages as Array<{ source: string }>) ?? [],
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `Image generation failed: ${msg}` }],
          details: {
            error: e instanceof ToolInputError ? 'invalid_input_images' : 'generation_failed',
          },
        };
      }

      try {
        const result = await generateImage({
          cfg: effectiveCfg,
          modelConfig: imageGenerationModelConfig,
          prompt,
          ...(modelOverride ? { modelOverride } : {}),
          count,
          ...(size ? { size } : {}),
          ...(aspectRatio ? { aspectRatio } : {}),
          ...(resolution ? { resolution } : {}),
          ...(quality ? { quality } : {}),
          ...(outputFormat ? { outputFormat } : {}),
          ...(background ? { background } : {}),
          ...(inputImages.length > 0 ? { inputImages } : {}),
          ...(providerOptions ? { providerOptions } : {}),
        });

        const paths = await saveGeneratedImages({
          workspace: options.workspace,
          images: result.images,
          ...(filename ? { filenameHint: filename } : {}),
        });

        const workspaceRelativePaths = paths.map((p) =>
          path.relative(options.workspace, p).split(path.sep).join('/'),
        );

        const lines: string[] = [
          `Generated ${paths.length} image(s) with ${result.provider}/${result.model}.`,
          ...paths.map((p) => `Saved: ${p}`),
        ];
        for (const note of buildNormalizationNotes(result.normalization, result.ignoredOverrides)) {
          lines.push(note);
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          details: {
            provider: result.provider,
            model: result.model,
            paths,
            workspaceRelativePaths,
            attempts: result.attempts,
            ...(result.normalization ? { normalization: result.normalization } : {}),
            ...(result.ignoredOverrides.length > 0
              ? { ignoredOverrides: result.ignoredOverrides }
              : {}),
            ...(result.metadata ? { metadata: result.metadata } : {}),
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const failoverFields = isFailoverError(e)
          ? {
              ...(e.reason !== undefined ? { reason: e.reason } : {}),
              ...(e.status !== undefined ? { status: e.status } : {}),
              ...(e.code !== undefined ? { code: e.code } : {}),
              ...(e.provider !== undefined ? { provider: e.provider } : {}),
              ...(e.model !== undefined ? { model: e.model } : {}),
              attempts: e.attempts,
            }
          : {};
        return {
          content: [{ type: 'text', text: `Image generation failed: ${msg}` }],
          details: { error: 'generation_failed', ...failoverFields },
        };
      }
    },
  } as any;
}

function buildNormalizationNotes(
  normalization: import('../image/generation/types.js').ImageGenerationNormalization | undefined,
  ignoredOverrides: ReadonlyArray<import('../image/generation/types.js').ImageGenerationIgnoredOverride>,
): string[] {
  const notes: string[] = [];
  if (normalization) {
    for (const [key, entry] of Object.entries(normalization)) {
      if (!entry) continue;
      const requested = entry.requested;
      const applied = entry.applied;
      if (requested !== undefined && applied !== undefined && requested !== applied) {
        notes.push(`Note: requested ${key}="${requested}" → applied "${applied}".`);
      } else if (applied !== undefined && entry.derivedFrom) {
        notes.push(`Note: ${key}="${applied}" derived from ${entry.derivedFrom}.`);
      }
    }
  }
  for (const ig of ignoredOverrides) {
    notes.push(`Note: ignored ${ig.key}="${ig.value}" (not supported by provider).`);
  }
  return notes;
}
