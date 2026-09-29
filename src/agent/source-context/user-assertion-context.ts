import {
  canUseAssertion,
  getAssertionSlot,
  getUserAssertion,
  listUserAssertionSources,
} from '../../user-model/index.js';
import type { AgentSourceContext } from './types.js';

export function buildUserAssertionAgentContext(
  assertionId: string,
  expectedVersion?: string,
  agentId?: string,
): AgentSourceContext | null {
  const assertion = getUserAssertion(assertionId);
  const slot = assertion ? getAssertionSlot(assertion.slotId) : undefined;
  if (!assertion || !slot || slot.scope.type !== 'global'
    || (expectedVersion && expectedVersion !== String(assertion.recordedAt))
    || !canUseAssertion(assertion, Date.now(), { use: 'answer', agentId })) return null;
  const sources = listUserAssertionSources([assertion.id]).get(assertion.id) ?? [];
  return {
    kind: 'user_assertion',
    sourceId: assertion.id,
    version: String(assertion.recordedAt),
    title: assertion.statement,
    text: JSON.stringify({
      id: assertion.id,
      statement: assertion.statement,
      predicate: slot.predicate,
      scope: slot.scope,
      status: assertion.status,
      authority: assertion.authority,
      sources,
    }, null, 2),
  };
}
