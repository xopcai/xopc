import { arrayBufferToBase64 } from '@/features/chat/attachments/attachment-utils-core';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface VoiceTranscribeResult {
  raw: string;
  refined?: string;
  language?: string;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return arrayBufferToBase64(await blob.arrayBuffer());
}

export async function transcribeVoiceBlob(blob: Blob, mimeType: string): Promise<VoiceTranscribeResult> {
  const audio = await blobToBase64(blob);
  const res = await fetchJson<{
    ok?: boolean;
    payload?: VoiceTranscribeResult;
  }>(apiUrl('/api/voice/transcribe'), {
    method: 'POST',
    body: JSON.stringify({ audio, mimeType }),
  });

  if (!res.payload) {
    throw new Error('Missing transcription payload');
  }

  return res.payload;
}

let sttAvailableCache: boolean | null = null;

/** Cached read of gateway `voice.sttAvailable` from GET /api/status. */
export async function fetchVoiceSttAvailable(): Promise<boolean> {
  if (sttAvailableCache !== null) return sttAvailableCache;
  try {
    const res = await fetchJson<{ voice?: { sttAvailable?: boolean } }>(apiUrl('/api/status'));
    sttAvailableCache = res.voice?.sttAvailable === true;
  } catch {
    sttAvailableCache = false;
  }
  return sttAvailableCache;
}

export function clearVoiceSttAvailableCache(): void {
  sttAvailableCache = null;
}
