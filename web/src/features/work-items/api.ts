import type { ProjectGoal, ProjectSession } from '@/features/projects/api';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type WorkItemStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'blocked'
  | 'needs_input'
  | 'in_review'
  | 'done'
  | 'cancelled';

export type WorkItemPriority = 'urgent' | 'high' | 'normal' | 'low';
export type WorkItemLinkKind = 'chat' | 'goal' | 'workflow_run' | 'automation' | 'note';
export type WorkItemEventType =
  | 'created'
  | 'updated'
  | 'status_changed'
  | 'archived'
  | 'chat_started'
  | 'goal_created'
  | 'workflow_started'
  | 'automation_added'
  | 'link_added'
  | 'progress_note_added'
  | 'update_suggestion_created'
  | 'update_suggestion_applied'
  | 'update_suggestion_dismissed';
export type WorkItemUpdateSuggestionStatus = 'pending' | 'applied' | 'dismissed';
export type WorkItemUpdateSuggestionSourceKind = 'chat' | 'goal' | 'workflow_run' | 'automation';

export type WorkItemLink = {
  id: string;
  workItemId: string;
  kind: WorkItemLinkKind;
  targetId: string;
  title?: string;
  statusSnapshot?: string;
  createdAt: number;
};

export type WorkItem = {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  ownerAgentId?: string;
  nextAction?: string;
  blockedReason?: string;
  dueAt?: number;
  completedAt?: number;
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
  links?: WorkItemLink[];
};

export type WorkItemEvent = {
  id: string;
  workItemId: string;
  type: WorkItemEventType;
  payload?: unknown;
  createdAt: number;
};

export type WorkItemUpdateSuggestion = {
  id: string;
  workItemId: string;
  sourceKind: WorkItemUpdateSuggestionSourceKind;
  sourceId: string;
  status: WorkItemUpdateSuggestionStatus;
  patch: {
    status?: WorkItemStatus;
    nextAction?: string | null;
    blockedReason?: string | null;
  };
  progressNote?: string;
  rationale?: string;
  confidence?: number;
  createdAt: number;
  appliedAt?: number;
  dismissedAt?: number;
};

export type WorkItemListResponse = {
  ok: true;
  items: WorkItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export async function fetchProjectWorkItems(projectId: string, query?: {
  status?: WorkItemStatus[];
  includeArchived?: boolean;
  search?: string;
  sortBy?: 'updatedAt' | 'createdAt' | 'priority' | 'status';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}): Promise<WorkItemListResponse> {
  const params = new URLSearchParams();
  if (query?.status?.length) params.set('status', query.status.join(','));
  if (query?.includeArchived) params.set('includeArchived', 'true');
  if (query?.search?.trim()) params.set('search', query.search.trim());
  if (query?.sortBy) params.set('sortBy', query.sortBy);
  if (query?.sortOrder) params.set('sortOrder', query.sortOrder);
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.offset) params.set('offset', String(query.offset));
  const suffix = params.toString();
  return fetchJson<WorkItemListResponse>(
    apiUrl(`/api/projects/${encodeURIComponent(projectId)}/work-items${suffix ? `?${suffix}` : ''}`),
  );
}

export async function createWorkItem(projectId: string, input: {
  title: string;
  description?: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  ownerAgentId?: string;
  nextAction?: string;
  blockedReason?: string;
  dueAt?: number;
}): Promise<{ ok: true; item: WorkItem }> {
  return fetchJson<{ ok: true; item: WorkItem }>(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/work-items`), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchWorkItem(workItemId: string): Promise<{ ok: true; item: WorkItem }> {
  return fetchJson<{ ok: true; item: WorkItem }>(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}`));
}

export async function patchWorkItem(workItemId: string, patch: {
  title?: string;
  description?: string | null;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  ownerAgentId?: string | null;
  nextAction?: string | null;
  blockedReason?: string | null;
  dueAt?: number | null;
  archivedAt?: number | null;
}): Promise<{ ok: true; item: WorkItem }> {
  return fetchJson<{ ok: true; item: WorkItem }>(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function startWorkItemChat(workItemId: string): Promise<{ ok: true; item: WorkItem; session: ProjectSession }> {
  return fetchJson<{ ok: true; item: WorkItem; session: ProjectSession }>(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}/start-chat`), {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function createWorkItemGoal(workItemId: string): Promise<{ ok: true; item: WorkItem; goal: ProjectGoal }> {
  return fetchJson<{ ok: true; item: WorkItem; goal: ProjectGoal }>(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}/create-goal`), {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function fetchWorkItemEvents(workItemId: string): Promise<{ ok: true; events: WorkItemEvent[] }> {
  return fetchJson<{ ok: true; events: WorkItemEvent[] }>(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}/events`));
}

export async function createWorkItemUpdateSuggestion(workItemId: string, input: {
  sourceKind: WorkItemUpdateSuggestionSourceKind;
  sourceId: string;
  patch?: WorkItemUpdateSuggestion['patch'];
  progressNote?: string;
  rationale?: string;
  confidence?: number;
}): Promise<{ ok: true; suggestion: WorkItemUpdateSuggestion }> {
  return fetchJson<{ ok: true; suggestion: WorkItemUpdateSuggestion }>(
    apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}/update-suggestions`),
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function applyWorkItemUpdateSuggestion(suggestionId: string): Promise<{ ok: true; item: WorkItem; suggestion: WorkItemUpdateSuggestion }> {
  return fetchJson<{ ok: true; item: WorkItem; suggestion: WorkItemUpdateSuggestion }>(
    apiUrl(`/api/work-item-update-suggestions/${encodeURIComponent(suggestionId)}/apply`),
    { method: 'POST' },
  );
}

export async function dismissWorkItemUpdateSuggestion(suggestionId: string): Promise<{ ok: true; suggestion: WorkItemUpdateSuggestion }> {
  return fetchJson<{ ok: true; suggestion: WorkItemUpdateSuggestion }>(
    apiUrl(`/api/work-item-update-suggestions/${encodeURIComponent(suggestionId)}/dismiss`),
    { method: 'POST' },
  );
}
