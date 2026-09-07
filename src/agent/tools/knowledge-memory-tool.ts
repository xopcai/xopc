import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { getKnowledgeItem, searchKnowledgeItems, writeKnowledgeItem } from '../../knowledge-memory/index.js';

export interface KnowledgeToolOptions {
  agentId: string;
  workspaceId: string;
  getSessionId: () => string | undefined;
}

const SearchSchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});
const GetSchema = Type.Object({ id: Type.String() });
const WriteSchema = Type.Object({
  kind: Type.Union([
    Type.Literal('project_fact'), Type.Literal('workspace_fact'), Type.Literal('decision'),
    Type.Literal('task_lesson'), Type.Literal('commitment'), Type.Literal('open_question'),
    Type.Literal('episode'), Type.Literal('note'),
  ]),
  content: Type.String(),
  canonicalKey: Type.String(),
  scope: Type.Union([Type.Literal('workspace'), Type.Literal('session')]),
  importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
});

function visibility(options: KnowledgeToolOptions) {
  return {
    agentId: options.agentId,
    workspaceId: options.workspaceId,
    sessionId: options.getSessionId() ?? '',
  };
}

export function createKnowledgeSearchTool(options: KnowledgeToolOptions): AgentTool {
  return {
    name: 'knowledge_search',
    label: 'Knowledge Search',
    description: 'Search project, workspace, and session knowledge for prior decisions, facts, lessons, and commitments.',
    parameters: SearchSchema,
    async execute(_toolCallId, raw): Promise<AgentToolResult<{}>> {
      const input = raw as { query: string; maxResults?: number };
      const results = searchKnowledgeItems({
        query: input.query,
        context: visibility(options),
        limit: input.maxResults ?? 12,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ results }, null, 2) }], details: { results } };
    },
  } as AgentTool;
}

function visibleItem(options: KnowledgeToolOptions, item: NonNullable<ReturnType<typeof getKnowledgeItem>>): boolean {
  return item.scope.type === 'global'
    || (item.scope.type === 'agent' && item.scope.id === options.agentId)
    || (item.scope.type === 'workspace' && item.scope.id === options.workspaceId)
    || (item.scope.type === 'session' && item.scope.id === options.getSessionId());
}

export function createKnowledgeGetTool(options: KnowledgeToolOptions): AgentTool {
  return {
    name: 'knowledge_get',
    label: 'Knowledge Get',
    description: 'Read one knowledge item returned by knowledge_search.',
    parameters: GetSchema,
    async execute(_toolCallId, raw): Promise<AgentToolResult<{}>> {
      const id = (raw as { id: string }).id;
      const item = getKnowledgeItem(id);
      return item && visibleItem(options, item)
        ? { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }], details: { item } }
        : { content: [{ type: 'text', text: `Knowledge item not found: ${id}` }], details: { id } };
    },
  } as AgentTool;
}

export function createKnowledgeWriteTool(options: KnowledgeToolOptions): AgentTool {
  return {
    name: 'knowledge_write',
    label: 'Knowledge Write',
    description: 'Store a scoped knowledge candidate with provenance for later review and retrieval.',
    parameters: WriteSchema,
    async execute(_toolCallId, raw): Promise<AgentToolResult<{}>> {
      const input = raw as {
        kind: Parameters<typeof writeKnowledgeItem>[0]['kind']; content: string;
        canonicalKey: string; scope: 'workspace' | 'session'; importance?: number;
      };
      const sessionId = options.getSessionId();
      if (input.scope === 'session' && !sessionId) throw new Error('A current session is required for session knowledge.');
      const result = writeKnowledgeItem({
        kind: input.kind,
        scope: input.scope === 'workspace'
          ? { type: 'workspace', id: options.workspaceId }
          : { type: 'session', id: sessionId! },
        content: input.content,
        canonicalKey: input.canonicalKey,
        confidence: 0.7,
        importance: input.importance ?? 0.5,
        originClass: 'agent',
        sourceAgentId: options.agentId,
        ...(sessionId ? { sourceSessionId: sessionId } : {}),
        source: { tool: 'knowledge_write' },
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], details: result };
    },
  } as AgentTool;
}
