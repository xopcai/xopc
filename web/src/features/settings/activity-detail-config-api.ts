import type { ReasoningLevel } from '@/features/chat/messages/messages.types';
import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeActivityDetailDefault(config: unknown): ReasoningLevel {
  const root = isRecord(config) ? config : {};
  const gateway = isRecord(root.gateway) ? root.gateway : {};
  const webchat = isRecord(gateway.webchat) ? gateway.webchat : {};
  const level = webchat.activityDetailDefault;
  return level === 'off' || level === 'stream' || level === 'on' ? level : 'on';
}

export async function patchActivityDetailDefault(level: ReasoningLevel): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({ gateway: { webchat: { activityDetailDefault: level } } }),
  });
  await revalidateGatewayConfig();
}
