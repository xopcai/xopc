import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type { AgentDefaults, BuiltinToolSummary } from './types/agent-gateway';

export type GlobalDefaultsPayload = {
  defaults: AgentDefaults;
  builtinTools: BuiltinToolSummary[];
};

export async function fetchGlobalDefaults(): Promise<GlobalDefaultsPayload> {
  const response = await fetchJson<{ payload?: GlobalDefaultsPayload }>(apiUrl('/api/global-defaults'));
  if (!response.payload?.defaults || !Array.isArray(response.payload.builtinTools)) {
    throw new Error('Invalid global defaults response');
  }
  return response.payload;
}

export async function updateGlobalDefaults(defaults: AgentDefaults): Promise<GlobalDefaultsPayload> {
  const response = await fetchJson<{ payload?: GlobalDefaultsPayload }>(apiUrl('/api/global-defaults'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaults }),
  });
  if (!response.payload?.defaults || !Array.isArray(response.payload.builtinTools)) {
    throw new Error('Invalid global defaults response');
  }
  const { mutate } = await import('swr');
  await Promise.all([
    mutate('settings-gateway-agents'),
    revalidateGatewayConfig(),
  ]);
  return response.payload;
}
