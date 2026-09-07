import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import {
  getKnowledgeItem,
  knowledgeSourceAllowed,
  searchKnowledgeItems,
  writeKnowledgeItem,
  type KnowledgeSource,
} from '../../knowledge-memory/index.js';

export interface KnowledgeToolOptions {
  agentId: string;
  workspaceId: string;
  getSessionId: () => string | undefined;
  getProjectId?: () => string | undefined;
  canRead: () => boolean;
  canWrite: () => boolean;
  getWritePolicy: () => 'deny' | 'confirm' | 'allow';
  getSources: () => readonly KnowledgeSource[];
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
  scope: Type.Union([Type.Literal('workspace'), Type.Literal('project'), Type.Literal('session')]),
  importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
});

function visibility(options: KnowledgeToolOptions) {
  const projectId = options.getProjectId?.();
  return {
    agentId: options.agentId,
    workspaceId: options.workspaceId,
    sessionId: options.getSessionId() ?? '',
    ...(projectId ? { projectId } : {}),
  };
}

export function createKnowledgeSearchTool(options: KnowledgeToolOptions): AgentTool {
  return {
    name: 'knowledge_search',
    label: 'Knowledge Search',
    description: 'Search project, workspace, and session knowledge for prior decisions, facts, lessons, and commitments.',
    parameters: SearchSchema,
    async execute(_toolCallId, raw): Promise<AgentToolResult<{}>> {
      if (!options.canRead()) {
        return { content: [{ type: 'text', text: 'Knowledge memory is disabled for this session.' }], details: { error: 'knowledge_memory_disabled' } };
      }
      const input = raw as { query: string; maxResults?: number };
      const results = searchKnowledgeItems({
        query: input.query,
        context: visibility(options),
        sources: options.getSources(),
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
    async execute(_toolCallId, raw): Promise<AgentToolResult<{}>> {
      if (!options.canRead()) {
        return { content: [{ type: 'text', text: 'Knowledge memory is disabled for this session.' }], details: { error: 'knowledge_memory_disabled' } };
      }
      const id = (raw as { id: string }).id;
      const item = getKnowledgeItem(id);
      return item && visibleItem(options, item) && knowledgeSourceAllowed(item, options.getSources())
        ? { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }], details: { item } }
        : { content: [{ type: 'text', text: `Knowledge item not found: ${id}` }], details: { id } };
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
      if (!options.getSources().includes(input.scope)) {
        return { content: [{ type: 'text', text: `Knowledge source is disabled: ${input.scope}` }], details: { error: 'knowledge_source_disabled', source: input.scope } };
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
        status: writePolicy === 'allow' ? 'active' : 'candidate',
        confidence: 0.7,
        importance: input.importance ?? 0.5,
        originClass: 'agent',
        sourceAgentId: options.agentId,
        ...(sessionId ? { sourceSessionId: sessionId } : {}),
        source: { tool: 'knowledge_write' },
      });
      const details = { ...result, writePolicy };
      return { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }], details };
    },
  } as AgentTool;
}
