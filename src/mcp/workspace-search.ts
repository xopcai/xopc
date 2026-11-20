import { z } from 'zod';

import { defineReadCapability, type CapabilityDispatcher } from '../capabilities/runtime/dispatcher.js';
import {
  LocalAppNoteListSchema, LocalAppProjectListSchema, LocalAppTaskListSchema,
} from '../local-apps/capabilities/projections.js';

export const WorkspaceSearchOutput = z.object({
  query: z.string(),
  hits: z.array(z.object({
    kind: z.enum(['project', 'task', 'note']),
    id: z.string(),
    title: z.string().optional(),
    snippet: z.string().max(320).optional(),
  })),
});

export function registerWorkspaceSearch(dispatcher: CapabilityDispatcher): void {
  dispatcher.register(defineReadCapability({
    id: 'xopc.workspace.search', majorVersion: 1, effect: 'read', surfaces: ['mcp'], scopes: ['workspace.read'],
    description: 'Search projects, tasks and notes the connection can list. Use each hit’s ID with the corresponding get tool.',
    input: z.strictObject({
      query: z.string().trim().min(1).max(4096),
      limitPerKind: z.number().int().min(1).max(20).default(5),
    }),
    output: WorkspaceSearchOutput,
    async execute({ query, limitPerKind }, context) {
      const visible = new Set(dispatcher.list(context).map(tool => tool.id));
      const input = { search: query, limit: limitPerKind };
      const [projects, tasks, notes] = await Promise.all([
        visible.has('xopc.projects.list') ? dispatcher.call('xopc.projects.list', input, context)
          .then(result => LocalAppProjectListSchema.parse(result).items) : [],
        visible.has('xopc.tasks.list') ? dispatcher.call('xopc.tasks.list', input, context)
          .then(result => LocalAppTaskListSchema.parse(result).items) : [],
        visible.has('xopc.notes.list') ? dispatcher.call('xopc.notes.list', input, context)
          .then(result => LocalAppNoteListSchema.parse(result).items) : [],
      ]);
      return {
        query,
        hits: [
          ...projects.map(item => ({ kind: 'project' as const, id: item.id, title: item.name, snippet: item.description?.slice(0, 320) })),
          ...tasks.map(({ task }) => ({ kind: 'task' as const, id: task.id, title: task.title })),
          ...notes.map(item => ({ kind: 'note' as const, id: item.id, title: item.title, snippet: item.snippet?.slice(0, 320) })),
        ],
      };
    },
  }));
}
