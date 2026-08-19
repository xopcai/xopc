import type {
  WorkItem,
  WorkItemCommand,
  WorkItemCommandProposal,
  WorkItemCompletionPolicy,
  WorkItemNextAction,
  WorkItemPhase,
  WorkItemPriority,
  WorkItemResolution,
} from '@xopcai/gateway-contract';

export type {
  WorkItem,
  WorkItemActionActor,
  WorkItemAttachment,
  WorkItemCommand,
  WorkItemCommandProposal,
  WorkItemCompletionPolicy,
  WorkItemLink,
  WorkItemNextAction,
  WorkItemPhase,
  WorkItemPriority,
  WorkItemResolution,
  WorkItemWait,
  WorkItemWaitKind,
} from '@xopcai/gateway-contract';

export type WorkItemEventType =
  | 'work_item.created'
  | 'work_item.metadata_updated'
  | 'work_item.committed'
  | 'work_item.deferred'
  | 'work_item.started'
  | 'work_item.stopped'
  | 'work_item.review_requested'
  | 'work_item.changes_requested'
  | 'work_item.completed'
  | 'work_item.closed'
  | 'work_item.reopened'
  | 'work_item.wait_created'
  | 'work_item.wait_resolved'
  | 'work_item.archived'
  | 'work_item.unarchived'
  | 'work_item.attachment_added'
  | 'work_item.attachment_removed'
  | 'work_item.link_added'
  | 'work_item.command_proposed'
  | 'work_item.command_proposal_executed'
  | 'work_item.command_proposal_rejected';

export interface WorkItemEvent {
  id: string;
  workItemId: string;
  type: WorkItemEventType;
  payload?: unknown;
  createdAt: number;
}

export interface WorkItemListQuery {
  phase?: WorkItemPhase | WorkItemPhase[];
  priority?: WorkItemPriority | WorkItemPriority[];
  resolution?: WorkItemResolution | WorkItemResolution[];
  waitKind?: string | string[];
  includeArchived?: boolean;
  search?: string;
  sortBy?: 'updatedAt' | 'createdAt' | 'priority' | 'phase' | 'dueAt';
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
  initialPhase?: Extract<WorkItemPhase, 'backlog' | 'ready'>;
  priority?: WorkItemPriority;
  ownerAgentId?: string;
  completionPolicy?: WorkItemCompletionPolicy;
  nextAction?: WorkItemNextAction;
  dueAt?: number;
}

export interface UpdateWorkItemMetadataInput {
  title?: string;
  description?: string | null;
  priority?: WorkItemPriority;
  ownerAgentId?: string | null;
  completionPolicy?: WorkItemCompletionPolicy;
  nextAction?: WorkItemNextAction | null;
  dueAt?: number | null;
}

export interface CreateWorkItemCommandProposalInput {
  command: WorkItemCommand;
  sourceKind: WorkItemCommandProposal['sourceKind'];
  sourceId: string;
  rationale?: string;
  confidence?: number;
}
