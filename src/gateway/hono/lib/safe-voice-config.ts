import { isMaskedApiKey } from '../../config-tools-web.js';
import { maskSecretLength } from './mask-secret-length.js';

export function maskRealtimeVoiceConfigForWeb(voice: { realtime?: { omni?: { apiKey?: string } } } | undefined): unknown {
  if (!voice?.realtime?.omni) return voice;
  return { ...voice, realtime: { ...voice.realtime, omni: maskProviderSlice(voice.realtime.omni) } };
}

export function mergeRealtimeVoiceConfigPatch(previous: { realtime?: { omni?: { apiKey?: string } } } | undefined, incoming: unknown): unknown {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming;
  const patch = incoming as Record<string, unknown>;
  const realtime = patch.realtime as Record<string, unknown> | undefined;
  const omni = realtime?.omni as Record<string, unknown> | undefined;
  if (!omni || typeof omni !== 'object' || Array.isArray(omni)) return incoming;
  const apiKey = omni.apiKey === '' ? undefined : mergeApiKeyField(omni.apiKey, previous?.realtime?.omni?.apiKey);
  return { ...patch, realtime: { ...realtime, omni: { ...omni, ...(omni.apiKey !== undefined ? { apiKey } : {}) } } };
}

function maskProviderSlice(slice: Record<string, unknown>): Record<string, unknown> {
  const next = { ...slice };
  if (typeof next.apiKey === 'string' && next.apiKey.trim()) {
    next.apiKey = maskSecretLength(next.apiKey);
  }
  return next;
}

function mergeApiKeyField(incoming: unknown, previous: unknown): unknown {
  if (typeof incoming !== 'string') return previous;
  if (isMaskedApiKey(incoming) && typeof previous === 'string' && previous.trim()) {
    return previous;
  }
  return incoming;
}

function mergeProviderSlice(
  incoming: Record<string, unknown>,
  previous: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...previous, ...incoming };
  if ('apiKey' in incoming) {
    next.apiKey = mergeApiKeyField(incoming.apiKey, previous.apiKey);
  }
  return next;
}

function maskProviderMap(providers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(providers)) {
    out[id] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? maskProviderSlice(value as Record<string, unknown>)
        : value;
  }
  return out;
}

function mergeProviderMap(
  incoming: Record<string, unknown>,
  previous: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...previous };
  for (const [id, value] of Object.entries(incoming)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[id] = mergeProviderSlice(value as Record<string, unknown>, (out[id] ?? {}) as Record<string, unknown>);
    } else {
      out[id] = value;
    }
  }
  return out;
}

function maskVoiceConfigForWeb(cfg: unknown): unknown {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return cfg;
  const raw = { ...(cfg as Record<string, unknown>) };
  if (raw.providers && typeof raw.providers === 'object' && !Array.isArray(raw.providers)) {
    raw.providers = maskProviderMap(raw.providers as Record<string, unknown>);
  }
  return raw;
}

/** Mask STT api keys for GET `/api/config`. */
export function maskSttConfigForWeb(stt: unknown): unknown {
  return maskVoiceConfigForWeb(stt);
}

/** Mask TTS api keys for GET `/api/config`. */
export function maskTtsConfigForWeb(tts: unknown): unknown {
  return maskVoiceConfigForWeb(tts);
}

function mergeVoiceConfigPatch(previous: unknown, incoming: unknown): unknown {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return previous ?? incoming;
  const prev = previous && typeof previous === 'object' && !Array.isArray(previous)
    ? (previous as Record<string, unknown>)
    : {};
  const patch = incoming as Record<string, unknown>;
  const next: Record<string, unknown> = { ...prev, ...patch };
  if (patch.providers && typeof patch.providers === 'object' && !Array.isArray(patch.providers)) {
    next.providers = mergeProviderMap(
      patch.providers as Record<string, unknown>,
      (prev.providers ?? {}) as Record<string, unknown>,
    );
  }
  return next;
}

/** Merge incoming STT patch, preserving api keys when the UI sends masked sentinels. */
export function mergeSttConfigPatch(previous: unknown, incoming: unknown): unknown {
  return mergeVoiceConfigPatch(previous, incoming);
}

/** Merge incoming TTS patch, preserving api keys when the UI sends masked sentinels. */
export function mergeTtsConfigPatch(previous: unknown, incoming: unknown): unknown {
  return mergeVoiceConfigPatch(previous, incoming);
}
