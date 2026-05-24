import type { Config } from '../config/schema.js';
import type { GatewayBindMode } from '../config/schema.js';
import {
  resolveGatewayBindMode,
  resolveGatewayBindHostSync,
  resolveGatewayCustomBindHost,
} from '../config/gateway-bind.js';

export { isLoopbackHost, isAllInterfacesHost, buildDefaultCorsOrigins } from './host.js';

/** Resolve the effective HTTP listen host (CLI bind override > config bind). */
export function resolveGatewayListenHost(params: {
  cfg: Config;
  bindOverride?: GatewayBindMode;
}): string {
  const bindMode = resolveGatewayBindMode(params.cfg, params.bindOverride);
  const customBindHost = resolveGatewayCustomBindHost(params.cfg);
  return resolveGatewayBindHostSync({ bindMode, customBindHost });
}

export function resolveGatewayListenPlan(params: {
  cfg: Config;
  bindOverride?: GatewayBindMode;
}): { bindMode: GatewayBindMode; bindHost: string; customBindHost?: string } {
  const bindMode = resolveGatewayBindMode(params.cfg, params.bindOverride);
  const customBindHost = resolveGatewayCustomBindHost(params.cfg);
  return {
    bindMode,
    bindHost: resolveGatewayBindHostSync({ bindMode, customBindHost }),
    customBindHost,
  };
}
