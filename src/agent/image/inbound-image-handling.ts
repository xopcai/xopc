import type { Config } from '../../config/schema.js';
import { describeImagesWithFallback } from './understanding/runtime.js';
import { resolveImageModelConfigForTool } from './tool-model-config.js';
import { resolveImageHandlingStrategy } from './vision-detection.js';

export async function resolveInboundImageContentParts(params: {
  modelRef: string;
  cfg?: Config;
  userTextForContext: string;
  images: Array<{ data: string; mimeType: string }>;
}): Promise<Array<{ type: 'image'; data: string; mimeType: string } | { type: 'text'; text: string }>> {
  const strategy = resolveImageHandlingStrategy(params.modelRef);
  if (strategy === 'native') {
    return params.images.map((att) => ({
      type: 'image' as const,
      data: att.data,
      mimeType: att.mimeType,
    }));
  }

  const toolCfg = resolveImageModelConfigForTool({ cfg: params.cfg });
  const primary = toolCfg?.primary;
  const fallbacks = toolCfg?.fallbacks ?? [];

  if (!primary) {
    return [
      {
        type: 'text' as const,
        text: `[${params.images.length} image(s) attached; no image-capable model is available to describe them.]`,
      },
    ];
  }

  try {
    const buffers = params.images.map((att) => ({
      buffer: Buffer.from(att.data, 'base64'),
      mimeType: att.mimeType,
    }));
    const prompt = params.userTextForContext.trim()
      ? `Describe these images in the context of the user's message: "${params.userTextForContext}"`
      : 'Describe these images in detail.';
    const result = await describeImagesWithFallback({
      modelRef: primary,
      fallbacks,
      images: buffers,
      prompt,
      maxTokens: 1024,
      timeoutMs: 30_000,
    });
    return [{ type: 'text' as const, text: `[Image description: ${result.text}]` }];
  } catch (err) {
    return [
      {
        type: 'text' as const,
        text: `[${params.images.length} image(s) attached but could not be described: ${err instanceof Error ? err.message : String(err)}]`,
      },
    ];
  }
}
