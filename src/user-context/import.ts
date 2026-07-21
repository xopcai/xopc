import type { MemoryRecord } from '../agent/memory/types.js';
import { isUserContextMemoryKind } from './projection.js';

export type PreparedUserContextImport = {
  statement: string;
  kind: MemoryRecord['kind'];
  sensitivity: NonNullable<MemoryRecord['sensitivity']>;
  durability: MemoryRecord['durability'];
  disclosurePolicy: MemoryRecord['disclosurePolicy'];
};

export function prepareUserContextImport(
  candidates: unknown[],
  existingStatements: Iterable<string>,
): { imports: PreparedUserContextImport[]; skippedCount: number } {
  const known = new Set(Array.from(existingStatements, (statement) => statement.trim().toLocaleLowerCase()));
  const imports: PreparedUserContextImport[] = [];
  let skippedCount = 0;

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      skippedCount += 1;
      continue;
    }
    const item = candidate as Record<string, unknown>;
    const statement = typeof item.statement === 'string' ? item.statement.trim() : '';
    const normalized = statement.toLocaleLowerCase();
    if (
      !statement
      || statement.length > 5_000
      || known.has(normalized)
      || item.status === 'archived'
      || item.status === 'rejected'
    ) {
      skippedCount += 1;
      continue;
    }
    const kind = isUserContextMemoryKind(item.kind) ? item.kind : 'preference';
    const sensitivity = typeof item.sensitivity === 'string'
      && ['normal', 'personal', 'secret', 'regulated'].includes(item.sensitivity)
      ? item.sensitivity as NonNullable<MemoryRecord['sensitivity']>
      : 'normal';
    const durability = typeof item.durability === 'string'
      && ['ephemeral', 'durable', 'recurring'].includes(item.durability)
      ? item.durability as MemoryRecord['durability']
      : 'durable';
    known.add(normalized);
    const disclosurePolicy = typeof item.disclosurePolicy === 'string'
      && ['silent', 'referenceable', 'ask_before_reference'].includes(item.disclosurePolicy)
      ? item.disclosurePolicy as MemoryRecord['disclosurePolicy']
      : 'referenceable';
    imports.push({ statement, kind, sensitivity, durability, disclosurePolicy });
  }

  return { imports, skippedCount };
}
