import {
  isNetworkAccessibleBindHost,
  resolveGatewayEffectiveHost,
} from '../config/gateway-bind.js';
import type { Config } from '../config/schema.js';
import { ConfigSchema } from '../config/schema.js';
import { buildDefaultCorsOrigins } from './host.js';

/** Ensure network-accessible binds have browser CORS origins (fail-closed startup guard). */
export function ensureGatewayCorsOriginsForNetworkBind(config: Config, port: number): Config {
  const bindHost = resolveGatewayEffectiveHost(config);
  if (!isNetworkAccessibleBindHost(bindHost)) {
    return config;
  }
  const existing = (config.gateway?.corsOrigins ?? [])
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (
    existing.length > 0 ||
    config.gateway?.dangerouslyAllowHostHeaderOriginFallback === true
  ) {
    return config;
  }
  return ConfigSchema.parse({
    ...config,
    gateway: {
      ...config.gateway,
      corsOrigins: buildDefaultCorsOrigins({ port, bindHost }),
    },
  });
}
