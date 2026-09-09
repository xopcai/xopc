import { getActiveAssertionForSlot, reconcileAssertion, setAssertionStatus } from './repository.js';
import type { AssertionCandidate } from './domain.js';

export type UserProfileField = 'callName' | 'role' | 'pronouns' | 'timezone' | 'locale';
export type UserProfilePatch = Partial<Record<UserProfileField, string>>;
export type UserProfileSnapshot = Partial<Record<UserProfileField, string>>;

const PROFILE_FIELDS = {
  callName: {
    predicate: 'identity.call_name', kind: 'identity', volatility: 'stable', importance: 0.95,
    statement: (value: string) => `Prefers to be called ${value}.`,
  },
  role: {
    predicate: 'identity.role', kind: 'identity', volatility: 'slow', importance: 0.9,
    statement: (value: string) => `Role: ${value}.`,
  },
  pronouns: {
    predicate: 'identity.pronouns', kind: 'identity', volatility: 'stable', importance: 0.75,
    statement: (value: string) => `Pronouns: ${value}.`,
  },
  timezone: {
    predicate: 'preference.timezone', kind: 'preference', volatility: 'slow', importance: 0.85,
    statement: (value: string) => `Timezone: ${value}.`,
  },
  locale: {
    predicate: 'preference.locale', kind: 'preference', volatility: 'slow', importance: 0.85,
    statement: (value: string) => `Language and locale: ${value}.`,
  },
} as const satisfies Record<UserProfileField, {
  predicate: string;
  kind: AssertionCandidate['kind'];
  volatility: AssertionCandidate['volatility'];
  importance: number;
  statement: (value: string) => string;
}>;

function activeProfileAssertion(field: UserProfileField) {
  return getActiveAssertionForSlot({
    subject: { type: 'user', id: 'self' },
    predicate: PROFILE_FIELDS[field].predicate,
    scope: { type: 'global' },
  });
}

export function getUserProfileSnapshot(): UserProfileSnapshot {
  return Object.fromEntries(Object.keys(PROFILE_FIELDS).flatMap((key) => {
    const value = activeProfileAssertion(key as UserProfileField)?.value;
    return typeof value === 'string' ? [[key, value]] : [];
  }));
}

export function applyUserProfilePatch(input: UserProfilePatch, now = Date.now()): UserProfileSnapshot {
  for (const [key, rawValue] of Object.entries(input) as Array<[UserProfileField, string]>) {
    const field = PROFILE_FIELDS[key];
    const value = rawValue.trim();
    const current = activeProfileAssertion(key);
    if (!value) {
      if (current) setAssertionStatus(current.id, 'archived', {
        actor: 'user', reason: 'Profile field cleared by user.', now,
      });
      continue;
    }
    reconcileAssertion({
      subject: { type: 'user', id: 'self' },
      predicate: field.predicate,
      cardinality: 'single',
      scope: { type: 'global' },
      kind: field.kind,
      value,
      normalizedValue: value.toLocaleLowerCase(),
      statement: field.statement(value),
      authority: 'user_explicit',
      confidence: 1,
      declaredImportance: field.importance,
      inferredImportance: field.importance,
      consequence: 'medium',
      actionability: 0.9,
      volatility: field.volatility,
      sensitivity: 'normal',
      disclosurePolicy: 'referenceable',
      observedAt: now,
      createdBy: 'user',
      ...(current ? { correctionOfAssertionId: current.id } : {}),
    }, now);
  }
  return getUserProfileSnapshot();
}
