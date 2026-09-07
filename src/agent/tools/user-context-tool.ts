import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { retrievalLexicalSimilarity } from '../../retrieval/textFeatures.js';
import { getAssertionSlot, getUserAssertion, listUserAssertions } from '../../user-model/index.js';

export interface UserContextToolOptions {
  agentId: string;
  workspaceId: string;
  getSessionId: () => string | undefined;
}

const SearchSchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});

const GetSchema = Type.Object({ id: Type.String() });

function visible(options: UserContextToolOptions, slotId: string): boolean {
  const scope = getAssertionSlot(slotId)?.scope;
  return scope?.type === 'global'
    || (scope?.type === 'agent' && scope.id === options.agentId)
    || (scope?.type === 'workspace' && scope.id === options.workspaceId)
    || (scope?.type === 'session' && scope.id === options.getSessionId());
}

export function createUserContextSearchTool(options: UserContextToolOptions): AgentTool {
  return {
    name: 'user_context_search',
    label: 'User Context Search',
    description: 'Search typed user assertions such as identity, preferences, routines, and current state.',
    parameters: SearchSchema,
    async execute(_toolCallId, raw): Promise<AgentToolResult<{}>> {
      const input = raw as { query: string; maxResults?: number };
      const results = listUserAssertions({ statuses: ['active', 'needs_review'], limit: 1_000 })
        .filter((assertion) => visible(options, assertion.slotId))
        .map((assertion) => ({
          assertion,
          score: retrievalLexicalSimilarity(input.query, `${assertion.statement} ${assertion.normalizedValue}`),
        }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, input.maxResults ?? 12)
        .map(({ assertion, score }) => ({
          id: assertion.id,
          kind: assertion.kind,
          statement: assertion.statement,
          status: assertion.status,
          authority: assertion.authority,
          score,
        }));
      return { content: [{ type: 'text', text: JSON.stringify({ results }, null, 2) }], details: { results } };
    },
  } as AgentTool;
}

export function createUserContextGetTool(options: UserContextToolOptions): AgentTool {
  return {
    name: 'user_context_get',
    label: 'User Context Get',
    description: 'Read one typed user assertion and its subject, predicate, and scope.',
    parameters: GetSchema,
    async execute(_toolCallId, raw): Promise<AgentToolResult<{}>> {
      const id = (raw as { id: string }).id;
      const assertion = getUserAssertion(id);
      if (!assertion || !visible(options, assertion.slotId)) {
        return { content: [{ type: 'text', text: `User assertion not found: ${id}` }], details: { id } };
      }
      const result = { assertion, slot: getAssertionSlot(assertion.slotId) };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], details: result };
    },
  } as AgentTool;
}
