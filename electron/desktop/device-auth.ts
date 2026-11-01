import { createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, verify } from 'node:crypto';

import { buildDevicePairingProof, desktopPairingInvitationSchema, desktopExecutionGrantSchema, type DesktopExecutionGrant, type DevicePairingAction } from '@xopcai/gateway-contract';
import { endpointHelloSigningPayload, endpointToolContentSchema, SCREEN_CAPTURE_MAX_BYTES, type EndpointHelloPayload } from '@xopcai/endpoint-tools-protocol';
import { endpointToolRevision, type EndpointToolFile, type EndpointToolUploadGrant } from '@xopcai/endpoint-tools-client';

import { DesktopIdentityStore, type DesktopBinding, type DesktopIdentity } from './device-identity.js';
import { DesktopDeviceFrameSigner } from '../../src/endpoint-tools/desktop-device-frame.js';
import { verifyDesktopAuthorityResponse } from '../../src/endpoint-tools/desktop-authority-response.js';

export type DesktopAuthTransport = (path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown,
  headers?: Record<string, string>, signal?: AbortSignal) => Promise<{ status: number; body: any }>;
const refreshToken = () => `xopc_rt_${randomUUID()}_${randomBytes(32).toString('base64url')}`;
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const signature = (record: DesktopIdentity, payload: string) => sign('sha256', Buffer.from(payload), { key: record.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');

/** Runs only in the main process. The transport never receives or stores an owner credential. */
export class DesktopDeviceAuth {
  private access?: { token: string; expiresAt: number };
  private queue = Promise.resolve();
  constructor(private readonly binding: DesktopBinding, private readonly store: DesktopIdentityStore, private readonly transport: DesktopAuthTransport) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => this.store.serialize(this.binding, work)); this.queue = next.then(() => {}, () => {}); return next;
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
  private async deviceRequest(record: DesktopIdentity, method: 'GET' | 'POST' | 'DELETE', target = '/api/devices/me', body?: unknown,
    extraHeaders: Record<string, string> = {}, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.access || this.access.expiresAt - Date.now() < 30000) await this.refresh(record);
    signal?.throwIfAborted();
    const headers = { 'content-type': 'application/json', ...extraHeaders };
    const timestamp = Date.now(), nonce = randomBytes(24).toString('base64url'), bodyDigest = digest(Buffer.isBuffer(body) ? body : body === undefined ? '' : JSON.stringify(body)), token = this.access!.token;
    const payload = ['xopc-request-v1', this.binding.gatewayId, digest(token), method, target, bodyDigest,
      headers['content-type'], '', '', extraHeaders['x-endpoint-id'] ?? '', extraHeaders['x-endpoint-upload-token'] ?? '', String(timestamp), nonce].join('\n');
    const response = await this.transport(target, method, body, { Authorization: `Bearer ${token}`, ...headers,
      'X-Xopc-Proof': `${timestamp}.${nonce}.${bodyDigest}.${signature(record, payload)}` }, signal);
    if (target === '/api/desktop-host/execution' && response.status >= 200 && response.status < 300) {
      return { status: response.status, body: verifyDesktopAuthorityResponse(response,
        { gatewayId: this.binding.gatewayId, deviceId: record.deviceId!, nonce, method, target }, this.binding.publicKey) };
    }
    return response;
  }
  private async enrolled(): Promise<DesktopIdentity> {
    const record = await this.store.load(this.binding);
    if (record?.phase !== 'enrolled' || !record.deviceId || !record.refreshToken) throw new Error('DESKTOP_REENROLLMENT_REQUIRED');
    return record;
  }
  endpointIdentity(): Promise<{ deviceId: string; displayName: string; publicKey: string }> {
    return this.serial(async () => {
      const record = await this.enrolled();
      return { deviceId: record.deviceId!, displayName: record.displayName,
        publicKey: createPublicKey(record.privateKey).export({ type: 'spki', format: 'der' }).toString('base64url') };
    });
  }
  endpointRequest(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown, expectedDeviceId?: string, signal?: AbortSignal): Promise<any> {
    return this.serial(async () => {
      signal?.throwIfAborted();
      if (!(method === 'POST' && ['/api/endpoint-tools/principals', '/api/realtime/tickets'].includes(path)
        || path === '/api/desktop-host/execution' && ['GET', 'POST', 'DELETE'].includes(method)
        || method === 'GET' && ['/api/endpoint-tools/compatibility', '/api/desktop-host/status', '/api/desktop-host/compatibility'].includes(path)
        || method === 'DELETE' && ['/api/desktop-host/observation', '/api/desktop-host/screen'].includes(path))) throw new Error('DESKTOP_AUTH_ROUTE_DENIED');
      const record = await this.enrolled();
      if (expectedDeviceId && record.deviceId !== expectedDeviceId) throw new Error('DESKTOP_DEVICE_IDENTITY_MISMATCH');
      const response = await this.deviceRequest(record, method, path, body, {}, signal);
      if (response.status === 401) { this.access = undefined; record.phase = 'revoked'; await this.store.save(record); throw new Error('DESKTOP_AUTH_REVOKED'); }
      if (response.status === 403) throw new Error('DESKTOP_OBSERVATION_DENIED');
      if (![200, 201].includes(response.status)) throw new Error('DESKTOP_AUTH_UNAVAILABLE');
      return response.body.payload;
    });
  }
  signEndpointHello(hello: EndpointHelloPayload): Promise<EndpointHelloPayload> {
    return this.serial(async () => {
      const record = await this.enrolled();
      if (hello.execution || hello.principalId !== record.deviceId || hello.kind !== 'desktop' || hello.platform !== 'desktop'
        || hello.tools.length !== 1 || !['desktop.device.get_state', 'desktop.screen.capture'].includes(hello.tools[0]?.name)) throw new Error('DESKTOP_OBSERVATION_DENIED');
      return { ...hello, signature: signature(record, endpointHelloSigningPayload(hello)) };
    });
  }
  prepareSignedEndpoint(hello: EndpointHelloPayload, clientId: string): Promise<{ hello: EndpointHelloPayload; signer: DesktopDeviceFrameSigner }> {
    return this.serial(async () => {
      const record = await this.enrolled();
      if (hello.execution || hello.principalId !== record.deviceId || hello.kind !== 'desktop' || hello.platform !== 'desktop'
        || hello.tools.length !== 1 || !['desktop.device.get_state', 'desktop.screen.capture'].includes(hello.tools[0]?.name)
        || hello.deviceFrames?.version !== 1) throw new Error('DESKTOP_OBSERVATION_DENIED');
      const signer = new DesktopDeviceFrameSigner({ gatewayId: this.binding.gatewayId, deviceId: record.deviceId!, clientId,
        connectionInstanceId: hello.connectionInstanceId, authorizationRevision: hello.deviceFrames.authorizationRevision }, record.privateKey);
      try { return { hello: { ...hello, signature: signature(record, endpointHelloSigningPayload(hello)) }, signer }; }
      catch (error) { signer.close(); throw error; }
    });
  }
  /** The main-process caller must supply its locally approved, immutable grant, never renderer input. */
  prepareExecutionEndpoint(hello: EndpointHelloPayload, clientId: string, approved: DesktopExecutionGrant): Promise<{ hello: EndpointHelloPayload; signer: DesktopDeviceFrameSigner }> {
    const grant = desktopExecutionGrantSchema.parse(JSON.parse(JSON.stringify(approved)));
    return this.serial(async () => {
      const record = await this.enrolled(), execution = hello.execution;
      if (hello.principalId !== record.deviceId || hello.kind !== 'desktop' || hello.platform !== 'desktop'
        || hello.deviceFrames?.version !== 1 || !execution || execution.version !== 1
        || execution.authorizationRevision !== hello.deviceFrames.authorizationRevision || execution.grantId !== grant.grantId
        || execution.expiresAt !== grant.expiresAt || execution.expiresAt <= Date.now()
        || hello.tools.length !== Object.keys(grant.toolRevisions).length || new Set(hello.tools.map(tool => tool.name)).size !== hello.tools.length
        || hello.tools.some(tool => grant.toolRevisions[tool.name as keyof typeof grant.toolRevisions] !== endpointToolRevision(tool))) throw new Error('DESKTOP_EXECUTION_DENIED');
      const signer = new DesktopDeviceFrameSigner({ gatewayId: this.binding.gatewayId, deviceId: record.deviceId!, clientId,
        connectionInstanceId: hello.connectionInstanceId, authorizationRevision: execution.authorizationRevision }, record.privateKey);
      try { return { hello: { ...hello, signature: signature(record, endpointHelloSigningPayload(hello)) }, signer }; }
      catch (error) { signer.close(); throw error; }
    });
  }
  uploadScreenshot(options: { endpointId: string; deviceId: string; invocationId: string; grant: EndpointToolUploadGrant; file: EndpointToolFile; signal: AbortSignal }) {
    return this.serial(async () => {
      const { signal, grant, file, invocationId, endpointId } = options;
      signal.throwIfAborted();
      if (!grant || grant.path !== `/api/endpoint-tools/invocations/${invocationId}/files` || !/^[0-9a-f-]{36}$/.test(invocationId)
        || !endpointId.startsWith(options.deviceId + ':') || grant.expiresAt <= Date.now() || file.bytes.byteLength > Math.min(grant.maxBytes, SCREEN_CAPTURE_MAX_BYTES)
        || file.name !== 'screenshot.png' || file.mimeType !== 'image/png' || !Buffer.from(file.bytes.subarray(0, 8)).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('DESKTOP_SCREEN_UPLOAD_DENIED');
      const record = await this.enrolled();
      if (record.deviceId !== options.deviceId) throw new Error('DESKTOP_DEVICE_IDENTITY_MISMATCH');
      const bytes = Buffer.from(file.bytes);
      try {
        const response = await this.deviceRequest(record, 'POST', `${grant.path}?name=screenshot.png`, bytes,
          { 'content-type': 'image/png', 'content-length': String(bytes.length), 'x-endpoint-id': endpointId, 'x-endpoint-upload-token': grant.token }, signal);
        if (response.status === 401) { this.access = undefined; record.phase = 'revoked'; await this.store.save(record); throw new Error('DESKTOP_AUTH_REVOKED'); }
        if (response.status === 403) throw new Error('DESKTOP_OBSERVATION_DENIED');
        signal.throwIfAborted();
        const parsed = endpointToolContentSchema.safeParse(response.body?.payload);
        if (response.status !== 201 || !parsed.success || parsed.data.type !== 'file' || parsed.data.mimeType !== 'image/png'
          || parsed.data.name !== file.name || parsed.data.size !== bytes.length || parsed.data.sha256 !== digest(bytes)) throw new Error('DESKTOP_SCREEN_UPLOAD_FAILED');
        return parsed.data;
      } finally { bytes.fill(0); }
    });
  }
  connectionProof(ticket: string): Promise<string> {
    return this.serial(async () => {
      const record = await this.enrolled(), timestamp = Date.now(), nonce = randomBytes(24).toString('base64url'), bodyDigest = digest('');
      const payload = ['xopc-request-v1', this.binding.gatewayId, digest(ticket), 'CONNECT', '/api/realtime/v1/ws', bodyDigest,
        '', '', '', '', '', String(timestamp), nonce].join('\n');
      return `${timestamp}.${nonce}.${bodyDigest}.${signature(record, payload)}`;
    });
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
