import type { NotificationTarget } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { getProviderAuthService } from '../providers/provider-auth-service.js';
import { resolveXopcModelRouterUrl, XOPC_CLOUD_PROVIDER_ID } from '../providers/xopc-cloud-config.js';

const endpointResponse = z.object({ endpointId: z.string().uuid() });
const endpointPrefix = 'platform-push:';

export class PlatformPushError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export function platformPushEndpoint(value: string): string | undefined {
  return value.startsWith(endpointPrefix) ? value.slice(endpointPrefix.length) : undefined;
}

async function request(path: string, method: string, body?: object, fetchImpl = fetch): Promise<Response> {
  const token = await getProviderAuthService().resolveApiKey(XOPC_CLOUD_PROVIDER_ID);
  if (!token) throw new PlatformPushError(401, 'PUSH_CLOUD_AUTH_REQUIRED');
  const response = await fetchImpl(resolveXopcModelRouterUrl() + '/push' + path, {
    method,
    redirect: 'error',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (response.ok) return response;
  if (response.status === 401 || response.status === 403) {
    throw new PlatformPushError(response.status, 'PUSH_CLOUD_AUTH_REQUIRED');
  }
  const error = await response.json().catch(() => null) as { error?: { code?: string } } | null;
  if (response.status === 503 && error?.error?.code === 'push_provider_unavailable') {
    throw new PlatformPushError(503, 'PUSH_PLATFORM_UNAVAILABLE');
  }
  throw new PlatformPushError(response.status, 'PUSH_PLATFORM_REQUEST_FAILED');
}

export async function registerPlatformPushDevice(gatewayId: string, deviceId: string, pushToken: string): Promise<string> {
  const response = await request('/endpoints', 'PUT', { gatewayId, deviceId, platform: 'harmonyos', pushToken });
  const result = endpointResponse.safeParse(await response.json().catch(() => null));
  if (!result.success) throw new PlatformPushError(502, 'PUSH_PLATFORM_INVALID_RESPONSE');
  return endpointPrefix + result.data.endpointId;
}

export async function removePlatformPushDevice(reference: string): Promise<void> {
  const endpointId = platformPushEndpoint(reference);
  if (endpointId) await request('/endpoints/' + encodeURIComponent(endpointId), 'DELETE');
}

export type PlatformPushDelivery = {
  endpointId: string;
  eventId: string;
  locale: 'en' | 'zh';
  target: NotificationTarget;
  expiresAt: number;
};

export async function sendPlatformPush(message: PlatformPushDelivery, fetchImpl = fetch): Promise<string> {
  const response = await request('/deliveries', 'POST', message, fetchImpl);
  if (response.status !== 202) throw new PlatformPushError(502, 'PUSH_PLATFORM_INVALID_RESPONSE');
  return 'platform:' + message.eventId;
}
