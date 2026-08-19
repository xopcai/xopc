import { randomUUID } from 'node:crypto';

import type {
  WorkItem,
  WorkItemActionActor,
  WorkItemAttachment,
  WorkItemCommandProposal,
  WorkItemLink,
  WorkItemPriority,
  WorkItemWait,
} from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/index.js';
import type {
  CreateWorkItemCommandProposalInput,
  CreateWorkItemInput,
  UpdateWorkItemMetadataInput,
  WorkItemEvent,
  WorkItemEventType,
  WorkItemListQuery,
  WorkItemListResult,
} from './types.js';

type WorkItemRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  priority: WorkItem['priority'];
  owner_agent_id: string | null;
  phase: WorkItem['phase'];
  completion_policy: WorkItem['completionPolicy'];
  next_action_text: string | null;
  next_action_actor: WorkItemActionActor | null;
  next_action_due_at: number | null;
  resolution: WorkItem['resolution'] | null;
  resolution_reason: string | null;
  due_at: number | null;
  started_at: number | null;
  review_requested_at: number | null;
  closed_at: number | null;
  archived_at: number | null;
  version: number;
  created_at: number;
  updated_at: number;
};

type WaitRow = {
  id: string;
  work_item_id: string;
  kind: WorkItemWait['kind'];
  reason: string;
  resume_at: number | null;
  blocking_work_item_id: string | null;
  created_at: number;
  resolved_at: number | null;
  resolution_note: string | null;
};

type LinkRow = {
  id: string;
  work_item_id: string;
  kind: WorkItemLink['kind'];
  target_id: string;
  title: string | null;
  status_snapshot: string | null;
  created_at: number;
};

type AttachmentRow = {
  id: string;
  work_item_id: string;
  media_uri: string;
  media_id: string;
  bucket: string;
  type: WorkItemAttachment['type'];
  mime_type: string;
  file_name: string;
  size: number;
  created_at: number;
};

type EventRow = { id: string; work_item_id: string; type: WorkItemEventType; payload_json: string | null; created_at: number };

type ProposalRow = {
  id: string;
  work_item_id: string;
  command_json: string;
  source_kind: WorkItemCommandProposal['sourceKind'];
  source_id: string;
  rationale: string | null;
  confidence: number | null;
  state: WorkItemCommandProposal['state'];
  created_at: number;
  resolved_at: number | null;
};

function nowMs(): number {
  return Date.now();
}

function normalizeTitle(title: string): string {
  const value = title.trim();
  if (!value) throw new Error('Work item title is required');
  return value;
}

function rowToWait(row: WaitRow): WorkItemWait {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    kind: row.kind,
    reason: row.reason,
    resumeAt: row.resume_at ?? undefined,
    blockingWorkItemId: row.blocking_work_item_id ?? undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
    resolutionNote: row.resolution_note ?? undefined,
  };
}

function rowToLink(row: LinkRow): WorkItemLink {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    kind: row.kind,
    targetId: row.target_id,
    title: row.title ?? undefined,
    statusSnapshot: row.status_snapshot ?? undefined,
    createdAt: row.created_at,
  };
}

function rowToAttachment(row: AttachmentRow): WorkItemAttachment {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    mediaUri: row.media_uri,
    mediaId: row.media_id,
    bucket: row.bucket,
    type: row.type,
    mimeType: row.mime_type,
    fileName: row.file_name,
    size: row.size,
    createdAt: row.created_at,
  };
}

function rowToProposal(row: ProposalRow): WorkItemCommandProposal {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    command: JSON.parse(row.command_json),
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    rationale: row.rationale ?? undefined,
    confidence: row.confidence ?? undefined,
    state: row.state,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

function toArray<T>(value: T | T[] | undefined): T[] | undefined {
  return value === undefined ? undefined : Array.isArray(value) ? value : [value];
}

function comparePriority(left: WorkItemPriority, right: WorkItemPriority): number {
  const rank: Record<WorkItemPriority, number> = { urgent: 4, high: 3, normal: 2, low: 1 };
  return rank[left] - rank[right];
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(500, Math.floor(value ?? 50)));
}

export class WorkItemStore {
  private hydrate(row: WorkItemRow): WorkItem {
    const nextAction = row.next_action_text && row.next_action_actor
      ? { text: row.next_action_text, actor: row.next_action_actor, dueAt: row.next_action_due_at ?? undefined }
      : undefined;
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description ?? undefined,
      priority: row.priority,
      ownerAgentId: row.owner_agent_id ?? undefined,
      phase: row.phase,
      completionPolicy: row.completion_policy,
      nextAction,
      waits: this.listWaits(row.id),
      links: this.listLinks(row.id),
      attachments: this.listAttachments(row.id),
      resolution: row.resolution ?? undefined,
      resolutionReason: row.resolution_reason ?? undefined,
      dueAt: row.due_at ?? undefined,
      startedAt: row.started_at ?? undefined,
      reviewRequestedAt: row.review_requested_at ?? undefined,
      closedAt: row.closed_at ?? undefined,
      archivedAt: row.archived_at ?? undefined,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  create(projectId: string, input: CreateWorkItemInput): WorkItem {
    const timestamp = nowMs();
    const item: WorkItem = {
      id: randomUUID(),
      projectId,
      title: normalizeTitle(input.title),
      description: input.description?.trim() || undefined,
      priority: input.priority ?? 'normal',
      ownerAgentId: input.ownerAgentId?.trim() || undefined,
      phase: input.initialPhase ?? 'backlog',
      completionPolicy: input.completionPolicy ?? 'agent_verified',
      nextAction: input.nextAction,
      waits: [],
      links: [],
      attachments: [],
      dueAt: input.dueAt,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    getSqliteDatabase().prepare(`INSERT INTO work_items (
      id, project_id, title, description, priority, owner_agent_id, phase, completion_policy,
      next_action_text, next_action_actor, next_action_due_at, due_at, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      item.id, item.projectId, item.title, item.description ?? null, item.priority, item.ownerAgentId ?? null,
      item.phase, item.completionPolicy, item.nextAction?.text ?? null, item.nextAction?.actor ?? null,
      item.nextAction?.dueAt ?? null, item.dueAt ?? null, item.version, item.createdAt, item.updatedAt,
    );
    return item;
  }

  get(id: string): WorkItem | null {
    const row = getSqliteDatabase().prepare('SELECT * FROM work_items WHERE id = ?').get(id) as WorkItemRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  list(projectId: string, query: WorkItemListQuery = {}): WorkItemListResult {
    const rows = getSqliteDatabase().prepare('SELECT * FROM work_items WHERE project_id = ?').all(projectId) as WorkItemRow[];
    return this.applyQuery(rows.map((row) => this.hydrate(row)), query);
  }

  listAll(query: WorkItemListQuery = {}): WorkItemListResult {
    const rows = getSqliteDatabase().prepare('SELECT * FROM work_items').all() as WorkItemRow[];
    return this.applyQuery(rows.map((row) => this.hydrate(row)), query);
  }

  private applyQuery(items: WorkItem[], query: WorkItemListQuery): WorkItemListResult {
    const phases = toArray(query.phase);
    const priorities = toArray(query.priority);
    const resolutions = toArray(query.resolution);
    const waitKinds = toArray(query.waitKind);
    const search = query.search?.trim().toLowerCase();
    let filtered = items.filter((item) => {
      if (!query.includeArchived && item.archivedAt) return false;
      if (phases?.length && !phases.includes(item.phase)) return false;
      if (priorities?.length && !priorities.includes(item.priority)) return false;
      if (resolutions?.length && (!item.resolution || !resolutions.includes(item.resolution))) return false;
      if (waitKinds?.length && !item.waits.some((wait) => !wait.resolvedAt && waitKinds.includes(wait.kind))) return false;
      if (search) {
        const text = [item.title, item.description, item.nextAction?.text, ...item.waits.map((wait) => wait.reason)]
          .filter(Boolean).join('\n').toLowerCase();
        if (!text.includes(search)) return false;
      }
      return true;
    });
    const direction = query.sortOrder === 'asc' ? 1 : -1;
    filtered = [...filtered].sort((left, right) => {
      if (query.sortBy === 'priority') return direction * comparePriority(left.priority, right.priority);
      if (query.sortBy === 'phase') return direction * left.phase.localeCompare(right.phase);
      if (query.sortBy === 'createdAt') return direction * (left.createdAt - right.createdAt);
      if (query.sortBy === 'dueAt') return direction * ((left.dueAt ?? Number.MAX_SAFE_INTEGER) - (right.dueAt ?? Number.MAX_SAFE_INTEGER));
      return direction * (left.updatedAt - right.updatedAt);
    });
    const total = filtered.length;
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const page = filtered.slice(offset, offset + limit);
    return { items: page, total, limit, offset, hasMore: offset + page.length < total };
  }

  updateMetadata(id: string, patch: UpdateWorkItemMetadataInput, expectedVersion: number): WorkItem | null {
    const current = this.get(id);
    if (!current || current.version !== expectedVersion) return null;
    const nextAction = patch.nextAction === undefined ? current.nextAction : patch.nextAction ?? undefined;
    const result = getSqliteDatabase().prepare(`UPDATE work_items SET
      title = ?, description = ?, priority = ?, owner_agent_id = ?, completion_policy = ?,
      next_action_text = ?, next_action_actor = ?, next_action_due_at = ?, due_at = ?,
      version = version + 1, updated_at = ? WHERE id = ? AND version = ?`).run(
      patch.title === undefined ? current.title : normalizeTitle(patch.title),
      patch.description === undefined ? current.description ?? null : patch.description?.trim() || null,
      patch.priority ?? current.priority,
      patch.ownerAgentId === undefined ? current.ownerAgentId ?? null : patch.ownerAgentId?.trim() || null,
      patch.completionPolicy ?? current.completionPolicy,
      nextAction?.text ?? null, nextAction?.actor ?? null, nextAction?.dueAt ?? null,
      patch.dueAt === undefined ? current.dueAt ?? null : patch.dueAt,
      nowMs(), id, expectedVersion,
    );
    return Number(result.changes) === 1 ? this.get(id) : null;
  }

  saveTransition(next: WorkItem): WorkItem | null {
    const result = getSqliteDatabase().prepare(`UPDATE work_items SET
      phase = ?, next_action_text = ?, next_action_actor = ?, next_action_due_at = ?,
      resolution = ?, resolution_reason = ?, started_at = ?, review_requested_at = ?, closed_at = ?,
      version = ?, updated_at = ? WHERE id = ? AND version = ?`).run(
      next.phase, next.nextAction?.text ?? null, next.nextAction?.actor ?? null, next.nextAction?.dueAt ?? null,
      next.resolution ?? null, next.resolutionReason ?? null, next.startedAt ?? null,
      next.reviewRequestedAt ?? null, next.closedAt ?? null, next.version, next.updatedAt,
      next.id, next.version - 1,
    );
    if (Number(result.changes) !== 1) return null;
    for (const wait of next.waits) this.upsertWait(wait);
    return this.get(next.id);
  }

  setArchived(id: string, archived: boolean, expectedVersion: number): WorkItem | null {
    const timestamp = nowMs();
    const result = getSqliteDatabase().prepare(`UPDATE work_items SET archived_at = ?, version = version + 1,
      updated_at = ? WHERE id = ? AND version = ? AND phase = 'closed'`)
      .run(archived ? timestamp : null, timestamp, id, expectedVersion);
    return Number(result.changes) === 1 ? this.get(id) : null;
  }

  private upsertWait(wait: WorkItemWait): void {
    getSqliteDatabase().prepare(`INSERT INTO work_item_waits (
      id, work_item_id, kind, reason, resume_at, blocking_work_item_id, created_at, resolved_at, resolution_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET resolved_at = excluded.resolved_at, resolution_note = excluded.resolution_note`).run(
      wait.id, wait.workItemId, wait.kind, wait.reason, wait.resumeAt ?? null, wait.blockingWorkItemId ?? null,
      wait.createdAt, wait.resolvedAt ?? null, wait.resolutionNote ?? null,
    );
  }

  listWaits(workItemId: string): WorkItemWait[] {
    const rows = getSqliteDatabase().prepare('SELECT * FROM work_item_waits WHERE work_item_id = ? ORDER BY created_at')
      .all(workItemId) as WaitRow[];
    return rows.map(rowToWait);
  }

  wouldCreateDependencyCycle(workItemId: string, blockingWorkItemId: string): boolean {
    if (workItemId === blockingWorkItemId) return true;
    const row = getSqliteDatabase().prepare(`WITH RECURSIVE dependency(id) AS (
      SELECT blocking_work_item_id FROM work_item_waits
      WHERE work_item_id = ? AND kind = 'dependency' AND resolved_at IS NULL
      UNION
      SELECT w.blocking_work_item_id FROM work_item_waits w JOIN dependency d ON w.work_item_id = d.id
      WHERE w.kind = 'dependency' AND w.resolved_at IS NULL
    ) SELECT 1 AS found FROM dependency WHERE id = ? LIMIT 1`).get(blockingWorkItemId, workItemId) as { found: number } | undefined;
    return Boolean(row);
  }

  addLink(input: Omit<WorkItemLink, 'id' | 'createdAt'>): WorkItemLink {
    const link = { ...input, id: randomUUID(), createdAt: nowMs() };
    getSqliteDatabase().prepare(`INSERT INTO work_item_links
      (id, work_item_id, kind, target_id, title, status_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(link.id, link.workItemId, link.kind, link.targetId, link.title ?? null, link.statusSnapshot ?? null, link.createdAt);
    return link;
  }

  listLinks(workItemId: string): WorkItemLink[] {
    const rows = getSqliteDatabase().prepare('SELECT * FROM work_item_links WHERE work_item_id = ? ORDER BY created_at DESC')
      .all(workItemId) as LinkRow[];
    return rows.map(rowToLink);
  }

  addAttachment(input: Omit<WorkItemAttachment, 'id' | 'createdAt'>): WorkItemAttachment {
    const attachment = { ...input, id: randomUUID(), createdAt: nowMs() };
    getSqliteDatabase().prepare(`INSERT INTO work_item_attachments
      (id, work_item_id, media_uri, media_id, bucket, type, mime_type, file_name, size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      attachment.id, attachment.workItemId, attachment.mediaUri, attachment.mediaId, attachment.bucket,
      attachment.type, attachment.mimeType, attachment.fileName, attachment.size, attachment.createdAt,
    );
    return attachment;
  }

  getAttachment(workItemId: string, attachmentId: string): WorkItemAttachment | null {
    const row = getSqliteDatabase().prepare('SELECT * FROM work_item_attachments WHERE work_item_id = ? AND id = ?')
      .get(workItemId, attachmentId) as AttachmentRow | undefined;
    return row ? rowToAttachment(row) : null;
  }

  listAttachments(workItemId: string): WorkItemAttachment[] {
    const rows = getSqliteDatabase().prepare('SELECT * FROM work_item_attachments WHERE work_item_id = ? ORDER BY created_at DESC')
      .all(workItemId) as AttachmentRow[];
    return rows.map(rowToAttachment);
  }

  removeAttachment(workItemId: string, attachmentId: string): WorkItemAttachment | null {
    const attachment = this.getAttachment(workItemId, attachmentId);
    if (!attachment) return null;
    getSqliteDatabase().prepare('DELETE FROM work_item_attachments WHERE work_item_id = ? AND id = ?')
      .run(workItemId, attachmentId);
    return attachment;
  }

  addEvent(workItemId: string, type: WorkItemEventType, payload?: unknown): WorkItemEvent {
    const event = { id: randomUUID(), workItemId, type, payload, createdAt: nowMs() };
    getSqliteDatabase().prepare(`INSERT INTO work_item_events
      (id, work_item_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(event.id, workItemId, type, payload === undefined ? null : JSON.stringify(payload), event.createdAt);
    return event;
  }

  listEvents(workItemId: string): WorkItemEvent[] {
    const rows = getSqliteDatabase().prepare('SELECT * FROM work_item_events WHERE work_item_id = ? ORDER BY created_at DESC, rowid DESC')
      .all(workItemId) as EventRow[];
    return rows.map((row) => ({
      id: row.id,
      workItemId: row.work_item_id,
      type: row.type,
      payload: row.payload_json ? JSON.parse(row.payload_json) : undefined,
      createdAt: row.created_at,
    }));
  }

  createCommandProposal(workItemId: string, input: CreateWorkItemCommandProposalInput): WorkItemCommandProposal | null {
    if (!this.get(workItemId)) return null;
    const proposal: WorkItemCommandProposal = {
      id: randomUUID(), workItemId, command: input.command,
      sourceKind: input.sourceKind, sourceId: input.sourceId, rationale: input.rationale?.trim() || undefined,
      confidence: input.confidence, state: 'pending', createdAt: nowMs(),
    };
    getSqliteDatabase().prepare(`INSERT INTO work_item_command_proposals
      (id, work_item_id, command_json, source_kind, source_id, rationale, confidence, state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      proposal.id, proposal.workItemId, JSON.stringify(proposal.command),
      proposal.sourceKind, proposal.sourceId, proposal.rationale ?? null, proposal.confidence ?? null,
      proposal.state, proposal.createdAt,
    );
    return proposal;
  }

  getCommandProposal(id: string): WorkItemCommandProposal | null {
    const row = getSqliteDatabase().prepare('SELECT * FROM work_item_command_proposals WHERE id = ?').get(id) as ProposalRow | undefined;
    return row ? rowToProposal(row) : null;
  }

  listCommandProposals(workItemId: string, state?: WorkItemCommandProposal['state']): WorkItemCommandProposal[] {
    const rows = state
      ? getSqliteDatabase().prepare('SELECT * FROM work_item_command_proposals WHERE work_item_id = ? AND state = ? ORDER BY created_at DESC').all(workItemId, state)
      : getSqliteDatabase().prepare('SELECT * FROM work_item_command_proposals WHERE work_item_id = ? ORDER BY created_at DESC').all(workItemId);
    return (rows as ProposalRow[]).map(rowToProposal);
  }

  resolveCommandProposal(id: string, state: 'executed' | 'rejected' | 'expired'): WorkItemCommandProposal | null {
    getSqliteDatabase().prepare(`UPDATE work_item_command_proposals SET state = ?, resolved_at = ?
      WHERE id = ? AND state = 'pending'`).run(state, nowMs(), id);
    return this.getCommandProposal(id);
  }
}
