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

export interface ManagedDeviceIdentity {
  createdAt: number;
  lastSeenAt?: number;
  revokedAt?: number;
}

export interface ManagedDevice {
  id: string;
  displayName: string;
  kind: EndpointKind;
  platform: string;
  createdAt: number;
  lastSeenAt?: number;
  access: (ManagedDeviceIdentity & { scopes: string[] }) | null;
  principal: ManagedDeviceIdentity | null;
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

export interface ManagedEndpointInvocationPage {
  items: ManagedEndpointInvocation[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type InvocationFilters = {
  page: number;
  pageSize: number;
  query: string;
  principalId: string;
  status: '' | ManagedEndpointInvocation['status'];
  effect: '' | EndpointEffect;
};

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

export function managedDevicesKey(): string {
  return apiUrl('/api/endpoint-tools/devices');
}

export function endpointInvocationsKey(filters: InvocationFilters): string {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: String(filters.pageSize) });
  if (filters.query.trim()) params.set('query', filters.query.trim());
  if (filters.principalId) params.set('principalId', filters.principalId);
  if (filters.status) params.set('status', filters.status);
  if (filters.effect) params.set('effect', filters.effect);
  return apiUrl(`/api/endpoint-tools/invocations?${params}`);
}

export function endpointBindingKey(conversationId: string): string {
  return apiUrl(`/api/endpoint-tools/bindings/${encodeURIComponent(conversationId)}`);
}

export async function fetchManagedDevices(): Promise<ManagedDevice[]> {
  return payload<ManagedDevice[]>(await apiFetch(managedDevicesKey()));
}

export async function revokeManagedDevices(ids: string[]): Promise<void> {
  const chunks = Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => (
    ids.slice(index * 100, (index + 1) * 100)
  ));
  await Promise.all(chunks.map(async (chunk) => {
    await payload(await apiFetch(apiUrl('/api/endpoint-tools/devices/revoke'), {
      method: 'POST',
      body: JSON.stringify({ ids: chunk }),
    }));
  }));
}

export async function fetchEndpointInvocations(filters: InvocationFilters): Promise<ManagedEndpointInvocationPage> {
  return payload<ManagedEndpointInvocationPage>(await apiFetch(endpointInvocationsKey(filters)));
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
