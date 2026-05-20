import { createLogger } from '../utils/logger.js';
import type { TunnelRegistration } from './tunnel-types.js';

const log = createLogger('TunnelBroker');

export type BrokerRegisterInput = {
  brokerUrl: string;
  registrationSecret: string;
  gatewayVersion: string;
  platform: string;
  gatewayTokenHash: string;
  preferredSubdomain?: string;
};

export class TunnelBrokerClient {
  constructor(private readonly baseUrl: string) {}

  private apiUrl(path: string): string {
    const base = this.baseUrl.replace(/\/+$/, '');
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${base}${normalized}`;
  }

  async register(input: BrokerRegisterInput): Promise<TunnelRegistration> {
    const url = this.apiUrl('/tunnels/register');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Registration-Secret': input.registrationSecret,
      },
      body: JSON.stringify({
        gatewayVersion: input.gatewayVersion,
        platform: input.platform,
        gatewayTokenHash: input.gatewayTokenHash,
        preferredSubdomain: input.preferredSubdomain,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.error({ status: res.status, url, bodyPreview: body.slice(0, 200) }, 'Tunnel register failed');
      throw new Error(`Tunnel register failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as TunnelRegistration;
  }

  async heartbeat(tunnelId: string, tunnelToken: string): Promise<void> {
    const res = await fetch(this.apiUrl(`/tunnels/${encodeURIComponent(tunnelId)}/heartbeat`), {
      method: 'POST',
      headers: { 'X-Tunnel-Token': tunnelToken },
    });
    if (res.status === 401 || res.status === 410) {
      throw new Error(`Tunnel heartbeat rejected: ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(`Tunnel heartbeat failed: ${res.status}`);
    }
  }

  async deregister(tunnelId: string, tunnelToken: string): Promise<void> {
    const res = await fetch(this.apiUrl(`/tunnels/${encodeURIComponent(tunnelId)}`), {
      method: 'DELETE',
      headers: { 'X-Tunnel-Token': tunnelToken },
    });
    if (!res.ok && res.status !== 404) {
      log.warn({ tunnelId, status: res.status }, 'Tunnel deregister returned non-OK');
    }
  }
}

export function resolveBrokerApiBase(brokerUrl: string): string {
  const trimmed = brokerUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/api')) return trimmed;
  return `${trimmed}/api`;
}
