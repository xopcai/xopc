export type ActivityObjectKind =
  | 'project'
  | 'note'
  | 'work_item'
  | 'session'
  | 'outcome'
  | 'workflow_run'
  | 'automation';

export type ActivityVisibility = 'timeline' | 'audit' | 'debug';
export type ActivityImportance = 'low' | 'normal' | 'high';
export type ActivityPrincipalKind = 'user' | 'agent' | 'system' | 'automation' | 'workflow';
export type ActivitySourceKind = 'xopc_use' | 'gateway_api' | 'automation' | 'workflow' | 'system';
export type ActivityScopeKind = 'project' | 'session' | 'workspace' | 'channel';
export type ActivityScopeReason = 'explicit' | 'object_owner' | 'inherited_session' | 'runtime_context';
export type ActivityRelatedProjectReason = 'object_link' | 'session_link' | 'derived_context';
export type ObjectLinkRelation = 'belongs_to' | 'created_from' | 'discussed_in' | 'attached_to';
export type ObjectLinkSource = 'user' | 'agent' | 'system';

export type ActivityEventType =
  | 'project.created'
  | 'project.updated'
  | 'project.status_changed'
  | 'project.workspace_changed'
  | 'note.created'
  | 'note.appended'
  | 'note.updated'
  | 'note.status_changed'
  | 'note.preview_generated'
  | 'work_item.created'
  | 'work_item.updated.v1'
  | 'work_item.lifecycle_changed.v1'
  | 'work_item.link_added'
  | 'session.attached_to_project'
  | 'session.detached_from_project'
  | 'session.renamed'
  | 'outcome.created'
  | 'outcome.status_changed'
  | 'workflow_run.started'
  | 'workflow_run.completed'
  | 'automation.run_started'
  | 'automation.run_completed'
  | 'work_discovery.started'
  | 'work_discovery.completed'
  | 'work_discovery.failed'
  | 'work_discovery.canceled'
  | 'work_discovery.suggestion_selected'
  | (string & {});

export interface ActivityPrincipal {
  kind: ActivityPrincipalKind;
  id?: string;
  name?: string;
  sessionKey?: string;
  agentId?: string;
}

export interface ActivitySource {
  kind: ActivitySourceKind;
  requestId?: string;
  toolCallId?: string;
  runId?: string;
}

export interface ActivityObjectRef {
  kind: ActivityObjectKind;
  id: string;
  title?: string;
}

export interface ActivityScope {
  activityId: string;
  scopeKind: ActivityScopeKind;
  scopeId: string;
  reason: ActivityScopeReason;
}

export interface ActivityRelatedProject {
  activityId: string;
  projectId: string;
  reason: ActivityRelatedProjectReason;
  confidence: number;
  computedAt: number;
}

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  primaryObject: ActivityObjectRef;
  actor: ActivityPrincipal;
  initiator?: ActivityPrincipal;
  source: ActivitySource;
  payload: Record<string, unknown>;
  visibility: ActivityVisibility;
  importance: ActivityImportance;
  createdAt: number;
}

export interface ActivityEventWithRelations extends ActivityEvent {
  scopes: ActivityScope[];
  relatedProjects: ActivityRelatedProject[];
}

export interface ObjectLink {
  id: string;
  from: ActivityObjectRef;
  to: ActivityObjectRef;
  relation: ObjectLinkRelation;
  source: ObjectLinkSource;
  createdAt: number;
}

export interface RecordActivityInput {
  id?: string;
  type: ActivityEventType;
  primaryObject: ActivityObjectRef;
  actor: ActivityPrincipal;
  initiator?: ActivityPrincipal;
  source: ActivitySource;
  payload?: Record<string, unknown>;
  visibility?: ActivityVisibility;
  importance?: ActivityImportance;
  scopes?: Array<Omit<ActivityScope, 'activityId'>>;
  relatedProjects?: Array<Omit<ActivityRelatedProject, 'activityId' | 'computedAt'> & { computedAt?: number }>;
  nowMs?: number;
}

export interface CreateObjectLinkInput {
  id?: string;
  from: ActivityObjectRef;
  to: ActivityObjectRef;
  relation: ObjectLinkRelation;
  source: ObjectLinkSource;
  nowMs?: number;
}

export interface ListActivityOptions {
  visibility?: ActivityVisibility;
  limit?: number;
  offset?: number;
}

export interface ListObjectActivityOptions extends ListActivityOptions {
  object: ActivityObjectRef;
}

export interface ListProjectActivityOptions extends ListActivityOptions {
  projectId: string;
  includeRelated?: boolean;
}

export interface ActivityListResult {
  items: ActivityEventWithRelations[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
