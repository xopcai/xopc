import { base64UrlToBytes, bytesToBase64Url, utf8ToBytes, bytesToUtf8, asCryptoBuffer } from './encoding.js';

/** Length-prefixed AES-GCM frame for SSE/agent streams. */
export async function encryptFrame(key: CryptoKey, seq: number, plaintext: string): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aad = utf8ToBytes(String(seq));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asCryptoBuffer(nonce), additionalData: asCryptoBuffer(aad) },
    key,
    asCryptoBuffer(utf8ToBytes(plaintext)),
  );
  const body = new Uint8Array(nonce.length + ciphertext.byteLength);
  body.set(nonce, 0);
  body.set(new Uint8Array(ciphertext), nonce.length);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, body.length, false);
  const out = new Uint8Array(4 + body.length);
  out.set(len, 0);
  out.set(body, 4);
  return out;
}

export async function decryptFrame(key: CryptoKey, seq: number, frame: Uint8Array): Promise<string> {
  const len = new DataView(frame.buffer, frame.byteOffset, 4).getUint32(0, false);
  const body = frame.slice(4, 4 + len);
  const nonce = body.slice(0, 12);
  const ciphertext = body.slice(12);
  const aad = utf8ToBytes(String(seq));
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asCryptoBuffer(nonce), additionalData: asCryptoBuffer(aad) },
    key,
    asCryptoBuffer(ciphertext),
  );
  return bytesToUtf8(new Uint8Array(plaintext));
}

export function frameToBase64(frame: Uint8Array): string {
  return bytesToBase64Url(frame);
}

export function frameFromBase64(value: string): Uint8Array {
  return base64UrlToBytes(value);
}
