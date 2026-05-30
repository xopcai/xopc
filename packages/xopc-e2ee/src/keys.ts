import { bytesToBase64Url, base64UrlToBytes, utf8ToBytes, asCryptoBuffer } from './encoding.js';

export type X25519KeyPair = {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
};

export type ExportedIdentity = {
  version: 1;
  publicKey: string;
  privateKey: string;
  createdAt: string;
};

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto API is unavailable');
  return subtle;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

export async function generateX25519KeyPair(): Promise<X25519KeyPair> {
  const subtle = getSubtle();
  const pair = (await subtle.generateKey({ name: 'X25519' }, true, [
    'deriveKey',
    'deriveBits',
  ])) as { publicKey: CryptoKey; privateKey: CryptoKey };
  const publicKey = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const privateKey = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
  return { publicKey, privateKey };
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  return asCryptoBuffer(bytes);
}

export async function importX25519PublicKey(raw: Uint8Array): Promise<CryptoKey> {
  return getSubtle().importKey('raw', toBufferSource(raw), { name: 'X25519' }, true, []);
}

export async function importX25519PrivateKey(pkcs8: Uint8Array): Promise<CryptoKey> {
  return getSubtle().importKey('pkcs8', toBufferSource(pkcs8), { name: 'X25519' }, true, ['deriveKey', 'deriveBits']);
}

export async function exportIdentityKeyPair(pair: X25519KeyPair): Promise<ExportedIdentity> {
  return {
    version: 1,
    publicKey: bytesToBase64Url(pair.publicKey),
    privateKey: bytesToBase64Url(pair.privateKey),
    createdAt: new Date().toISOString(),
  };
}

export async function loadIdentityKeyPair(identity: ExportedIdentity): Promise<X25519KeyPair> {
  return {
    publicKey: base64UrlToBytes(identity.publicKey),
    privateKey: base64UrlToBytes(identity.privateKey),
  };
}

export function fingerprintPublicKey(publicKey: Uint8Array): string {
  return bytesToBase64Url(publicKey).slice(0, 16);
}

export async function deriveSessionRootKey(params: {
  privateKey: Uint8Array;
  peerPublicKey: Uint8Array;
  sessionId: string;
  pairingSecret?: string;
}): Promise<Uint8Array> {
  const subtle = getSubtle();
  const priv = await importX25519PrivateKey(params.privateKey);
  const pub = await importX25519PublicKey(params.peerPublicKey);
  const bits = await subtle.deriveBits({ name: 'X25519', public: pub }, priv, 256);
  const ikm = new Uint8Array(bits.byteLength + (params.pairingSecret ? utf8ToBytes(params.pairingSecret).length : 0));
  ikm.set(new Uint8Array(bits));
  if (params.pairingSecret) {
    ikm.set(utf8ToBytes(params.pairingSecret), bits.byteLength);
  }
  const root = await subtle.importKey('raw', toBufferSource(ikm), 'HKDF', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toBufferSource(utf8ToBytes(params.sessionId)),
      info: toBufferSource(utf8ToBytes('xopc-e2ee-v1')),
    },
    root,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  return new Uint8Array(await subtle.exportKey('raw', key));
}

export async function deriveDirectionKey(rootKey: Uint8Array, direction: 'req' | 'res' | 'stream'): Promise<CryptoKey> {
  const subtle = getSubtle();
  const root = await subtle.importKey('raw', toBufferSource(rootKey), 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toBufferSource(utf8ToBytes('xopc-e2ee-v1')),
      info: toBufferSource(utf8ToBytes(direction)),
    },
    root,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Per relay-stream request — allows concurrent `/api/events` + `/api/agent` streams. */
export async function deriveRelayStreamKey(rootKey: Uint8Array, requestSeq: number): Promise<CryptoKey> {
  const subtle = getSubtle();
  const root = await subtle.importKey('raw', toBufferSource(rootKey), 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toBufferSource(utf8ToBytes('xopc-e2ee-v1')),
      info: toBufferSource(utf8ToBytes(`stream-relay-${requestSeq}`)),
    },
    root,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function hmacSha256(key: Uint8Array, message: string): Promise<string> {
  const subtle = getSubtle();
  const cryptoKey = await subtle.importKey(
    'raw',
    toBufferSource(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await subtle.sign('HMAC', cryptoKey, toBufferSource(utf8ToBytes(message)));
  return bytesToBase64Url(new Uint8Array(sig));
}
