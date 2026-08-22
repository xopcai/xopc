import { postJsonRequest } from '../../../media-shared/http/index.js';
import { registerMediaUnderstandingProvider } from '../../../media-understanding/registry.js';
import type {
  AudioTranscriptionRequest,
  AudioTranscriptionResult,
  MediaUnderstandingProvider,
} from '../../../media-understanding/types.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('STT:Alibaba');
const DEFAULT_MODEL = 'qwen-audio-3.0-asr-flash';
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

async function transcribeAudio(request: AudioTranscriptionRequest): Promise<AudioTranscriptionResult> {
  if (!request.apiKey) throw new Error('Alibaba STT API key is unavailable');
  const startedAt = Date.now();
  const model = request.model ?? DEFAULT_MODEL;
  const audio = `data:${request.mime ?? 'application/octet-stream'};base64,${request.buffer.toString('base64')}`;
  const messages: Array<Record<string, unknown>> = [];
  if (request.prompt) messages.push({ role: 'system', content: [{ text: request.prompt }] });
  messages.push({ role: 'user', content: [{ type: 'input_audio', input_audio: audio }] });
  try {
    const response = await postJsonRequest(request.baseUrl ?? DEFAULT_BASE_URL, {
      timeoutMs: request.timeoutMs,
      label: 'Alibaba STT',
      headers: { Authorization: `Bearer ${request.apiKey}` },
      body: {
        model,
        input: { messages },
        parameters: request.language ? { asr_options: { language: request.language } } : {},
      },
      signal: request.signal,
    });
    const data = await response.json() as {
      output?: { choices?: Array<{ message?: { content?: Array<{ text?: unknown }> } }> };
    };
    const text = data.output?.choices?.flatMap((choice) => choice.message?.content ?? [])
      .map((part) => part.text).find((value): value is string => typeof value === 'string');
    if (text === undefined) throw new Error('Alibaba STT returned an invalid response');
    log.info({ provider: 'alibaba', model, latencyMs: Date.now() - startedAt, textLength: text.length }, 'Transcription completed');
    return { text, model, ...(request.language ? { language: request.language } : {}) };
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
};

registerMediaUnderstandingProvider(alibabaTranscriptionProvider);
