import { createHash } from 'node:crypto';

import { createUnderstanding, listUnderstandings } from '../storage/sqlite/index.js';
import type { UnderstandingKind, UserContextScope, UserUnderstanding } from './domain.js';

function canonicalKey(kind: UnderstandingKind, statement: string): string {
  const normalized = statement.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return `${kind}:${createHash('sha256').update(normalized).digest('hex').slice(0, 20)}`;
}

function sameScope(left: UserContextScope, right: UserContextScope): boolean {
  return left.type === right.type && left.id === right.id;
}

export function createManualUnderstanding(input: {
  content: string;
  kind: UnderstandingKind;
  scope: UserContextScope;
  sensitivity: UserUnderstanding['sensitivity'];
  durability: UserUnderstanding['durability'];
  disclosurePolicy: UserUnderstanding['disclosurePolicy'];
}): { understanding: UserUnderstanding; created: boolean } {
  const statement = input.content.trim();
  const key = canonicalKey(input.kind, statement);
  const duplicate = listUnderstandings().find((item) =>
    item.canonicalKey === key
    && item.status !== 'archived'
    && item.status !== 'rejected'
    && sameScope(item.scope, input.scope));
  if (duplicate) return { understanding: duplicate, created: false };
  const understanding = createUnderstanding({
    kind: input.kind,
    canonicalKey: key,
    status: 'active',
    scope: input.scope,
    explicitness: 'explicit',
    durability: input.durability,
    sensitivity: input.sensitivity,
    disclosurePolicy: input.disclosurePolicy,
    confidence: 1,
    statement,
    createdBy: 'user',
    changeReason: 'Created with /remember',
  });
  return { understanding, created: true };
}
