import {
  getUserPerson,
  listUnderstandings,
  listUserPeople,
  mergeUserPeople,
  summarizeUserPeople,
  updateUserPerson,
} from '../../storage/sqlite/index.js';
import { ensureUserPeopleIndex } from './indexer.js';
import type { UserPerson, UserPersonKind } from './types.js';

function withUnderstanding(person: UserPerson): UserPerson {
  const understanding = listUnderstandings().find((item) => (
    item.kind === 'relationship'
    && item.payload.personId === person.id
    && !['archived', 'rejected'].includes(item.status)
  ));
  return understanding ? {
    ...person,
    relationshipUnderstanding: {
      id: understanding.id,
      statement: understanding.statement,
      status: understanding.status,
    },
  } : person;
}

export function listUserRelationships(options: {
  query?: string;
  kind?: UserPersonKind;
  sourceInstanceId?: string;
  includeHidden?: boolean;
  hiddenOnly?: boolean;
  cursor?: string;
  limit?: number;
} = {}) {
  ensureUserPeopleIndex();
  const offset = options.cursor && /^\d+$/.test(options.cursor) ? Number(options.cursor) : 0;
  const result = listUserPeople({
    query: options.query,
    kind: options.kind,
    sourceInstanceId: options.sourceInstanceId,
    includeHidden: options.includeHidden,
    hiddenOnly: options.hiddenOnly,
    offset,
    limit: options.limit,
  });
  return {
    items: result.items.map(withUnderstanding),
    summary: summarizeUserPeople(),
    total: result.total,
    ...(result.nextOffset === undefined ? {} : { nextCursor: String(result.nextOffset) }),
  };
}

export function getUserRelationship(personId: string): UserPerson | null {
  ensureUserPeopleIndex();
  const person = getUserPerson(personId);
  return person ? withUnderstanding(person) : null;
}

export function patchUserRelationship(personId: string, patch: {
  displayName?: string | null;
  kind?: UserPersonKind | null;
  hidden?: boolean;
}): UserPerson | null {
  const person = updateUserPerson(personId, patch);
  return person ? withUnderstanding(person) : null;
}

export function mergeUserRelationships(sourcePersonId: string, targetPersonId: string): UserPerson | null {
  const person = mergeUserPeople(sourcePersonId, targetPersonId);
  return person ? withUnderstanding(person) : null;
}
