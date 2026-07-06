import { queryKeys } from '../../query/keys';
import { queryClient } from '../../query/query-client';
import { invalidateSessionLists } from '../../query/workspace-sync';
import { useGatewayStore } from '../../stores/gateway-store';

import { getSharedGatewaySseConnection } from './use-gateway-sse';

const SYNC_DEBOUNCE_MS = 2_000;
const MIN_SYNC_INTERVAL_MS = 8_000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastSyncAt = 0;

export type GatewaySyncOptions = {
  /** Invalidate sessions/agents REST caches. Default true. */
  invalidateQueries?: boolean;
  /** Reopen broadcast SSE transport. Default true. */
  reconnectSse?: boolean;
  /** Skip debounce (explicit user action such as saving gateway settings). */
  immediate?: boolean;
};

function runGatewaySync(options: GatewaySyncOptions): void {
  const { invalidateQueries = true, reconnectSse = true } = options;
  lastSyncAt = Date.now();

  if (invalidateQueries) {
    invalidateSessionLists(queryClient);
    void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
  }
  if (reconnectSse) {
    getSharedGatewaySseConnection()?.reconnect();
  }
}

/** Invalidate REST caches and reopen SSE after the active gateway URL changes or comes back online. */
export function syncGatewayAfterConnectivityChange(options: GatewaySyncOptions = {}): void {
  const { immediate = false, invalidateQueries = true, reconnectSse = true } = options;

  const execute = () => {
    const now = Date.now();
    if (!immediate && now - lastSyncAt < MIN_SYNC_INTERVAL_MS) {
      if (reconnectSse && !invalidateQueries) {
        getSharedGatewaySseConnection()?.reconnect();
      }
      return;
    }
    runGatewaySync({ invalidateQueries, reconnectSse });
  };

  if (immediate) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    execute();
    return;
  }

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    execute();
  }, SYNC_DEBOUNCE_MS);
}

/** Persisted gateway settings changed — refresh active URL and reconnect immediately (no app restart). */
export async function syncAfterGatewaySettingsSave(): Promise<void> {
  await useGatewayStore.getState().refreshActiveBaseUrl();
  syncGatewayAfterConnectivityChange({ immediate: true });
}

/** @internal test helper */
export function resetGatewaySyncStateForTests(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  lastSyncAt = 0;
}
