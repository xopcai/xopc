import { z } from 'zod';

import { defineReadCapability, type CapabilityDispatcher } from '../capabilities/runtime/dispatcher.js';
import {
  LocalAppNoteListSchema, LocalAppProjectListSchema, LocalAppTaskListSchema,
} from '../local-apps/capabilities/projections.js';
import { McpKnowledgeSearchOutput } from './user-context-tools.js';
import { McpFileSearchOutput } from './workspace-files.js';

const SearchKindSchema = z.enum(['project', 'task', 'note', 'file', 'knowledge']);

export const WorkspaceSearchOutput = z.object({
  query: z.string(),
  hits: z.array(z.object({
    kind: SearchKindSchema,
    id: z.string(),
    title: z.string().optional(),
    snippet: z.string().max(320).optional(),
    spaceId: z.string().optional(),
    relativePath: z.string().optional(),
  })),
});

export function registerWorkspaceSearch(dispatcher: CapabilityDispatcher): void {
  dispatcher.register(defineReadCapability({
    id: 'xopc.workspace.search', majorVersion: 1, effect: 'read', surfaces: ['mcp'], scopes: ['workspace.read'],
    description: 'Search across projects, tasks, notes, workspace files, and curated knowledge memory that this connection is authorized to read. Use each hit’s ID with the corresponding get/read tool.',
    input: z.strictObject({
      query: z.string().trim().min(1).max(4096),
      kinds: z.array(SearchKindSchema).min(1).max(5).optional(),
      projectId: z.string().trim().min(1).max(200).optional(),
      limitPerKind: z.number().int().min(1).max(20).default(5),
    }),
    output: WorkspaceSearchOutput,
    async execute({ query, kinds, projectId, limitPerKind }, context) {
      const visible = new Set(dispatcher.list(context).map(tool => tool.id));
      const wanted = new Set(kinds ?? ['project', 'task', 'note', 'file', 'knowledge']);
      const listInput = { search: query, limit: limitPerKind, ...(projectId ? { projectId } : {}) };

      const [projects, tasks, notes, files, knowledge] = await Promise.all([
        wanted.has('project') && visible.has('xopc.projects.list')
          ? dispatcher.call('xopc.projects.list', { search: query, limit: limitPerKind }, context)
              .then(result => LocalAppProjectListSchema.parse(result).items.filter(item => !projectId || item.id === projectId))
              .catch(() => [])
          : [],
        wanted.has('task') && visible.has('xopc.tasks.list')
          ? dispatcher.call('xopc.tasks.list', listInput, context)
              .then(result => LocalAppTaskListSchema.parse(result).items)
              .catch(() => [])
          : [],
        wanted.has('note') && visible.has('xopc.notes.list')
          ? dispatcher.call('xopc.notes.list', listInput, context)
              .then(result => LocalAppNoteListSchema.parse(result).items)
              .catch(() => [])
          : [],
        wanted.has('file') && visible.has('xopc.files.search')
          ? dispatcher.call('xopc.files.search', { query, limit: limitPerKind, ...(projectId ? { projectId } : {}) }, context)
              .then(result => McpFileSearchOutput.parse(result).hits)
              .catch(() => [])
          : [],
        wanted.has('knowledge') && visible.has('xopc.knowledge.search')
          ? dispatcher.call('xopc.knowledge.search', { query, limit: limitPerKind, ...(projectId ? { projectId } : {}) }, context)
              .then(result => McpKnowledgeSearchOutput.parse(result).items)
              .catch(() => [])
          : [],
      ]);

      return {
        query,
        hits: [
          ...projects.map(item => ({ kind: 'project' as const, id: item.id, title: item.name, snippet: item.description?.slice(0, 320) })),
          ...tasks.map(({ task }) => ({ kind: 'task' as const, id: task.id, title: task.title })),
          ...notes.map(item => ({ kind: 'note' as const, id: item.id, title: item.title, snippet: item.snippet?.slice(0, 320) })),
          ...files.map(item => ({
            kind: 'file' as const,
            id: item.id,
            title: item.name,
            snippet: `${item.spaceTitle}: ${item.relativePath}`.slice(0, 320),
            spaceId: item.spaceId,
            relativePath: item.relativePath,
          })),
          ...knowledge.map(item => ({
            kind: 'knowledge' as const,
            id: item.id,
            title: item.kind,
            snippet: (item.snippet ?? item.content).slice(0, 320),
          })),
        ],
      };
    },
  }));
}
