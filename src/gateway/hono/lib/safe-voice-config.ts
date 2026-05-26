import { isMaskedApiKey } from '../../config-tools-web.js';
import { STT_CONFIG_RESERVED_KEYS } from '../../../voice/stt/config-slice.js';
import { TTS_CONFIG_RESERVED_KEYS } from '../../../voice/tts/config-slice.js';

function maskProviderSlice(slice: Record<string, unknown>): Record<string, unknown> {
  const next = { ...slice };
  if (typeof next.apiKey === 'string' && next.apiKey.trim()) {
    next.apiKey = '***';
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

/** Mask STT api keys for GET `/api/config`. */
export function maskSttConfigForWeb(stt: unknown): unknown {
  if (!stt || typeof stt !== 'object' || Array.isArray(stt)) return stt;
  const raw = { ...(stt as Record<string, unknown>) };

  if (raw.alibaba && typeof raw.alibaba === 'object' && !Array.isArray(raw.alibaba)) {
    raw.alibaba = maskProviderSlice(raw.alibaba as Record<string, unknown>);
  }
  if (raw.openai && typeof raw.openai === 'object' && !Array.isArray(raw.openai)) {
    raw.openai = maskProviderSlice(raw.openai as Record<string, unknown>);
  }
  if (raw.providers && typeof raw.providers === 'object' && !Array.isArray(raw.providers)) {
    raw.providers = maskProviderMap(raw.providers as Record<string, unknown>);
  }

  for (const [key, value] of Object.entries(raw)) {
    if (STT_CONFIG_RESERVED_KEYS.has(key)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      raw[key] = maskProviderSlice(value as Record<string, unknown>);
    }
  }

  return raw;
}

/** Mask TTS api keys for GET `/api/config`. */
export function maskTtsConfigForWeb(tts: unknown): unknown {
  if (!tts || typeof tts !== 'object' || Array.isArray(tts)) return tts;
  const raw = { ...(tts as Record<string, unknown>) };

  for (const key of ['alibaba', 'openai', 'minimax'] as const) {
    const value = raw[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      raw[key] = maskProviderSlice(value as Record<string, unknown>);
    }
  }
  if (raw.providers && typeof raw.providers === 'object' && !Array.isArray(raw.providers)) {
    raw.providers = maskProviderMap(raw.providers as Record<string, unknown>);
  }

  for (const [key, value] of Object.entries(raw)) {
    if (TTS_CONFIG_RESERVED_KEYS.has(key)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      raw[key] = maskProviderSlice(value as Record<string, unknown>);
    }
  }

  return raw;
}

/** Merge incoming STT patch, preserving api keys when the UI sends masked sentinels. */
export function mergeSttConfigPatch(previous: unknown, incoming: unknown): unknown {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return previous ?? incoming;
  const prev = previous && typeof previous === 'object' && !Array.isArray(previous)
    ? (previous as Record<string, unknown>)
    : {};
  const patch = incoming as Record<string, unknown>;
  const next: Record<string, unknown> = { ...prev, ...patch };

  for (const key of ['alibaba', 'openai'] as const) {
    if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
      next[key] = mergeProviderSlice(
        patch[key] as Record<string, unknown>,
        (prev[key] ?? {}) as Record<string, unknown>,
      );
    }
  }

  if (patch.providers && typeof patch.providers === 'object' && !Array.isArray(patch.providers)) {
    next.providers = mergeProviderMap(
      patch.providers as Record<string, unknown>,
      (prev.providers ?? {}) as Record<string, unknown>,
    );
  }

  for (const [key, value] of Object.entries(patch)) {
    if (STT_CONFIG_RESERVED_KEYS.has(key)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = mergeProviderSlice(value as Record<string, unknown>, (prev[key] ?? {}) as Record<string, unknown>);
    }
  }

  return next;
}

/** Merge incoming TTS patch, preserving api keys when the UI sends masked sentinels. */
export function mergeTtsConfigPatch(previous: unknown, incoming: unknown): unknown {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return previous ?? incoming;
  const prev = previous && typeof previous === 'object' && !Array.isArray(previous)
    ? (previous as Record<string, unknown>)
    : {};
  const patch = incoming as Record<string, unknown>;
  const next: Record<string, unknown> = { ...prev, ...patch };

  for (const key of ['alibaba', 'openai', 'minimax'] as const) {
    if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
      next[key] = mergeProviderSlice(
        patch[key] as Record<string, unknown>,
        (prev[key] ?? {}) as Record<string, unknown>,
      );
    }
  }

  if (patch.providers && typeof patch.providers === 'object' && !Array.isArray(patch.providers)) {
    next.providers = mergeProviderMap(
      patch.providers as Record<string, unknown>,
      (prev.providers ?? {}) as Record<string, unknown>,
    );
  }

  for (const [key, value] of Object.entries(patch)) {
    if (TTS_CONFIG_RESERVED_KEYS.has(key)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = mergeProviderSlice(value as Record<string, unknown>, (prev[key] ?? {}) as Record<string, unknown>);
    }
  }

  return next;
}
