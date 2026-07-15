import { randomUUID } from 'node:crypto';

import { getSqliteDatabase } from '../storage/sqlite/index.js';
import type {
  CreateWorkItemUpdateSuggestionInput,
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItem,
  WorkItemAttachment,
  WorkItemEvent,
  WorkItemEventType,
  WorkItemLink,
  WorkItemLinkKind,
  WorkItemListQuery,
  WorkItemListResult,
  WorkItemPriority,
  WorkItemStatus,
  WorkItemUpdateSuggestion,
  WorkItemUpdateSuggestionSourceKind,
  WorkItemUpdateSuggestionStatus,
} from './types.js';

type WorkItemRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  owner_agent_id: string | null;
  next_action: string | null;
  blocked_reason: string | null;
  due_at: number | null;
  completed_at: number | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
};

type WorkItemLinkRow = {
  id: string;
  work_item_id: string;
  kind: string;
  target_id: string;
  title: string | null;
  status_snapshot: string | null;
  created_at: number;
};

type WorkItemAttachmentRow = {
  id: string;
  work_item_id: string;
  media_uri: string;
  media_id: string;
  bucket: string;
  type: string;
  mime_type: string;
  file_name: string;
  size: number;
  created_at: number;
};

type WorkItemEventRow = {
  id: string;
  work_item_id: string;
  type: string;
  payload_json: string | null;
  created_at: number;
};

type WorkItemUpdateSuggestionRow = {
  id: string;
  work_item_id: string;
  source_kind: string;
  source_id: string;
  status: string;
  patch_json: string;
  progress_note: string | null;
  rationale: string | null;
  confidence: number | null;
  created_at: number;
  applied_at: number | null;
  dismissed_at: number | null;
};

function nowMs(): number {
  return Date.now();
}

function toArray<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(500, Math.floor(value ?? 50)));
}

function normalizeTitle(title: string): string {
  const value = title.trim();
  if (!value) throw new Error('Work item title is required');
  return value;
}

function rowToItem(row: WorkItemRow): WorkItem {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as WorkItemStatus,
    priority: row.priority as WorkItemPriority,
    ownerAgentId: row.owner_agent_id ?? undefined,
    nextAction: row.next_action ?? undefined,
    blockedReason: row.blocked_reason ?? undefined,
    dueAt: row.due_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToLink(row: WorkItemLinkRow): WorkItemLink {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    kind: row.kind as WorkItemLinkKind,
    targetId: row.target_id,
    title: row.title ?? undefined,
    statusSnapshot: row.status_snapshot ?? undefined,
    createdAt: row.created_at,
  };
}

function rowToAttachment(row: WorkItemAttachmentRow): WorkItemAttachment {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    mediaUri: row.media_uri,
    mediaId: row.media_id,
    bucket: row.bucket,
    type: row.type as WorkItemAttachment['type'],
    mimeType: row.mime_type,
    fileName: row.file_name,
    size: row.size,
    createdAt: row.created_at,
  };
}

function rowToEvent(row: WorkItemEventRow): WorkItemEvent {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    type: row.type as WorkItemEventType,
    payload: row.payload_json ? JSON.parse(row.payload_json) : undefined,
    createdAt: row.created_at,
  };
}

function rowToSuggestion(row: WorkItemUpdateSuggestionRow): WorkItemUpdateSuggestion {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    sourceKind: row.source_kind as WorkItemUpdateSuggestionSourceKind,
    sourceId: row.source_id,
    status: row.status as WorkItemUpdateSuggestionStatus,
    patch: JSON.parse(row.patch_json || '{}'),
    progressNote: row.progress_note ?? undefined,
    rationale: row.rationale ?? undefined,
    confidence: row.confidence ?? undefined,
    createdAt: row.created_at,
    appliedAt: row.applied_at ?? undefined,
    dismissedAt: row.dismissed_at ?? undefined,
  };
}

function comparePriority(left: WorkItemPriority, right: WorkItemPriority): number {
  const rank: Record<WorkItemPriority, number> = { urgent: 4, high: 3, normal: 2, low: 1 };
  return rank[left] - rank[right];
}

function applyQuery(items: WorkItem[], query: WorkItemListQuery = {}): WorkItemListResult {
  const statuses = toArray(query.status);
  const priorities = toArray(query.priority);
  const search = query.search?.trim().toLowerCase();
  let filtered = items.filter((item) => {
    if (!query.includeArchived && item.archivedAt) return false;
    if (statuses?.length && !statuses.includes(item.status)) return false;
    if (priorities?.length && !priorities.includes(item.priority)) return false;
    if (search) {
      const text = [item.title, item.description, item.nextAction, item.blockedReason].filter(Boolean).join('\n').toLowerCase();
      if (!text.includes(search)) return false;
    }
    return true;
  });

  const sortBy = query.sortBy ?? 'updatedAt';
  const direction = query.sortOrder === 'asc' ? 1 : -1;
  filtered = [...filtered].sort((left, right) => {
    if (sortBy === 'priority') return direction * comparePriority(left.priority, right.priority);
    if (sortBy === 'status') return direction * left.status.localeCompare(right.status);
    if (sortBy === 'createdAt') return direction * (left.createdAt - right.createdAt);
    return direction * (left.updatedAt - right.updatedAt);
  });

  const total = filtered.length;
  const limit = clampLimit(query.limit);
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const page = filtered.slice(offset, offset + limit);
  return { items: page, total, limit, offset, hasMore: offset + page.length < total };
}

export class WorkItemStore {
  create(projectId: string, input: CreateWorkItemInput): WorkItem {
    const timestamp = nowMs();
    const item: WorkItem = {
      id: randomUUID(),
      projectId,
      title: normalizeTitle(input.title),
      description: input.description?.trim() || undefined,
      status: input.status ?? 'todo',
      priority: input.priority ?? 'normal',
      ownerAgentId: input.ownerAgentId?.trim() || undefined,
      nextAction: input.nextAction?.trim() || undefined,
      blockedReason: input.blockedReason?.trim() || undefined,
      dueAt: input.dueAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    getSqliteDatabase()
      .prepare(
        `INSERT INTO work_items
          (id, project_id, title, description, status, priority, owner_agent_id, next_action, blocked_reason, due_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.projectId,
        item.title,
        item.description ?? null,
        item.status,
        item.priority,
        item.ownerAgentId ?? null,
        item.nextAction ?? null,
        item.blockedReason ?? null,
        item.dueAt ?? null,
        item.createdAt,
        item.updatedAt,
      );
    return item;
  }

  get(id: string): WorkItem | null {
    const row = getSqliteDatabase()
      .prepare(`SELECT * FROM work_items WHERE id = ?`)
      .get(id) as WorkItemRow | undefined;
    return row ? { ...rowToItem(row), links: this.listLinks(id), attachments: this.listAttachments(id) } : null;
  }

  list(projectId: string, query: WorkItemListQuery = {}): WorkItemListResult {
    const rows = getSqliteDatabase()
      .prepare(`SELECT * FROM work_items WHERE project_id = ?`)
      .all(projectId) as WorkItemRow[];
    const result = applyQuery(rows.map(rowToItem), query);
    const linksByItem = this.listLinksForItems(result.items.map((item) => item.id));
    const attachmentsByItem = this.listAttachmentsForItems(result.items.map((item) => item.id));
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        links: linksByItem.get(item.id) ?? [],
        attachments: attachmentsByItem.get(item.id) ?? [],
      })),
    };
  }

  listAll(query: WorkItemListQuery = {}): WorkItemListResult {
    const rows = getSqliteDatabase()
      .prepare(`SELECT * FROM work_items`)
      .all() as WorkItemRow[];
    const result = applyQuery(rows.map(rowToItem), query);
    const linksByItem = this.listLinksForItems(result.items.map((item) => item.id));
    const attachmentsByItem = this.listAttachmentsForItems(result.items.map((item) => item.id));
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        links: linksByItem.get(item.id) ?? [],
        attachments: attachmentsByItem.get(item.id) ?? [],
      })),
    };
  }

  update(id: string, patch: UpdateWorkItemInput): WorkItem | null {
    const current = this.get(id);
    if (!current) return null;
    const timestamp = nowMs();
    const nextStatus = patch.status ?? current.status;
    const completedAt = nextStatus === 'done'
      ? (current.completedAt ?? timestamp)
      : (nextStatus === current.status ? (current.completedAt ?? null) : null);
    getSqliteDatabase()
      .prepare(
        `UPDATE work_items
         SET title = ?, description = ?, status = ?, priority = ?, owner_agent_id = ?,
             next_action = ?, blocked_reason = ?, due_at = ?, completed_at = ?, archived_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.title !== undefined ? normalizeTitle(patch.title) : current.title,
        patch.description !== undefined ? (patch.description?.trim() || null) : (current.description ?? null),
        nextStatus,
        patch.priority ?? current.priority,
        patch.ownerAgentId !== undefined ? (patch.ownerAgentId?.trim() || null) : (current.ownerAgentId ?? null),
        patch.nextAction !== undefined ? (patch.nextAction?.trim() || null) : (current.nextAction ?? null),
        patch.blockedReason !== undefined ? (patch.blockedReason?.trim() || null) : (current.blockedReason ?? null),
        patch.dueAt !== undefined ? patch.dueAt : (current.dueAt ?? null),
        completedAt,
        patch.archivedAt !== undefined ? patch.archivedAt : (current.archivedAt ?? null),
        timestamp,
        id,
      );
    return this.get(id);
  }

  addLink(input: Omit<WorkItemLink, 'id' | 'createdAt'>): WorkItemLink {
    const link: WorkItemLink = { ...input, id: randomUUID(), createdAt: nowMs() };
    getSqliteDatabase()
      .prepare(
        `INSERT INTO work_item_links (id, work_item_id, kind, target_id, title, status_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(link.id, link.workItemId, link.kind, link.targetId, link.title ?? null, link.statusSnapshot ?? null, link.createdAt);
    return link;
  }

  listLinks(workItemId: string): WorkItemLink[] {
    const rows = getSqliteDatabase()
      .prepare(`SELECT * FROM work_item_links WHERE work_item_id = ? ORDER BY created_at DESC`)
      .all(workItemId) as WorkItemLinkRow[];
    return rows.map(rowToLink);
  }

  listLinksForItems(workItemIds: string[]): Map<string, WorkItemLink[]> {
    const unique = [...new Set(workItemIds)];
    if (!unique.length) return new Map();
    const rows = getSqliteDatabase()
      .prepare(`SELECT * FROM work_item_links WHERE work_item_id IN (${unique.map(() => '?').join(', ')}) ORDER BY created_at DESC`)
      .all(...unique) as WorkItemLinkRow[];
    const map = new Map<string, WorkItemLink[]>();
    for (const row of rows) {
      const list = map.get(row.work_item_id) ?? [];
      list.push(rowToLink(row));
      map.set(row.work_item_id, list);
    }
    return map;
  }

  addAttachment(input: Omit<WorkItemAttachment, 'id' | 'createdAt'>): WorkItemAttachment {
    const attachment: WorkItemAttachment = { ...input, id: randomUUID(), createdAt: nowMs() };
    getSqliteDatabase()
      .prepare(
        `INSERT INTO work_item_attachments
          (id, work_item_id, media_uri, media_id, bucket, type, mime_type, file_name, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attachment.id,
        attachment.workItemId,
        attachment.mediaUri,
        attachment.mediaId,
        attachment.bucket,
        attachment.type,
        attachment.mimeType,
        attachment.fileName,
        attachment.size,
        attachment.createdAt,
      );
    return attachment;
  }

  getAttachment(workItemId: string, attachmentId: string): WorkItemAttachment | null {
    const row = getSqliteDatabase()
      .prepare(`SELECT * FROM work_item_attachments WHERE work_item_id = ? AND id = ?`)
      .get(workItemId, attachmentId) as WorkItemAttachmentRow | undefined;
    return row ? rowToAttachment(row) : null;
  }

  listAttachments(workItemId: string): WorkItemAttachment[] {
    const rows = getSqliteDatabase()
      .prepare(`SELECT * FROM work_item_attachments WHERE work_item_id = ? ORDER BY created_at DESC`)
      .all(workItemId) as WorkItemAttachmentRow[];
    return rows.map(rowToAttachment);
  }

  listAttachmentsForItems(workItemIds: string[]): Map<string, WorkItemAttachment[]> {
    const unique = [...new Set(workItemIds)];
    if (!unique.length) return new Map();
    const rows = getSqliteDatabase()
      .prepare(`SELECT * FROM work_item_attachments WHERE work_item_id IN (${unique.map(() => '?').join(', ')}) ORDER BY created_at DESC`)
      .all(...unique) as WorkItemAttachmentRow[];
    const map = new Map<string, WorkItemAttachment[]>();
    for (const row of rows) {
      const list = map.get(row.work_item_id) ?? [];
      list.push(rowToAttachment(row));
      map.set(row.work_item_id, list);
    }
    return map;
  }

  removeAttachment(workItemId: string, attachmentId: string): WorkItemAttachment | null {
    const attachment = this.getAttachment(workItemId, attachmentId);
    if (!attachment) return null;
    getSqliteDatabase()
      .prepare(`DELETE FROM work_item_attachments WHERE work_item_id = ? AND id = ?`)
      .run(workItemId, attachmentId);
    return attachment;
  }

  addEvent(workItemId: string, type: WorkItemEventType, payload?: unknown): WorkItemEvent {
    const event: WorkItemEvent = { id: randomUUID(), workItemId, type, payload, createdAt: nowMs() };
    getSqliteDatabase()
      .prepare(`INSERT INTO work_item_events (id, work_item_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(event.id, workItemId, type, payload === undefined ? null : JSON.stringify(payload), event.createdAt);
    return event;
  }

  listEvents(workItemId: string): WorkItemEvent[] {
    const rows = getSqliteDatabase()
      .prepare(`SELECT * FROM work_item_events WHERE work_item_id = ? ORDER BY created_at DESC`)
      .all(workItemId) as WorkItemEventRow[];
    return rows.map(rowToEvent);
  }

  createUpdateSuggestion(workItemId: string, input: CreateWorkItemUpdateSuggestionInput): WorkItemUpdateSuggestion | null {
    if (!this.get(workItemId)) return null;
    const suggestion: WorkItemUpdateSuggestion = {
      id: randomUUID(),
      workItemId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      status: 'pending',
      patch: input.patch ?? {},
      progressNote: input.progressNote?.trim() || undefined,
      rationale: input.rationale?.trim() || undefined,
      confidence: input.confidence,
      createdAt: nowMs(),
    };
    getSqliteDatabase()
      .prepare(
        `INSERT INTO work_item_update_suggestions
          (id, work_item_id, source_kind, source_id, status, patch_json, progress_note, rationale, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        suggestion.id,
        suggestion.workItemId,
        suggestion.sourceKind,
        suggestion.sourceId,
        suggestion.status,
        JSON.stringify(suggestion.patch),
        suggestion.progressNote ?? null,
        suggestion.rationale ?? null,
        suggestion.confidence ?? null,
        suggestion.createdAt,
      );
    return suggestion;
  }

  getUpdateSuggestion(id: string): WorkItemUpdateSuggestion | null {
    const row = getSqliteDatabase()
      .prepare(`SELECT * FROM work_item_update_suggestions WHERE id = ?`)
      .get(id) as WorkItemUpdateSuggestionRow | undefined;
    return row ? rowToSuggestion(row) : null;
  }

  listUpdateSuggestions(workItemId: string, status?: WorkItemUpdateSuggestionStatus): WorkItemUpdateSuggestion[] {
    const rows = status
      ? getSqliteDatabase()
        .prepare(`SELECT * FROM work_item_update_suggestions WHERE work_item_id = ? AND status = ? ORDER BY created_at DESC`)
        .all(workItemId, status) as WorkItemUpdateSuggestionRow[]
      : getSqliteDatabase()
        .prepare(`SELECT * FROM work_item_update_suggestions WHERE work_item_id = ? ORDER BY created_at DESC`)
        .all(workItemId) as WorkItemUpdateSuggestionRow[];
    return rows.map(rowToSuggestion);
  }

  markUpdateSuggestion(id: string, status: Extract<WorkItemUpdateSuggestionStatus, 'applied' | 'dismissed'>): WorkItemUpdateSuggestion | null {
    const timestamp = nowMs();
    const column = status === 'applied' ? 'applied_at' : 'dismissed_at';
    getSqliteDatabase()
      .prepare(`UPDATE work_item_update_suggestions SET status = ?, ${column} = ? WHERE id = ? AND status = 'pending'`)
      .run(status, timestamp, id);
    return this.getUpdateSuggestion(id);
  }
}
