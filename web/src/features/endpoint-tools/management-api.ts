import type {
  EndpointAvailability,
  EndpointEffect,
  EndpointKind,
  EndpointToolDescriptor,
  EndpointToolErrorCode,
} from '@xopcai/endpoint-tools-protocol';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface ManagedEndpoint {
  principalId: string;
  endpointId: string;
  connectionId: string;
  displayName: string;
  kind: EndpointKind;
  platform: string;
  appVersion: string;
  availability: EndpointAvailability;
  lastHeartbeatAt: number;
  tools: Array<{ descriptor: EndpointToolDescriptor; revision: string }>;
}

export interface ManagedEndpointPrincipal {
  id: string;
  kind: EndpointKind;
  displayName: string;
  platform: string;
  createdAt: number;
  lastSeenAt?: number;
  revokedAt?: number;
  endpoints: ManagedEndpoint[];
}

export interface ManagedEndpointInvocation {
  id: string;
  principalId: string;
  endpointId: string;
  toolName: string;
  effect: EndpointEffect;
  confirmationRequired: boolean;
  status: 'running' | 'succeeded' | 'failed';
  errorCode?: EndpointToolErrorCode;
  errorMessage?: string;
  startedAt: number;
  completedAt?: number;
}

async function payload<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as {
    payload?: T;
    error?: { message?: string };
  } | null;
  if (!response.ok || body?.payload === undefined) {
    throw new Error(body?.error?.message ?? `Endpoint management request failed: ${response.status}`);
  }
  return body.payload;
}

export function endpointPrincipalsKey(): string {
  return apiUrl('/api/endpoint-tools/principals');
}

export function endpointInvocationsKey(): string {
  return apiUrl('/api/endpoint-tools/invocations?limit=50');
}

export async function fetchEndpointPrincipals(): Promise<ManagedEndpointPrincipal[]> {
  return payload<ManagedEndpointPrincipal[]>(await apiFetch(endpointPrincipalsKey()));
}

export async function fetchEndpointInvocations(): Promise<ManagedEndpointInvocation[]> {
  return payload<ManagedEndpointInvocation[]>(await apiFetch(endpointInvocationsKey()));
}

export async function revokeManagedEndpointPrincipal(principalId: string): Promise<void> {
  await payload(await apiFetch(apiUrl(`/api/endpoint-tools/principals/${encodeURIComponent(principalId)}`), {
    method: 'DELETE',
  }));
}
