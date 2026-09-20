import type { DatabaseSync } from 'node:sqlite';

import type { SceneContextProvider, SceneEvidence } from './execution.js';
import type { ScenePrincipal } from './contracts.js';
import { SceneSourceNotReady } from './readiness.js';

type MailRow = {
  item_id: string; source_instance_id: string; collection_scope: string; content_hash: string;
  normalized_text: string; sensitivity: string; metadata_json: string; occurred_at: number;
};

const accountJoin = `JOIN connector_accounts a ON a.id = c.account_id AND a.current_connection_id = c.id
  AND a.principal_id = c.principal_id AND a.connector_id = c.connector_id
  JOIN connector_installations installation ON installation.id = c.installation_id
  AND installation.principal_id = c.principal_id AND installation.connector_id = c.connector_id`;
// A scene has no Agent identity yet, so Agent-restricted accounts fail closed.
const accountPolicy = `a.enabled = 1 AND installation.enabled = 1 AND c.status = 'active'
  AND json_array_length(installation.allowed_agent_ids_json) = 0 AND a.allowed_agent_ids_json IS NULL
  AND (installation.selected_account_ids_json = 'null' OR EXISTS
    (SELECT 1 FROM json_each(installation.selected_account_ids_json) WHERE value = a.id))`;

/** Reads a bounded, account-scoped thread from synchronized connector knowledge. */
export class SceneMailContextProvider implements SceneContextProvider {
  readonly id = 'mail';
  constructor(private readonly db: DatabaseSync, private readonly clock: () => number = Date.now) {}

  /** Picker metadata only; choosing an item still requires explicit activation consent. */
  listSources(principal: ScenePrincipal, limit = 50, afterId = '') {
    if (!principal.ownerId.trim() || !principal.workspaceId.trim()) throw new Error('Scene principal is required');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid source list limit');
    return this.db.prepare(`SELECT k.item_id AS id, a.id AS accountId,
        substr(json_extract(k.normalized_text, '$.subject'), 1, 300) AS subject,
        substr(json_extract(k.normalized_text, '$.sender'), 1, 300) AS sender
      FROM knowledge_source_items k
      JOIN connector_connections c ON c.id = json_extract(CASE WHEN json_valid(k.metadata_json) THEN k.metadata_json ELSE '{}' END, '$.connectionId')
      ${accountJoin}
      WHERE k.item_type = 'email' AND k.deleted_at IS NULL AND k.sensitivity NOT IN ('secret', 'regulated')
        AND json_valid(k.normalized_text) AND json_valid(k.metadata_json)
        AND json_extract(k.metadata_json, '$.workspaceId') = ? AND c.principal_id = ?
        AND ${accountPolicy}
        AND (c.expires_at IS NULL OR julianday(c.expires_at) > julianday(?, 'unixepoch'))
        AND json_type(k.normalized_text, '$.threadId') = 'text' AND length(trim(json_extract(k.normalized_text, '$.threadId'))) > 0
        AND NOT EXISTS (SELECT 1 FROM json_each(k.normalized_text, '$.labels') WHERE value IN ('DRAFT', 'TRASH', 'SPAM'))
        AND k.item_id > ? ORDER BY k.item_id LIMIT ?`)
      .all(principal.workspaceId, principal.ownerId, this.clock() / 1000, afterId, limit)
      .map((row) => ({ id: String(row.id), accountId: String(row.accountId), subject: typeof row.subject === 'string' ? row.subject : '', sender: typeof row.sender === 'string' ? row.sender : '' }));
  }

  async read(input: Parameters<SceneContextProvider['read']>[0]): Promise<SceneEvidence[]> {
    input.signal.throwIfAborted();
    if (!input.permissions.contextProviders.includes(this.id)) throw new Error('Mail context permission is required');
    const origin = this.db.prepare(`SELECT * FROM knowledge_source_items WHERE item_id = ? AND item_type = 'email' AND deleted_at IS NULL`)
      .get(input.subjectId) as MailRow | undefined;
    if (!origin) throw new Error('Mail source unavailable');
    const metadata = JSON.parse(origin.metadata_json) as Record<string, unknown>;
    if (metadata.workspaceId !== input.activation.workspaceId || typeof metadata.connectionId !== 'string') throw new Error('Mail source workspace mismatch');
    const connection = this.db.prepare(`SELECT c.account_id, c.expires_at FROM connector_connections c
      ${accountJoin} WHERE c.id = ? AND c.principal_id = ? AND ${accountPolicy}`)
      .get(metadata.connectionId, input.activation.ownerId) as { account_id: string; expires_at: string | null } | undefined;
    if (!connection || !input.permissions.accountIds.includes(connection.account_id)) throw new Error('Mail account permission is required');
    if (connection.expires_at !== null && !(Date.parse(connection.expires_at) > this.clock())) throw new Error('Mail connection is expired');
    const fields = JSON.parse(origin.normalized_text) as { threadId?: unknown; labels?: unknown };
    if (typeof fields.threadId !== 'string' || !fields.threadId.trim()) throw new Error('Mail thread identity unavailable');
    if (Array.isArray(fields.labels) && fields.labels.some((label) => ['DRAFT', 'TRASH', 'SPAM'].includes(label))) throw new Error('Mail origin is not an active message');
    const sync = this.db.prepare(`SELECT status, started_at, finished_at FROM knowledge_sync_runs
      WHERE source_instance_id = ? AND collection_scope = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`)
      .get(origin.source_instance_id, origin.collection_scope) as { status: string; started_at: number; finished_at: number | null } | undefined;
    const now = this.clock();
    if (!sync || sync.status !== 'succeeded' || sync.finished_at === null || sync.finished_at < sync.started_at || sync.started_at > now || sync.finished_at > now
      || sync.started_at + 30 * 60_000 <= now || (input.notBefore !== undefined && sync.started_at < input.notBefore)) throw new SceneSourceNotReady();
    const messages = this.db.prepare(`SELECT * FROM knowledge_source_items
      WHERE source_instance_id = ? AND collection_scope = ? AND item_type = 'email' AND deleted_at IS NULL
      AND json_valid(normalized_text) AND json_valid(metadata_json)
      AND json_extract(normalized_text, '$.threadId') = ?
      AND json_extract(metadata_json, '$.connectionId') = ?
      AND json_extract(metadata_json, '$.workspaceId') = ?
      AND NOT EXISTS (SELECT 1 FROM json_each(normalized_text, '$.labels') WHERE value IN ('DRAFT', 'TRASH', 'SPAM'))
      ORDER BY occurred_at, item_id LIMIT 31`)
      .all(origin.source_instance_id, origin.collection_scope, fields.threadId, metadata.connectionId, input.activation.workspaceId) as MailRow[];
    if (!messages.length || messages.length > 30) throw new Error('Mail thread cannot be read completely within its budget');
    if (messages.some((item) => ['secret', 'regulated'].includes(item.sensitivity))) throw new Error('Mail thread contains restricted evidence');
    input.signal.throwIfAborted();
    return messages.map((item) => ({
      id: item.item_id, subjectId: input.subjectId, ownerId: input.activation.ownerId, workspaceId: input.activation.workspaceId,
      accountId: connection.account_id, revision: item.content_hash, freshUntil: sync.started_at + 30 * 60_000,
      ...(item.occurred_at !== null ? { occurredAt: item.occurred_at } : {}),
      content: item.normalized_text,
    }));
  }
}
