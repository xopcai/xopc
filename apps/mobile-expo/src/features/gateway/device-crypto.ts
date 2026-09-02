import { ed25519 } from '@noble/curves/ed25519';
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { getRandomValues } from 'expo-crypto';

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function encodeBase64Url(bytes: Uint8Array): string {
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

export function decodeBase64Url(value: string): Uint8Array {
  const output: number[] = [];
  let bits = 0;
  let buffer = 0;
  for (const char of value) {
    const index = BASE64URL.indexOf(char);
    if (index < 0) throw new Error('Invalid base64url value');
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(output);
}

export function decodeBase64UrlJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

export function generateDevicePrivateKey(): Uint8Array {
  const seedLength = p256.lengths.seed;
  if (seedLength === undefined) throw new Error('P-256 seed length is unavailable');
  return p256.utils.randomSecretKey(getRandomValues(new Uint8Array(seedLength)));
}

export function devicePublicKeyJwk(privateKey: Uint8Array): {
  kty: 'EC'; crv: 'P-256'; x: string; y: string;
} {
  const publicKey = p256.getPublicKey(privateKey, false);
  return {
    kty: 'EC', crv: 'P-256',
    x: encodeBase64Url(publicKey.slice(1, 33)),
    y: encodeBase64Url(publicKey.slice(33, 65)),
  };
}

export function signDevicePayload(privateKey: Uint8Array, payload: string): string {
  return encodeBase64Url(p256.sign(
    sha256(new TextEncoder().encode(payload)),
    privateKey,
  ).toCompactRawBytes());
}

export function verifyGatewayPayload(
  gatewayPublicKey: string,
  payload: string,
  signature: string,
): boolean {
  try {
    return ed25519.verify(
      decodeBase64Url(signature),
      new TextEncoder().encode(payload),
      decodeBase64Url(gatewayPublicKey),
    );
  } catch {
    return false;
  }
}

export function randomNonce(byteLength = 24): string {
  return encodeBase64Url(getRandomValues(new Uint8Array(byteLength)));
}
