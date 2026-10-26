import { z } from 'zod';
import { createTunnelRegistrationProof } from './registration-proof.js';
import { createLogger } from '../utils/logger.js';
import type { TunnelRegistration } from './tunnel-types.js';

const log = createLogger('TunnelBroker');

export type BrokerRegisterInput = {
  brokerUrl: string;
  registrationSecret: string;
  gatewayVersion: string;
  platform: string;
  recoveryToken?: string;
  preferredSubdomain?: string;
};

export class TunnelBrokerError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class TunnelRegistrationKeyRejectedError extends TunnelBrokerError {
  readonly code = 'TUNNEL_REGISTRATION_KEY_REJECTED';

  constructor() {
    super(401, 'Tunnel register failed: 401');
    this.name = 'TunnelRegistrationKeyRejectedError';
  }
}

export class TunnelRecoveryProofRejectedError extends TunnelBrokerError {
  readonly code = 'TUNNEL_RECOVERY_PROOF_REJECTED';

  constructor() {
    super(403, 'Active lease ownership proof required');
    this.name = 'TunnelRecoveryProofRejectedError';
  }
}

const registrationResponseSchema = z.object({
  tunnelId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), tunnelToken: z.string().min(1).max(256),
  subdomain: z.string().regex(/^[a-z0-9]{4,16}$/), publicUrl: z.url(),
  frpc: z.object({ serverAddr: z.string().min(1).max(253), serverPort: z.number().int().min(1).max(65535),
    authToken: z.string().min(1).max(256), proxyName: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), subdomain: z.string().regex(/^[a-z0-9]{4,16}$/) }),
  expiresAt: z.iso.datetime(), heartbeatIntervalMs: z.number().int().min(5_000).max(60_000),
});

export class TunnelBrokerClient {
  constructor(private readonly baseUrl: string) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Tunnel broker requires HTTPS without URL credentials');
  }

  private apiUrl(path: string): string {
    const base = this.baseUrl.replace(/\/+$/, '');
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${base}${normalized}`;
  }

  async register(input: BrokerRegisterInput): Promise<TunnelRegistration> {
    return this.requestRegistration(input, false);
  }

  /** Explicit takeover requires a separately signed recovery audience. */
  async recover(input: BrokerRegisterInput): Promise<TunnelRegistration> {
    return this.requestRegistration(input, true);
  }

  private async requestRegistration(input: BrokerRegisterInput, recovering: boolean): Promise<TunnelRegistration> {
    const url = this.apiUrl(recovering ? '/tunnels/recover' : '/tunnels/register');
    const res = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Registration-Secret': input.registrationSecret,
      },
      body: JSON.stringify(createTunnelRegistrationProof({ ...input, brokerUrl: recovering ? url : this.baseUrl })),
    });
    if (!res.ok) {
      log.error({ status: res.status, url }, 'Tunnel register failed');
      const body = await res.json().catch(() => null) as { code?: unknown; error?: unknown } | null;
      if (res.status === 403 && body?.code === 'REGISTRATION_DENIED' && body.error === 'Active lease ownership proof required') {
        throw new TunnelRecoveryProofRejectedError();
      }
      if (recovering && res.status === 404) {
        throw new TunnelBrokerError(404, 'Immediate recovery requires an updated cloud tunnel broker');
      }
      if (res.status === 401) throw new TunnelRegistrationKeyRejectedError();
      throw new TunnelBrokerError(res.status, `Tunnel register failed: ${res.status}`);
    }
    const registration = registrationResponseSchema.parse(await res.json());
    if (new URL(registration.publicUrl).protocol !== 'https:') throw new Error('Tunnel requires HTTPS');
    return registration;
  }

  async heartbeat(tunnelId: string, tunnelToken: string): Promise<void> {
    const res = await fetch(this.apiUrl(`/tunnels/${encodeURIComponent(tunnelId)}/heartbeat`), {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      method: 'POST',
      headers: { 'X-Tunnel-Token': tunnelToken },
    });
    if (res.status === 401 || res.status === 403 || res.status === 410) {
      throw new TunnelBrokerError(res.status, `Tunnel heartbeat rejected: ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(`Tunnel heartbeat failed: ${res.status}`);
    }
  }

  async deregister(tunnelId: string, tunnelToken: string): Promise<void> {
    const res = await fetch(this.apiUrl(`/tunnels/${encodeURIComponent(tunnelId)}`), {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      method: 'DELETE',
      headers: { 'X-Tunnel-Token': tunnelToken },
    });
    if (!res.ok) {
      throw new TunnelBrokerError(res.status, `Tunnel deregister failed: ${res.status}`);
    }
  }


}

export function resolveBrokerApiBase(brokerUrl: string): string {
  const trimmed = brokerUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/api')) return trimmed;
  return `${trimmed}/api`;
}
