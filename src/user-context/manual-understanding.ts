import { createUnderstanding, listUnderstandings } from '../storage/sqlite/index.js';
import type { UnderstandingKind, UserContextScope, UserUnderstanding } from './domain.js';
import { canonicalUnderstandingKey, findDuplicateUnderstanding } from './understanding.js';

export function createManualUnderstanding(input: {
  content: string;
  kind: UnderstandingKind;
  scope: UserContextScope;
  sensitivity: UserUnderstanding['sensitivity'];
  durability: UserUnderstanding['durability'];
  disclosurePolicy: UserUnderstanding['disclosurePolicy'];
}): { understanding: UserUnderstanding; created: boolean } {
  const statement = input.content.trim();
  const key = canonicalUnderstandingKey(input.kind, statement);
  const duplicate = findDuplicateUnderstanding(listUnderstandings(), {
    kind: input.kind,
    statement,
    canonicalKey: key,
    scope: input.scope,
  });
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
