import { getSqliteDatabase } from './transaction.js';

export interface StoredEndpointSessionBinding {
  conversationId: string;
  endpointId: string;
  boundAt: number;
}

type BindingRow = {
  conversation_id: string;
  endpoint_id: string;
  bound_at: number;
};

function fromRow(row: BindingRow): StoredEndpointSessionBinding {
  return {
    conversationId: row.conversation_id,
    endpointId: row.endpoint_id,
    boundAt: row.bound_at,
  };
}

export function getEndpointSessionBinding(conversationId: string): StoredEndpointSessionBinding | undefined {
  const row = getSqliteDatabase().prepare(`
    SELECT conversation_id, endpoint_id, bound_at
    FROM endpoint_session_bindings
    WHERE conversation_id = ?
  `).get(conversationId) as BindingRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function setEndpointSessionBinding(
  binding: StoredEndpointSessionBinding,
): StoredEndpointSessionBinding {
  getSqliteDatabase().prepare(`
    INSERT INTO endpoint_session_bindings (conversation_id, endpoint_id, bound_at)
    VALUES (?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET
      endpoint_id = excluded.endpoint_id,
      bound_at = excluded.bound_at
  `).run(binding.conversationId, binding.endpointId, binding.boundAt);
  return binding;
}

export function deleteEndpointSessionBinding(conversationId: string): boolean {
  return getSqliteDatabase()
    .prepare('DELETE FROM endpoint_session_bindings WHERE conversation_id = ?')
    .run(conversationId).changes > 0;
}

export function deleteEndpointSessionBindingsByPrincipal(principalId: string): number {
  return Number(getSqliteDatabase().prepare(`
    DELETE FROM endpoint_session_bindings
    WHERE endpoint_id IN (
      SELECT endpoint_id FROM endpoint_instance_bindings WHERE principal_id = ?
    )
  `).run(principalId).changes);
}
