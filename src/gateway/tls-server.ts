import type { Config } from '../config/schema.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('GatewayTls');

export type GatewayTlsRuntime = {
  enabled: boolean;
  port?: number;
};

/** Native HTTPS for LAN/tailnet binds (Phase 2). Requires certPath/keyPath or autoGenerate. */
export function resolveGatewayTlsRuntime(cfg: Config): GatewayTlsRuntime {
  const tls = cfg.gateway?.tls;
  if (!tls?.enabled) {
    return { enabled: false };
  }
  if (!tls.autoGenerate && (!tls.certPath?.trim() || !tls.keyPath?.trim())) {
    log.warn(
      { phase: 'gateway_tls' },
      'gateway.tls.enabled but certPath/keyPath missing and autoGenerate=false',
    );
    return { enabled: false };
  }
  return {
    enabled: true,
    port: cfg.gateway?.port ?? 18790,
  };
}
