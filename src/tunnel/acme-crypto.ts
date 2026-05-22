import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  generateKeyPairSync,
  X509Certificate,
} from 'node:crypto';

export type EcPublicJwk = {
  kty: 'EC';
  crv: string;
  x: string;
  y: string;
};

export function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

export function ensureEcAccountKeyPem(existingPem?: string): string {
  if (existingPem?.trim()) return existingPem;
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}

export function exportJwkFromPrivateKeyPem(privateKeyPem: string): EcPublicJwk {
  const jwk = createPublicKey(createPrivateKey(privateKeyPem)).export({ format: 'jwk' }) as EcPublicJwk;
  if (jwk.kty !== 'EC') throw new Error('Expected EC account key');
  return jwk;
}

/** RFC 7638 JWK thumbprint for ACME account key. */
export function jwkThumbprint(jwk: EcPublicJwk): string {
  const ordered = {
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  };
  return base64url(createHash('sha256').update(JSON.stringify(ordered)).digest());
}

export type AcmeJwsParts = {
  protected: string;
  payload: string;
  signature: string;
};

export function signAcmeJws(params: {
  privateKeyPem: string;
  url: string;
  nonce: string;
  payload: unknown;
  jwk?: EcPublicJwk;
  kid?: string;
}): AcmeJwsParts {
  const payloadStr = params.payload === null ? '' : JSON.stringify(params.payload);
  const headerObj: Record<string, unknown> = {
    alg: 'ES256',
    url: params.url,
    nonce: params.nonce,
  };
  if (params.kid) headerObj.kid = params.kid;
  else if (params.jwk) headerObj.jwk = params.jwk;

  const protectedB64 = base64url(JSON.stringify(headerObj));
  const payloadB64 = payloadStr === '' ? '' : base64url(payloadStr);
  const signingInput = payloadB64 === '' ? `${protectedB64}.` : `${protectedB64}.${payloadB64}`;

  const key = createPrivateKey(params.privateKeyPem);
  const signature = createSign('SHA256')
    .update(signingInput)
    .sign({ key, dsaEncoding: 'ieee-p1363' });

  return {
    protected: protectedB64,
    payload: payloadB64,
    signature: base64url(signature),
  };
}

export function getCertExpiryFromPem(certPem: string): Date {
  const cert = new X509Certificate(certPem);
  return new Date(cert.validTo);
}
