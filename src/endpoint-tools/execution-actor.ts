import type { GatewayPrincipal } from '../gateway/security/gateway-principal.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { getDevice, isDeviceAccessSessionActive } from '../storage/sqlite/device-access-repository.js';

export function deviceExecutionPrincipalId(principal: GatewayPrincipal): string {
  return principal.kind === 'owner' && principal.browserSessionId ? 'gateway-owner' : principal.principalId;
}

interface AcceptedActor { principal: GatewayPrincipal; acceptedAt: number }
const actors = new DurableState<AcceptedActor>('device.input-actors');
const actorKey = (conversationId: string, clientMessageId: string) => JSON.stringify([conversationId, clientMessageId]);

/** Only authenticated input handlers may establish the identity of a queued request. */
export function recordDeviceExecutionActor(conversationId: string, clientMessageId: string, principal: GatewayPrincipal): void {
  principal = { ...principal, principalId: deviceExecutionPrincipalId(principal) };
  if (!clientMessageId.trim() || clientMessageId.length > 200) return;
  actors.update(actorKey(conversationId, clientMessageId), previous => {
    if (previous && previous.principal.principalId !== principal.principalId) throw new Error('Input belongs to another principal');
    return { value: previous ?? { principal, acceptedAt: Date.now() }, result: undefined };
  });
}

/** Resolve the actual executing input, never the most recently submitted message or a model argument. */
export function currentDeviceExecutionActor(conversationId: string, runId?: string): GatewayPrincipal | undefined {
  if (!isXopcDatabaseOpen()) return;
  const row = getSqliteDatabase().prepare(`SELECT i.client_message_id FROM session_inputs i
    WHERE i.conversation_id=? AND i.run_id=COALESCE(?,
      (SELECT active_run_id FROM session_input_runtime WHERE conversation_id=?)) ORDER BY i.position ASC LIMIT 1`)
    .get(conversationId, runId ?? null, conversationId) as { client_message_id: string } | undefined;
  if (!row) return;
  const actor = actors.get(actorKey(conversationId, row.client_message_id));
  if (!actor || Date.now() - actor.acceptedAt > 24 * 60 * 60 * 1_000) return;
  const principal = actor.principal;
  if (principal.browserSessionId && !getSqliteDatabase().prepare('SELECT 1 FROM browser_sessions WHERE session_id=? AND expires_at>?')
    .get(principal.browserSessionId, Date.now())) return;
  if (principal.kind === 'device') {
    const device = principal.deviceId ? getDevice(principal.deviceId) : undefined;
    if (!device || device.revokedAt !== undefined || principal.accessSessionId
      && !isDeviceAccessSessionActive(device.id, principal.accessSessionId)) return;
    return { ...principal, scopes: principal.scopes.filter(scope => device.scopes.includes(scope)) };
  }
  return principal;
}
