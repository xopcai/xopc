import { randomUUID } from 'node:crypto';
import { getSqliteDatabase } from './transaction.js';

export interface DeviceGrantAuditEvent {
  id: string; conversationId: string; requestorPrincipalId: string; targetPrincipalId: string; targetEndpointId: string;
  toolName: string; argumentsDigest: string; event: 'issued' | 'reserved' | 'consumed' | 'revoked' | 'expired';
}
export function recordDeviceGrantEvent(value: DeviceGrantAuditEvent): void {
  getSqliteDatabase().prepare(`INSERT INTO device_grant_events(id, grant_id, conversation_id, requestor_principal_id,
    target_principal_id, target_endpoint_id, tool_name, arguments_sha256, event, created_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), value.id, value.conversationId, value.requestorPrincipalId, value.targetPrincipalId,
      value.targetEndpointId, value.toolName, value.argumentsDigest, value.event, Date.now());
}
