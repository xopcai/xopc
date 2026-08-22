import { apiFetch, formatApiHttpError } from '../../api/client';

export type SpeechChunk = {
  bytes: Uint8Array;
  mimeType: string;
};

export async function generateSpeechChunk(input: {
  text: string;
  language: 'en-US' | 'zh-CN';
  signal?: AbortSignal;
}): Promise<SpeechChunk> {
  const response = await apiFetch('/api/voice/speech', {
    method: 'POST',
    body: JSON.stringify({ text: input.text, language: input.language }),
    signal: input.signal,
    timeoutMs: 60_000,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as {
      error?: string | { message?: string };
    };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    throw new Error(formatApiHttpError(response.status, response.statusText, message));
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error('Speech service returned empty audio');
  return {
    bytes,
    mimeType: response.headers.get('Content-Type')?.split(';')[0]?.trim() || 'audio/mpeg',
  };
}
