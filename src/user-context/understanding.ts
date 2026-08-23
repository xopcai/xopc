import { createHash } from 'node:crypto';

import type { UnderstandingKind, UserContextScope, UserUnderstanding } from './domain.js';
import { isNearDuplicateUnderstanding } from './understandingQuality.js';

export function canonicalUnderstandingKey(kind: UnderstandingKind, statement: string): string {
  const normalized = statement.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return `${kind}:${createHash('sha256').update(normalized).digest('hex').slice(0, 20)}`;
}

export function isSameUserContextScope(left: UserContextScope, right: UserContextScope): boolean {
  return left.type === right.type && left.id === right.id;
}

const NEGATION = /\b(?:do not|don't|never|avoid|without)\b|(?:不要|不用|无需|从不|避免|禁止)/i;

function withoutNegation(statement: string): string {
  return statement.replace(NEGATION, '').replace(/\s+/g, ' ').trim();
}

export function findDuplicateUnderstanding(
  understandings: UserUnderstanding[],
  input: { kind: UnderstandingKind; statement: string; canonicalKey: string; scope: UserContextScope; excludeId?: string },
): UserUnderstanding | undefined {
  const inputIsNegative = NEGATION.test(input.statement);
  return understandings.find((item) =>
    item.id !== input.excludeId
    && item.kind === input.kind
    && item.status !== 'archived'
    && item.status !== 'rejected'
    && isSameUserContextScope(item.scope, input.scope)
    && (item.canonicalKey === input.canonicalKey
      || (NEGATION.test(item.statement) === inputIsNegative
        && isNearDuplicateUnderstanding(item.statement, input.statement))));
}

export function findContradictoryUnderstanding(
  understandings: UserUnderstanding[],
  input: { kind: UnderstandingKind; statement: string; scope: UserContextScope },
): UserUnderstanding | undefined {
  const inputIsNegative = NEGATION.test(input.statement);
  return understandings.find((item) =>
    item.kind === input.kind
    && item.status === 'active'
    && isSameUserContextScope(item.scope, input.scope)
    && NEGATION.test(item.statement) !== inputIsNegative
    && isNearDuplicateUnderstanding(withoutNegation(item.statement), withoutNegation(input.statement)));
}
