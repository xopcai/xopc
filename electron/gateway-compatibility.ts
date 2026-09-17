import { COMPUTER_DESCRIPTOR } from '@xopcai/computer-control-contract';
import { canonicalJson, ENDPOINT_PROTOCOL_VERSION } from '@xopcai/endpoint-tools-protocol';
import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';
import { RealtimeConnectionError } from '@xopcai/realtime-client';

export const GATEWAY_PROTOCOL_INCOMPATIBLE = 'GATEWAY_PROTOCOL_INCOMPATIBLE';

function contractFields(descriptor: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const { title: _title, description: _description, ...contract } = descriptor ?? {};
  return contract;
}

/** Compare executable contracts, not release labels (dev builds may share a version). */
export async function assertGatewayCompatibility(
  connection: { port: number; token: string },
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${connection.port}/api/endpoint-tools/compatibility`, {
    headers: { Authorization: `Bearer ${connection.token}` },
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Gateway compatibility check HTTP ${response.status}`);
  }
  const body = await response.json().catch((error) => {
    if (error instanceof SyntaxError) return null;
    throw error;
  });
  if (!response.ok || body?.ok !== true
    || body.payload?.realtimeProtocolVersion !== REALTIME_PROTOCOL_VERSION
    || body.payload?.endpointProtocolVersion !== ENDPOINT_PROTOCOL_VERSION
    || canonicalJson(contractFields(body.payload?.computerControl)) !== canonicalJson(contractFields(COMPUTER_DESCRIPTOR))) {
    throw new RealtimeConnectionError(GATEWAY_PROTOCOL_INCOMPATIBLE, false);
  }
}
