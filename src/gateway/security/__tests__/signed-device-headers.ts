import { randomBytes, sign, type KeyObject } from 'node:crypto';
import { getOrCreateGatewayIdentity } from '../../../storage/sqlite/gateway-identity-repository.js';
import { proofDigest, requestProofMessage } from '../device-request-proof.js';

export function signedDeviceHeaders(key: KeyObject, token: string, target: string, method = 'GET', body = '', headers: Record<string, string> = {}): Record<string, string> {
  const proof = { timestamp: Date.now(), nonce: randomBytes(24).toString('base64url'), digest: proofDigest(body) };
  const message = requestProofMessage({ gatewayId: getOrCreateGatewayIdentity().id, credential: token, method, target,
    headers: name => Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1], proof });
  const signature = sign('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const currentHeaders = Object.fromEntries(Object.entries(headers).filter(([name]) => !['authorization', 'x-xopc-proof'].includes(name.toLowerCase())));
  return { ...currentHeaders, Authorization: `Bearer ${token}`, 'X-Xopc-Proof': `${proof.timestamp}.${proof.nonce}.${proof.digest}.${signature}` };
}
