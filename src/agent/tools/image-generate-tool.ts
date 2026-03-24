import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { Config } from '../../config/schema.js';
import { OPENAI_DEFAULT_IMAGE_MODEL } from '../../image-generation/constants.js';
import { generateImage, listImageGenerationProvidersSummary } from '../../image-generation/runtime.js';
import { applyImageGenerationModelConfigDefaults } from './image-tool.helpers.js';
import {
  buildToolModelConfigFromCandidates,
  coerceToolModelConfig,
  hasToolModelConfig,
  type ToolModelConfig,
} from './model-config.helpers.js';

const DEFAULT_COUNT = 1;
const MAX_COUNT = 4;

const ImageGenerateToolSchema = Type.Object({
  action: Type.Optional(
    Type.String({
      description: 'Optional: "generate" (default) or "list" available image-generation providers.',
    }),
  ),
  prompt: Type.Optional(Type.String({ description: 'Image generation prompt.' })),
  model: Type.Optional(Type.String({ description: 'Optional provider/model override, e.g. openai/gpt-image-1.' })),
  filename: Type.Optional(Type.String({ description: 'Optional basename hint for saved files.' })),
  size: Type.Optional(Type.String({ description: 'Optional size, e.g. 1024x1024.' })),
  count: Type.Optional(
    Type.Number({ minimum: 1, maximum: MAX_COUNT, description: `Number of images (1–${MAX_COUNT}).` }),
  ),
});

function readStringParam(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function resolveImageGenerationModelConfigForTool(params: { cfg?: Config }): ToolModelConfig | null {
  const explicit = coerceToolModelConfig(params.cfg?.agents?.defaults?.imageGenerationModel);
  if (hasToolModelConfig(explicit)) {
    return explicit;
  }
  return buildToolModelConfigFromCandidates({
    explicit,
    candidates: [`openai/${OPENAI_DEFAULT_IMAGE_MODEL}`],
  });
}

async function saveGeneratedImages(params: {
  workspace: string;
  images: Array<{ buffer: Buffer; mimeType: string; fileName?: string }>;
  filenameHint?: string;
}): Promise<string[]> {
  const dir = path.join(params.workspace, 'media', 'generated');
  await mkdir(dir, { recursive: true });
  const out: string[] = [];
  let i = 0;
  for (const img of params.images) {
    i += 1;
    const ext = img.mimeType.includes('png') ? 'png' : 'jpg';
    const base =
      (params.filenameHint?.replace(/[^\w.-]/g, '') || 'image') + `-${randomBytes(4).toString('hex')}`;
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
        const providers = listImageGenerationProvidersSummary();
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

      const countRaw = params.count;
      const count =
        typeof countRaw === 'number' && Number.isFinite(countRaw)
          ? Math.min(MAX_COUNT, Math.max(1, Math.floor(countRaw)))
          : DEFAULT_COUNT;

      try {
        const result = await generateImage({
          cfg: effectiveCfg,
          prompt,
          modelOverride,
          count,
          size,
        });

        const paths = await saveGeneratedImages({
          workspace: options.workspace,
          images: result.images,
          filenameHint: filename,
        });

        const lines = [
          `Generated ${paths.length} image(s) with ${result.provider}/${result.model}.`,
          ...paths.map((p) => `Saved: ${p}`),
        ];

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          details: {
            provider: result.provider,
            model: result.model,
            paths,
            attempts: result.attempts,
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `Image generation failed: ${msg}` }],
          details: { error: 'generation_failed' },
        };
      }
    },
  };
}
