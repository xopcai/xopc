import { getModelCatalogStore } from '../../../providers/model-catalog-store.js';
import { getProviderAuthService } from '../../../providers/provider-auth-service.js';
import { resolveXopcModelRouterUrl } from '../../../providers/xopc-cloud-config.js';
import { registerMediaUnderstandingProvider } from '../../../media-understanding/registry.js';
import type { AudioTranscriptionRequest, MediaUnderstandingProvider } from '../../../media-understanding/types.js';

function defaultModel(): string | undefined {
  return getModelCatalogStore().getSource('xopc-cloud')?.models.find((model) =>
    model.availability === 'available' && model.kind === 'stt')?.id;
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
};

registerMediaUnderstandingProvider(xopcCloudTranscriptionProvider);
