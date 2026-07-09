import { deleteMediaBuffer, mimeTypeFromMediaPath, saveMediaBuffer } from '../media/store.js';
import { readMediaReference } from '../media/media-reference.js';
import type { MediaRef } from '../media/types.js';
import { WorkItemStore } from './work-item-store.js';
import type {
  CreateWorkItemUpdateSuggestionInput,
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItem,
  WorkItemAttachment,
  WorkItemEvent,
  WorkItemLink,
  WorkItemListQuery,
  WorkItemListResult,
  WorkItemUpdateSuggestion,
  WorkItemUpdateSuggestionStatus,
} from './types.js';

export const WORK_ITEM_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const WORK_ITEM_ATTACHMENT_MAX_COUNT = 10;
export const WORK_ITEM_ATTACHMENT_UPLOAD_BODY_MAX_BYTES =
  WORK_ITEM_ATTACHMENT_MAX_BYTES * WORK_ITEM_ATTACHMENT_MAX_COUNT + 1024 * 1024;

function inferAttachmentType(mimeType: string): WorkItemAttachment['type'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
}

function attachmentTypeForMediaRef(attachment: WorkItemAttachment): string {
  return attachment.type === 'file' ? 'document' : attachment.type;
}

export class WorkItemService {
  constructor(private readonly store = new WorkItemStore()) {}

  listProjectWorkItems(projectId: string, query: WorkItemListQuery = {}): WorkItemListResult {
    return this.store.list(projectId, query);
  }

  createProjectWorkItem(projectId: string, input: CreateWorkItemInput): WorkItem {
    const item = this.store.create(projectId, input);
    this.store.addEvent(item.id, 'created', { title: item.title, status: item.status, priority: item.priority });
    return { ...item, links: [] };
  }

  getWorkItem(id: string): WorkItem | null {
    return this.store.get(id);
  }

  updateWorkItem(id: string, patch: UpdateWorkItemInput): WorkItem | null {
    const before = this.store.get(id);
    if (!before) return null;
    const after = this.store.update(id, patch);
    if (!after) return null;
    if (before.status !== after.status) {
      this.store.addEvent(id, 'status_changed', { from: before.status, to: after.status });
    } else {
      this.store.addEvent(id, 'updated', patch);
    }
    if (!before.archivedAt && after.archivedAt) {
      this.store.addEvent(id, 'archived', { archivedAt: after.archivedAt });
    }
    return after;
  }

  addLink(workItemId: string, input: Omit<WorkItemLink, 'id' | 'workItemId' | 'createdAt'>, eventType: Parameters<WorkItemStore['addEvent']>[1] = 'link_added'): WorkItemLink | null {
    if (!this.store.get(workItemId)) return null;
    const link = this.store.addLink({ ...input, workItemId });
    this.store.addEvent(workItemId, eventType, { kind: link.kind, targetId: link.targetId, title: link.title, statusSnapshot: link.statusSnapshot });
    return link;
  }

  listEvents(workItemId: string): WorkItemEvent[] {
    return this.store.listEvents(workItemId);
  }

  listAttachments(workItemId: string): WorkItemAttachment[] | null {
    if (!this.store.get(workItemId)) return null;
    return this.store.listAttachments(workItemId);
  }

  async addAttachment(
    workItemId: string,
    file: { name: string; buffer: Buffer; mimeType: string },
  ): Promise<WorkItemAttachment | null> {
    if (!this.store.get(workItemId)) return null;
    const saved = await saveMediaBuffer(file.buffer, {
      bucket: 'work-item',
      contentType: file.mimeType,
      maxBytes: WORK_ITEM_ATTACHMENT_MAX_BYTES,
      originalFilename: file.name,
    });
    const mimeType = saved.contentType || file.mimeType || mimeTypeFromMediaPath(saved.path);
    const attachment = this.store.addAttachment({
      workItemId,
      mediaUri: saved.uri,
      mediaId: saved.id,
      bucket: saved.bucket,
      type: inferAttachmentType(mimeType),
      mimeType,
      fileName: file.name.trim() || saved.id,
      size: saved.size,
    });
    this.store.addEvent(workItemId, 'attachment_added', {
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
    });
    return attachment;
  }

  async readAttachment(
    workItemId: string,
    attachmentId: string,
  ): Promise<{ attachment: WorkItemAttachment; buffer: Buffer } | null> {
    const attachment = this.store.getAttachment(workItemId, attachmentId);
    if (!attachment) return null;
    const { buffer } = await readMediaReference(attachment.mediaUri, WORK_ITEM_ATTACHMENT_MAX_BYTES);
    return { attachment, buffer };
  }

  async removeAttachment(workItemId: string, attachmentId: string): Promise<WorkItemAttachment | null> {
    const attachment = this.store.removeAttachment(workItemId, attachmentId);
    if (!attachment) return null;
    await deleteMediaBuffer(attachment.mediaId, 'work-item');
    this.store.addEvent(workItemId, 'attachment_removed', {
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
    });
    return attachment;
  }

  async snapshotAttachmentsForGoal(workItemId: string): Promise<MediaRef[] | null> {
    const item = this.store.get(workItemId);
    if (!item) return null;
    const refs: MediaRef[] = [];
    for (const attachment of item.attachments ?? []) {
      const { buffer } = await readMediaReference(attachment.mediaUri, WORK_ITEM_ATTACHMENT_MAX_BYTES);
      const saved = await saveMediaBuffer(buffer, {
        bucket: 'inbound',
        contentType: attachment.mimeType,
        maxBytes: WORK_ITEM_ATTACHMENT_MAX_BYTES,
        originalFilename: attachment.fileName,
      });
      refs.push({
        id: saved.id,
        bucket: saved.bucket,
        type: attachmentTypeForMediaRef(attachment),
        mimeType: saved.contentType || attachment.mimeType,
        name: attachment.fileName,
        size: saved.size,
        uri: saved.uri,
        path: saved.path,
      });
    }
    return refs;
  }

  createUpdateSuggestion(workItemId: string, input: CreateWorkItemUpdateSuggestionInput): WorkItemUpdateSuggestion | null {
    const suggestion = this.store.createUpdateSuggestion(workItemId, input);
    if (!suggestion) return null;
    this.store.addEvent(workItemId, 'update_suggestion_created', {
      suggestionId: suggestion.id,
      sourceKind: suggestion.sourceKind,
      sourceId: suggestion.sourceId,
      patch: suggestion.patch,
      hasProgressNote: Boolean(suggestion.progressNote),
    });
    return suggestion;
  }

  listUpdateSuggestions(workItemId: string, status?: WorkItemUpdateSuggestionStatus): WorkItemUpdateSuggestion[] {
    return this.store.listUpdateSuggestions(workItemId, status);
  }

  applyUpdateSuggestion(id: string): { item: WorkItem; suggestion: WorkItemUpdateSuggestion } | null {
    const suggestion = this.store.getUpdateSuggestion(id);
    if (!suggestion || suggestion.status !== 'pending') return null;
    const before = this.store.get(suggestion.workItemId);
    if (!before) return null;
    const patch: UpdateWorkItemInput = {};
    if (suggestion.patch.status !== undefined) patch.status = suggestion.patch.status;
    if (suggestion.patch.nextAction !== undefined) patch.nextAction = suggestion.patch.nextAction;
    if (suggestion.patch.blockedReason !== undefined) patch.blockedReason = suggestion.patch.blockedReason;
    const item = Object.keys(patch).length > 0
      ? this.updateWorkItem(suggestion.workItemId, patch)
      : before;
    if (!item) return null;
    if (suggestion.progressNote) {
      this.store.addEvent(suggestion.workItemId, 'progress_note_added', {
        sourceKind: suggestion.sourceKind,
        sourceId: suggestion.sourceId,
        suggestionId: suggestion.id,
        text: suggestion.progressNote,
      });
    }
    const marked = this.store.markUpdateSuggestion(id, 'applied');
    if (!marked) return null;
    this.store.addEvent(suggestion.workItemId, 'update_suggestion_applied', {
      suggestionId: suggestion.id,
      sourceKind: suggestion.sourceKind,
      sourceId: suggestion.sourceId,
      patch,
      previousStatus: before.status,
      nextStatus: item.status,
    });
    return { item, suggestion: marked };
  }

  dismissUpdateSuggestion(id: string): WorkItemUpdateSuggestion | null {
    const suggestion = this.store.getUpdateSuggestion(id);
    if (!suggestion || suggestion.status !== 'pending') return null;
    const marked = this.store.markUpdateSuggestion(id, 'dismissed');
    if (marked) {
      this.store.addEvent(marked.workItemId, 'update_suggestion_dismissed', {
        suggestionId: marked.id,
        sourceKind: marked.sourceKind,
        sourceId: marked.sourceId,
      });
    }
    return marked;
  }
}
