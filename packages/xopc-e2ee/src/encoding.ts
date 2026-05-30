export const E2EE_VERSION = 1 as const;
export const E2EE_CONTENT_TYPE = 'application/x-xopc-e2ee+json';

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function utf8ToBytes(value: string): Uint8Array {
  return new Uint8Array(new TextEncoder().encode(value));
}

export function asCryptoBuffer(bytes: Uint8Array): BufferSource {
  return new Uint8Array(bytes) as unknown as BufferSource;
}

export function bytesToUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}
