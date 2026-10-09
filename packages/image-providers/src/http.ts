import { ImageProviderError } from './validation.js';

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

export async function readBytesLimited(response: Response, limit = MAX_RESPONSE_BYTES): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new ImageProviderError('Image response exceeds byte limit', 502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ImageProviderError('Empty image response', 502);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new ImageProviderError('Image response exceeds byte limit', 502);
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function assertImageResponseOk(response: Response): Promise<void> {
  if (response.ok) return;
  await response.body?.cancel();
  throw new ImageProviderError(`Image provider HTTP ${response.status}`, response.status, [401, 403, 429].includes(response.status));
}

export async function readImageJson(response: Response): Promise<Record<string, unknown>> {
  await assertImageResponseOk(response);
  try {
    const data: unknown = JSON.parse(new TextDecoder().decode(await readBytesLimited(response)));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid object');
    return data as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ImageProviderError) throw error;
    throw new ImageProviderError('Invalid image provider JSON', 502);
  }
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

export function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new ImageProviderError('Invalid image base64', 502);
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export function imageFromBytes(bytes: Uint8Array): { bytes: Uint8Array; mimeType: string } {
  const mimeType = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a ? 'image/png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
    : new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP' ? 'image/webp' : null;
  if (!mimeType || bytes.length > MAX_IMAGE_BYTES) throw new ImageProviderError('Invalid generated image bytes', 502);
  return { bytes, mimeType };
}

export function authenticatedJobUrl(value: unknown, baseUrl: string, allowBflHost = false): string {
  if (typeof value !== 'string') throw new ImageProviderError('Missing provider job URL', 502);
  const url = new URL(value), base = new URL(baseUrl);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && url.origin !== base.origin)
    || (url.origin !== base.origin && !(allowBflHost && (base.hostname === 'api.bfl.ai' || base.hostname.endsWith('.bfl.ai')) && url.protocol === 'https:' && url.hostname.endsWith('.bfl.ai') && !url.port))) {
    throw new ImageProviderError('Untrusted provider job URL', 502);
  }
  return url.toString();
}

export async function waitForImagePoll(signal: AbortSignal, delayMs = 1500): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, delayMs);
    signal.addEventListener('abort', aborted, { once: true });
  });
}
