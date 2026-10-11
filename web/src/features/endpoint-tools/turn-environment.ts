import { endpointContextSchema, type EndpointContext } from '@xopcai/gateway-contract';

import { useGatewayStore } from '@/stores/gateway-store';

let supportedScope: string | undefined;

export function publishTurnEnvironmentSupport(supported: boolean): void {
  supportedScope = supported ? useGatewayStore.getState().conversationId : undefined;
}

/** Negotiation happens at device connection; retries reuse their frozen input snapshot. */
export async function captureTurnEnvironment(): Promise<EndpointContext | undefined> {
  if (!supportedScope || supportedScope !== useGatewayStore.getState().conversationId) return undefined;
  const parsed = endpointContextSchema.safeParse({ version: 1, capturedAt: Date.now(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: navigator.language });
  return parsed.success ? parsed.data : undefined;
}
