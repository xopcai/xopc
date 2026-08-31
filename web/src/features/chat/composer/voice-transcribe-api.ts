import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface VoiceTranscribeResult {
  raw: string;
  refined?: string;
  language?: string;
  provider?: string;
  latencyMs?: number;
}

export type VoiceReadinessState = 'ready' | 'preparing' | 'needs_download' | 'error' | 'disabled' | 'unavailable';

export interface VoiceReadiness {
  state: VoiceReadinessState;
  provider?: string;
  modelId?: string;
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  error?: string;
}

interface GatewayVoiceStatus {
  sttAvailable?: boolean;
  sttEnabled?: boolean;
  sttProvider?: string | null;
  localModelId?: string | null;
}

interface LocalVoiceModelStatus {
  id: string;
  state: 'not_installed' | 'downloading' | 'ready' | 'error';
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  error?: string;
}

interface LocalVoiceRuntimeStatus {
  ready: boolean;
  error?: string;
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

export async function transcribeVoiceBlob(blob: Blob, mimeType: string): Promise<VoiceTranscribeResult> {
  const resolvedMime = blob.type || mimeType || 'audio/webm';
  const audio = blob.type ? blob : new Blob([blob], { type: resolvedMime });
  const form = new FormData();
  form.append('audio', audio, `recording.${extensionForMime(resolvedMime)}`);
  const res = await fetchJson<{
    ok?: boolean;
    payload?: VoiceTranscribeResult;
  }>(apiUrl('/api/voice/transcriptions'), {
    method: 'POST',
    body: form,
  });

  if (!res.payload) {
    throw new Error('Missing transcription payload');
  }

  return res.payload;
}

const STT_AVAILABILITY_TTL_MS = 10_000;
let sttAvailableCache: { value: boolean; expiresAt: number } | null = null;

export function invalidateVoiceSttAvailabilityCache(): void {
  sttAvailableCache = null;
}

export async function fetchVoiceReadiness(): Promise<VoiceReadiness> {
  try {
    const status = await fetchJson<{ voice?: GatewayVoiceStatus }>(apiUrl('/api/status'));
    const voice = status.voice;
    if (voice?.sttEnabled === false) return { state: 'disabled' };
    const provider = voice?.sttProvider ?? undefined;
    if (provider !== 'xopc-local') {
      return voice?.sttAvailable === true
        ? { state: 'ready', provider }
        : { state: 'unavailable', provider };
    }

    const local = await fetchJson<{
      payload?: { runtime?: LocalVoiceRuntimeStatus; models?: LocalVoiceModelStatus[] };
    }>(
      apiUrl('/api/voice/local/status'),
    );
    const modelId = voice?.localModelId ?? 'sensevoice-small';
    if (local.payload?.runtime?.ready === false) {
      return {
        state: 'error',
        provider,
        modelId,
        error: local.payload.runtime.error || 'Local voice runtime is unavailable',
      };
    }
    const model = local.payload?.models?.find((entry) => entry.id === modelId);
    if (!model) return { state: 'error', provider, modelId, error: 'Local voice model status is unavailable' };
    if (model.state === 'ready') return { state: 'ready', provider, modelId };
    if (model.state === 'not_installed') return { state: 'needs_download', provider, modelId };
    return {
      state: model.state === 'downloading' ? 'preparing' : 'error',
      provider,
      modelId,
      progress: model.progress,
      downloadedBytes: model.downloadedBytes,
      totalBytes: model.totalBytes,
      error: model.error,
    };
  } catch (cause) {
    return { state: 'error', error: cause instanceof Error ? cause.message : String(cause) };
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('voice-config-changed', invalidateVoiceSttAvailabilityCache);
  window.addEventListener('config-reload', invalidateVoiceSttAvailabilityCache);
}

/** Cached read of gateway `voice.sttAvailable` from GET /api/status. */
export async function fetchVoiceSttAvailable(): Promise<boolean> {
  if (sttAvailableCache && sttAvailableCache.expiresAt > Date.now()) {
    return sttAvailableCache.value;
  }
  try {
    const res = await fetchJson<{ voice?: { sttAvailable?: boolean } }>(apiUrl('/api/status'));
    sttAvailableCache = {
      value: res.voice?.sttAvailable === true,
      expiresAt: Date.now() + STT_AVAILABILITY_TTL_MS,
    };
  } catch {
    sttAvailableCache = { value: false, expiresAt: Date.now() + STT_AVAILABILITY_TTL_MS };
  }
  return sttAvailableCache.value;
}
