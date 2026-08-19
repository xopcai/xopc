import type {
  WorkItem,
  WorkItemAttachment,
  WorkItemCommand,
  WorkItemCommandProposal,
  WorkItemCompletionPolicy,
  WorkItemNextAction,
  WorkItemPhase,
  WorkItemPriority,
} from '@xopcai/gateway-contract';

import type { ProjectSession } from '@/features/projects/api';
import type { StartWorkflowRunResult } from '@/features/workflows/workflow-api';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type { WorkItem, WorkItemAttachment, WorkItemCommand, WorkItemCommandProposal, WorkItemCompletionPolicy, WorkItemNextAction, WorkItemPhase, WorkItemPriority };

export type WorkItemEvent = { id: string; workItemId: string; type: string; payload?: unknown; createdAt: number };
export type WorkItemListResponse = { ok: true; items: WorkItem[]; total: number; limit: number; offset: number; hasMore: boolean };

export async function fetchProjectWorkItems(projectId: string, query?: {
  phase?: WorkItemPhase[];
  includeArchived?: boolean;
  search?: string;
  sortBy?: 'updatedAt' | 'createdAt' | 'priority' | 'phase' | 'dueAt';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}): Promise<WorkItemListResponse> {
  const params = new URLSearchParams();
  if (query?.phase?.length) params.set('phase', query.phase.join(','));
  if (query?.includeArchived) params.set('includeArchived', 'true');
  if (query?.search?.trim()) params.set('search', query.search.trim());
  if (query?.sortBy) params.set('sortBy', query.sortBy);
  if (query?.sortOrder) params.set('sortOrder', query.sortOrder);
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.offset) params.set('offset', String(query.offset));
  const suffix = params.toString();
  return fetchJson(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/work-items${suffix ? `?${suffix}` : ''}`));
}

export type CreateWorkItemPayload = {
  title: string;
  description?: string;
  initialPhase?: Extract<WorkItemPhase, 'backlog' | 'ready'>;
  priority?: WorkItemPriority;
  ownerAgentId?: string;
  completionPolicy?: WorkItemCompletionPolicy;
  nextAction?: WorkItemNextAction;
  dueAt?: number;
  attachments?: File[];
};

function appendDefined(form: FormData, key: string, value: string | number | undefined): void {
  if (value !== undefined) form.append(key, String(value));
}

export async function createWorkItem(projectId: string, input: CreateWorkItemPayload): Promise<{ ok: true; item: WorkItem }> {
  if (!input.attachments?.length) {
    return fetchJson(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/work-items`), {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  const form = new FormData();
  appendDefined(form, 'title', input.title);
  appendDefined(form, 'description', input.description);
  appendDefined(form, 'initialPhase', input.initialPhase);
  appendDefined(form, 'priority', input.priority);
  appendDefined(form, 'ownerAgentId', input.ownerAgentId);
  appendDefined(form, 'completionPolicy', input.completionPolicy);
  appendDefined(form, 'nextAction', input.nextAction ? JSON.stringify(input.nextAction) : undefined);
  appendDefined(form, 'dueAt', input.dueAt);
  for (const file of input.attachments) form.append('file', file);
  return fetchJson(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/work-items`), { method: 'POST', body: form });
}

export async function fetchWorkItem(workItemId: string): Promise<{ ok: true; item: WorkItem; availableCommands: WorkItemCommand['type'][] }> {
  return fetchJson(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}`));
}

export async function patchWorkItemMetadata(workItemId: string, expectedVersion: number, patch: {
  title?: string;
  description?: string | null;
  priority?: WorkItemPriority;
  ownerAgentId?: string | null;
  completionPolicy?: WorkItemCompletionPolicy;
  nextAction?: WorkItemNextAction | null;
  dueAt?: number | null;
}): Promise<{ ok: true; item: WorkItem }> {
  return fetchJson(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...patch, expectedVersion }),
  });
}

export async function executeWorkItemCommand(workItemId: string, command: WorkItemCommand): Promise<{ ok: true; item: WorkItem; availableCommands: WorkItemCommand['type'][] }> {
  return fetchJson(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}/commands`), { method: 'POST', body: JSON.stringify(command) });
}

export async function setWorkItemArchived(workItemId: string, archived: boolean, expectedVersion: number): Promise<{ ok: true; item: WorkItem }> {
  return fetchJson(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}/${archived ? 'archive' : 'unarchive'}`), {
    method: 'POST',
    body: JSON.stringify({ expectedVersion }),
  });
}

export async function startWorkItemChat(workItemId: string): Promise<{ ok: true; item: WorkItem; session: ProjectSession }> {
  return fetchJson(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}/start-chat`), { method: 'POST', body: JSON.stringify({}) });
}

export async function startWorkItemWorkflowRun(workItemId: string, input: { definitionId: string; goal?: string }): Promise<StartWorkflowRunResult & { ok: true; item: WorkItem }> {
  return fetchJson(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}/workflows/run`), { method: 'POST', body: JSON.stringify(input) });
}

export async function fetchWorkItemEvents(workItemId: string): Promise<{ ok: true; events: WorkItemEvent[] }> {
  return fetchJson(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}/events`));
}

export async function uploadWorkItemAttachments(workItemId: string, files: File[]): Promise<{ ok: true; attachments: WorkItemAttachment[]; item: WorkItem }> {
  const form = new FormData();
  for (const file of files) form.append('file', file);
  return fetchJson(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}/attachments`), { method: 'POST', body: form });
}

export async function deleteWorkItemAttachment(workItemId: string, attachmentId: string): Promise<{ ok: true; attachment: WorkItemAttachment; item: WorkItem }> {
  return fetchJson(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}/attachments/${encodeURIComponent(attachmentId)}`), { method: 'DELETE' });
}

export function workItemAttachmentContentUrl(workItemId: string, attachmentId: string): string {
  return apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}/attachments/${encodeURIComponent(attachmentId)}/content`);
}

export async function downloadWorkItemAttachment(workItemId: string, attachment: WorkItemAttachment): Promise<void> {
  const res = await apiFetch(workItemAttachmentContentUrl(workItemId, attachment.id));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function fetchWorkItemCommandProposals(workItemId: string, state?: WorkItemCommandProposal['state']): Promise<{ ok: true; proposals: WorkItemCommandProposal[] }> {
  return fetchJson(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}/command-proposals${state ? `?state=${state}` : ''}`));
}

export async function createWorkItemCommandProposal(workItemId: string, input: {
  command: WorkItemCommand;
  sourceKind: WorkItemCommandProposal['sourceKind'];
  sourceId: string;
  rationale?: string;
  confidence?: number;
}): Promise<{ ok: true; proposal: WorkItemCommandProposal }> {
  return fetchJson(apiUrl(`/api/work-items/${encodeURIComponent(workItemId)}/command-proposals`), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function executeWorkItemCommandProposal(proposalId: string): Promise<{ ok: true; item: WorkItem; proposal: WorkItemCommandProposal }> {
  return fetchJson(apiUrl(`/api/work-item-command-proposals/${encodeURIComponent(proposalId)}/execute`), { method: 'POST' });
}

export async function rejectWorkItemCommandProposal(proposalId: string): Promise<{ ok: true; proposal: WorkItemCommandProposal }> {
  return fetchJson(apiUrl(`/api/work-item-command-proposals/${encodeURIComponent(proposalId)}/reject`), { method: 'POST' });
}
