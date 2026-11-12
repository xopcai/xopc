import { listCollaborationRules, type CollaborationRule } from '../storage/sqlite/collaboration-rule-repository.js';
import { getAssertionSlot, listUserAssertions } from './repository.js';

export interface ActionRuleSuggestion {
  id: string;
  sourceAssertionId: string;
  category: CollaborationRule['category'];
  statement: string;
  scope: CollaborationRule['scope'];
  conditions: Record<string, unknown>;
}

/** Suggestions are inert until the user explicitly creates a collaboration rule. */
export function listActionRuleSuggestions(): ActionRuleSuggestion[] {
  const existingSources = new Set(listCollaborationRules()
    .map((rule) => rule.conditions.sourceAssertionId)
    .filter((value): value is string => typeof value === 'string'));
  return listUserAssertions({ statuses: ['active'], limit: 1_000 })
    .filter((assertion) => assertion.authority === 'user_explicit'
      && assertion.layer === 'pattern'
      && assertion.sensitivity === 'normal'
      && assertion.actionability >= 0.6
      && assertion.allowedUses.includes('recommend')
      && !existingSources.has(assertion.id))
    .flatMap((assertion) => {
      const category: CollaborationRule['category'] | undefined = assertion.kind === 'preference'
        ? 'communication'
        : assertion.kind === 'routine' ? 'routine' : undefined;
      const scope = getAssertionSlot(assertion.slotId)?.scope;
      if (!category || !scope || scope.type === 'agent') return [];
      return [{
        id: `assertion:${assertion.id}`,
        sourceAssertionId: assertion.id,
        category,
        statement: assertion.statement,
        scope,
        conditions: {
          sourceAssertionId: assertion.id,
          enforcementLevel: 'prompt',
          requiresConfirmation: true,
        },
      }];
    });
}
