import { z } from 'zod';

import { defineReadCapability, type CapabilityDispatcher } from '../capabilities/runtime/dispatcher.js';
import { listKnowledgeItems, searchKnowledgeItems, type KnowledgeItem } from '../knowledge-memory/index.js';
import { listCollaborationRules } from '../storage/sqlite/collaboration-rule-repository.js';
import { getUserProfileSnapshot, listPriorityWindows, listUserGoals } from '../user-model/index.js';

const scopeSchema = z.object({
  type: z.enum(['global', 'agent', 'workspace', 'project', 'session']),
  id: z.string().optional(),
});

const knowledgeSummarySchema = z.object({
  id: z.string(),
  kind: z.string(),
  scope: scopeSchema,
  content: z.string(),
  snippet: z.string().optional(),
  confidence: z.number(),
  importance: z.number(),
  updatedAt: z.number(),
});

export const McpUserProfileOutput = z.object({
  profile: z.object({
    callName: z.string().optional(),
    role: z.string().optional(),
    pronouns: z.string().optional(),
    timezone: z.string().optional(),
    locale: z.string().optional(),
  }),
  activeGoals: z.array(z.object({
    id: z.string(),
    title: z.string(),
    desiredOutcome: z.string(),
    scope: scopeSchema,
    targetAt: z.number().optional(),
  })),
  priorityWindows: z.array(z.object({
    id: z.string(),
    targetType: z.string(),
    targetId: z.string(),
    rank: z.enum(['primary', 'secondary', 'background']),
    urgency: z.number(),
    validTo: z.number(),
  })),
  collaborationRules: z.array(z.object({
    id: z.string(),
    category: z.string(),
    priority: z.number(),
    scope: scopeSchema,
    statement: z.string(),
  })),
});

export const McpKnowledgeListOutput = z.object({
  items: z.array(knowledgeSummarySchema),
});

export const McpKnowledgeSearchOutput = z.object({
  query: z.string(),
  items: z.array(knowledgeSummarySchema),
});

export const mcpUserContextTools = {
  'xopc.user_context.profile': { scope: 'workspace.read' as const, output: McpUserProfileOutput },
  'xopc.knowledge.list': { scope: 'workspace.read' as const, output: McpKnowledgeListOutput },
  'xopc.knowledge.search': { scope: 'workspace.read' as const, output: McpKnowledgeSearchOutput },
} as const;

function isSafeForExternalMcp(item: KnowledgeItem): boolean {
  if (item.status !== 'active') return false;
  if (item.originClass === 'untrusted') return false;
  if (item.sensitivity === 'secret' || item.sensitivity === 'regulated') return false;
  return true;
}

function summarizeKnowledge(item: KnowledgeItem) {
  return {
    id: item.id,
    kind: item.kind,
    scope: item.scope,
    content: item.content.slice(0, 2000),
    ...(item.retrievalSnippet ? { snippet: item.retrievalSnippet.slice(0, 400) } : {}),
    confidence: item.confidence,
    importance: item.importance,
    updatedAt: item.updatedAt,
  };
}

export function registerUserContextTools(dispatcher: CapabilityDispatcher): void {
  const policy = { majorVersion: 1, effect: 'read' as const, surfaces: ['mcp'] as const, scopes: ['workspace.read'] as const };

  dispatcher.register(defineReadCapability({
    ...policy,
    id: 'xopc.user_context.profile',
    description: 'Read the user’s confirmed profile preferences, active goals, current priority windows, and active collaboration rules so you can tailor responses and work to their style.',
    input: z.strictObject({
      projectId: z.string().trim().min(1).max(200).optional(),
    }),
    output: McpUserProfileOutput,
    execute({ projectId }, context) {
      context.assertCurrent?.();
      const profile = getUserProfileSnapshot();
      const now = Date.now();
      const matchesProject = (scope: { type: string; id?: string }) =>
        !projectId || scope.type === 'global' || scope.type === 'workspace' || (scope.type === 'project' && scope.id === projectId);

      const activeGoals = listUserGoals()
        .filter(goal => goal.status === 'active' && matchesProject(goal.scope))
        .slice(0, 20)
        .map(goal => ({
          id: goal.id,
          title: goal.title,
          desiredOutcome: goal.desiredOutcome,
          scope: goal.scope,
          ...(goal.targetAt !== undefined ? { targetAt: goal.targetAt } : {}),
        }));

      const priorityWindows = listPriorityWindows()
        .filter(win => win.status === 'active' && win.validTo >= now && matchesProject(win.scope))
        .slice(0, 20)
        .map(win => ({
          id: win.id,
          targetType: win.targetType,
          targetId: win.targetId,
          rank: win.rank,
          urgency: win.urgency,
          validTo: win.validTo,
        }));

      const collaborationRules = listCollaborationRules()
        .filter(rule => rule.status === 'active' && matchesProject(rule.scope))
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 30)
        .map(rule => ({
          id: rule.id,
          category: rule.category,
          priority: rule.priority,
          scope: rule.scope,
          statement: rule.statement,
        }));

      return { profile, activeGoals, priorityWindows, collaborationRules };
    },
  }));

  dispatcher.register(defineReadCapability({
    ...policy,
    id: 'xopc.knowledge.list',
    description: 'List active non-sensitive long-term memory and curated knowledge items from xopc, optionally filtered by projectId.',
    input: z.strictObject({
      projectId: z.string().trim().min(1).max(200).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    output: McpKnowledgeListOutput,
    execute({ projectId, limit }, context) {
      context.assertCurrent?.();
      const raw = listKnowledgeItems({
        statuses: ['active'],
        scope: projectId ? { type: 'project', id: projectId } : undefined,
        limit: limit * 2,
      });
      return {
        items: raw.filter(isSafeForExternalMcp).slice(0, limit).map(summarizeKnowledge),
      };
    },
  }));

  dispatcher.register(defineReadCapability({
    ...policy,
    id: 'xopc.knowledge.search',
    description: 'Full-text search across active non-sensitive user knowledge memory (decisions, project facts, work threads, commitments, lessons).',
    input: z.strictObject({
      query: z.string().trim().min(1).max(1024),
      projectId: z.string().trim().min(1).max(200).optional(),
      limit: z.number().int().min(1).max(30).default(10),
    }),
    output: McpKnowledgeSearchOutput,
    execute({ query, projectId, limit }, context) {
      context.assertCurrent?.();
      const raw = searchKnowledgeItems({
        query,
        context: {
          agentId: 'main',
          workspaceId: 'default',
          ...(projectId ? { projectId } : {}),
          conversationId: '',
        },
        trustedOnly: true,
        policy: {
          scopes: projectId ? ['global', 'workspace', 'project'] : ['global', 'workspace', 'project', 'agent'],
          contentSources: ['memory', 'local_import', 'connector'],
        },
        limit: limit * 2,
      });
      return {
        query,
        items: raw.filter(isSafeForExternalMcp).slice(0, limit).map(summarizeKnowledge),
      };
    },
  }));
}
