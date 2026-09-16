import { getModelCatalogStore } from '../../../providers/model-catalog-store.js';
import { compareCatalogModels } from '../../../providers/model-catalog-ranking.js';
import { getProviderAuthService } from '../../../providers/provider-auth-service.js';
import { resolveXopcModelRouterUrl } from '../../../providers/xopc-cloud-config.js';
import { registerMediaUnderstandingProvider } from '../../../media-understanding/registry.js';
import type { AudioTranscriptionRequest, MediaUnderstandingProvider } from '../../../media-understanding/types.js';
import { openPlatformStt } from '../../platform-streams.js';
import { platformVoiceModels, requirePlatformVoiceModel } from '../../platform-catalog.js';


function defaultModel(): string | undefined {
  const source = getModelCatalogStore().getSource('xopc-cloud');
  return source?.models
    .filter((model) => model.availability === 'available' && model.kind === 'stt' && model.voice?.modes.includes('transcription'))
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
    requirePlatformVoiceModel(model, 'transcription');
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
    get defaultModel() { return platformVoiceModels('transcription.stream')[0]?.id ?? ''; },
    get models() { return platformVoiceModels('transcription.stream').map(model => model.id); },
  },
  openAudioStream: async (request) => {
    const catalogModel = requirePlatformVoiceModel(request.model, 'transcription.stream');
    const accessToken = await getProviderAuthService().resolveApiKey('xopc-cloud', request.signal);
    if (!accessToken) throw new Error('XOPC Cloud authorization is unavailable');
    const source = getModelCatalogStore().getSource('xopc-cloud');
    const baseUrl = (request.baseUrl ?? source?.baseUrl ?? resolveXopcModelRouterUrl()).replace(/\/+$/, '');
    const relayUrl = new URL(`${baseUrl}/audio/transcriptions/realtime`);
    relayUrl.protocol = relayUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    relayUrl.searchParams.set('model', request.model);
    relayUrl.searchParams.set('service_version', String(catalogModel.voice.serviceVersion));
    return openPlatformStt({
      ...request,
      apiKey: accessToken,
      baseUrl: relayUrl.toString(),
      model: request.model,
    });
  },
};

registerMediaUnderstandingProvider(xopcCloudTranscriptionProvider);
