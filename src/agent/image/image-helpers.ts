import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import type { AssistantMessage } from '@mariozechner/pi-ai';
import type { Config } from '../../config/schema.js';
import { getAgentDefaultModelRef, parseModelRef } from '../../config/schema.js';
import { extractTextContent } from '../context/workspace.js';
import type { ImageAttempt } from './image-model-fallback.js';
import { coerceToolModelConfig, type ToolModelConfig } from './tool-model-config.js';

export type ImageModelConfig = ToolModelConfig;

export function decodeDataUrl(dataUrl: string): {
  buffer: Buffer;
  mimeType: string;
  kind: 'image';
} {
  const trimmed = dataUrl.trim();
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(trimmed);
  if (!match) {
    throw new Error('Invalid data URL (expected base64 data: URL).');
  }
  const mimeType = (match[1] ?? '').trim().toLowerCase();
  if (!mimeType.startsWith('image/')) {
    throw new Error(`Unsupported data URL type: ${mimeType || 'unknown'}`);
  }
  const b64 = (match[2] ?? '').trim();
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length === 0) {
    throw new Error('Invalid data URL: empty payload.');
  }
  return { buffer, mimeType, kind: 'image' };
}

export function coerceImageAssistantText(params: {
  message: AssistantMessage;
  provider: string;
  model: string;
}): string {
  const stop = params.message.stopReason;
  const errorMessage = params.message.errorMessage?.trim();
  if (stop === 'error' || stop === 'aborted') {
    throw new Error(
      errorMessage
        ? `Image model failed (${params.provider}/${params.model}): ${errorMessage}`
        : `Image model failed (${params.provider}/${params.model})`,
    );
  }
  if (errorMessage) {
    throw new Error(`Image model failed (${params.provider}/${params.model}): ${errorMessage}`);
  }
  const text = extractTextContent(
    params.message.content as Array<{ type: string; text?: string }>,
  );
  if (text.trim()) {
    return text.trim();
  }
  throw new Error(`Image model returned no text (${params.provider}/${params.model}).`);
}

export function coerceImageModelConfig(cfg?: Config): ImageModelConfig {
  return coerceToolModelConfig(cfg?.agents?.defaults?.imageModel);
}

export function applyImageModelConfigDefaults(
  cfg: Config | undefined,
  imageModelConfig: ImageModelConfig,
): Config | undefined {
  if (!cfg) {
    return undefined;
  }
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        imageModel: imageModelConfig,
      },
    },
  };
}

export function applyImageGenerationModelConfigDefaults(
  cfg: Config | undefined,
  imageGenerationModelConfig: ToolModelConfig,
): Config | undefined {
  if (!cfg) {
    return undefined;
  }
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        imageGenerationModel: imageGenerationModelConfig,
      },
    },
  };
}

export function resolvePromptAndModelOverride(
  args: Record<string, unknown>,
  defaultPrompt: string,
): {
  prompt: string;
  modelOverride?: string;
} {
  const prompt =
    typeof args.prompt === 'string' && args.prompt.trim() ? args.prompt.trim() : defaultPrompt;
  const modelOverride =
    typeof args.model === 'string' && args.model.trim() ? args.model.trim() : undefined;
  return { prompt, modelOverride };
}

export function buildImageToolTextResult(
  result: { text: string; provider: string; model: string; attempts: ImageAttempt[] },
  extraDetails: Record<string, unknown>,
): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: 'text', text: result.text }],
    details: {
      model: `${result.provider}/${result.model}`,
      ...extraDetails,
      attempts: result.attempts,
    },
  };
}

export function primaryProviderFromConfig(cfg?: Config): string | undefined {
  const ref = cfg ? getAgentDefaultModelRef(cfg) : undefined;
  if (!ref) {
    return undefined;
  }
  return parseModelRef(ref)?.provider;
}
