import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import {
  getKnowledgeItem,
  isKnowledgeCurrent,
  knowledgeItemAllowed,
  searchKnowledgeItems,
  writeKnowledgeItem,
  type KnowledgeReadPolicy,
} from '../../knowledge-memory/index.js';

export interface KnowledgeToolOptions {
  agentId: string;
  workspaceId: string;
  getSessionId: () => string | undefined;
  getProjectId?: () => string | undefined;
  canRead: () => boolean;
  canWrite: () => boolean;
  getWritePolicy: () => 'deny' | 'allow';
  getReadPolicy: () => KnowledgeReadPolicy;
}

const SearchSchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});
const GetSchema = Type.Object({ id: Type.String() });
const WriteSchema = Type.Object({
  kind: Type.Union([
    Type.Literal('work_thread'), Type.Literal('project_fact'), Type.Literal('workspace_fact'), Type.Literal('decision'),
    Type.Literal('task_lesson'), Type.Literal('commitment'), Type.Literal('open_question'),
    Type.Literal('episode'), Type.Literal('note'),
  ]),
  content: Type.String(),
  canonicalKey: Type.String(),
  scope: Type.Union([Type.Literal('workspace'), Type.Literal('project'), Type.Literal('session')]),
  importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
});

function visibility(options: KnowledgeToolOptions) {
  const projectId = options.getProjectId?.();
  return {
    agentId: options.agentId,
    workspaceId: options.workspaceId,
    conversationId: options.getSessionId() ?? '',
    ...(projectId ? { projectId } : {}),
  };
}

export function createKnowledgeSearchTool(options: KnowledgeToolOptions): AgentTool {
  return {
    name: 'knowledge_search',
    label: 'Knowledge Search',
    description: 'Search project, workspace, and session knowledge for prior decisions, facts, lessons, and commitments.',
    parameters: SearchSchema,
    supportsParallel: true,
    async execute(_toolCallId, raw): Promise<AgentToolResult<{}>> {
      if (!options.canRead()) {
        return { content: [{ type: 'text', text: 'Knowledge memory is disabled for this session.' }], details: { error: 'knowledge_memory_disabled' } };
      }
      const input = raw as { query: string; maxResults?: number };
      const results = searchKnowledgeItems({
        query: input.query,
        context: visibility(options),
        policy: options.getReadPolicy(),
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
    || (item.scope.type === 'project' && item.scope.id === options.getProjectId?.())
    || (item.scope.type === 'session' && item.scope.id === options.getSessionId());
}

export function createKnowledgeGetTool(options: KnowledgeToolOptions): AgentTool {
  return {
    name: 'knowledge_get',
    label: 'Knowledge Get',
    description: 'Read one knowledge item returned by knowledge_search.',
    parameters: GetSchema,
    supportsParallel: true,
    async execute(_toolCallId, raw): Promise<AgentToolResult<{}>> {
      if (!options.canRead()) {
        return { content: [{ type: 'text', text: 'Knowledge memory is disabled for this session.' }], details: { error: 'knowledge_memory_disabled' } };
      }
      const id = (raw as { id: string }).id;
      const item = getKnowledgeItem(id);
      return item && isKnowledgeCurrent(item) && visibleItem(options, item) && knowledgeItemAllowed(item, options.getReadPolicy())
        ? { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }], details: { item, complete: true } }
        : { content: [{ type: 'text', text: `Knowledge item not found: ${id}` }], details: { id, error: 'knowledge_not_found' } };
    },
  } as AgentTool;
}

export function createKnowledgeWriteTool(options: KnowledgeToolOptions): AgentTool {
  return {
    name: 'knowledge_write',
    label: 'Knowledge Write',
    description: 'Store scoped knowledge with provenance, subject to the configured write policy.',
    parameters: WriteSchema,
    async execute(_toolCallId, raw): Promise<AgentToolResult<{}>> {
      if (!options.canWrite()) {
        return { content: [{ type: 'text', text: 'Knowledge memory writes are disabled for this session.' }], details: { error: 'knowledge_memory_disabled' } };
      }
      const writePolicy = options.getWritePolicy();
      if (writePolicy === 'deny') {
        return { content: [{ type: 'text', text: 'Knowledge memory writes are denied by policy.' }], details: { error: 'knowledge_write_denied' } };
      }
      const input = raw as {
        kind: Parameters<typeof writeKnowledgeItem>[0]['kind']; content: string;
        canonicalKey: string; scope: 'workspace' | 'project' | 'session'; importance?: number;
      };
      if (!options.getReadPolicy().scopes.includes(input.scope)
        || !options.getReadPolicy().contentSources.includes('memory')) {
        return {
          content: [{ type: 'text', text: `Knowledge memory writes are disabled for scope: ${input.scope}` }],
          details: { error: 'knowledge_scope_disabled', scope: input.scope },
        };
      }
      const sessionId = options.getSessionId();
      if (input.scope === 'session' && !sessionId) throw new Error('A current session is required for session knowledge.');
      const projectId = options.getProjectId?.();
      if (input.scope === 'project' && !projectId) throw new Error('A current project is required for project knowledge.');
      const result = writeKnowledgeItem({
        kind: input.kind,
        scope: input.scope === 'workspace'
          ? { type: 'workspace', id: options.workspaceId }
          : input.scope === 'project'
            ? { type: 'project', id: projectId! }
            : { type: 'session', id: sessionId! },
        content: input.content,
        canonicalKey: input.canonicalKey,
        status: 'active',
        confidence: 0.7,
        importance: input.importance ?? 0.5,
        originClass: 'agent',
        sourceAgentId: options.agentId,
        ...(sessionId ? { sourceConversationId: sessionId } : {}),
        source: { tool: 'knowledge_write' },
      });
      const details = { ...result, writePolicy };
      return { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }], details };
    },
  } as AgentTool;
}
