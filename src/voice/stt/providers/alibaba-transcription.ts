import { postJsonRequest } from '../../../media-shared/http/index.js';
import { registerMediaUnderstandingProvider } from '../../../media-understanding/registry.js';
import type {
  AudioTranscriptionRequest,
  AudioTranscriptionResult,
  MediaUnderstandingProvider,
} from '../../../media-understanding/types.js';
import { createLogger } from '../../../utils/logger.js';
import { openDashScopeStreamingStt } from '../../dashscope/streaming-stt-session.js';

const log = createLogger('STT:Alibaba');
const DEFAULT_MODEL = 'qwen-audio-3.0-asr-flash';
const DEFAULT_STREAMING_MODEL = 'qwen-audio-3.0-asr-flash-streaming';
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

function audioFormat(request: AudioTranscriptionRequest): string {
  const extension = request.fileName.split('.').pop()?.toLowerCase();
  if (extension === 'mpeg' || extension === 'mpga') return 'mp3';
  if (extension === 'm4a') return 'mp4';
  return extension || 'wav';
}

async function transcribeAudio(request: AudioTranscriptionRequest): Promise<AudioTranscriptionResult> {
  if (!request.apiKey) throw new Error('Alibaba STT API key is unavailable');
  const startedAt = Date.now();
  const model = request.model ?? DEFAULT_MODEL;
  const audio = `data:${request.mime ?? 'application/octet-stream'};base64,${request.buffer.toString('base64')}`;
  const messages: Array<Record<string, unknown>> = [];
  if (request.prompt) messages.push({ role: 'user', content: [{ type: 'input_text', text: request.prompt }] });
  messages.push({ role: 'user', content: [{ type: 'input_audio', input_audio: { data: audio } }] });
  try {
    const response = await postJsonRequest(request.baseUrl ?? DEFAULT_BASE_URL, {
      timeoutMs: request.timeoutMs,
      label: 'Alibaba STT',
      headers: { Authorization: `Bearer ${request.apiKey}`, 'X-DashScope-SSE': 'disable' },
      body: {
        model,
        input: { messages },
        parameters: {
          format: audioFormat(request),
          ...(request.language && request.language !== 'auto' ? { language_hints: [request.language] } : {}),
        },
      },
      signal: request.signal,
    });
    const data = await response.json() as {
      output?: { text?: unknown };
      usage?: { duration?: unknown };
    };
    const text = data.output?.text;
    if (typeof text !== 'string') throw new Error('Alibaba STT returned an invalid response');
    log.info({ provider: 'alibaba', model, latencyMs: Date.now() - startedAt, textLength: text.length }, 'Transcription completed');
    const durationSeconds = Number(data.usage?.duration);
    return {
      text, model,
      ...(request.language ? { language: request.language } : {}),
      ...(Number.isFinite(durationSeconds) && durationSeconds >= 0 ? { durationSeconds } : {}),
    };
  } catch (error) {
    if (request.signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: error, model, bufferSize: request.buffer.length }, `Alibaba transcription failed: ${message}`);
    throw new Error(`Alibaba STT failed: ${message}`);
  }
}

export const alibabaTranscriptionProvider: MediaUnderstandingProvider = {
  id: 'alibaba',
  aliases: ['dashscope'],
  capabilities: ['audio'],
  envKey: 'DASHSCOPE_API_KEY',
  defaultModels: { audio: DEFAULT_MODEL },
  autoPriority: { audio: 10 },
  transcribeAudio,
  streamingAudio: {
    inputSampleRates: [16_000],
    turnDetection: ['server_vad'],
    defaultModel: DEFAULT_STREAMING_MODEL,
    models: [DEFAULT_STREAMING_MODEL],
  },
  openAudioStream: (request) => openDashScopeStreamingStt({
    ...request,
    model: request.model || DEFAULT_STREAMING_MODEL,
  }),
};

registerMediaUnderstandingProvider(alibabaTranscriptionProvider);
