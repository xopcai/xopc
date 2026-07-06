import { GatewayConnectivityError } from '../../api/gateway-error';
import type { PairGatewayResult } from './pair-gateway';
import { syncAfterGatewaySettingsSave } from './gateway-connection-sync';
import { preflightGatewayCredentials } from './preflight-credentials';
import {
  applyGatewayUpsert,
  type GatewayCredentials,
  type UpsertGatewayResult,
} from './upsert-gateway-core';
import { useGatewayStore } from '../../stores/gateway-store';

export type { GatewayCredentials, UpsertGatewayResult };

export type UpsertOptions = {
  /** Verify reachability before persisting and refuse on full failure. */
  preflight?: boolean;
};

/**
 * Add a new gateway profile or update an existing one (matched by baseUrl), then switch to it.
 *
 * When `preflight` is true the credentials are validated against the live
 * gateway BEFORE persisting; on full failure we throw a `GatewayConnectivityError`
 * the caller can render inline.
 */
export async function upsertGatewayFromCredentials(
  credentials: GatewayCredentials,
  options: UpsertOptions = {},
): Promise<UpsertGatewayResult> {
  if (options.preflight) {
    const preflight = await preflightGatewayCredentials({
      baseUrl: credentials.baseUrl,
      lanUrl: credentials.lanUrl ?? null,
      token: credentials.token ?? '',
    });
    if (!preflight.ok) throw preflight.error;
  }
  const result = applyGatewayUpsert(useGatewayStore.getState(), credentials);
  await syncAfterGatewaySettingsSave();
  return result;
}

export { GatewayConnectivityError };

export async function upsertGatewayFromPairResult(result: PairGatewayResult): Promise<UpsertGatewayResult> {
  return upsertGatewayFromCredentials(
    {
      baseUrl: result.baseUrl,
      lanUrl: result.lanUrl,
      token: result.token,
    },
    { preflight: true },
  );
}
