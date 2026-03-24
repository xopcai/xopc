import { useGatewaySse } from '@/features/gateway/use-gateway-sse';

/** Mount once under the app shell to run the SSE lifecycle hook. */
export function GatewaySseBridge() {
  useGatewaySse();
  return null;
}
