import { XopcDeviceCrypto } from './deviceCrypto';
import { XopcSecureStore, fromUtf8, utf8 } from './secureStore';
import { XopcTransport, XopcHttpError } from './transport';
import { XopcTransferAuth } from '../model/files';
import { decodeBase64Url, encodeBase64Url, invitationPayload, pairingProof, parseInvitationJson, validateRoutes } from '../common/protocol';
import {
  XopcInvitation, XopcPairingBody, XopcPairingJournal, XopcPairingResponse, XopcProfile,
  XopcSignedEnvelope, XopcProbeBody, XopcProbeProof, XopcRefreshAttempt, XopcRefreshBody,
  XopcRefreshProof, XopcNonceBody, XopcIdentityProof, XopcTokens
} from '../model/gateway';

export class XopcGatewaySession {
  private store: XopcSecureStore;
  private crypto: XopcDeviceCrypto;
  private transport: XopcTransport;
  private profile?: XopcProfile;
  private tokens?: XopcTokens;
  private refreshTask?: Promise<string>;
  private pairingTask?: Promise<XopcProfile>;
  private generation: number = 0;
  private verifiedUntil: Map<string, number> = new Map<string, number>();
  private foreground: boolean = true;

  constructor(store: XopcSecureStore = new XopcSecureStore(), crypto: XopcDeviceCrypto = new XopcDeviceCrypto(),
    transport: XopcTransport = new XopcTransport()) {
    this.store = store; this.crypto = crypto; this.transport = transport;
  }

  setForeground(value: boolean): void { this.foreground = value; }

  async restore(progress: (code: string) => void = (_code: string): void => {}): Promise<XopcProfile | undefined> {
    const generation = this.generation;
    const pending = await this.store.read('pairing');
    this.assertGeneration(generation);
    if (pending) {
      const journal = JSON.parse(pending) as XopcPairingJournal;
      return this.pair('https://link.xopc.ai/connect#p=' + encodeBase64Url(utf8(JSON.stringify(journal.invitation))), progress);
    }
    const saved = await this.store.read('profile');
    this.assertGeneration(generation);
    if (!saved) return undefined;
    const profile = JSON.parse(saved) as XopcProfile;
    profile.routes = validateRoutes(profile.routes);
    if (!profile.deviceId || !profile.gatewayId || !profile.gatewayPublicKey) throw new Error('INVALID_PROFILE');
    this.profile = profile;
    return profile;
  }

  currentProfile(): XopcProfile | undefined { return this.profile; }

  async pair(link: string, progress: (code: string) => void): Promise<XopcProfile> {
    if (this.pairingTask) return this.pairingTask;
    const generation = ++this.generation;
    this.pairingTask = this.pairInternal(link, progress, generation);
    try { return await this.pairingTask; } finally { this.pairingTask = undefined; }
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.generation) throw new Error('OPERATION_CANCELLED');
  }

  private async pairInternal(link: string, progress: (code: string) => void, generation: number): Promise<XopcProfile> {
    const saved = await this.store.read('pairing');
    const json = fromUtf8(decodeBase64Url(invitationPayload(link)));
    // A completed request can be recovered after the invitation expiry, using only its durable journal.
    const invitation = parseInvitationJson(json, saved ? 0 : Date.now());
    let journal: XopcPairingJournal;
    if (saved) {
      journal = JSON.parse(saved) as XopcPairingJournal;
      if (JSON.stringify(journal.invitation) !== JSON.stringify(invitation)) throw new Error('PAIRING_ALREADY_PENDING');
    } else {
      const origin = await this.probe(invitation);
      this.assertGeneration(generation);
      journal = {
        invitation, origin, requestId: this.crypto.uuid(), idempotencyKey: this.crypto.uuid(),
        initialRefreshToken: await this.crypto.refreshToken(),
        device: { displayName: 'HarmonyOS', platform: 'harmonyos', publicKeyJwk: await this.crypto.publicKey() }
      };
      await this.store.write('pairing', JSON.stringify(journal));
    }
    this.assertGeneration(generation);
    let result = await this.pairingRequest(journal, 'request');
    while (result.request.status === 'pending') {
      progress(result.request.confirmationCode);
      await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 1500); });
      this.assertGeneration(generation);
      if (!this.foreground) continue;
      if (Date.now() >= result.request.expiresAt) throw new Error('PAIRING_EXPIRED');
      result = await this.pairingRequest(journal, 'status');
    }
    if (result.request.status !== 'approved' && result.request.status !== 'completed') {
      await this.store.remove('pairing');
      throw new Error('PAIRING_' + result.request.status.toUpperCase());
    }
    this.assertGeneration(generation);
    result = await this.pairingRequest(journal, 'complete');
    if (!result.request.deviceId || !result.routes || result.request.status !== 'completed') throw new Error('INVALID_PAIRING_RESPONSE');
    const routes = validateRoutes(result.routes);
    const profile: XopcProfile = {
      gatewayId: invitation.gatewayId, name: result.gateway.name,
      gatewayPublicKey: invitation.gatewayPublicKey, deviceId: result.request.deviceId,
      routes, activeRouteId: routes.find((route): boolean => route.url === journal.origin)?.id ?? routes[0].id
    };
    this.assertGeneration(generation);
    // Both writes are repeatable after a crash; don't rotate until the pairing journal is removed.
    await this.store.write('refresh', journal.initialRefreshToken);
    await this.store.write('profile', JSON.stringify(profile));
    await this.store.remove('pairing');
    this.assertGeneration(generation);
    this.profile = profile;
    await this.accessToken();
    this.assertGeneration(generation);
    return profile;
  }

  private async probe(invitation: XopcInvitation): Promise<string> {
    const pairingId = invitation.pairingToken.slice(10).split('_')[0];
    const body: XopcProbeBody = { pairingId };
    for (const route of invitation.routes) {
      try {
        const envelope = JSON.parse(await this.transport.request(route.url, '/api/device-pairing/probe', 'POST', JSON.stringify(body))) as XopcSignedEnvelope;
        const proof = JSON.parse(await this.crypto.verify(invitation.gatewayPublicKey, envelope)) as XopcProbeProof;
        if (proof.gatewayId !== invitation.gatewayId || proof.pairingId !== pairingId || !Number.isFinite(proof.issuedAt)
          || Math.abs(Date.now() - proof.issuedAt) > 300000) throw new Error('GATEWAY_IDENTITY_MISMATCH');
        return route.url;
      } catch (error) { if (error instanceof XopcHttpError && error.status < 500 && ![404, 408, 425, 429].includes(error.status)) throw error; }
    }
    throw new Error('NO_VERIFIED_ROUTE');
  }

  private async pairingRequest(journal: XopcPairingJournal, action: string): Promise<XopcPairingResponse> {
    const body: XopcPairingBody = {
      gatewayId: journal.invitation.gatewayId, requestId: journal.requestId,
      pairingToken: journal.invitation.pairingToken, timestamp: Date.now(), nonce: await this.crypto.nonce()
    };
    if (action === 'request') body.device = journal.device;
    if (action === 'complete') { body.idempotencyKey = journal.idempotencyKey; body.initialRefreshToken = journal.initialRefreshToken; }
    body.signature = await this.crypto.sign(pairingProof(action, body));
    const path = action === 'request' ? '/api/device-pairing/requests' : '/api/device-pairing/requests/' + journal.requestId + '/' + action;
    const envelope = JSON.parse(await this.transport.request(journal.origin, path, 'POST', JSON.stringify(body))) as XopcSignedEnvelope;
    const result = JSON.parse(await this.crypto.verify(journal.invitation.gatewayPublicKey, envelope)) as XopcPairingResponse;
    if (!result.gateway || !result.request || result.gateway.id !== journal.invitation.gatewayId
      || result.nonce !== body.nonce || result.request.requestId !== journal.requestId
      || typeof result.request.status !== 'string') throw new Error('GATEWAY_IDENTITY_MISMATCH');
    return result;
  }

  async cancelPairing(): Promise<void> {
    this.generation++;
    if (this.pairingTask) { try { await this.pairingTask; } catch (_) { /* Cancellation is expected. */ } }
    const saved = await this.store.read('pairing');
    if (saved) {
      await this.pairingRequest(JSON.parse(saved) as XopcPairingJournal, 'cancel');
      await this.store.remove('pairing');
    }
  }

  async verifyRoute(profile: XopcProfile, origin: string): Promise<void> {
    const cacheKey = profile.gatewayId + ':' + origin;
    if ((this.verifiedUntil.get(cacheKey) ?? 0) > Date.now()) return;
    const body: XopcNonceBody = { nonce: await this.crypto.nonce() };
    const envelope = JSON.parse(await this.transport.request(origin, '/api/gateway-identity/challenge', 'POST', JSON.stringify(body))) as XopcSignedEnvelope;
    const proof = JSON.parse(await this.crypto.verify(profile.gatewayPublicKey, envelope)) as XopcIdentityProof;
    if (proof.purpose !== 'gateway-route-v1' || proof.gatewayId !== profile.gatewayId || proof.nonce !== body.nonce
      || !(proof.expiresAt > Date.now()) || proof.expiresAt > Date.now() + 60000) throw new Error('GATEWAY_IDENTITY_MISMATCH');
    this.verifiedUntil.set(cacheKey, Math.min(proof.expiresAt, Date.now() + 30000));
  }

  async accessToken(): Promise<string> {
    if (this.tokens && this.tokens.accessTokenExpiresAt > Date.now() + 30000) return this.tokens.accessToken;
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = this.refresh();
    try { return await this.refreshTask; } finally { this.refreshTask = undefined; }
  }

  private async refresh(): Promise<string> {
    const profile = this.profile;
    const generation = this.generation;
    if (!profile) throw new Error('NOT_PAIRED');
    const refreshToken = await this.store.read('refresh');
    if (!refreshToken) throw new Error('DEVICE_CREDENTIALS_MISSING');
    const saved = await this.store.read('refresh-attempt');
    let attempt: XopcRefreshAttempt;
    if (saved && (JSON.parse(saved) as XopcRefreshAttempt).refreshToken === refreshToken) {
      attempt = JSON.parse(saved) as XopcRefreshAttempt;
    } else {
      attempt = { refreshToken, nextRefreshToken: await this.crypto.refreshToken(), requestId: this.crypto.uuid() };
      await this.store.write('refresh-attempt', JSON.stringify(attempt));
    }
    const body: XopcRefreshBody = {
      refreshToken, nextRefreshToken: attempt.nextRefreshToken, requestId: attempt.requestId,
      timestamp: Date.now(), nonce: await this.crypto.nonce(), signature: ''
    };
    body.signature = await this.crypto.sign('xopc-device-refresh-v2\n' + refreshToken.slice(8).split('_')[0] + '\n'
      + body.timestamp + '\n' + body.nonce + '\n' + attempt.requestId + '\n' + attempt.nextRefreshToken);
    for (const route of profile.routes) {
      try {
        await this.verifyRoute(profile, route.url);
        const envelope = JSON.parse(await this.transport.request(route.url, '/api/device-auth/refresh', 'POST', JSON.stringify(body))) as XopcSignedEnvelope;
        const proof = JSON.parse(await this.crypto.verify(profile.gatewayPublicKey, envelope)) as XopcRefreshProof;
        if (proof.purpose !== 'device-refresh-v3' || proof.gatewayId !== profile.gatewayId || proof.nonce !== body.nonce
          || proof.requestId !== body.requestId || !(proof.expiresAt > Date.now()) || proof.expiresAt > Date.now() + 60000
          || !proof.tokens || !proof.tokens.accessToken || proof.tokens.refreshToken !== attempt.nextRefreshToken
          || !(proof.tokens.accessTokenExpiresAt > Date.now()) || !(proof.tokens.refreshTokenExpiresAt > Date.now())) throw new Error('GATEWAY_IDENTITY_MISMATCH');
        this.assertGeneration(generation);
        await this.store.write('refresh', proof.tokens.refreshToken);
        await this.store.remove('refresh-attempt');
        this.assertGeneration(generation);
        this.tokens = proof.tokens;
        profile.activeRouteId = route.id;
        return this.tokens.accessToken;
      } catch (error) {
        this.assertGeneration(generation);
        if (error instanceof XopcHttpError && [401, 403].includes(error.status)) throw new Error('DEVICE_AUTH_DENIED');
      }
    }
    throw new Error('NO_VERIFIED_ROUTE');
  }

  activeOrigin(): string {
    const profile = this.profile;
    if (!profile) throw new Error('NOT_PAIRED');
    return (profile.routes.find((route): boolean => route.id === profile.activeRouteId) ?? profile.routes[0]).url;
  }

  async transferAuth(): Promise<XopcTransferAuth> {
    const generation = this.generation;
    const token = await this.accessToken();
    const profile = this.profile;
    if (!profile) throw new Error('NOT_PAIRED');
    const origin = this.activeOrigin();
    await this.verifyRoute(profile, origin);
    this.assertGeneration(generation);
    return { origin, token };
  }

  async request(path: string, method: string = 'GET', body: string = ''): Promise<string> {
    let token = await this.accessToken();
    const profile = this.profile;
    if (!profile) throw new Error('NOT_PAIRED');
    const generation = this.generation;
    const routes = profile.routes.slice().sort((left, right): number =>
      (left.id === profile.activeRouteId ? -1 : 0) - (right.id === profile.activeRouteId ? -1 : 0));
    let lastError: Error = new Error('NO_VERIFIED_ROUTE');
    for (const route of routes) {
      try {
        await this.verifyRoute(profile, route.url);
        this.assertGeneration(generation);
        let result: string;
        try { result = await this.transport.request(route.url, path, method, body, token); }
        catch (error) {
          if (!(error instanceof XopcHttpError) || error.status !== 401) throw error as Error;
          this.tokens = undefined; token = await this.accessToken();
          this.assertGeneration(generation);
          result = await this.transport.request(route.url, path, method, body, token);
        }
        this.assertGeneration(generation);
        profile.activeRouteId = route.id;
        return result;
      } catch (error) {
        this.assertGeneration(generation);
        lastError = error as Error;
        // Never replay an ambiguous mutation on another route.
        if (method !== 'GET' || (error instanceof XopcHttpError && error.status < 500)) throw lastError;
      }
    }
    throw lastError;
  }

  async disconnect(): Promise<void> {
    this.generation++;
    if (this.pairingTask) { try { await this.pairingTask; } catch (_) {} }
    if (this.refreshTask) { try { await this.refreshTask; } catch (_) { /* In-flight auth is superseded. */ } }
    this.tokens = undefined; this.profile = undefined; this.verifiedUntil.clear();
    await this.store.remove('profile'); await this.store.remove('refresh'); await this.store.remove('refresh-attempt');
    await this.store.remove('pairing'); await this.crypto.clearKey();
  }
}

export const gatewaySession: XopcGatewaySession = new XopcGatewaySession();
