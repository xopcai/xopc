import { createLogger } from '../utils/logger.js';

const log = createLogger('TunnelAudit');

export type TunnelAuditEvent =
  | 'tunnel.consent'
  | 'tunnel.start'
  | 'tunnel.stop'
  | 'tunnel.release'
  | 'tunnel.start_denied'
  | 'tunnel.pair'
  | 'tunnel.exchange_token'
  | 'tunnel.registration_authorized'
  | 'tunnel.enable_lan_pairing';

export function logTunnelAudit(
  event: TunnelAuditEvent,
  fields: Record<string, unknown>,
  message: string,
): void {
  log.info({ phase: event, ...fields }, message);
}
