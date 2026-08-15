import { createHash, randomUUID } from 'node:crypto';

import { ObjectLinkService } from '../activity/service.js';
import { buildNoteAttachmentRef } from '../notes/attachment-ref.js';
import type { NotesService } from '../notes/service.js';
import type { ProjectService } from '../projects/project-service.js';
import type { WorkItemService } from '../work-items/index.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';

import {
  createDiscussionActionConversion,
  createDiscussionCapture,
  getDiscussionCapture,
  getDiscussionCaptureByClientRequestId,
  getDiscussionMetrics,
  listDiscussionCaptures,
  listDiscussionActionConversions,
  updateDiscussionCapture,
} from './repository.js';
import { normalizeDiscussionAnalysis } from './analyzer.js';
import { mergeDiscussionAnalysisIntoMarkdown } from './pipeline.js';
import type {
  CreateDiscussionInput,
  DiscussionCapture,
  DiscussionDetail,
  DiscussionAnalysis,
  DiscussionCompletion,
  DiscussionListResult,
  DiscussionMetrics,
  ListDiscussionsQuery,
} from './types.js';

const log = createLogger('DiscussionService');

export const DISCUSSION_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
export const DISCUSSION_MAX_DURATION_MS = 30 * 60 * 1_000;

function isSupportedAudioMimeType(mimeType: string): boolean {
  const base = mimeType.toLowerCase().split(';', 1)[0]?.trim();
  return base === 'audio/webm'
    || base === 'audio/mp4'
    || base === 'audio/ogg'
    || base === 'audio/wav'
    || base === 'audio/x-wav'
    || base === 'audio/mpeg';
}

export class DiscussionServiceError extends Error {
  constructor(
    readonly code: 'invalid_input' | 'not_found' | 'conflict',
    message: string,
  ) {
    super(message);
    this.name = 'DiscussionServiceError';
  }
}

export class DiscussionService {
  private readonly createsInFlight = new Map<string, Promise<DiscussionDetail>>();
  private readonly mutationTails = new Map<string, Promise<unknown>>();
  private readonly objectLinks = new ObjectLinkService();

  constructor(
    private readonly notes: NotesService,
    private readonly projects: ProjectService,
    private readonly workItems?: WorkItemService,
    private readonly emit?: (type: string, payload: unknown) => void,
  ) {}

  async create(input: CreateDiscussionInput): Promise<DiscussionDetail> {
    const clientRequestId = input.clientRequestId.trim();
    if (!clientRequestId || clientRequestId.length > 200) {
      throw new DiscussionServiceError('invalid_input', 'clientRequestId must be between 1 and 200 characters');
    }
    if (input.captureMode === 'conversation' && !input.consentConfirmed) {
      throw new DiscussionServiceError('invalid_input', 'Conversation recording requires consent confirmation');
    }
    const existing = getDiscussionCaptureByClientRequestId(clientRequestId);
    if (existing) return this.detail(existing);
    const pending = this.createsInFlight.get(clientRequestId);
    if (pending) return pending;
    const creation = this.createOnce({ ...input, clientRequestId })
      .finally(() => this.createsInFlight.delete(clientRequestId));
    this.createsInFlight.set(clientRequestId, creation);
    return creation;
  }

  private async createOnce(input: CreateDiscussionInput): Promise<DiscussionDetail> {
    const project = input.projectId ? this.projects.get(input.projectId) : null;
    if (input.projectId && !project) {
      throw new DiscussionServiceError('invalid_input', 'Project not found');
    }
    const title = input.title?.trim().replace(/\s+/g, ' ').slice(0, 200) || 'Discussion recording';
    const languageHint = input.language?.trim().slice(0, 32);
    const note = await this.notes.createNote({
      title,
      markdown: `# ${title}\n\n> Waiting for the discussion recording to be uploaded.`,
      kind: 'voice',
      capturedVia: { channel: input.source },
    });
    const now = Date.now();
    const capture: DiscussionCapture = {
      id: randomUUID(),
      clientRequestId: input.clientRequestId,
      noteId: note.id,
      ...(project ? { projectId: project.id } : {}),
      status: 'awaiting_upload',
      captureMode: input.captureMode,
      consentConfirmed: input.consentConfirmed,
      ...(languageHint ? { languageHint } : {}),
      analysisVersion: 0,
      reviewRevision: 0,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    try {
      runSqliteWriteTransaction(() => {
        createDiscussionCapture(capture);
        if (project) {
          this.objectLinks.create({
            id: `discussion:${capture.id}:project`,
            from: { kind: 'note', id: note.id, title: note.title },
            to: { kind: 'project', id: project.id, title: project.name },
            relation: 'belongs_to',
            source: 'user',
            nowMs: now,
          });
        }
      });
    } catch (error) {
      await this.notes.deleteNote(note.id).catch(() => undefined);
      throw error;
    }
    log.info({ discussionId: capture.id, noteId: note.id, projectId: project?.id }, 'Discussion created');
    const discussion = getDiscussionCapture(capture.id)!;
    this.emit?.('discussion.updated', discussion);
    return { discussion, note };
  }

  async get(id: string): Promise<DiscussionDetail | null> {
    const capture = getDiscussionCapture(id);
    return capture ? this.detail(capture) : null;
  }

  list(query: ListDiscussionsQuery = {}): DiscussionListResult {
    return listDiscussionCaptures(query);
  }

  metrics(): DiscussionMetrics {
    return getDiscussionMetrics();
  }

  async uploadAudio(
    id: string,
    file: { name: string; buffer: Buffer; mimeType: string },
    durationMs: number,
  ): Promise<DiscussionDetail | null> {
    const capture = getDiscussionCapture(id);
    if (!capture) return null;
    if (!Number.isFinite(durationMs) || durationMs < 1_000 || durationMs > DISCUSSION_MAX_DURATION_MS) {
      throw new DiscussionServiceError('invalid_input', 'durationMs must be between 1000 and 1800000');
    }
    if (!isSupportedAudioMimeType(file.mimeType)) {
      throw new DiscussionServiceError('invalid_input', 'Unsupported audio type');
    }
    if (file.buffer.length === 0 || file.buffer.length > DISCUSSION_AUDIO_MAX_BYTES) {
      throw new DiscussionServiceError('invalid_input', 'Audio must be between 1 byte and 25MB');
    }
    const audioSha256 = createHash('sha256').update(file.buffer).digest('hex');
    if (capture.audioAttachmentId) {
      if (capture.audioSha256 === audioSha256) return this.detail(capture);
      throw new DiscussionServiceError('conflict', 'Discussion already has different audio');
    }
    if (capture.status !== 'awaiting_upload') {
      throw new DiscussionServiceError('conflict', 'Discussion is not waiting for an upload');
    }

    const noteBefore = await this.notes.getNote(capture.noteId);
    if (!noteBefore) throw new DiscussionServiceError('not_found', 'Discussion note not found');
    const attachment = await this.notes.addAttachment(capture.noteId, {
      name: file.name.trim().slice(0, 200) || `discussion-${id}.webm`,
      buffer: file.buffer,
      mimeType: file.mimeType,
      duration: Math.round(durationMs / 1_000),
    });
    if (!attachment) throw new DiscussionServiceError('not_found', 'Discussion note not found');

    try {
      const audioRef = buildNoteAttachmentRef(capture.noteId, attachment.id);
      await this.notes.updateNote(capture.noteId, {
        markdown: `${noteBefore.markdown}\n\n[Discussion audio](${audioRef})\n\n> Recording uploaded. Processing will start shortly.`,
      });
      const updated = updateDiscussionCapture(id, {
        audioAttachmentId: attachment.id,
        status: 'queued',
        durationMs: Math.round(durationMs),
        mimeType: file.mimeType,
        audioSizeBytes: file.buffer.length,
        audioSha256,
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
      }, ['awaiting_upload']);
      if (!updated) throw new DiscussionServiceError('conflict', 'Discussion changed while uploading');
      log.info({
        discussionId: id,
        noteId: capture.noteId,
        audioSizeBytes: file.buffer.length,
        durationMs,
      }, 'Discussion audio stored');
      this.emit?.('discussion.updated', updated);
      return this.detail(updated);
    } catch (error) {
      await this.notes.removeAttachment(capture.noteId, attachment.id).catch(() => undefined);
      await this.notes.updateNote(capture.noteId, { markdown: noteBefore.markdown }).catch(() => undefined);
      throw error;
    }
  }

  async cancel(id: string): Promise<DiscussionDetail | null> {
    const capture = getDiscussionCapture(id);
    if (!capture) return null;
    if (capture.status === 'completed') {
      throw new DiscussionServiceError('conflict', 'Completed discussions cannot be cancelled');
    }
    if (capture.status !== 'cancelled') {
      const updated = updateDiscussionCapture(id, {
        status: 'cancelled',
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        nextAttemptAt: undefined,
      }, [capture.status]);
      if (!updated) throw new DiscussionServiceError('conflict', 'Discussion changed while cancelling');
    }
    const detail = await this.get(id);
    if (detail) this.emit?.('discussion.updated', detail.discussion);
    return detail;
  }

  async retry(id: string): Promise<DiscussionDetail | null> {
    const capture = getDiscussionCapture(id);
    if (!capture) return null;
    if (capture.status !== 'failed') {
      throw new DiscussionServiceError('conflict', 'Only failed discussions can be retried');
    }
    const status = capture.transcriptRaw ? 'analyzing' : capture.audioAttachmentId ? 'queued' : 'awaiting_upload';
    const updated = updateDiscussionCapture(id, {
      status,
      failedStage: undefined,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      nextAttemptAt: undefined,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      attemptCount: 0,
    }, ['failed']);
    if (!updated) throw new DiscussionServiceError('conflict', 'Discussion changed while retrying');
    this.emit?.('discussion.updated', updated);
    return this.detail(updated);
  }

  async deleteAudio(id: string): Promise<DiscussionDetail | null> {
    return this.enqueueMutation(id, () => this.deleteAudioOnce(id));
  }

  private async deleteAudioOnce(id: string): Promise<DiscussionDetail | null> {
    const capture = getDiscussionCapture(id);
    if (!capture) return null;
    if (capture.status === 'queued' || capture.status === 'transcribing' || capture.status === 'analyzing') {
      throw new DiscussionServiceError('conflict', 'Audio cannot be deleted while processing');
    }
    if (!capture.audioAttachmentId) return this.detail(capture);
    const note = await this.notes.getNote(capture.noteId);
    if (!note) throw new DiscussionServiceError('not_found', 'Discussion note not found');
    const audioRef = buildNoteAttachmentRef(capture.noteId, capture.audioAttachmentId);
    const removed = await this.notes.removeAttachment(capture.noteId, capture.audioAttachmentId);
    if (!removed) log.warn({ discussionId: id, noteId: capture.noteId }, 'Discussion audio was already absent');
    await this.notes.updateNote(capture.noteId, {
      markdown: note.markdown
        .split('\n')
        .filter((line) => !line.includes(`](${audioRef})`))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    });
    const updated = updateDiscussionCapture(id, {
      audioAttachmentId: undefined,
      audioDeletedAt: Date.now(),
    }, [capture.status]);
    if (!updated) throw new DiscussionServiceError('conflict', 'Discussion changed while deleting audio');
    log.info({ discussionId: id, noteId: capture.noteId }, 'Discussion audio deleted');
    this.emit?.('discussion.updated', updated);
    return this.detail(updated);
  }

  async saveReview(
    id: string,
    analysisInput: unknown,
    expectedRevision: number,
  ): Promise<DiscussionDetail | null> {
    return this.enqueueMutation(id, () => this.saveReviewOnce(id, analysisInput, expectedRevision));
  }

  private async saveReviewOnce(
    id: string,
    analysisInput: unknown,
    expectedRevision: number,
  ): Promise<DiscussionDetail | null> {
    const capture = getDiscussionCapture(id);
    if (!capture) return null;
    if (capture.status !== 'review_required') {
      throw new DiscussionServiceError('conflict', 'Discussion is not ready for review');
    }
    if (capture.reviewRevision !== expectedRevision) {
      throw new DiscussionServiceError('conflict', 'Discussion review changed; reload and try again');
    }
    let analysis: DiscussionAnalysis;
    try {
      analysis = normalizeDiscussionAnalysis(analysisInput);
    } catch (error) {
      throw new DiscussionServiceError('invalid_input', error instanceof Error ? error.message : 'Invalid review');
    }
    if (!capture.transcriptRaw) throw new DiscussionServiceError('conflict', 'Discussion transcript is missing');
    const note = await this.notes.getNote(capture.noteId);
    if (!note) throw new DiscussionServiceError('not_found', 'Discussion note not found');
    await this.notes.updateNote(capture.noteId, {
      markdown: mergeDiscussionAnalysisIntoMarkdown(note.markdown, capture.transcriptRaw, analysis),
    });
    const updated = updateDiscussionCapture(id, {
      review: analysis,
      reviewRevision: capture.reviewRevision + 1,
      reviewedAt: Date.now(),
    }, ['review_required']);
    if (!updated) throw new DiscussionServiceError('conflict', 'Discussion changed while saving review');
    this.emit?.('discussion.updated', updated);
    return this.detail(updated);
  }

  async complete(
    id: string,
    expectedRevision: number,
    actionItemIds: string[],
  ): Promise<DiscussionCompletion | null> {
    return this.enqueueMutation(id, () => this.completeOnce(id, expectedRevision, actionItemIds));
  }

  private async completeOnce(
    id: string,
    expectedRevision: number,
    actionItemIds: string[],
  ): Promise<DiscussionCompletion | null> {
    const capture = getDiscussionCapture(id);
    if (!capture) return null;
    if (capture.status === 'completed') {
      const detail = await this.detail(capture);
      return {
        ...detail,
        createdWorkItemIds: listDiscussionActionConversions(id).map((conversion) => conversion.workItemId),
      };
    }
    if (capture.status !== 'review_required') {
      throw new DiscussionServiceError('conflict', 'Discussion is not ready to complete');
    }
    if (capture.reviewRevision !== expectedRevision) {
      throw new DiscussionServiceError('conflict', 'Discussion review changed; reload and try again');
    }
    const analysis = normalizeDiscussionAnalysis(capture.review ?? capture.analysis);
    const selected = new Set(actionItemIds);
    if ([...selected].some((actionId) => !analysis.actionItems.some((item) => item.id === actionId))) {
      throw new DiscussionServiceError('invalid_input', 'Unknown action item selected');
    }
    if (selected.size > 0 && (!capture.projectId || !this.workItems)) {
      throw new DiscussionServiceError('invalid_input', 'A project is required to create work items');
    }

    const createdWorkItemIds: string[] = [];
    for (const action of analysis.actionItems) {
      if (!selected.has(action.id)) continue;
      const existing = listDiscussionActionConversions(id).find((item) => item.actionId === action.id);
      if (existing) {
        createdWorkItemIds.push(existing.workItemId);
        continue;
      }
      const dueAt = action.dueDate ? Date.parse(action.dueDate) : Number.NaN;
      const workItem = runSqliteWriteTransaction(() => {
        const item = this.workItems!.createProjectWorkItem(capture.projectId!, {
          title: action.title,
          description: `Created from discussion note ${capture.noteId}.${action.owner ? ` Mentioned owner: ${action.owner}.` : ''}`,
          status: 'todo',
          nextAction: action.title,
          dueAt: Number.isFinite(dueAt) ? dueAt : undefined,
        });
        createDiscussionActionConversion({
          discussionId: id,
          actionId: action.id,
          workItemId: item.id,
          createdAt: Date.now(),
        });
        this.objectLinks.create({
          id: `discussion:${id}:action:${action.id}`,
          from: { kind: 'work_item', id: item.id, title: item.title },
          to: { kind: 'note', id: capture.noteId },
          relation: 'created_from',
          source: 'user',
        });
        return item;
      });
      createdWorkItemIds.push(workItem.id);
    }

    const now = Date.now();
    await this.notes.updateNote(capture.noteId, { status: 'processed' });
    const updated = updateDiscussionCapture(id, {
      status: 'completed',
      completedAt: now,
      reviewedAt: capture.reviewedAt ?? now,
    }, ['review_required']);
    if (!updated) throw new DiscussionServiceError('conflict', 'Discussion changed while completing');
    this.emit?.('discussion.updated', updated);
    this.emit?.('discussion.completed', {
      discussionId: updated.id,
      noteId: updated.noteId,
      projectId: updated.projectId,
      completedAt: updated.completedAt,
      createdWorkItemIds,
      actionCount: analysis.actionItems.length,
      unownedActionCount: analysis.actionItems.filter((item) => !item.owner).length,
      undatedActionCount: analysis.actionItems.filter((item) => !item.dueDate).length,
      riskCount: analysis.risks.length,
      openQuestionCount: analysis.openQuestions.length,
    });
    return { ...(await this.detail(updated)), createdWorkItemIds };
  }

  private async detail(capture: DiscussionCapture): Promise<DiscussionDetail> {
    const note = await this.notes.getNote(capture.noteId);
    if (!note) {
      throw new DiscussionServiceError('not_found', 'Discussion note not found');
    }
    return { discussion: capture, note };
  }

  private enqueueMutation<T>(id: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(id);
    const current = (previous ? previous.catch(() => undefined) : Promise.resolve())
      .then(mutation);
    const tracked = current.finally(() => {
      if (this.mutationTails.get(id) === tracked) this.mutationTails.delete(id);
    });
    this.mutationTails.set(id, tracked);
    return tracked;
  }
}
