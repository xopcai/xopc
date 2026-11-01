import { createPublicKey, verify } from 'node:crypto';

import { canonicalJson } from '@xopcai/endpoint-tools-protocol';

type Binding = { gatewayId: string; deviceId: string; nonce: string; method: string; target: string };

export function signDesktopAuthorityResponse(body: Record<string, unknown>, binding: Binding, status: number, signPayload: (payload: string) => string) {
  if (Buffer.byteLength(JSON.stringify(body)) > 16384 || 'authorityProof' in body) throw new Error('DESKTOP_AUTHORITY_RESPONSE_INVALID');
  const signedPayload = Buffer.from(JSON.stringify({ purpose: 'desktop-authority-response-v1', ...binding, status, sentAt: Date.now(), body })).toString('base64url');
  return { ...body, authorityProof: { signedPayload, signature: signPayload(signedPayload) } };
}

/** Bind authority acknowledgements to the exact authenticated request, including over loopback relays. */
export function verifyDesktopAuthorityResponse(response: { status: number; body: unknown }, binding: Binding, publicKey: string, now = Date.now()): Record<string, any> {
  try {
    if (!response.body || typeof response.body !== 'object' || Array.isArray(response.body)) throw new Error();
    const { authorityProof, ...body } = response.body as Record<string, any>;
    if (!authorityProof || typeof authorityProof.signedPayload !== 'string' || authorityProof.signedPayload.length > 65536
      || !/^[A-Za-z0-9_-]+$/.test(authorityProof.signedPayload) || typeof authorityProof.signature !== 'string'
      || !/^[A-Za-z0-9_-]{86}$/.test(authorityProof.signature)) throw new Error();
    const key = createPublicKey(publicKey);
    if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(authorityProof.signedPayload), key, Buffer.from(authorityProof.signature, 'base64url'))) throw new Error();
    const payload = JSON.parse(Buffer.from(authorityProof.signedPayload, 'base64url').toString());
    if (payload.purpose !== 'desktop-authority-response-v1' || payload.status !== response.status
      || Object.entries(binding).some(([name, value]) => payload[name] !== value)
      || !Number.isSafeInteger(payload.sentAt) || !Number.isSafeInteger(now) || Math.abs(payload.sentAt - now) > 60000
      || canonicalJson(payload.body) !== canonicalJson(body)) throw new Error();
    return body;
  } catch { throw new Error('DESKTOP_AUTHORITY_RESPONSE_INVALID'); }
}
