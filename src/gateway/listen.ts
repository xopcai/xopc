import type { Config } from '../config/schema.js';
import type { GatewayBindMode } from '../config/schema.js';
import {
  bindModeFromHostOverride,
  resolveGatewayBindMode,
  resolveGatewayBindHostSync,
  resolveGatewayCustomBindHost,
} from '../config/gateway-bind.js';

export { isLoopbackHost, isAllInterfacesHost, buildDefaultCorsOrigins } from './host.js';

/** Resolve the effective HTTP listen host (CLI/bind override > config bind > legacy host). */
export function resolveGatewayListenHost(params: {
  cfg: Config;
  bindOverride?: GatewayBindMode;
  hostOverride?: string;
}): string {
  if (params.hostOverride?.trim()) {
    const mapped = bindModeFromHostOverride(params.hostOverride);
    return resolveGatewayBindHostSync({
      bindMode: mapped.bind,
      customBindHost: mapped.customBindHost,
    });
  }
  const bindMode = resolveGatewayBindMode(params.cfg, params.bindOverride);
  const customBindHost = resolveGatewayCustomBindHost(params.cfg);
  return resolveGatewayBindHostSync({ bindMode, customBindHost });
}

export function resolveGatewayListenPlan(params: {
  cfg: Config;
  bindOverride?: GatewayBindMode;
  hostOverride?: string;
}): { bindMode: GatewayBindMode; bindHost: string; customBindHost?: string } {
  if (params.hostOverride?.trim()) {
    const mapped = bindModeFromHostOverride(params.hostOverride);
    return {
      bindMode: mapped.bind,
      bindHost: resolveGatewayBindHostSync({
        bindMode: mapped.bind,
        customBindHost: mapped.customBindHost,
      }),
      customBindHost: mapped.customBindHost,
    };
  }
  const bindMode = resolveGatewayBindMode(params.cfg, params.bindOverride);
  const customBindHost = resolveGatewayCustomBindHost(params.cfg);
  return {
    bindMode,
    bindHost: resolveGatewayBindHostSync({ bindMode, customBindHost }),
    customBindHost,
  };
}
