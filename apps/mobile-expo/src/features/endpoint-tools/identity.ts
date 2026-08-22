import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { getRandomValues, randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const IDENTITY_KEY = 'xopc.endpoint-tools.mobile.identity';
const KEYCHAIN_SERVICE = 'xopc.endpoint-tools';
const P256_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export interface MobileEndpointIdentity {
  principalId: string;
  publicKey: string;
  privateKey: Uint8Array;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    result += BASE64URL[a >> 2];
    result += BASE64URL[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) result += BASE64URL[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) result += BASE64URL[c & 63];
  }
  return result;
}

function decodeBase64Url(value: string): Uint8Array {
  const output: number[] = [];
  let bits = 0;
  let buffer = 0;
  for (const char of value) {
    const index = BASE64URL.indexOf(char);
    if (index < 0) throw new Error('Invalid endpoint identity encoding');
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(output);
}

function publicKeyFromPrivate(privateKey: Uint8Array): string {
  const point = p256.getPublicKey(privateKey, false);
  const spki = new Uint8Array(P256_SPKI_PREFIX.length + point.length);
  spki.set(P256_SPKI_PREFIX);
  spki.set(point, P256_SPKI_PREFIX.length);
  return encodeBase64Url(spki);
}

export function getOrCreateMobileEndpointIdentity(): MobileEndpointIdentity {
  const stored = SecureStore.getItem(IDENTITY_KEY, { keychainService: KEYCHAIN_SERVICE });
  if (stored) {
    const value = JSON.parse(stored) as { principalId?: unknown; privateKey?: unknown };
    if (typeof value.principalId !== 'string' || typeof value.privateKey !== 'string') {
      throw new Error('Stored endpoint identity is invalid');
    }
    const privateKey = decodeBase64Url(value.privateKey);
    return { principalId: value.principalId, privateKey, publicKey: publicKeyFromPrivate(privateKey) };
  }

  const seedLength = p256.lengths.seed;
  if (seedLength === undefined) throw new Error('P-256 seed length is unavailable');
  const privateKey = p256.utils.randomSecretKey(getRandomValues(new Uint8Array(seedLength)));
  const principalId = randomUUID();
  SecureStore.setItem(
    IDENTITY_KEY,
    JSON.stringify({ principalId, privateKey: encodeBase64Url(privateKey) }),
    { keychainService: KEYCHAIN_SERVICE },
  );
  return { principalId, privateKey, publicKey: publicKeyFromPrivate(privateKey) };
}

export async function rotateMobileEndpointIdentity(): Promise<MobileEndpointIdentity> {
  await SecureStore.deleteItemAsync(IDENTITY_KEY, { keychainService: KEYCHAIN_SERVICE });
  return getOrCreateMobileEndpointIdentity();
}

export function signMobileEndpointPayload(privateKey: Uint8Array, payload: string): string {
  const digest = sha256(new TextEncoder().encode(payload));
  return encodeBase64Url(p256.sign(digest, privateKey).toCompactRawBytes());
}
