import crypto from 'node:crypto';

export type BrowserEnrollmentPublicKeyJwk = {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
};

export function parseBrowserEnrollmentPublicKeyJwk(value: unknown): BrowserEnrollmentPublicKeyJwk {
  if (!value || typeof value !== 'object') throw new Error('Browser enrollment public key is missing');
  const key = value as Record<string, unknown>;
  if (key.kty !== 'EC' || key.crv !== 'P-256'
    || typeof key.x !== 'string' || !key.x
    || typeof key.y !== 'string' || !key.y) {
    throw new Error('Browser enrollment public key is invalid');
  }
  return { kty: 'EC', crv: 'P-256', x: key.x, y: key.y };
}

export function browserEnrollmentPublicKeyThumbprint(value: unknown): string {
  const key = parseBrowserEnrollmentPublicKeyJwk(value);
  const canonical = JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y });
  return crypto.createHash('sha256').update(canonical).digest('base64url');
}
