import { createHash, randomUUID } from 'node:crypto';

import type { WorkItemCommand, WorkItemCommandProposal } from '@xopcai/gateway-contract';

import { changedFieldsFromPatch, emitActivity, systemActivityActor, systemActivitySource } from '../activity/emitter.js';
import { readMediaReference } from '../media/media-reference.js';
import { deleteMediaBuffer, mimeTypeFromMediaPath, saveMediaBuffer } from '../media/store.js';
import type { ProactiveSignalPublisher } from '../proactive/events/publisher.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import {
  availableWorkItemCommands,
  transitionWorkItem,
  type WorkItemCommandActor,
} from './lifecycle.js';
import { WorkItemStore } from './work-item-store.js';
import type {
  CreateWorkItemCommandProposalInput,
  CreateWorkItemInput,
  UpdateWorkItemMetadataInput,
  WorkItem,
  WorkItemAttachment,
  WorkItemEvent,
  WorkItemLink,
  WorkItemListQuery,
  WorkItemListResult,
} from './types.js';

export const WORK_ITEM_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const WORK_ITEM_ATTACHMENT_MAX_COUNT = 10;
export const WORK_ITEM_ATTACHMENT_UPLOAD_BODY_MAX_BYTES =
  WORK_ITEM_ATTACHMENT_MAX_BYTES * WORK_ITEM_ATTACHMENT_MAX_COUNT + 1024 * 1024;

export interface ExecuteWorkItemCommandContext {
  actor: WorkItemCommandActor;
  source: 'web' | 'mobile' | 'agent_tool' | 'workflow' | 'automation' | 'system';
  requestId: string;
}

function inferAttachmentType(mimeType: string): WorkItemAttachment['type'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
}

export class WorkItemService {
  constructor(private readonly store = new WorkItemStore(), private readonly signals?: ProactiveSignalPublisher) {}

  listProjectWorkItems(projectId: string, query: WorkItemListQuery = {}): WorkItemListResult {
    return this.store.list(projectId, query);
  }

  listWorkItems(query: WorkItemListQuery = {}): WorkItemListResult {
    return this.store.listAll(query);
  }

  createProjectWorkItem(projectId: string, input: CreateWorkItemInput): WorkItem {
    return runSqliteWriteTransaction(() => {
      const item = this.store.create(projectId, input);
      this.store.addEvent(item.id, 'work_item.created', {
        phase: item.phase,
        priority: item.priority,
        completionPolicy: item.completionPolicy,
      });
      emitActivity({
        type: 'work_item.created',
        primaryObject: { kind: 'work_item', id: item.id, title: item.title },
        actor: systemActivityActor(),
        source: systemActivitySource(),
        payload: { phase: item.phase, priority: item.priority, completionPolicy: item.completionPolicy },
        scopes: [{ scopeKind: 'project', scopeId: projectId, reason: 'object_owner' }],
        nowMs: item.createdAt,
      });
      return item;
    });
  }

  getWorkItem(id: string): WorkItem | null {
    return this.store.get(id);
  }

  availableCommands(id: string, actor: WorkItemCommandActor): WorkItemCommand['type'][] | null {
    const item = this.store.get(id);
    return item ? availableWorkItemCommands(item, actor) : null;
  }

  updateMetadata(id: string, patch: UpdateWorkItemMetadataInput, expectedVersion: number): WorkItem | null {
    return runSqliteWriteTransaction(() => {
      const before = this.store.get(id);
      if (!before) return null;
      const after = this.store.updateMetadata(id, patch, expectedVersion);
      if (!after) return null;
      const changes = changedFieldsFromPatch(patch as Record<string, unknown>);
      this.store.addEvent(id, 'work_item.metadata_updated', { changes, beforeVersion: before.version, afterVersion: after.version });
      this.publishChange(after, 'work_item.updated.v1', { before, after, changes });
      return after;
    });
  }

  executeCommand(id: string, command: WorkItemCommand, context: ExecuteWorkItemCommandContext): WorkItem | null {
    return runSqliteWriteTransaction(() => {
      const before = this.store.get(id);
      if (!before) return null;
      if (command.type === 'wait' && command.wait.kind === 'dependency') {
        const blockerId = command.wait.blockingWorkItemId!;
        if (!this.store.get(blockerId)) throw new Error(`Blocking work item not found: ${blockerId}`);
        if (this.store.wouldCreateDependencyCycle(id, blockerId)) throw new Error('Work item dependency would create a cycle');
      }
      const transition = transitionWorkItem(before, command, {
        actor: context.actor,
        now: Date.now(),
        createId: randomUUID,
      });
      const after = this.store.saveTransition(transition.item);
      if (!after) return null;
      this.store.addEvent(id, transition.eventType as Parameters<WorkItemStore['addEvent']>[1], {
        requestId: context.requestId,
        actor: context.actor,
        source: context.source,
        before: { phase: before.phase, version: before.version, resolution: before.resolution },
        after: { phase: after.phase, version: after.version, resolution: after.resolution },
        ...transition.eventPayload,
      });
      this.publishChange(after, 'work_item.lifecycle_changed.v1', { before, after, command: command.type });
      return after;
    });
  }

  setArchived(id: string, archived: boolean, expectedVersion: number): WorkItem | null {
    return runSqliteWriteTransaction(() => {
      const item = this.store.setArchived(id, archived, expectedVersion);
      if (!item) return null;
      this.store.addEvent(id, archived ? 'work_item.archived' : 'work_item.unarchived', { archivedAt: item.archivedAt });
      this.publishChange(item, 'work_item.updated.v1', { archivedAt: item.archivedAt });
      return item;
    });
  }

  private publishChange(item: WorkItem, type: string, payload: Record<string, unknown>): void {
    emitActivity({
      type,
      primaryObject: { kind: 'work_item', id: item.id, title: item.title },
      actor: systemActivityActor(),
      source: systemActivitySource(),
      payload,
      scopes: [{ scopeKind: 'project', scopeId: item.projectId, reason: 'object_owner' }],
      nowMs: item.updatedAt,
    });
    this.signals?.publish({
      type,
      schemaVersion: 1,
      source: { kind: 'work_items', id: 'local' },
      subject: { kind: 'work_item', id: item.id },
      actor: { kind: 'system' },
      scope: { workspaceId: 'default', projectId: item.projectId },
      occurredAt: new Date(item.updatedAt).toISOString(),
      dedupeKey: `work_item:${item.id}:${item.version}:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`,
      sensitivity: 'personal',
      payload,
    });
  }

  addLink(
    workItemId: string,
    input: Omit<WorkItemLink, 'id' | 'workItemId' | 'createdAt'>,
  ): WorkItemLink | null {
    const item = this.store.get(workItemId);
    if (!item) return null;
    const link = this.store.addLink({ ...input, workItemId });
    this.store.addEvent(workItemId, 'work_item.link_added', {
      kind: link.kind,
      targetId: link.targetId,
      title: link.title,
      statusSnapshot: link.statusSnapshot,
    });
    this.publishChange(item, 'work_item.link_added', { target: { kind: link.kind, id: link.targetId, title: link.title } });
    return link;
  }

  listEvents(workItemId: string): WorkItemEvent[] {
    return this.store.listEvents(workItemId);
  }

  listAttachments(workItemId: string): WorkItemAttachment[] | null {
    return this.store.get(workItemId) ? this.store.listAttachments(workItemId) : null;
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
    this.store.addEvent(workItemId, 'work_item.attachment_added', {
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
    this.store.addEvent(workItemId, 'work_item.attachment_removed', {
      attachmentId: attachment.id,
      fileName: attachment.fileName,
    });
    return attachment;
  }

  createCommandProposal(workItemId: string, input: CreateWorkItemCommandProposalInput): WorkItemCommandProposal | null {
    const proposal = this.store.createCommandProposal(workItemId, input);
    if (proposal) this.store.addEvent(workItemId, 'work_item.command_proposed', { proposalId: proposal.id, command: proposal.command.type });
    return proposal;
  }

  listCommandProposals(workItemId: string, state?: WorkItemCommandProposal['state']): WorkItemCommandProposal[] {
    return this.store.listCommandProposals(workItemId, state);
  }

  executeCommandProposal(id: string, context: ExecuteWorkItemCommandContext): { item: WorkItem; proposal: WorkItemCommandProposal } | null {
    return runSqliteWriteTransaction(() => {
      const proposal = this.store.getCommandProposal(id);
      if (!proposal || proposal.state !== 'pending') return null;
      const item = this.executeCommand(proposal.workItemId, proposal.command, context);
      if (!item) return null;
      const resolved = this.store.resolveCommandProposal(id, 'executed');
      if (!resolved) return null;
      this.store.addEvent(item.id, 'work_item.command_proposal_executed', { proposalId: id });
      return { item, proposal: resolved };
    });
  }

  rejectCommandProposal(id: string): WorkItemCommandProposal | null {
    const proposal = this.store.resolveCommandProposal(id, 'rejected');
    if (proposal) this.store.addEvent(proposal.workItemId, 'work_item.command_proposal_rejected', { proposalId: id });
    return proposal;
  }
}
