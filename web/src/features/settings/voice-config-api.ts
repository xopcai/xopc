import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type { SttSettings, TtsSettings, VoiceModelsPayload, VoiceSettingsState } from './voice-settings.types';

export type { SttSettings, TtsSettings, VoiceModelsPayload, VoiceSettingsState } from './voice-settings.types';

function defaultStt(): SttSettings {
  return {
    enabled: false,
    provider: 'alibaba',
    alibaba: { model: 'paraformer-v2' },
    openai: { model: 'whisper-1' },
    fallback: { enabled: true, order: ['alibaba', 'openai'] },
  };
}

function defaultTts(): TtsSettings {
  return {
    enabled: false,
    provider: 'openai',
    trigger: 'always',
    maxTextLength: 4096,
    timeoutMs: 30000,
    alibaba: { model: 'qwen-tts', voice: 'Cherry' },
    openai: { model: 'tts-1', voice: 'alloy' },
    edge: { voice: 'zh-CN-XiaoxiaoNeural' },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function mergeStt(raw: unknown): SttSettings {
  const d = defaultStt();
  if (!isRecord(raw)) return d;
  const provider = raw.provider === 'openai' ? 'openai' : 'alibaba';
  const alibaba = isRecord(raw.alibaba) ? { ...d.alibaba, ...raw.alibaba } : d.alibaba;
  const openai = isRecord(raw.openai) ? { ...d.openai, ...raw.openai } : d.openai;
  const baseFallback = d.fallback ?? { enabled: true, order: ['alibaba', 'openai'] as const };
  let fallback = baseFallback;
  if (isRecord(raw.fallback)) {
    const order = Array.isArray(raw.fallback.order)
      ? (raw.fallback.order.filter((x) => x === 'alibaba' || x === 'openai') as ('alibaba' | 'openai')[])
      : fallback.order;
    fallback = {
      enabled: typeof raw.fallback.enabled === 'boolean' ? raw.fallback.enabled : fallback.enabled,
      order: order.length ? order : fallback.order,
    };
  }
  return {
    enabled: Boolean(raw.enabled),
    provider,
    alibaba,
    openai,
    fallback,
  };
}

function mergeTts(raw: unknown): TtsSettings {
  const d = defaultTts();
  if (!isRecord(raw)) return d;
  const provider =
    raw.provider === 'alibaba' || raw.provider === 'edge' ? raw.provider : 'openai';
  const trigger =
    raw.trigger === 'off' ||
    raw.trigger === 'always' ||
    raw.trigger === 'inbound' ||
    raw.trigger === 'tagged'
      ? raw.trigger
      : 'always';
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
    body: JSON.stringify({ stt: state.stt, tts: state.tts }),
  });
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
