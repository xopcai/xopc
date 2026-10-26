import type { InteractionCapabilities } from '@xopcai/gateway-contract';
import { apiUrl } from '@/lib/url';

/** Probe before a session exists; old Gateways simply omit the capability. */
export async function readClarificationCapabilities(): Promise<InteractionCapabilities | undefined> {
  try {
    const response = await fetch(apiUrl('/api/health'), { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!response.ok) return undefined;
    const value = await response.json() as { clarificationVersions?: unknown };
    return Array.isArray(value.clarificationVersions) && value.clarificationVersions.includes(2)
      ? { clarificationVersions: [1, 2] } : undefined;
  } catch { return undefined; }
}
