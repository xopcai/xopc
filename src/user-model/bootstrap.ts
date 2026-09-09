import {
  createCollaborationRule,
  listCollaborationRules,
} from '../storage/sqlite/collaboration-rule-repository.js';
import { createPriorityWindow, createUserGoal, listPriorityWindows, listUserGoals } from './goals.js';
import { applyUserProfilePatch, type UserProfilePatch } from './profile.js';
import { reconcileAssertion } from './repository.js';
import type { AssertionKind } from './domain.js';

export interface UserModelBootstrapInput {
  profile: UserProfilePatch;
  responsibilities?: string[];
  goals?: string[];
  communicationPreferences?: string[];
  boundaries?: string[];
  relationships?: string[];
}

function statements(values: string[] | undefined, limit: number): string[] {
  return [...new Set((values ?? []).map((value) => value.trim().slice(0, 500)).filter(Boolean))].slice(0, limit);
}

function addExplicitAssertions(
  values: string[],
  input: { predicate: string; kind: AssertionKind; importance: number },
  now: number,
): number {
  let created = 0;
  for (const statement of values) {
    const result = reconcileAssertion({
      subject: { type: 'user', id: 'self' },
      predicate: input.predicate,
      cardinality: 'multiple',
      scope: { type: 'global' },
      kind: input.kind,
      value: statement,
      normalizedValue: statement.toLocaleLowerCase(),
      statement,
      authority: 'user_explicit',
      confidence: 1,
      declaredImportance: input.importance,
      inferredImportance: input.importance,
      consequence: 'medium',
      actionability: 0.8,
      volatility: 'slow',
      sensitivity: input.kind === 'relationship' ? 'personal' : 'normal',
      disclosurePolicy: 'referenceable',
      observedAt: now,
      createdBy: 'user',
    }, now);
    if (result.action !== 'deduplicated') created += 1;
  }
  return created;
}

function addRules(
  category: 'communication' | 'boundary',
  values: string[],
): number {
  const existing = new Set(listCollaborationRules()
    .filter((rule) => rule.category === category && rule.status !== 'archived')
    .map((rule) => rule.statement.toLocaleLowerCase()));
  let created = 0;
  for (const statement of values) {
    if (existing.has(statement.toLocaleLowerCase())) continue;
    createCollaborationRule({
      category,
      priority: category === 'boundary' ? 0 : 50,
      scope: { type: 'global' },
      conditions: { enforcementLevel: 'prompt', source: 'onboarding' },
      statement,
    });
    existing.add(statement.toLocaleLowerCase());
    created += 1;
  }
  return created;
}

export function bootstrapUserModel(input: UserModelBootstrapInput, now = Date.now()) {
  const responsibilities = statements(input.responsibilities, 8);
  const goals = statements(input.goals, 5);
  const communicationPreferences = statements(input.communicationPreferences, 8);
  const boundaries = statements(input.boundaries, 8);
  const relationships = statements(input.relationships, 12);
  const profile = applyUserProfilePatch(input.profile, now);

  const assertionCount = addExplicitAssertions(responsibilities, {
    predicate: 'identity.responsibility', kind: 'identity', importance: 0.85,
  }, now) + addExplicitAssertions(relationships, {
    predicate: 'relationship.important', kind: 'relationship', importance: 0.8,
  }, now);

  const existingGoals = new Map(listUserGoals()
    .filter((goal) => goal.status === 'active' || goal.status === 'proposed')
    .map((goal) => [goal.desiredOutcome.toLocaleLowerCase(), goal]));
  const activePriorities = new Set(listPriorityWindows()
    .filter((priority) => priority.status === 'active')
    .map((priority) => priority.targetId));
  let goalCount = 0;
  for (const [index, desiredOutcome] of goals.entries()) {
    const key = desiredOutcome.toLocaleLowerCase();
    const existing = existingGoals.get(key);
    const goal = existing ?? createUserGoal({
      title: desiredOutcome.slice(0, 80),
      desiredOutcome,
      scope: { type: 'global' },
      declaredImportance: index === 0 ? 1 : 0.8,
      status: 'active',
      authority: 'user_explicit',
      confidence: 1,
      createdBy: 'user',
      now,
    });
    if (!existing) goalCount += 1;
    if (index === 0 && !activePriorities.has(goal.id)) {
      createPriorityWindow({
        targetType: 'goal', targetId: goal.id, rank: 'primary', urgency: 0.9,
        scope: { type: 'global' }, validFrom: now,
        validTo: now + 30 * 24 * 60 * 60 * 1_000,
        reviewAt: now + 7 * 24 * 60 * 60 * 1_000,
        declaredImportance: 1, now,
      });
      activePriorities.add(goal.id);
    }
    existingGoals.set(key, goal);
  }

  return {
    profile,
    created: {
      assertions: assertionCount,
      goals: goalCount,
      rules: addRules('communication', communicationPreferences) + addRules('boundary', boundaries),
    },
  };
}
