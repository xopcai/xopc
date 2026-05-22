import { createLogger } from '../utils/logger.js';

const log = createLogger('ShareAudit');

export type ShareAuditEvent =
  | 'share.create'
  | 'share.access'
  | 'share.access_denied'
  | 'share.revoke'
  | 'share.expire'
  | 'share.update'
  | 'share.path_changed';

export function logShareAudit(
  event: ShareAuditEvent,
  fields: Record<string, unknown>,
  message: string,
): void {
  log.info({ phase: event, ...fields }, message);
}
