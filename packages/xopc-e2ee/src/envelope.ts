import { E2EE_VERSION, base64UrlToBytes, bytesToBase64Url, utf8ToBytes, bytesToUtf8, asCryptoBuffer } from './encoding.js';
import { deriveDirectionKey } from './keys.js';

export type E2eeEnvelope = {
  v: typeof E2EE_VERSION;
  seq: number;
  nonce: string;
  aad?: Record<string, unknown>;
  ciphertext: string;
};

export async function encryptEnvelope(
  key: CryptoKey,
  seq: number,
  plaintext: string,
  aad?: Record<string, unknown>,
): Promise<E2eeEnvelope> {
  const subtle = crypto.subtle;
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const additional = aad ? utf8ToBytes(JSON.stringify(aad)) : undefined;
  const ciphertext = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: asCryptoBuffer(nonce),
      additionalData: additional ? asCryptoBuffer(additional) : undefined,
    },
    key,
    asCryptoBuffer(utf8ToBytes(plaintext)),
  );
  return {
    v: E2EE_VERSION,
    seq,
    nonce: bytesToBase64Url(nonce),
    ...(aad ? { aad } : {}),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptEnvelope(key: CryptoKey, envelope: E2eeEnvelope): Promise<string> {
  const subtle = crypto.subtle;
  const nonce = base64UrlToBytes(envelope.nonce);
  const additional = envelope.aad ? utf8ToBytes(JSON.stringify(envelope.aad)) : undefined;
  const plaintext = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: asCryptoBuffer(nonce),
      additionalData: additional ? asCryptoBuffer(additional) : undefined,
    },
    key,
    asCryptoBuffer(base64UrlToBytes(envelope.ciphertext)),
  );
  return bytesToUtf8(new Uint8Array(plaintext));
}

export type DirectionKeys = {
  requestKey: CryptoKey;
  responseKey: CryptoKey;
  streamKey: CryptoKey;
};

export async function buildDirectionKeys(rootKey: Uint8Array): Promise<DirectionKeys> {
  const [requestKey, responseKey, streamKey] = await Promise.all([
    deriveDirectionKey(rootKey, 'req'),
    deriveDirectionKey(rootKey, 'res'),
    deriveDirectionKey(rootKey, 'stream'),
  ]);
  return { requestKey, responseKey, streamKey };
}
