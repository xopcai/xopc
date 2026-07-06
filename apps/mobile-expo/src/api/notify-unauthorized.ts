/**
 * Tiny helper to flip the gateway store's `unauthorized` flag — extracted so
 * `client.ts` and `dual-fire-fetch.ts` don't form an import cycle.
 */
import { useGatewayStore } from '../stores/gateway-store';

export function notifyUnauthorizedIfNeeded(status: number): void {
  if (status !== 401) return;
  useGatewayStore.getState().onUnauthorized();
}
