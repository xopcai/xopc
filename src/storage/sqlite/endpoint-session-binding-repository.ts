import { getSqliteDatabase } from './transaction.js';

export interface StoredEndpointSessionBinding {
  sessionKey: string;
  endpointId: string;
  boundAt: number;
}

type BindingRow = {
  session_key: string;
  endpoint_id: string;
  bound_at: number;
};

function fromRow(row: BindingRow): StoredEndpointSessionBinding {
  return {
    sessionKey: row.session_key,
    endpointId: row.endpoint_id,
    boundAt: row.bound_at,
  };
}

export function getEndpointSessionBinding(sessionKey: string): StoredEndpointSessionBinding | undefined {
  const row = getSqliteDatabase().prepare(`
    SELECT session_key, endpoint_id, bound_at
    FROM endpoint_session_bindings
    WHERE session_key = ?
  `).get(sessionKey) as BindingRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function setEndpointSessionBinding(
  binding: StoredEndpointSessionBinding,
): StoredEndpointSessionBinding {
  getSqliteDatabase().prepare(`
    INSERT INTO endpoint_session_bindings (session_key, endpoint_id, bound_at)
    VALUES (?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET
      endpoint_id = excluded.endpoint_id,
      bound_at = excluded.bound_at
  `).run(binding.sessionKey, binding.endpointId, binding.boundAt);
  return binding;
}

export function deleteEndpointSessionBinding(sessionKey: string): boolean {
  return getSqliteDatabase()
    .prepare('DELETE FROM endpoint_session_bindings WHERE session_key = ?')
    .run(sessionKey).changes > 0;
}
