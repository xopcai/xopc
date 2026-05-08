/**
 * OpenAI Whisper STT — implements MediaUnderstandingProvider.transcribeAudio.
 *
 * Uses the official `openai` SDK rather than the raw HTTP path because the SDK
 * already handles multipart/form-data encoding (`file` field), streaming
 * response normalization, and per-call apiKey override via constructor
 * injection. The media-shared HTTP layer is intentionally not used here so we
 * keep parity with the SDK's own fetch (proxy support, retries, etc.); the
 * only egress is api.openai.com which is HTTPS-only and public.
 *
 * Streaming transcription is not implemented (Whisper returns a final text
 * blob). Self-registers with `capabilities: ['audio']` only — the registry's
 * `listProvidersForCapability` filter skips this provider for image/video.
 */

import OpenAI from 'openai';

import { createLogger } from '../../utils/logger.js';
import { registerMediaUnderstandingProvider } from '../../media-understanding/registry.js';
import type {
  AudioTranscriptionRequest,
  AudioTranscriptionResult,
  MediaUnderstandingProvider,
} from '../../media-understanding/types.js';

const log = createLogger('STT:OpenAI');

const DEFAULT_MODEL = 'whisper-1';

async function transcribeAudio(req: AudioTranscriptionRequest): Promise<AudioTranscriptionResult> {
  const startTime = Date.now();
  const model = req.model ?? DEFAULT_MODEL;

  // openai SDK supports baseURL override per-instance.
  const client = new OpenAI({
    apiKey: req.apiKey,
    ...(req.baseUrl ? { baseURL: req.baseUrl } : {}),
    ...(req.headers ? { defaultHeaders: req.headers } : {}),
  });

  const uint8Array = new Uint8Array(
    req.buffer.buffer as ArrayBuffer,
    req.buffer.byteOffset,
    req.buffer.byteLength,
  );
  // MIME defaults to audio/ogg because Telegram voice notes are the most common
  // input. The SDK doesn't actually inspect the type — it just uses it for the
  // multipart Content-Type header. Whisper itself sniffs the file content.
  const blob = new Blob([uint8Array], { type: req.mime ?? 'audio/ogg' });

  log.debug(
    { model, bufferSize: req.buffer.length, language: req.language, fileName: req.fileName },
    'Sending to OpenAI Whisper',
  );

  try {
    const result = await client.audio.transcriptions.create({
      file: blob,
      model,
      ...(req.language ? { language: req.language } : {}),
      ...(req.prompt ? { prompt: req.prompt } : {}),
      response_format: 'json',
    });
    const durationSeconds = (Date.now() - startTime) / 1000;
    log.info(
      { provider: 'openai', durationSeconds, textLength: result.text?.length ?? 0 },
      'Transcription completed',
    );
    return {
      text: result.text || '',
      model,
      ...(req.language ? { language: req.language } : {}),
      durationSeconds,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(
      { err: error, bufferSize: req.buffer.length, model },
      `OpenAI transcription failed: ${errorMsg}`,
    );
    throw new Error(`OpenAI STT failed: ${errorMsg}`);
  }
}

export const openAiTranscriptionProvider: MediaUnderstandingProvider = {
  id: 'openai',
  capabilities: ['audio'],
  defaultModels: { audio: DEFAULT_MODEL },
  autoPriority: { audio: 20 }, // alibaba is preferred when both configured (Chinese-first)
  transcribeAudio,
};

registerMediaUnderstandingProvider(openAiTranscriptionProvider);
