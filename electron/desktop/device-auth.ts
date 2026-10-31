import { createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, verify } from 'node:crypto';

import { buildDevicePairingProof, desktopPairingInvitationSchema, type DevicePairingAction } from '@xopcai/gateway-contract';

import { DesktopIdentityStore, type DesktopBinding, type DesktopIdentity } from './device-identity.js';

export type DesktopAuthTransport = (path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown,
  headers?: Record<string, string>) => Promise<{ status: number; body: any }>;
const refreshToken = () => `xopc_rt_${randomUUID()}_${randomBytes(32).toString('base64url')}`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const signature = (record: DesktopIdentity, payload: string) => sign('sha256', Buffer.from(payload), { key: record.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');

/** Runs only in the main process. The transport never receives or stores an owner credential. */
export class DesktopDeviceAuth {
  private access?: { token: string; expiresAt: number };
  private queue = Promise.resolve();
  constructor(private readonly binding: DesktopBinding, private readonly store: DesktopIdentityStore, private readonly transport: DesktopAuthTransport) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work); this.queue = next.then(() => {}, () => {}); return next;
  }
  private signedResponse(response: { status: number; body: any }, nonce: string): any {
    if (response.status !== 200) throw new Error(response.status === 401 ? 'DESKTOP_AUTH_REVOKED' : 'DESKTOP_AUTH_UNAVAILABLE');
    try {
      const { signedPayload, signature } = response.body;
      if (typeof signedPayload !== 'string' || signedPayload.length > 65536 || typeof signature !== 'string'
        || !verify(null, Buffer.from(signedPayload), createPublicKey(this.binding.publicKey), Buffer.from(signature, 'base64url'))) throw new Error();
      const body = JSON.parse(Buffer.from(signedPayload, 'base64url').toString());
      if ((body.gateway?.id ?? body.gatewayId) !== this.binding.gatewayId || body.nonce !== nonce
        || Math.abs(Date.now() - (body.issuedAt ?? body.expiresAt - 30000)) > 30000) throw new Error();
      return body;
    } catch { throw new Error('DESKTOP_AUTH_RESPONSE_INVALID'); }
  }
  private async pair(record: DesktopIdentity, action: DevicePairingAction, extra: Record<string, unknown> = {}) {
    const body = { gatewayId: this.binding.gatewayId, requestId: record.requestId, pairingToken: record.pairingToken,
      ...extra, timestamp: Date.now(), nonce: randomBytes(24).toString('base64url') };
    return this.signedResponse(await this.transport(action === 'request' ? '/api/device-pairing/requests'
      : `/api/device-pairing/requests/${record.requestId}/${action}`, 'POST', { ...body, signature: signature(record, buildDevicePairingProof(action, body)) }), body.nonce);
  }
  enroll(options: { displayName: string; consent(binding: DesktopBinding): Promise<boolean>;
    setup(): Promise<unknown>; approve(requestId: string, revision: number): Promise<void>;
    confirmRevoked?(identity: Pick<DesktopIdentity, 'deviceId' | 'revocationConfirmed'> & { setupId: string }): Promise<boolean> }): Promise<{ deviceId: string }> {
    return this.serial(async () => {
      let record = await this.store.load(this.binding);
      if (record?.phase === 'revoked') {
        if (!options.confirmRevoked || !await options.confirmRevoked({ deviceId: record.deviceId, revocationConfirmed: record.revocationConfirmed,
          setupId: record.pairingToken.slice(10, 46) })) throw new Error('DESKTOP_REENROLLMENT_REQUIRED');
        this.access = undefined;
        record = undefined;
      }
      if (record?.phase === 'enrolled') return { deviceId: record.deviceId! };
      if (!await options.consent(this.binding)) throw new Error('DESKTOP_LOCAL_CONSENT_DENIED');
      if (!record) {
        const invitation = desktopPairingInvitationSchema.parse(await options.setup());
        const key = createPublicKey(this.binding.publicKey).export({ format: 'jwk' });
        if (invitation.gatewayId !== this.binding.gatewayId || invitation.gatewayPublicKey !== key.x || invitation.expiresAt <= Date.now()) throw new Error('DESKTOP_PAIRING_IDENTITY_MISMATCH');
        const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        record = { version: 1, binding: this.binding, phase: 'pending', privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
          displayName: options.displayName, requestId: randomUUID(), completionKey: randomUUID(), pairingToken: invitation.pairingToken, initialRefreshToken: refreshToken() };
        await this.store.save(record);
      }
      const device = { displayName: record.displayName, platform: 'desktop', publicKeyJwk: createPublicKey(record.privateKey).export({ format: 'jwk' }) };
      const status = (await this.pair(record, 'request', { device })).request;
      if (status.requestId !== record.requestId || status.platform !== 'desktop') throw new Error('DESKTOP_PAIRING_IDENTITY_MISMATCH');
      if (status.status === 'pending') await options.approve(record.requestId, status.revision);
      const complete = await this.pair(record, 'complete', { idempotencyKey: record.completionKey, initialRefreshToken: record.initialRefreshToken });
      if (complete.request?.requestId !== record.requestId || complete.request.status !== 'completed'
        || !/^[0-9a-f-]{36}$/.test(complete.request.deviceId) || JSON.stringify(complete.scopes) !== JSON.stringify(['gateway.status', 'device.self'])) throw new Error('DESKTOP_PAIRING_GRANTS_INVALID');
      record = { ...record, phase: 'enrolled', deviceId: complete.request.deviceId, refreshToken: record.initialRefreshToken };
      await this.store.save(record); return { deviceId: record.deviceId! };
    });
  }
  private async refresh(record: DesktopIdentity): Promise<void> {
    if (!record.rotation) { record.rotation = { requestId: randomUUID(), nextRefreshToken: refreshToken() }; await this.store.save(record); }
    const { requestId, nextRefreshToken } = record.rotation, timestamp = Date.now(), nonce = randomBytes(24).toString('base64url');
    const credentialId = record.refreshToken!.slice(8).split('_')[0];
    const payload = `xopc-device-refresh-v2\n${credentialId}\n${timestamp}\n${nonce}\n${requestId}\n${nextRefreshToken}\nrequest-proof:1`;
    const response = await this.transport('/api/device-auth/refresh', 'POST', { refreshToken: record.refreshToken, nextRefreshToken, requestId, timestamp, nonce, requestProofVersion: 1, signature: signature(record, payload) });
    if (response.status === 401) { record.phase = 'revoked'; await this.store.save(record); throw new Error('DESKTOP_AUTH_REVOKED'); }
    const body = this.signedResponse(response, nonce);
    if (body.purpose !== 'device-refresh-v3' || body.requestId !== requestId || body.requestProofVersion !== 1 || body.expiresAt <= Date.now()
      || body.tokens?.refreshToken !== nextRefreshToken || !/^xopc_at_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/.test(body.tokens.accessToken)
      || !Number.isSafeInteger(body.tokens.accessTokenExpiresAt) || body.tokens.accessTokenExpiresAt <= Date.now()) throw new Error('DESKTOP_REFRESH_RESPONSE_INVALID');
    record.refreshToken = nextRefreshToken; delete record.rotation; await this.store.save(record);
    this.access = { token: body.tokens.accessToken, expiresAt: body.tokens.accessTokenExpiresAt };
  }
  private async deviceRequest(record: DesktopIdentity, method: 'GET' | 'DELETE') {
    if (!this.access || this.access.expiresAt - Date.now() < 30000) await this.refresh(record);
    const timestamp = Date.now(), nonce = randomBytes(24).toString('base64url'), bodyDigest = digest(''), token = this.access!.token;
    const payload = ['xopc-request-v1', this.binding.gatewayId, digest(token), method, '/api/devices/me', bodyDigest,
      'application/json', '', '', '', '', String(timestamp), nonce].join('\n');
    return this.transport('/api/devices/me', method, undefined, { Authorization: `Bearer ${token}`, 'content-type': 'application/json',
      'X-Xopc-Proof': `${timestamp}.${nonce}.${bodyDigest}.${signature(record, payload)}` });
  }
  readSelf(): Promise<{ deviceId: string; platform: 'desktop' }> {
    return this.serial(async () => {
      const record = await this.store.load(this.binding);
      if (!record) throw new Error('DESKTOP_NOT_ENROLLED');
      if (record.phase === 'pending') throw new Error('DESKTOP_ENROLLMENT_PENDING');
      if (record?.phase !== 'enrolled' || !record.deviceId || !record.refreshToken) throw new Error('DESKTOP_REENROLLMENT_REQUIRED');
      const response = await this.deviceRequest(record, 'GET');
      if (response.status === 401) { this.access = undefined; record.phase = 'revoked'; await this.store.save(record); throw new Error('DESKTOP_AUTH_REVOKED'); }
      if (response.status !== 200) throw new Error('DESKTOP_AUTH_UNAVAILABLE');
      if (response.body.device?.id !== record.deviceId || response.body.device.platform !== 'desktop') throw new Error('DESKTOP_DEVICE_IDENTITY_MISMATCH');
      return { deviceId: record.deviceId, platform: 'desktop' };
    });
  }
  disable(localOnly = false): Promise<{ localDisabled: true; remoteRevocationConfirmed: boolean; hadIdentity: boolean }> {
    return this.serial(async () => {
      const record = await this.store.load(this.binding);
      if (!record) return { localDisabled: true, remoteRevocationConfirmed: false, hadIdentity: false };
      record.phase = 'revoked'; await this.store.save(record);
      let confirmed = record.revocationConfirmed === true;
      try {
        if (!confirmed && !localOnly) {
          if (!record.deviceId) {
            const status = (await this.pair(record, 'status')).request;
            if (status?.requestId === record.requestId && status.status === 'completed' && /^[0-9a-f-]{36}$/.test(status.deviceId)) {
              record.deviceId = status.deviceId; record.refreshToken = record.initialRefreshToken;
              await this.store.save(record);
            }
          }
          if (record.deviceId && record.refreshToken) {
            const response = await this.deviceRequest(record, 'DELETE');
            confirmed = response.status === 200 && response.body.ok === true && response.body.revoked === true;
          } else confirmed = (await this.pair(record, 'cancel')).request?.status === 'cancelled';
        }
      } catch { /* Local disable remains effective when remote revocation cannot be confirmed. */ }
      finally { this.access = undefined; }
      if (confirmed) { record.revocationConfirmed = true; await this.store.save(record); }
      return { localDisabled: true, remoteRevocationConfirmed: confirmed, hadIdentity: true };
    });
  }

}
