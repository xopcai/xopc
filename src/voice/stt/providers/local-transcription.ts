import { registerMediaUnderstandingProvider } from '../../../media-understanding/registry.js';
import type {
  AudioTranscriptionRequest,
  AudioTranscriptionResult,
  MediaUnderstandingProvider,
} from '../../../media-understanding/types.js';
import { createLogger } from '../../../utils/logger.js';
import { getLocalVoiceRuntimeClient } from '../../local/runtime-client.js';
import { decodeAudioToMonoFloat32 } from '../../audio/normalize.js';
import {
  DEFAULT_LOCAL_VOICE_MODEL_ID,
  getLocalVoiceModel,
  hasInstalledLocalVoiceModel,
  isLocalVoiceModelInstalled,
} from '../../local/models.js';

const log = createLogger('STT:Local');

async function transcribeAudio(req: AudioTranscriptionRequest): Promise<AudioTranscriptionResult> {
  const model = getLocalVoiceModel(req.model);
  if (!isLocalVoiceModelInstalled(model.id)) {
    throw new Error(`Local voice model "${model.id}" is not installed`);
  }
  const decoded = await decodeAudioToMonoFloat32({ buffer: req.buffer, signal: req.signal });
  const audioBytes = Buffer.from(
    decoded.samples.buffer,
    decoded.samples.byteOffset,
    decoded.samples.byteLength,
  );
  const startedAt = Date.now();
  const result = await getLocalVoiceRuntimeClient().request<{
    text: string;
    modelId: string;
    language?: string;
    emotion?: string;
    event?: string;
  }>(
    'transcribe',
    {
      modelId: model.id,
      audioBase64: audioBytes.toString('base64'),
      ...(req.language ? { language: req.language } : {}),
    },
    { signal: req.signal, timeoutMs: req.timeoutMs },
  );
  log.info(
    {
      model: model.id,
      audioDurationSeconds: decoded.durationSeconds,
      latencyMs: Date.now() - startedAt,
      realTimeFactor: decoded.durationSeconds > 0
        ? (Date.now() - startedAt) / 1_000 / decoded.durationSeconds
        : undefined,
      textLength: result.text.length,
    },
    'Local transcription completed',
  );
  return {
    text: result.text,
    model: model.id,
    ...(result.language || req.language ? { language: result.language ?? req.language } : {}),
    durationSeconds: decoded.durationSeconds,
  };
}

export const localTranscriptionProvider: MediaUnderstandingProvider = {
  id: 'xopc-local',
  aliases: ['local'],
  capabilities: ['audio'],
  requiresApiKey: false,
  defaultModels: { audio: DEFAULT_LOCAL_VOICE_MODEL_ID },
  autoPriority: { audio: 0 },
  isConfigured: (options) => options?.model
    ? isLocalVoiceModelInstalled(options.model)
    : hasInstalledLocalVoiceModel(),
  transcribeAudio,
};

registerMediaUnderstandingProvider(localTranscriptionProvider);
