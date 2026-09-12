import { createHash } from 'node:crypto';

import { getKnowledgeSourceItem } from '../storage/sqlite/knowledge-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

export function emailFields(text: string | undefined | null): { threadId?: string; subject?: string; sender?: string; labels?: string[] } {
  try {
    const value: unknown = JSON.parse(text ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const row = value as Record<string, unknown>;
    return { ...(typeof row.threadId === 'string' ? { threadId: row.threadId } : {}),
      ...(typeof row.subject === 'string' ? { subject: row.subject } : {}),
      ...(typeof row.sender === 'string' ? { sender: row.sender } : {}),
      ...(Array.isArray(row.labels) ? { labels: row.labels.filter((label): label is string => typeof label === 'string') } : {}) };
  } catch { return {}; }
}

/** Thread identity includes the account and collection; provider thread IDs are not globally unique. */
export function readMailThread(sourceItemId: string) {
  const origin = getKnowledgeSourceItem(sourceItemId);
  if (!origin || origin.deletedAt || origin.itemType !== 'email') return null;
  const threadId = emailFields(origin.normalizedText)?.threadId;
  if (typeof threadId !== 'string' || !threadId.trim()) return null;
  if (emailFields(origin.normalizedText).labels?.some(label => ['DRAFT', 'TRASH', 'SPAM'].includes(label))) return null;
  const rows = getSqliteDatabase().prepare(`SELECT item_id FROM knowledge_source_items
    WHERE source_instance_id = ? AND collection_scope = ? AND item_type = 'email' AND deleted_at IS NULL
    AND json_extract(CASE WHEN json_valid(normalized_text) THEN normalized_text ELSE '{}' END, '$.threadId') = ?
    AND json_extract(metadata_json, '$.connectionId') = ?
    AND NOT EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(normalized_text) THEN normalized_text ELSE '{}' END, '$.labels') WHERE value IN ('DRAFT', 'TRASH', 'SPAM'))
    ORDER BY occurred_at DESC, item_id DESC LIMIT 30`).all(origin.sourceInstanceId, origin.collectionScope, threadId, String(origin.metadata.connectionId)) as Array<{ item_id: string }>;
  const items = rows.map(row => getKnowledgeSourceItem(row.item_id)!).reverse();
  const threadKey = createHash('sha256').update(JSON.stringify([origin.sourceInstanceId, origin.collectionScope, origin.metadata.connectionId, threadId])).digest('hex');
  const fingerprint = createHash('sha256').update(JSON.stringify(items.map(item => [item.id, item.contentHash, item.occurredAt]))).digest('hex');
  return { origin, items, threadKey, fingerprint };
}
