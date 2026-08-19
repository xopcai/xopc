import {
  ProjectOperatingViewSchema,
  WorkItemSchema,
  type ProjectOperatingView,
  type WorkItem,
  type WorkItemCommand,
  type WorkItemCompletionPolicy,
  type WorkItemNextAction,
  type WorkItemPhase,
  type WorkItemPriority,
} from '@xopcai/gateway-contract';
import { z } from 'zod';

import { apiFetch } from '../api/client';

export type { WorkItem, WorkItemCommand, WorkItemNextAction, WorkItemPhase, WorkItemPriority };

const workItemListSchema = z.object({
  ok: z.literal(true),
  items: z.array(WorkItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});
const projectSchema = z.object({ id: z.string(), name: z.string(), description: z.string().optional(), status: z.string().optional(), updatedAt: z.number().optional() });
export type Project = z.infer<typeof projectSchema>;

export type WorkItemListQuery = {
  phase?: WorkItemPhase[];
  priority?: WorkItemPriority[];
  includeArchived?: boolean;
  search?: string;
  sortBy?: 'updatedAt' | 'createdAt' | 'priority' | 'phase' | 'dueAt';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

async function readError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
  return new Error(body.error || body.message || `HTTP ${res.status}`);
}

function toQueryString(query?: WorkItemListQuery): string {
  const params = new URLSearchParams();
  if (query?.phase?.length) params.set('phase', query.phase.join(','));
  if (query?.priority?.length) params.set('priority', query.priority.join(','));
  if (query?.includeArchived) params.set('includeArchived', 'true');
  if (query?.search?.trim()) params.set('search', query.search.trim());
  if (query?.sortBy) params.set('sortBy', query.sortBy);
  if (query?.sortOrder) params.set('sortOrder', query.sortOrder);
  if (query?.limit != null) params.set('limit', String(query.limit));
  if (query?.offset != null) params.set('offset', String(query.offset));
  const value = params.toString();
  return value ? `?${value}` : '';
}

async function fetchList(path: string) {
  const res = await apiFetch(path);
  if (!res.ok) throw await readError(res);
  return workItemListSchema.parse(await res.json());
}

export function fetchWorkItems(query?: WorkItemListQuery) { return fetchList(`/api/work-items${toQueryString(query)}`); }
export function fetchProjectWorkItems(projectId: string, query?: WorkItemListQuery) { return fetchList(`/api/projects/${encodeURIComponent(projectId)}/work-items${toQueryString(query)}`); }

export async function fetchWorkItem(workItemId: string): Promise<{ item: WorkItem; availableCommands: WorkItemCommand['type'][] }> {
  const res = await apiFetch(`/api/work-items/${encodeURIComponent(workItemId)}`);
  if (!res.ok) throw await readError(res);
  const parsed = z.object({ ok: z.literal(true), item: WorkItemSchema, availableCommands: z.array(z.string()) }).parse(await res.json());
  return { item: parsed.item, availableCommands: parsed.availableCommands as WorkItemCommand['type'][] };
}

export async function patchWorkItemMetadata(workItemId: string, expectedVersion: number, patch: {
  title?: string;
  description?: string | null;
  priority?: WorkItemPriority;
  completionPolicy?: WorkItemCompletionPolicy;
  nextAction?: WorkItemNextAction | null;
  dueAt?: number | null;
}): Promise<WorkItem> {
  const res = await apiFetch(`/api/work-items/${encodeURIComponent(workItemId)}`, { method: 'PATCH', body: JSON.stringify({ ...patch, expectedVersion }) });
  if (!res.ok) throw await readError(res);
  return z.object({ ok: z.literal(true), item: WorkItemSchema }).parse(await res.json()).item;
}

export async function executeWorkItemCommand(workItemId: string, command: WorkItemCommand): Promise<{ item: WorkItem; availableCommands: WorkItemCommand['type'][] }> {
  const res = await apiFetch(`/api/work-items/${encodeURIComponent(workItemId)}/commands`, { method: 'POST', body: JSON.stringify(command) });
  if (!res.ok) throw await readError(res);
  const body = await res.json() as { item: unknown; availableCommands: WorkItemCommand['type'][] };
  return { item: WorkItemSchema.parse(body.item), availableCommands: body.availableCommands };
}

export async function createWorkItem(projectId: string, input: {
  title: string;
  description?: string;
  initialPhase?: Extract<WorkItemPhase, 'backlog' | 'ready'>;
  priority?: WorkItemPriority;
  completionPolicy?: WorkItemCompletionPolicy;
  nextAction?: WorkItemNextAction;
  dueAt?: number;
}): Promise<WorkItem> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/work-items`, { method: 'POST', body: JSON.stringify(input) });
  if (!res.ok) throw await readError(res);
  return z.object({ ok: z.literal(true), item: WorkItemSchema }).parse(await res.json()).item;
}

export async function fetchProjects(): Promise<Project[]> {
  const res = await apiFetch('/api/projects?limit=100&sortBy=updatedAt&sortOrder=desc');
  if (!res.ok) throw await readError(res);
  return z.object({ ok: z.literal(true), items: z.array(projectSchema) }).parse(await res.json()).items;
}

export async function fetchProjectOperatingView(projectId: string): Promise<ProjectOperatingView> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/operating-view`);
  if (!res.ok) throw await readError(res);
  return ProjectOperatingViewSchema.parse((await res.json() as { view?: unknown }).view);
}
