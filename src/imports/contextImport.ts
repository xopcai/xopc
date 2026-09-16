import { listKnowledgeItems, writeKnowledgeItem } from '../knowledge-memory/index.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { digest } from './files.js';
import type { ImportCandidate } from './types.js';

/** Small source records fit the existing retrieval budget without injecting entire documents. */
export function importContextDocument(item: ImportCandidate, projectId?: string): 'created' | 'unchanged' | 'kept' {
  const content = item.content?.trim();
  if (!content) throw new Error('Missing context');
  const scope = projectId ? { type: 'project' as const, id: projectId } : { type: 'global' as const };
  const canonicalKey = `product-import:${item.source}:${digest(item.location)}`;
  return runSqliteWriteTransaction(() => {
    const existing = listKnowledgeItems({ canonicalKey, scope, statuses: ['active', 'candidate', 'needs_review', 'stale', 'archived', 'rejected'] })[0];
    if (existing) return existing.source.hash === item.hash ? 'unchanged' : 'kept';
    for (let offset = 0, part = 0; offset < content.length; offset += 2000, part++) {
      const chunk = content.slice(offset, offset + 2000).trim();
      if (!chunk) continue;
      writeKnowledgeItem({
        kind: 'note', scope, content: chunk,
        canonicalKey: part === 0 ? canonicalKey : `${canonicalKey}:part:${part}`,
        recordClass: 'source_index', status: 'active', confidence: 0.7, importance: 0.7,
        originClass: 'system', source: { kind: 'product_import', product: item.source, path: item.location, hash: item.hash, part, importedAt: Date.now() },
      });
    }
    return 'created';
  });
}
