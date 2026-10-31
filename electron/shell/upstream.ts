import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { lookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import http from 'node:http';
import https from 'node:https';

import { DesktopChatBootstrapSchema, type DesktopChatIdentity } from '@xopcai/gateway-contract';

import { parseRemoteProfile } from '../gateway/profiles.js';

export type RemoteTarget = { origin: string; transport: 'direct' | 'ssh'; token: string; identity?: DesktopChatIdentity };

/** A dedicated pool, always pinned to one configured origin; no redirect following. */
export class ShellUpstream {
  readonly agent: http.Agent | https.Agent;
  readonly origin: string;
  readonly lookup?: LookupFunction;
  constructor(readonly target: RemoteTarget) {
    if (!target.token?.trim() || Buffer.byteLength(target.token) > 8192) throw new Error('INVALID_CREDENTIAL');
    this.origin = parseRemoteProfile({ id: '00000000-0000-0000-0000-000000000000', mode: 'remote', name: 'Shell', origin: target.origin, transport: target.transport }).origin;
    if (target.transport === 'ssh') this.lookup = (hostname, options, done) => {
      lookup(hostname, { all: true }, (error, resolved) => {
        const addresses = (resolved ?? []).filter(value => ['127.0.0.1', '::1'].includes(value.address)
          && (!options.family || value.family === options.family));
        if (error || !addresses.length) { done(error ?? new Error('SHELL_LOOPBACK_REQUIRED'), ''); return; }
        done(null, options.all ? addresses : addresses[0]!.address, addresses[0]!.family);
      });
    };
    this.agent = this.origin.startsWith('https:') ? new https.Agent({ keepAlive: true, maxSockets: 16 }) : new http.Agent({ keepAlive: true, maxSockets: 16 });
  }
  request(path: string, method = 'GET', headers: Record<string, string> = {}, signal?: AbortSignal, authenticated = true) {
    if (!path.startsWith('/api/') || /[\\\r\n#]/.test(path) || path.startsWith('//')) throw new Error('SHELL_PATH_DENIED');
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin) throw new Error('SHELL_TARGET_DENIED');
    return (url.protocol === 'https:' ? https : http).request(url, { method, agent: this.agent, signal, lookup: this.lookup,
      headers: { ...headers, ...(authenticated ? { Authorization: `Bearer ${this.target.token}` } : {}), Origin: this.origin, 'Accept-Encoding': 'identity' } });
  }
  async json(path: string, signal: AbortSignal, body?: unknown, authenticated = true): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req = this.request(path, body === undefined ? 'GET' : 'POST', { 'Content-Type': 'application/json' }, signal, authenticated);
      req.on('error', error => {
        const code = (error as NodeJS.ErrnoException).code ?? '';
        reject(new Error(/CERT|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code) ? 'GATEWAY_TLS_FAILED' : 'GATEWAY_NETWORK_FAILED'));
      });
      req.on('response', res => {
        if (res.statusCode !== 200 || !/^application\/json\b/i.test(res.headers['content-type'] ?? '')) {
          res.destroy(); reject(new Error(res.statusCode === 401 || res.statusCode === 403 ? 'GATEWAY_AUTH_FAILED' : 'GATEWAY_CONTRACT_UNAVAILABLE')); return;
        }
        const parts: Buffer[] = []; let bytes = 0;
        res.on('data', chunk => { bytes += chunk.length; if (bytes > 64 * 1024) res.destroy(new Error('GATEWAY_RESPONSE_LIMIT')); else parts.push(chunk); });
        res.on('error', () => reject(new Error('GATEWAY_RESPONSE_FAILED')));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { reject(new Error('GATEWAY_RESPONSE_INVALID')); } });
      });
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  async authenticate(): Promise<DesktopChatIdentity> {
    const signal = AbortSignal.timeout(15_000);
    if (this.target.identity) await this.prove(this.target.identity, signal);
    const parsed = DesktopChatBootstrapSchema.safeParse(await this.json('/api/desktop-chat/bootstrap', signal));
    if (!parsed.success) throw new Error('GATEWAY_CHAT_INCOMPATIBLE');
    const { gatewayId, publicKey } = parsed.data.payload;
    if (this.target.identity && (this.target.identity.gatewayId !== gatewayId || this.target.identity.publicKey !== publicKey)) throw new Error('GATEWAY_IDENTITY_CHANGED');
    const identity = { gatewayId, publicKey };
    if (!this.target.identity) await this.prove(identity, signal);
    return identity;
  }
  private async prove({ gatewayId, publicKey }: DesktopChatIdentity, signal: AbortSignal) {
    const nonce = randomBytes(24).toString('base64url');
    const proof = await this.json('/api/gateway-identity/challenge', signal, { nonce }, false) as { signedPayload?: unknown; signature?: unknown };
    try {
      if (typeof proof.signedPayload !== 'string' || typeof proof.signature !== 'string') throw new Error();
      const key = createPublicKey(publicKey);
      if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(proof.signedPayload), key, Buffer.from(proof.signature, 'base64url'))) throw new Error();
      const value = JSON.parse(Buffer.from(proof.signedPayload, 'base64url').toString('utf8'));
      const now = Date.now();
      if (value.gatewayId !== gatewayId) throw new Error('GATEWAY_IDENTITY_CHANGED');
      if (value.purpose !== 'gateway-route-v1' || value.gatewayId !== gatewayId || value.nonce !== nonce || value.requestProofVersion !== 1
        || !Number.isSafeInteger(value.serverTime) || !Number.isSafeInteger(value.expiresAt)
        || Math.abs(now - value.serverTime) > 30_000 || value.expiresAt <= now || value.expiresAt <= value.serverTime || value.expiresAt - value.serverTime > 31_000) throw new Error();
    } catch (error) {
      if (error instanceof Error && error.message === 'GATEWAY_IDENTITY_CHANGED') throw error;
      throw new Error('GATEWAY_IDENTITY_PROOF_FAILED');
    }
  }
  close() { this.agent.destroy(); }
}
