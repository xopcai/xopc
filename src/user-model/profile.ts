import { getActiveAssertionForSlot, reconcileAssertion, setAssertionStatus } from './repository.js';
import type { AssertionCandidate } from './domain.js';
import { canUseAssertion } from './usage-policy.js';

export type UserProfileField = 'callName' | 'role' | 'pronouns' | 'timezone' | 'locale';
export type UserProfilePatch = Partial<Record<UserProfileField, string>>;
export type UserProfileSnapshot = Partial<Record<UserProfileField, string>>;

export const USER_PROFILE_IDENTITY_RULE = 'Use confirmed profile data or explicit user self-identification for identity. A preferred callName is not necessarily a legal name. Current explicit corrections take priority. Assistant guesses, examples and user questions about a name are not confirmation. Missing details are unknown: consult permitted memory/history before answering, preserve uncertainty and never invent an identity.';

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

/** Confirmed profile data shared by text and voice; UI snapshots are not model authorization. */
export function getUserProfileContext(agentId: string, now = Date.now()) {
  return Object.keys(PROFILE_FIELDS).flatMap(key => {
    const field = key as UserProfileField;
    const assertion = activeProfileAssertion(field);
    return assertion?.authority === 'user_explicit' && typeof assertion.value === 'string'
      && canUseAssertion(assertion, now, { use: 'answer', agentId })
      ? [{ field, predicate: PROFILE_FIELDS[field].predicate, assertion, value: assertion.value }] : [];
  });
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
    }, now, { restoreDeleted: true });
  }
  return getUserProfileSnapshot();
}
