import { z } from 'zod';
import { ProjectOperatingViewSchema, type ProjectOperatingView } from '@xopcai/gateway-contract';

import { apiFetch } from '../api/client';

export const workItemStatuses = ['backlog', 'todo', 'in_progress', 'blocked', 'needs_input', 'in_review', 'done', 'cancelled'] as const;
export type WorkItemStatus = typeof workItemStatuses[number];
export const workItemPriorities = ['urgent', 'high', 'normal', 'low'] as const;
export type WorkItemPriority = typeof workItemPriorities[number];

const workItemSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(workItemStatuses),
  priority: z.enum(workItemPriorities),
  ownerAgentId: z.string().optional(),
  nextAction: z.string().optional(),
  blockedReason: z.string().optional(),
  dueAt: z.number().optional(),
  completedAt: z.number().optional(),
  archivedAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type WorkItem = z.infer<typeof workItemSchema>;

const workItemListSchema = z.object({
  ok: z.literal(true),
  items: z.array(workItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  status: z.string().optional(),
  updatedAt: z.number().optional(),
});

export type Project = z.infer<typeof projectSchema>;

export type WorkItemListQuery = {
  status?: WorkItemStatus[];
  priority?: WorkItemPriority[];
  includeArchived?: boolean;
  search?: string;
  sortBy?: 'updatedAt' | 'createdAt' | 'priority' | 'status';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

export type UpdateWorkItemInput = Partial<Pick<WorkItem, 'title' | 'status' | 'priority'>> & {
  description?: string | null;
  nextAction?: string | null;
  blockedReason?: string | null;
  dueAt?: number | null;
  archivedAt?: number | null;
};

async function readError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
  return new Error(body.error || body.message || `HTTP ${res.status}`);
}

function toQueryString(query?: WorkItemListQuery): string {
  const params = new URLSearchParams();
  if (query?.status?.length) params.set('status', query.status.join(','));
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

export async function fetchWorkItems(query?: WorkItemListQuery) {
  const res = await apiFetch(`/api/work-items${toQueryString(query)}`);
  if (!res.ok) throw await readError(res);
  const parsed = workItemListSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error('Invalid work item list response');
  return parsed.data;
}

export async function fetchProjectWorkItems(projectId: string, query?: WorkItemListQuery) {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/work-items${toQueryString(query)}`);
  if (!res.ok) throw await readError(res);
  const parsed = workItemListSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error('Invalid project work item list response');
  return parsed.data;
}

export async function fetchWorkItem(workItemId: string): Promise<WorkItem> {
  const res = await apiFetch(`/api/work-items/${encodeURIComponent(workItemId)}`);
  if (!res.ok) throw await readError(res);
  const parsed = z.object({ ok: z.literal(true), item: workItemSchema }).safeParse(await res.json());
  if (!parsed.success) throw new Error('Invalid work item response');
  return parsed.data.item;
}

export async function patchWorkItem(workItemId: string, patch: UpdateWorkItemInput): Promise<WorkItem> {
  const res = await apiFetch(`/api/work-items/${encodeURIComponent(workItemId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await readError(res);
  const parsed = z.object({ ok: z.literal(true), item: workItemSchema }).safeParse(await res.json());
  if (!parsed.success) throw new Error('Invalid work item update response');
  return parsed.data.item;
}

export async function createWorkItem(projectId: string, input: Pick<WorkItem, 'title'> & Partial<Pick<WorkItem, 'description' | 'status' | 'priority' | 'nextAction' | 'blockedReason' | 'dueAt'>>): Promise<WorkItem> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/work-items`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readError(res);
  const parsed = z.object({ ok: z.literal(true), item: workItemSchema }).safeParse(await res.json());
  if (!parsed.success) throw new Error('Invalid work item create response');
  return parsed.data.item;
}

export async function fetchProjects(): Promise<Project[]> {
  const res = await apiFetch('/api/projects?limit=100&sortBy=updatedAt&sortOrder=desc');
  if (!res.ok) throw await readError(res);
  const parsed = z.object({ ok: z.literal(true), items: z.array(projectSchema) }).safeParse(await res.json());
  if (!parsed.success) throw new Error('Invalid projects response');
  return parsed.data.items;
}

export async function fetchProjectOperatingView(projectId: string): Promise<ProjectOperatingView> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/operating-view`);
  if (!res.ok) throw await readError(res);
  const body = await res.json() as { view?: unknown };
  return ProjectOperatingViewSchema.parse(body.view);
}
