import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { callSetup } from './setup-api.js';
import type { SttSettings, SttProvidersPayload, TtsSettings, VoiceModelsPayload, VoiceSettingsState, VoiceProvidersPayload } from './voice-settings.types';

export type { SttSettings, TtsSettings, VoiceModelsPayload, VoiceSettingsState, VoiceProvidersPayload, SttProvidersPayload, TtsProviderListEntry, SttProviderListEntry } from './voice-settings.types';

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
    provider: 'openai',
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

function mergeStt(raw: unknown): SttSettings {
  const d = defaultStt();
  if (!isRecord(raw)) return d;
  const provider = normalizeSttProvider(raw.provider);
  const alibaba = isRecord(raw.alibaba) ? { ...d.alibaba, ...raw.alibaba } : d.alibaba;
  const openai = isRecord(raw.openai) ? { ...d.openai, ...raw.openai } : d.openai;
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
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : 'openai';
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
  // Per-provider buckets: keep built-in defaults, plus passthrough for any
  // extension-provider key (e.g. `tts-local-cli`) so unknown plugins survive
  // a round-trip through the UI without losing their config.
  const localCliRaw = raw['tts-local-cli'];
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
    alibaba: isRecord(raw.alibaba) ? { ...d.alibaba, ...raw.alibaba } : d.alibaba,
    openai: isRecord(raw.openai) ? { ...d.openai, ...raw.openai } : d.openai,
    edge: isRecord(raw.edge) ? { ...d.edge, ...raw.edge } : d.edge,
    minimax: isRecord(raw.minimax) ? { ...d.minimax, ...raw.minimax } : d.minimax,
    'tts-local-cli': isRecord(localCliRaw)
      ? { ...d['tts-local-cli'], ...localCliRaw }
      : d['tts-local-cli'],
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
  await callSetup({
    domain: 'voice',
    action: 'configure',
    fields: { stt: state.stt, tts: state.tts },
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
