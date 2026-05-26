/**
 * OpenAI-compatible `/audio/transcriptions` helper for STT providers and extensions.
 */

import path from 'node:path';

import { normalizeBaseUrl, postMultipartRequest } from '../media-shared/http/index.js';

import type {
  AudioTranscriptionRequest,
  AudioTranscriptionResult,
  MediaUnderstandingProvider,
} from './types.js';
import { registerMediaUnderstandingProvider } from './registry.js';

type OpenAiCompatibleAudioParams = AudioTranscriptionRequest & {
  defaultBaseUrl: string;
  defaultModel: string;
  provider?: string;
  label?: string;
};

export function resolveAudioTranscriptionUploadFileName(fileName?: string, mime?: string): string {
  const trimmed = fileName?.trim();
  const baseName = trimmed ? path.basename(trimmed) : 'audio';
  const lowerMime = mime?.trim().toLowerCase();

  if (/\.aac$/i.test(baseName)) {
    return `${baseName.slice(0, -4) || 'audio'}.m4a`;
  }
  if (!path.extname(baseName) && lowerMime === 'audio/aac') {
    return `${baseName || 'audio'}.m4a`;
  }
  return baseName;
}

export function buildAudioTranscriptionFormData(params: {
  buffer: Buffer;
  fileName?: string;
  mime?: string;
  fields?: Record<string, string | number | boolean | undefined>;
}): FormData {
  const form = new FormData();
  const bytes = new Uint8Array(params.buffer);
  const blob = new Blob([bytes], {
    type: params.mime ?? 'application/octet-stream',
  });
  form.append('file', blob, resolveAudioTranscriptionUploadFileName(params.fileName, params.mime));
  for (const [name, value] of Object.entries(params.fields ?? {})) {
    const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
    if (text) {
      form.append(name, text);
    }
  }
  return form;
}

function resolveModel(model: string | undefined, fallback: string): string {
  const trimmed = model?.trim();
  return trimmed || fallback;
}

function requireTranscriptionText(text: string | undefined, message: string): string {
  const trimmed = text?.trim();
  if (!trimmed) {
    throw new Error(message);
  }
  return trimmed;
}

export async function transcribeOpenAiCompatibleAudio(
  params: OpenAiCompatibleAudioParams,
): Promise<AudioTranscriptionResult> {
  const baseUrl = normalizeBaseUrl(params.baseUrl ?? params.defaultBaseUrl);
  const url = `${baseUrl}/audio/transcriptions`;
  const model = resolveModel(params.model, params.defaultModel);
  const headers: Record<string, string> = {
    authorization: `Bearer ${params.apiKey}`,
    ...(params.headers ?? {}),
  };
  const form = buildAudioTranscriptionFormData({
    buffer: params.buffer,
    fileName: params.fileName,
    mime: params.mime,
    fields: {
      model,
      language: params.language,
      prompt: params.prompt,
    },
  });

  const response = await postMultipartRequest(url, {
    timeoutMs: params.timeoutMs,
    label: params.label ?? `${params.provider ?? 'openai'} STT`,
    headers,
    body: form,
  });

  const payload = (await response.json()) as { text?: string };
  const text = requireTranscriptionText(
    payload.text,
    'Audio transcription response missing text',
  );
  return { text, model };
}

export interface OpenAiCompatibleAudioProviderOptions {
  id: string;
  aliases?: readonly string[];
  envKey?: string;
  defaultBaseUrl: string;
  defaultModel: string;
  autoPriority?: number;
  label?: string;
}

/** Factory for OpenAI `/audio/transcriptions`-compatible STT extension providers. */
export function createOpenAiCompatibleAudioProvider(
  options: OpenAiCompatibleAudioProviderOptions,
): MediaUnderstandingProvider {
  return {
    id: options.id,
    aliases: options.aliases,
    capabilities: ['audio'],
    envKey: options.envKey,
    defaultModels: { audio: options.defaultModel },
    autoPriority: { audio: options.autoPriority ?? 50 },
    transcribeAudio: (req: AudioTranscriptionRequest) => {
      if (!req.apiKey) {
        throw new Error(`${options.label ?? options.id} STT API key missing`);
      }
      return transcribeOpenAiCompatibleAudio({
        ...req,
        defaultBaseUrl: options.defaultBaseUrl,
        defaultModel: options.defaultModel,
        provider: options.id,
        label: options.label,
      });
    },
  };
}

export function registerOpenAiCompatibleAudioProvider(
  options: OpenAiCompatibleAudioProviderOptions,
): () => void {
  return registerMediaUnderstandingProvider(createOpenAiCompatibleAudioProvider(options));
}
