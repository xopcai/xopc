import type { STTConfig } from './types.js';
import { DEFAULT_STT_CONFIG } from './types.js';

function mergeSttProviders(
  base: STTConfig['providers'],
  patch: STTConfig['providers'],
): STTConfig['providers'] {
  if (!base && !patch) return undefined;
  const merged: Record<string, Record<string, unknown>> = { ...(base ?? {}) };
  for (const [id, slice] of Object.entries(patch ?? {})) {
    merged[id] = { ...(merged[id] ?? {}), ...slice };
  }
  return merged;
}

export function mergeSttConfigFromAppConfig(
  stt: Partial<STTConfig> | undefined,
  toolsMedia?: { models?: STTConfig['sharedModels'] },
): STTConfig {
  const patch = stt ?? {};
  return {
    ...DEFAULT_STT_CONFIG,
    ...patch,
    providers: mergeSttProviders(DEFAULT_STT_CONFIG.providers, patch.providers),
    fallback: { ...DEFAULT_STT_CONFIG.fallback!, ...patch.fallback },
    ...(toolsMedia?.models?.length ? { sharedModels: toolsMedia.models } : {}),
  };
}
