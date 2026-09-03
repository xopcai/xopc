import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface ManagedExecutionHost {
  id: string;
  displayName: string;
  platform: string;
  arch: string;
  appVersion: string;
  capabilities: {
    git: boolean;
    shell: boolean;
    search: boolean;
    patch: boolean;
    snapshots: boolean;
  };
  maxConcurrency: number;
  lifecycleStatus: 'active' | 'draining' | 'revoked';
  credentialEpoch: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  lastSeenAt?: number;
  revokedAt?: number;
  online: boolean;
}

async function payload<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as {
    payload?: T;
    error?: { message?: string };
  } | null;
  if (!response.ok || body?.payload === undefined) {
    throw new Error(body?.error?.message ?? `Execution host request failed: ${response.status}`);
  }
  return body.payload;
}

export function executionHostsKey(): string {
  return apiUrl('/api/execution-hosts');
}

export async function fetchExecutionHosts(): Promise<ManagedExecutionHost[]> {
  return payload<ManagedExecutionHost[]>(await apiFetch(executionHostsKey()));
}

export async function createExecutionHostEnrollmentCode(): Promise<{ code: string; expiresAt: number }> {
  return payload(await apiFetch(apiUrl('/api/execution-hosts/enrollment-codes'), { method: 'POST' }));
}

export async function revokeExecutionHost(hostId: string): Promise<void> {
  await payload(await apiFetch(apiUrl(`/api/execution-hosts/${encodeURIComponent(hostId)}`), {
    method: 'DELETE',
  }));
}
