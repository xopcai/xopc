import { getModelCatalogStore } from '../../../providers/model-catalog-store.js';
import { getProviderAuthService } from '../../../providers/provider-auth-service.js';
import { resolveXopcModelRouterUrl } from '../../../providers/xopc-cloud-config.js';
import { registerSpeechProvider } from '../speech-registry.js';
import type { SpeechProviderConfig, SpeechProviderPlugin, SpeechSynthesisResult } from '../speech-provider-types.js';

interface XopcCloudSpeechConfig extends Record<string, unknown> {
  model?: string;
  voice?: string;
  baseUrl: string;
}

function availableModels() {
  return getModelCatalogStore().getSource('xopc-cloud')?.models.filter((model) =>
    model.availability === 'available' && model.kind === 'tts') ?? [];
}

function readConfig(config: SpeechProviderConfig): XopcCloudSpeechConfig {
  return config as XopcCloudSpeechConfig;
}

function extension(contentType: string | null, fallback: string): string {
  const mime = contentType?.split(';')[0];
  return ({ 'audio/mpeg': 'mp3', 'audio/opus': 'opus', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/flac': 'flac', 'audio/aac': 'aac', 'audio/pcm': 'pcm' } as Record<string, string>)[mime ?? ''] ?? fallback;
}

export const xopcCloudSpeechProvider: SpeechProviderPlugin = {
  id: 'xopc-cloud',
  autoSelectOrder: 5,
  resolveConfig: ({ rawConfig }) => {
    const raw = rawConfig['xopc-cloud'];
    const slice = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const model = typeof slice.model === 'string' ? slice.model : availableModels()[0]?.id;
    const catalogModel = availableModels().find((entry) => entry.id === model);
    return {
      model,
      voice: typeof slice.voice === 'string' ? slice.voice : catalogModel?.tts?.defaultVoice,
      baseUrl: typeof slice.baseUrl === 'string' ? slice.baseUrl : getModelCatalogStore().getSource('xopc-cloud')?.baseUrl ?? resolveXopcModelRouterUrl(),
    } satisfies XopcCloudSpeechConfig;
  },
  isConfigured: ({ providerConfig }) => {
    const config = readConfig(providerConfig);
    return Boolean(config.model && config.voice && availableModels().some((model) => model.id === config.model));
  },
  listVoices: async ({ providerConfig }) => {
    const config = readConfig(providerConfig ?? {});
    if (!config.model) return [];
    const token = await getProviderAuthService().resolveApiKey('xopc-cloud');
    if (!token) return [];
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/audio/voices?model=${encodeURIComponent(config.model)}`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000), redirect: 'error',
    });
    if (!response.ok) return [];
    const body = await response.json().catch(() => null) as { data?: Array<{ id?: unknown; name?: unknown }> } | null;
    return (body?.data ?? []).filter((voice): voice is { id: string; name?: string } => typeof voice.id === 'string')
      .map((voice) => ({ id: voice.id, ...(typeof voice.name === 'string' ? { name: voice.name } : {}) }));
  },
  synthesize: async (request): Promise<SpeechSynthesisResult> => {
    const config = readConfig(request.providerConfig);
    const model = typeof request.providerOverrides?.model === 'string' ? request.providerOverrides.model : config.model;
    const voice = typeof request.providerOverrides?.voice === 'string' ? request.providerOverrides.voice : config.voice;
    if (!model || !voice) throw new Error('XOPC Cloud TTS model or voice is unavailable');
    const catalogModel = availableModels().find((entry) => entry.id === model);
    if (!catalogModel) throw new Error(`XOPC Cloud TTS model is unavailable: ${model}`);
    const outputFormat = request.target === 'voice-note' && catalogModel.tts?.outputFormats.includes('opus')
      ? 'opus' : catalogModel.tts?.outputFormats.includes('mp3') ? 'mp3' : catalogModel.tts?.outputFormats[0] ?? 'wav';
    const token = await getProviderAuthService().resolveApiKey('xopc-cloud');
    if (!token) throw new Error('XOPC Cloud authorization is unavailable');
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/audio/speech`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: request.text, voice, response_format: outputFormat }),
      signal: AbortSignal.timeout(request.timeoutMs), redirect: 'error',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: unknown } } | null;
      throw new Error(typeof body?.error?.message === 'string' ? body.error.message : `XOPC Cloud TTS failed (${response.status})`);
    }
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    if (audioBuffer.length === 0) throw new Error('XOPC Cloud TTS returned empty audio');
    const fileExtension = extension(response.headers.get('content-type'), outputFormat);
    return { audioBuffer, outputFormat: fileExtension, fileExtension, voiceCompatible: fileExtension === 'opus' || fileExtension === 'ogg' };
  },
};

registerSpeechProvider(xopcCloudSpeechProvider);
