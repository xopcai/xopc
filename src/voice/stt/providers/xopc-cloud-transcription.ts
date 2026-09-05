import { getModelCatalogStore } from '../../../providers/model-catalog-store.js';
import { compareCatalogModels } from '../../../providers/model-catalog-ranking.js';
import { getProviderAuthService } from '../../../providers/provider-auth-service.js';
import { resolveXopcModelRouterUrl } from '../../../providers/xopc-cloud-config.js';
import { registerMediaUnderstandingProvider } from '../../../media-understanding/registry.js';
import type { AudioTranscriptionRequest, MediaUnderstandingProvider } from '../../../media-understanding/types.js';
import { openDashScopeStreamingStt } from '../../dashscope/streaming-stt-session.js';

const DEFAULT_STREAMING_MODEL = 'qwen-audio-3.0-asr-flash-streaming';

function defaultModel(): string | undefined {
  const source = getModelCatalogStore().getSource('xopc-cloud');
  return source?.models
    .filter((model) => model.availability === 'available' && model.kind === 'stt')
    .sort((left, right) => compareCatalogModels(left, right, source.recommended?.stt))[0]?.id;
}

export const xopcCloudTranscriptionProvider: MediaUnderstandingProvider = {
  id: 'xopc-cloud',
  capabilities: ['audio'],
  requiresApiKey: false,
  autoPriority: { audio: 5 },
  isConfigured: () => Boolean(defaultModel()),
  transcribeAudio: async (request: AudioTranscriptionRequest) => {
    const model = request.model ?? defaultModel();
    if (!model) throw new Error('No XOPC Cloud speech-to-text model is available');
    const accessToken = await getProviderAuthService().resolveApiKey('xopc-cloud', request.signal);
    if (!accessToken) throw new Error('XOPC Cloud authorization is unavailable');
    const source = getModelCatalogStore().getSource('xopc-cloud');
    const baseUrl = (request.baseUrl ?? source?.baseUrl ?? resolveXopcModelRouterUrl()).replace(/\/+$/, '');
    const form = new FormData();
    form.append('model', model);
    form.append('file', new File([Uint8Array.from(request.buffer)], request.fileName, {
      type: request.mime ?? 'application/octet-stream',
    }));
    if (request.language) form.append('language', request.language);
    if (request.prompt) form.append('prompt', request.prompt);
    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: form,
      signal: request.signal ?? AbortSignal.timeout(request.timeoutMs), redirect: 'error',
    });
    const body = await response.json().catch(() => null) as { text?: unknown; error?: { message?: unknown } } | null;
    if (!response.ok) {
      throw new Error(typeof body?.error?.message === 'string' ? body.error.message : `XOPC Cloud STT failed (${response.status})`);
    }
    if (typeof body?.text !== 'string') throw new Error('XOPC Cloud STT returned an invalid response');
    return { text: body.text, model, ...(request.language ? { language: request.language } : {}) };
  },
  streamingAudio: {
    inputSampleRates: [16_000],
    turnDetection: ['server_vad'],
    defaultModel: DEFAULT_STREAMING_MODEL,
    models: [DEFAULT_STREAMING_MODEL],
  },
  openAudioStream: async (request) => {
    const accessToken = await getProviderAuthService().resolveApiKey('xopc-cloud', request.signal);
    if (!accessToken) throw new Error('XOPC Cloud authorization is unavailable');
    const source = getModelCatalogStore().getSource('xopc-cloud');
    const baseUrl = (request.baseUrl ?? source?.baseUrl ?? resolveXopcModelRouterUrl()).replace(/\/+$/, '');
    const relayUrl = new URL(`${baseUrl}/audio/transcriptions/realtime`);
    relayUrl.protocol = relayUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    relayUrl.searchParams.set('model', request.model || DEFAULT_STREAMING_MODEL);
    return openDashScopeStreamingStt({
      ...request,
      apiKey: accessToken,
      baseUrl: relayUrl.toString(),
      model: request.model || DEFAULT_STREAMING_MODEL,
    });
  },
};

registerMediaUnderstandingProvider(xopcCloudTranscriptionProvider);
