import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** Index the retained source text; source deletion removes chunks through the FK. */
export function replaceKnowledgeChunks(db: DatabaseSync, item: {
  id: string; contentHash: string; normalizedText?: string; sensitivity: string; deletedAt?: string; consentReceiptId?: string;
}): void {
  db.prepare('DELETE FROM knowledge_source_chunks WHERE source_item_id = ?').run(item.id);
  if (!item.normalizedText || item.deletedAt || item.sensitivity === 'secret' || item.sensitivity === 'regulated') return;
  const text = item.normalizedText;
  for (let offset = 0, ordinal = 0; offset < text.length; ordinal += 1) {
    let end = Math.min(text.length, offset + 2400);
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n', end);
      if (boundary > offset + 1200) end = boundary + 1;
    }
    const id = createHash('sha256').update(`${item.id}:${item.contentHash}:${ordinal}`).digest('hex');
    db.prepare(`INSERT INTO knowledge_source_chunks(chunk_id, source_item_id, source_version, consent_receipt_id, ordinal, locator, text)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, item.id, item.contentHash, item.consentReceiptId ?? null, ordinal,
      JSON.stringify({ startChar: offset, endChar: end }), text.slice(offset, end));
    if (end === text.length) break;
    offset = end - 150;
  }
}
