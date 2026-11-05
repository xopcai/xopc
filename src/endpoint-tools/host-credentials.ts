import { createHash, randomBytes, randomUUID, sign, verify } from 'node:crypto';

import { buildRefreshProofMessage, deviceRequestProofMessage } from '@xopcai/gateway-contract';
import { z } from 'zod';

const tokenPairSchema = z.strictObject({ accessToken: z.string().min(1).max(256), accessTokenExpiresAt: z.number().int().positive(),
  refreshToken: z.string().min(1).max(256), refreshTokenExpiresAt: z.number().int().positive() });
const pendingSchema = z.strictObject({ timestamp: z.number(), nonce: z.string(), requestId: z.uuid(), nextRefreshToken: z.string(), requestProofVersion: z.literal(1) });
export const hostCredentialSchema = z.strictObject({ gatewayUrl: z.url(), gatewayId: z.uuid(), gatewayPublicKey: z.string().max(1000),
  tokens: tokenPairSchema, pendingRefresh: pendingSchema.optional() });
export interface DeviceHostIdentity { principalId: string; publicKey: string; privateKey: string; credential?: z.infer<typeof hostCredentialSchema> }
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Owner bootstrap is used once; subsequent HTTP/WS requests use only signed host-scoped credentials. */
export async function createDeviceHostCredentials(options: {
  origin: URL; identity: DeviceHostIdentity; bootstrapToken?: string; displayName: string; signal: AbortSignal;
  persist(): Promise<void>;
}) {
  const { origin, identity, signal } = options;
  const fetchJson = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(new URL(path, origin), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    if (!response.ok) throw new Error(`Device credential request failed: HTTP ${response.status}`);
    return response.json() as Promise<any>;
  };
  if (identity.credential) {
    identity.credential = hostCredentialSchema.parse(identity.credential);
    if (identity.credential.gatewayUrl !== origin.origin) throw new Error('Device identity belongs to another Gateway origin; use a separate identity file');
  } else {
    if (!options.bootstrapToken) throw new Error('First device host enrollment requires an owner bootstrap credential');
    const response = await fetchJson('/api/endpoint-tools/hosts/enrollment', { principalId: identity.principalId, publicKey: identity.publicKey,
      displayName: options.displayName, platform: process.platform }, { Authorization: `Bearer ${options.bootstrapToken}` });
    if (response.ok !== true) throw new Error('Device host enrollment was rejected');
    identity.credential = hostCredentialSchema.parse({ gatewayUrl: origin.origin, ...response.payload });
    await options.persist();
  }
  let refresh: Promise<void> | undefined;
  const ensureAccess = async () => {
    const credential = identity.credential!;
    if (!credential.pendingRefresh && credential.tokens.accessTokenExpiresAt > Date.now() + 60_000) return;
    refresh ??= (async () => {
      credential.pendingRefresh ??= { timestamp: Date.now(), nonce: randomBytes(24).toString('base64url'), requestId: randomUUID(),
        nextRefreshToken: `xopc_rt_${randomUUID()}_${randomBytes(32).toString('base64url')}`, requestProofVersion: 1 };
      credential.pendingRefresh.timestamp = Date.now();
      credential.pendingRefresh.nonce = randomBytes(24).toString('base64url');
      // Persist the rotation identity before sending. Proof freshness may change;
      // requestId and nextRefreshToken stay fixed when recovering a lost reply.
      await options.persist();
      const pending = credential.pendingRefresh;
      const match = /^xopc_rt_([0-9a-f-]{36})_/i.exec(credential.tokens.refreshToken);
      if (!match) throw new Error('Invalid device refresh credential');
      const message = buildRefreshProofMessage({ ...pending, credentialId: match[1] });
      const response = await fetchJson('/api/device-auth/refresh', { ...pending, refreshToken: credential.tokens.refreshToken,
        signature: sign('sha256', Buffer.from(message), { key: identity.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') });
      if (response.ok !== true || typeof response.signedPayload !== 'string' || response.signedPayload.length > 8192
        || typeof response.signature !== 'string' || !verify(null, Buffer.from(response.signedPayload), credential.gatewayPublicKey, Buffer.from(response.signature, 'base64url'))) throw new Error('Invalid Gateway credential rotation signature');
      const payload = JSON.parse(Buffer.from(response.signedPayload, 'base64url').toString());
      if (payload.purpose !== 'device-refresh-v3' || payload.gatewayId !== credential.gatewayId || payload.requestId !== pending.requestId
        || payload.nonce !== pending.nonce || payload.requestProofVersion !== 1 || payload.expiresAt <= Date.now()
        || payload.expiresAt > Date.now() + 60_000) throw new Error('Gateway credential rotation response changed');
      const tokens = tokenPairSchema.parse(payload.tokens);
      if (tokens.refreshToken !== pending.nextRefreshToken) throw new Error('Gateway refresh credential differs from the recorded rotation');
      credential.tokens = tokens; delete credential.pendingRefresh; await options.persist();
    })().finally(() => { refresh = undefined; });
    await refresh;
  };
  const proofHeaders = (credential: string, method: string, target: string, body: string | Uint8Array, headers: Record<string, string>) => {
    const proof = { timestamp: Date.now(), nonce: randomBytes(24).toString('base64url'), digest: digest(body) };
    const message = deviceRequestProofMessage({ gatewayId: identity.credential!.gatewayId, credentialDigest: digest(credential), method, target,
      headers: name => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1], proof });
    const signature = sign('sha256', Buffer.from(message), { key: identity.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return { ...headers, 'X-Xopc-Proof': `${proof.timestamp}.${proof.nonce}.${proof.digest}.${signature}` };
  };
  return {
    async headers(method: string, target: string, body: string | Uint8Array = '', headers: Record<string, string> = {}) {
      await ensureAccess(); const token = identity.credential!.tokens.accessToken;
      return { ...proofHeaders(token, method, target, body, headers), Authorization: `Bearer ${token}` };
    },
    connectionHeaders(ticket: string) { return proofHeaders(ticket, 'CONNECT', '/api/realtime/v1/ws', '', {}); },
  };
}
