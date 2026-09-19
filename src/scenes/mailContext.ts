import type { DatabaseSync } from 'node:sqlite';

import type { SceneContextProvider, SceneEvidence } from './execution.js';

type MailRow = {
  item_id: string; source_instance_id: string; collection_scope: string; content_hash: string;
  normalized_text: string; sensitivity: string; metadata_json: string; occurred_at: number;
};

/** Reads a bounded, account-scoped thread from synchronized connector knowledge. */
export class SceneMailContextProvider implements SceneContextProvider {
  readonly id = 'mail';
  constructor(private readonly db: DatabaseSync, private readonly clock: () => number = Date.now) {}

  async read(input: Parameters<SceneContextProvider['read']>[0]): Promise<SceneEvidence[]> {
    input.signal.throwIfAborted();
    if (!input.permissions.contextProviders.includes(this.id)) throw new Error('Mail context permission is required');
    const origin = this.db.prepare(`SELECT * FROM knowledge_source_items WHERE item_id = ? AND item_type = 'email' AND deleted_at IS NULL`)
      .get(input.subjectId) as MailRow | undefined;
    if (!origin) throw new Error('Mail source unavailable');
    const metadata = JSON.parse(origin.metadata_json) as Record<string, unknown>;
    if (metadata.workspaceId !== input.activation.workspaceId || typeof metadata.connectionId !== 'string') throw new Error('Mail source workspace mismatch');
    const connection = this.db.prepare(`SELECT c.account_id FROM connector_connections c JOIN connector_accounts a ON a.id = c.account_id
      WHERE c.id = ? AND c.status = 'active' AND c.principal_id = ? AND a.principal_id = ?`)
      .get(metadata.connectionId, input.activation.ownerId, input.activation.ownerId) as { account_id: string } | undefined;
    if (!connection || !input.permissions.accountIds.includes(connection.account_id)) throw new Error('Mail account permission is required');
    const fields = JSON.parse(origin.normalized_text) as { threadId?: unknown; labels?: unknown };
    if (typeof fields.threadId !== 'string' || !fields.threadId.trim()) throw new Error('Mail thread identity unavailable');
    if (Array.isArray(fields.labels) && fields.labels.some((label) => ['DRAFT', 'TRASH', 'SPAM'].includes(label))) throw new Error('Mail origin is not an active message');
    const sync = this.db.prepare(`SELECT status, started_at, finished_at FROM knowledge_sync_runs
      WHERE source_instance_id = ? AND collection_scope = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`)
      .get(origin.source_instance_id, origin.collection_scope) as { status: string; started_at: number; finished_at: number | null } | undefined;
    const now = this.clock();
    if (!sync || sync.status !== 'succeeded' || sync.finished_at === null || sync.finished_at < sync.started_at || sync.started_at > now || sync.finished_at > now
      || sync.started_at + 30 * 60_000 <= now || (input.notBefore !== undefined && sync.started_at < input.notBefore)) throw new Error('Mail synchronization is stale or incomplete');
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
