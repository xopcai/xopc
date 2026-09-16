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

export interface ManagedEndpointSessionBinding {
  conversationId: string;
  endpointId: string;
  boundAt: number;
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

export function endpointBindingKey(conversationId: string): string {
  return apiUrl(`/api/endpoint-tools/bindings/${encodeURIComponent(conversationId)}`);
}

export async function fetchEndpointPrincipals(): Promise<ManagedEndpointPrincipal[]> {
  return payload<ManagedEndpointPrincipal[]>(await apiFetch(endpointPrincipalsKey()));
}

export async function fetchEndpointInvocations(): Promise<ManagedEndpointInvocation[]> {
  return payload<ManagedEndpointInvocation[]>(await apiFetch(endpointInvocationsKey()));
}

export async function fetchEndpointBinding(conversationId: string): Promise<ManagedEndpointSessionBinding | undefined> {
  const response = await apiFetch(endpointBindingKey(conversationId));
  if (response.status === 404) return undefined;
  return payload<ManagedEndpointSessionBinding>(response);
}

export async function bindEndpointToSession(
  conversationId: string,
  endpointId: string,
): Promise<ManagedEndpointSessionBinding> {
  return payload<ManagedEndpointSessionBinding>(await apiFetch(endpointBindingKey(conversationId), {
    method: 'PUT',
    body: JSON.stringify({ endpointId }),
  }));
}

export async function unbindEndpointFromSession(conversationId: string): Promise<boolean> {
  const result = await payload<{ removed: boolean }>(await apiFetch(endpointBindingKey(conversationId), {
    method: 'DELETE',
  }));
  return result.removed;
}

export async function revokeManagedEndpointPrincipal(principalId: string): Promise<void> {
  await payload(await apiFetch(apiUrl(`/api/endpoint-tools/principals/${encodeURIComponent(principalId)}`), {
    method: 'DELETE',
  }));
}
