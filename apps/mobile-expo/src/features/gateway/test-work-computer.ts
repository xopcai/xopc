import { apiFetch } from '../../api/client';
import { useGatewayStore } from '../../stores/gateway-store';
import { waitForMobileEndpointTurnClaim } from '../endpoint-tools/turn-claim';
import { refreshNetworkSnapshot } from './network-info';
import { requestMobileRealtimeReconnect } from './use-gateway-realtime';

/** Verify authorized HTTP and the live endpoint claim before calling a connection ready. */
export async function testWorkComputer(gatewayId: string): Promise<'cellular' | 'current'> {
  const before = useGatewayStore.getState();
  if (before.activeGatewayId !== gatewayId) throw new Error('SWITCH_COMPUTER');
  const network = await refreshNetworkSnapshot();
  const response = await apiFetch('/api/sessions?limit=1', { timeoutMs: 8_000 });
  if (!response.ok) throw new Error('CONNECTION_NOT_READY');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try { await waitForMobileEndpointTurnClaim(controller.signal, requestMobileRealtimeReconnect); }
  finally { clearTimeout(timer); }
  const after = useGatewayStore.getState();
  const currentNetwork = await refreshNetworkSnapshot();
  if (after.activeGatewayId !== gatewayId || before.connectionGeneration !== after.connectionGeneration || network.key !== currentNetwork.key) throw new Error('CONNECTION_CHANGED');
  return currentNetwork.kind === 'cellular' ? 'cellular' : 'current';
}
