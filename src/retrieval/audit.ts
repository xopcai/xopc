import { createHash } from 'node:crypto';

export function retrievalQueryAuditValue(query: string): string {
  const normalized = query.normalize('NFKC').trim();
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 24);
  return `sha256:${digest};length=${[...normalized].length}`;
}
