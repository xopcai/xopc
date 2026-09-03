import crypto from 'node:crypto';

export function parseP256PublicKey(encoded: string): crypto.KeyObject {
  const key = crypto.createPublicKey({
    key: Buffer.from(encoded, 'base64url'),
    format: 'der',
    type: 'spki',
  });
  if (
    key.asymmetricKeyType !== 'ec'
    || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
  ) {
    throw new Error('Public key must be ECDSA P-256');
  }
  return key;
}

export function verifyP256Signature(
  publicKey: string,
  payload: string,
  signature: string,
): boolean {
  return crypto.verify(
    'sha256',
    Buffer.from(payload, 'utf8'),
    { key: parseP256PublicKey(publicKey), dsaEncoding: 'ieee-p1363' },
    Buffer.from(signature, 'base64url'),
  );
}
