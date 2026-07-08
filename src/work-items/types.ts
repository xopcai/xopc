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

export interface WorkItem {
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
}

export interface WorkItemLink {
  id: string;
  workItemId: string;
  kind: WorkItemLinkKind;
  targetId: string;
  title?: string;
  statusSnapshot?: string;
  createdAt: number;
}

export interface WorkItemEvent {
  id: string;
  workItemId: string;
  type: WorkItemEventType;
  payload?: unknown;
  createdAt: number;
}

export interface WorkItemUpdateSuggestion {
  id: string;
  workItemId: string;
  sourceKind: WorkItemUpdateSuggestionSourceKind;
  sourceId: string;
  status: WorkItemUpdateSuggestionStatus;
  patch: Pick<UpdateWorkItemInput, 'status' | 'nextAction' | 'blockedReason'>;
  progressNote?: string;
  rationale?: string;
  confidence?: number;
  createdAt: number;
  appliedAt?: number;
  dismissedAt?: number;
}

export interface CreateWorkItemUpdateSuggestionInput {
  sourceKind: WorkItemUpdateSuggestionSourceKind;
  sourceId: string;
  patch?: Pick<UpdateWorkItemInput, 'status' | 'nextAction' | 'blockedReason'>;
  progressNote?: string;
  rationale?: string;
  confidence?: number;
}

export interface WorkItemListQuery {
  status?: WorkItemStatus | WorkItemStatus[];
  priority?: WorkItemPriority | WorkItemPriority[];
  includeArchived?: boolean;
  search?: string;
  sortBy?: 'updatedAt' | 'createdAt' | 'priority' | 'status';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface WorkItemListResult {
  items: WorkItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface CreateWorkItemInput {
  title: string;
  description?: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  ownerAgentId?: string;
  nextAction?: string;
  blockedReason?: string;
  dueAt?: number;
}

export interface UpdateWorkItemInput {
  title?: string;
  description?: string | null;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  ownerAgentId?: string | null;
  nextAction?: string | null;
  blockedReason?: string | null;
  dueAt?: number | null;
  archivedAt?: number | null;
}
