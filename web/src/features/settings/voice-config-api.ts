import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type { SttSettings, SttProvidersPayload, TtsSettings, VoiceModelsPayload, VoiceSettingsState, VoiceProvidersPayload } from './voice-settings.types';

export type { SttSettings, TtsSettings, VoiceConfigFieldMetadata, VoiceModelsPayload, VoiceSettingsState, VoiceProvidersPayload, SttProvidersPayload, TtsProviderListEntry, SttProviderListEntry } from './voice-settings.types';

export interface TtsTestPayload {
  audio: string;
  mimeType: string;
  format: string;
  provider: string;
  latencyMs?: number;
  audioSize?: number;
}

export interface TtsTestInput {
  text: string;
  provider?: string;
  model?: string;
  voice?: string;
  providerConfig?: Record<string, unknown>;
}


function defaultStt(): SttSettings {
  return {
    enabled: false,
    provider: 'alibaba',
    alibaba: { model: 'paraformer-v2' },
    openai: { model: 'whisper-1' },
    fallback: { enabled: true, order: ['alibaba', 'openai'] },
  };
}

// Defaults intentionally mirror src/config/schema.ts (TTSConfigSchema /
// TTSEdgeConfigSchema) and extensions/tts-local-cli/xopc.extension.json so a
// PATCH /api/config round-trip never silently overrides backend defaults.
function defaultTts(): TtsSettings {
  return {
    enabled: false,
    provider: 'edge',
    trigger: 'always',
    maxTextLength: 512,
    timeoutMs: 60000,
    alibaba: { model: 'qwen-tts', voice: 'Cherry' },
    openai: { model: 'tts-1', voice: 'alloy' },
    edge: { voice: 'en-US-MichelleNeural' },
    minimax: { model: 'speech-2.8-hd', voice: 'male-qn-qingse' },
    'tts-local-cli': {
      command: '',
      outputFormat: 'wav',
    },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeSttProvider(v: unknown): string {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : 'alibaba';
}

function readProviderSlice<T extends object>(
  raw: Record<string, unknown>,
  id: string,
  defaults: T,
): T {
  const providers = isRecord(raw.providers) ? raw.providers : undefined;
  const fromProviders = providers && isRecord(providers[id]) ? providers[id] : undefined;
  return {
    ...defaults,
    ...(fromProviders ?? {}),
  };
}

function mergeStt(raw: unknown): SttSettings {
  const d = defaultStt();
  if (!isRecord(raw)) return d;
  const provider = normalizeSttProvider(raw.provider);
  const alibaba = readProviderSlice(raw, 'alibaba', d.alibaba ?? {}) as SttSettings['alibaba'];
  const openai = readProviderSlice(raw, 'openai', d.openai ?? {}) as SttSettings['openai'];
  const baseFallback = d.fallback ?? { enabled: true, order: ['alibaba', 'openai'] };
  let fallback = baseFallback;
  if (isRecord(raw.fallback)) {
    const order = Array.isArray(raw.fallback.order)
      ? raw.fallback.order.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : fallback.order;
    fallback = {
      enabled: typeof raw.fallback.enabled === 'boolean' ? raw.fallback.enabled : fallback.enabled,
      order: order.length ? order : fallback.order,
    };
  }

  const providers = isRecord(raw.providers)
    ? Object.fromEntries(
        Object.entries(raw.providers).map(([key, value]) => [
          key,
          isRecord(value) ? { ...value } : {},
        ]),
      )
    : undefined;

  return {
    enabled: Boolean(raw.enabled),
    provider,
    alibaba,
    openai,
    ...(providers ? { providers } : {}),
    fallback,
  };
}

/** Provider id is open string — extension SpeechProviderPlugins (e.g. tts-local-cli) are allowed. */
function normalizeTtsProvider(v: unknown): string {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : 'edge';
}

function mergeTts(raw: unknown): TtsSettings {
  const d = defaultTts();
  if (!isRecord(raw)) return d;
  const provider = normalizeTtsProvider(raw.provider);
  const trigger =
    raw.trigger === 'off' ||
    raw.trigger === 'always' ||
    raw.trigger === 'inbound' ||
    raw.trigger === 'tagged'
      ? raw.trigger
      : 'always';
  const localCliDefaults = d['tts-local-cli'] ?? {};
  const providers = isRecord(raw.providers)
    ? Object.fromEntries(
        Object.entries(raw.providers).map(([key, value]) => [
          key,
          isRecord(value) ? { ...value } : {},
        ]),
      )
    : undefined;

  return {
    enabled: Boolean(raw.enabled),
    provider,
    trigger,
    maxTextLength:
      typeof raw.maxTextLength === 'number' && Number.isFinite(raw.maxTextLength)
        ? raw.maxTextLength
        : d.maxTextLength,
    timeoutMs:
      typeof raw.timeoutMs === 'number' && Number.isFinite(raw.timeoutMs) ? raw.timeoutMs : d.timeoutMs,
    ...(providers ? { providers } : {}),
    alibaba: readProviderSlice(raw, 'alibaba', d.alibaba ?? {}),
    openai: readProviderSlice(raw, 'openai', d.openai ?? {}),
    edge: readProviderSlice(raw, 'edge', d.edge ?? {}),
    minimax: readProviderSlice(raw, 'minimax', d.minimax ?? {}),
    'tts-local-cli': readProviderSlice(raw, 'tts-local-cli', localCliDefaults),
  };
}

function toSttPayload(stt: SttSettings): Record<string, unknown> {
  const { alibaba, openai, providers, ...rest } = stt;
  const providerMap: Record<string, Record<string, unknown>> = { ...(providers ?? {}) };
  if (alibaba) {
    providerMap.alibaba = { ...(providerMap.alibaba ?? {}), ...alibaba };
  }
  if (openai) {
    providerMap.openai = { ...(providerMap.openai ?? {}), ...openai };
  }
  return {
    ...rest,
    ...(Object.keys(providerMap).length > 0 ? { providers: providerMap } : {}),
  };
}

function toTtsPayload(tts: TtsSettings): Record<string, unknown> {
  const { alibaba, openai, edge, minimax, 'tts-local-cli': localCli, providers, ...rest } = tts;
  const providerMap: Record<string, Record<string, unknown>> = { ...(providers ?? {}) };
  if (alibaba) providerMap.alibaba = { ...(providerMap.alibaba ?? {}), ...alibaba };
  if (openai) providerMap.openai = { ...(providerMap.openai ?? {}), ...openai };
  if (edge) providerMap.edge = { ...(providerMap.edge ?? {}), ...edge };
  if (minimax) providerMap.minimax = { ...(providerMap.minimax ?? {}), ...minimax };
  if (localCli) providerMap['tts-local-cli'] = { ...(providerMap['tts-local-cli'] ?? {}), ...localCli };
  return {
    ...rest,
    ...(Object.keys(providerMap).length > 0 ? { providers: providerMap } : {}),
  };
}

export function normalizeVoiceSettings(config: unknown): VoiceSettingsState {
  const c = isRecord(config) ? config : {};
  return {
    stt: mergeStt(c.stt),
    tts: mergeTts(c.tts),
  };
}

export async function fetchVoiceSettings(): Promise<VoiceSettingsState> {
  const res = await fetchJson<{ ok?: boolean; payload?: { config?: unknown } }>(apiUrl('/api/config'));
  return normalizeVoiceSettings(res.payload?.config ?? {});
}

export async function patchVoiceSettings(state: VoiceSettingsState): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({ stt: toSttPayload(state.stt), tts: toTtsPayload(state.tts) }),
  });
  void revalidateGatewayConfig();
}

export async function fetchVoiceModels(): Promise<VoiceModelsPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: { models?: VoiceModelsPayload } }>(
    apiUrl('/api/voice/models'),
  );
  if (!res.payload?.models) {
    throw new Error('Missing voice models payload');
  }
  return res.payload.models;
}

export async function fetchVoiceProviders(): Promise<VoiceProvidersPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: VoiceProvidersPayload }>(
    apiUrl('/api/voice/providers'),
  );
  if (!res.payload?.providers) {
    throw new Error('Missing voice providers payload');
  }
  return res.payload;
}

export async function fetchVoiceSttProviders(): Promise<SttProvidersPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: SttProvidersPayload }>(
    apiUrl('/api/voice/stt-providers'),
  );
  if (!res.payload?.providers) {
    throw new Error('Missing STT providers payload');
  }
  return res.payload;
}

export type RevealVoiceApiKeyPayload = {
  kind: 'stt' | 'tts';
  provider: string;
  apiKey: string | null;
  source: 'config' | 'none';
};

export async function testTtsVoice(input: TtsTestInput): Promise<TtsTestPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: TtsTestPayload; error?: string | { message?: string } }>(apiUrl('/api/voice/tts-test'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (res.ok === false) {
    const serverMessage = typeof res.error === 'string' ? res.error : res.error?.message;
    throw new Error(serverMessage || 'TTS test failed');
  }
  if (!res.payload || typeof res.payload.audio !== 'string' || !res.payload.audio.trim()) {
    throw new Error('TTS test returned no audio. Check the selected voice engine and try again.');
  }
  return res.payload;
}

/** POST /api/voice/reveal-api-key — plaintext only when stored in config file. */
export async function revealVoiceConfigApiKey(args: {
  kind: 'stt' | 'tts';
  provider: string;
}): Promise<RevealVoiceApiKeyPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: RevealVoiceApiKeyPayload }>(
    apiUrl('/api/voice/reveal-api-key'),
    {
      method: 'POST',
      body: JSON.stringify(args),
    },
  );
  if (!res.payload) {
    throw new Error('Missing reveal payload');
  }
  return res.payload;
}
