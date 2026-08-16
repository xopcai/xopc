import { createHash, randomUUID } from 'node:crypto';

import { ObjectLinkService } from '../activity/service.js';
import { buildNoteAttachmentRef } from '../notes/attachment-ref.js';
import type { NotesService } from '../notes/service.js';
import type { ProjectService } from '../projects/project-service.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';

import {
  acknowledgeDiscussionCaptureConsent,
  createDiscussionCapture,
  createDiscussionTranscriptSegment,
  deleteDiscussionSegmentAudio,
  getDiscussionCapture,
  getDiscussionCaptureByClientRequestId,
  getDiscussionCaptureByNoteId,
  getDiscussionCaptureSettings,
  getDiscussionMetrics,
  getDiscussionTranscriptSegment,
  listDiscussionCaptures,
  listDiscussionTranscriptSegments,
  updateDiscussionCapture,
} from './repository.js';
import type {
  CreateDiscussionInput,
  DiscussionCapture,
  DiscussionCaptureSettings,
  DiscussionDetail,
  DiscussionListResult,
  DiscussionMetrics,
  DiscussionTranscript,
  ListDiscussionsQuery,
} from './types.js';
import { assembleDiscussionTranscript } from './transcript.js';

const log = createLogger('DiscussionService');

export const DISCUSSION_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
export const DISCUSSION_SEGMENT_MAX_BYTES = 2 * 1024 * 1024;
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

function placeholderTitle(now: number): string {
  return `Discussion · ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    private readonly emit?: (type: string, payload: unknown) => void,
  ) {}

  settings(): DiscussionCaptureSettings {
    return getDiscussionCaptureSettings();
  }

  acknowledgeConsent(policyVersion: number): DiscussionCaptureSettings {
    const settings = getDiscussionCaptureSettings();
    if (policyVersion !== settings.consentPolicyVersion) {
      throw new DiscussionServiceError('conflict', 'Recording consent policy changed; review it again');
    }
    return acknowledgeDiscussionCaptureConsent(policyVersion);
  }

  async create(input: CreateDiscussionInput): Promise<DiscussionDetail> {
    const clientRequestId = input.clientRequestId.trim();
    if (!clientRequestId || clientRequestId.length > 200) {
      throw new DiscussionServiceError('invalid_input', 'clientRequestId must be between 1 and 200 characters');
    }
    const settings = getDiscussionCaptureSettings();
    if (
      input.consentPolicyVersion !== settings.consentPolicyVersion
      || settings.consentAcknowledgedAt == null
    ) {
      throw new DiscussionServiceError('conflict', 'Recording consent must be acknowledged first');
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
    const project = input.contextProjectId ? this.projects.get(input.contextProjectId) : null;
    if (input.contextProjectId && !project) {
      throw new DiscussionServiceError('invalid_input', 'Project not found');
    }
    const now = Date.now();
    const title = placeholderTitle(now);
    const note = await this.notes.createNote({
      title,
      markdown: `# ${title}\n\n> Recording in progress. Live transcript will appear here.`,
      kind: 'voice',
      capturedVia: { channel: input.source },
    });
    const capture: DiscussionCapture = {
      id: randomUUID(),
      clientRequestId: input.clientRequestId,
      noteId: note.id,
      ...(project ? { projectId: project.id, projectInferenceScore: 1, projectInferenceSource: 'context' } : {}),
      source: input.source,
      status: 'recording',
      processingStage: 'original_upload',
      finalizationRevision: 0,
      attemptCount: 0,
      recordingStartedAt: now,
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
    const discussion = getDiscussionCapture(capture.id)!;
    log.info({ discussionId: discussion.id, noteId: note.id, projectId: project?.id }, 'Discussion recording started');
    this.emit?.('discussion.updated', discussion);
    return { discussion, note };
  }

  async get(id: string): Promise<DiscussionDetail | null> {
    const capture = getDiscussionCapture(id);
    return capture ? this.detail(capture) : null;
  }

  async getByNoteId(noteId: string): Promise<DiscussionDetail | null> {
    const capture = getDiscussionCaptureByNoteId(noteId);
    return capture ? this.detail(capture) : null;
  }

  list(query: ListDiscussionsQuery = {}): DiscussionListResult {
    return listDiscussionCaptures(query);
  }

  metrics(): DiscussionMetrics {
    return getDiscussionMetrics();
  }

  transcript(id: string): DiscussionTranscript | null {
    if (!getDiscussionCapture(id)) return null;
    const segments = listDiscussionTranscriptSegments(id);
    return {
      discussionId: id,
      segments,
      text: assembleDiscussionTranscript(segments),
    };
  }

  uploadSegment(input: {
    discussionId: string;
    sequence: number;
    file: { buffer: Buffer; mimeType: string };
    startedAtMs: number;
    endedAtMs: number;
    sha256: string;
  }): DiscussionTranscript {
    const capture = getDiscussionCapture(input.discussionId);
    if (!capture) throw new DiscussionServiceError('not_found', 'Discussion not found');
    if (capture.status !== 'recording') {
      throw new DiscussionServiceError('conflict', 'Discussion is no longer recording');
    }
    if (!Number.isInteger(input.sequence) || input.sequence < 0 || input.sequence > 2_000) {
      throw new DiscussionServiceError('invalid_input', 'Invalid segment sequence');
    }
    if (input.file.mimeType !== 'audio/wav' && input.file.mimeType !== 'audio/x-wav') {
      throw new DiscussionServiceError('invalid_input', 'Live transcript segments must be WAV audio');
    }
    if (input.file.buffer.length === 0 || input.file.buffer.length > DISCUSSION_SEGMENT_MAX_BYTES) {
      throw new DiscussionServiceError('invalid_input', 'Live transcript segment is empty or too large');
    }
    if (
      !Number.isFinite(input.startedAtMs)
      || !Number.isFinite(input.endedAtMs)
      || input.startedAtMs < 0
      || input.endedAtMs <= input.startedAtMs
      || input.endedAtMs - input.startedAtMs > 25_000
    ) {
      throw new DiscussionServiceError('invalid_input', 'Invalid live transcript segment timing');
    }
    const actualSha256 = createHash('sha256').update(input.file.buffer).digest('hex');
    if (input.sha256 !== actualSha256) throw new DiscussionServiceError('invalid_input', 'Segment checksum mismatch');
    const existing = getDiscussionTranscriptSegment(input.discussionId, input.sequence);
    if (existing && existing.audioSha256 !== actualSha256) {
      throw new DiscussionServiceError('conflict', 'Segment sequence already contains different audio');
    }
    if (!existing) {
      createDiscussionTranscriptSegment({
        discussionId: input.discussionId,
        sequence: input.sequence,
        audioSha256: actualSha256,
        audioBuffer: input.file.buffer,
        startedAtMs: Math.round(input.startedAtMs),
        endedAtMs: Math.round(input.endedAtMs),
      });
      this.emit?.('discussion.transcript.updated', { discussionId: input.discussionId, sequence: input.sequence });
    }
    return this.transcript(input.discussionId)!;
  }

  async uploadRecording(
    id: string,
    file: { name: string; buffer: Buffer; mimeType: string },
    durationMs: number,
  ): Promise<DiscussionDetail | null> {
    return this.enqueueMutation(id, async () => {
      const capture = getDiscussionCapture(id);
      if (!capture) return null;
      if (capture.status !== 'recording') throw new DiscussionServiceError('conflict', 'Discussion is no longer recording');
      if (!Number.isFinite(durationMs) || durationMs < 1_000 || durationMs > DISCUSSION_MAX_DURATION_MS) {
        throw new DiscussionServiceError('invalid_input', 'durationMs must be between 1000 and 1800000');
      }
      if (!isSupportedAudioMimeType(file.mimeType)) throw new DiscussionServiceError('invalid_input', 'Unsupported audio type');
      if (file.buffer.length === 0 || file.buffer.length > DISCUSSION_AUDIO_MAX_BYTES) {
        throw new DiscussionServiceError('invalid_input', 'Audio must be between 1 byte and 25MB');
      }
      const audioSha256 = createHash('sha256').update(file.buffer).digest('hex');
      if (capture.audioAttachmentId) {
        if (capture.audioSha256 === audioSha256) return this.detail(capture);
        throw new DiscussionServiceError('conflict', 'Discussion already has different audio');
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
      const audioRef = buildNoteAttachmentRef(capture.noteId, attachment.id);
      try {
        if (!noteBefore.markdown.includes(`](${audioRef})`)) {
          const note = await this.notes.updateNote(capture.noteId, {
            markdown: `${noteBefore.markdown.trim()}\n\n[Discussion audio](${audioRef})`,
          });
          if (!note) throw new DiscussionServiceError('not_found', 'Discussion note not found');
        }
        const updated = updateDiscussionCapture(id, {
          audioAttachmentId: attachment.id,
          durationMs: Math.round(durationMs),
          mimeType: file.mimeType,
          audioSizeBytes: file.buffer.length,
          audioSha256,
        }, ['recording']);
        if (!updated) throw new DiscussionServiceError('conflict', 'Discussion changed while storing audio');
        this.emit?.('discussion.updated', updated);
        return this.detail(updated);
      } catch (error) {
        await this.notes.updateNote(capture.noteId, { markdown: noteBefore.markdown }).catch(() => undefined);
        await this.notes.removeAttachment(capture.noteId, attachment.id).catch(() => undefined);
        throw error;
      }
    });
  }

  async finish(id: string, lastSequence: number, durationMs: number): Promise<DiscussionDetail | null> {
    return this.enqueueMutation(id, async () => {
      const capture = getDiscussionCapture(id);
      if (!capture) return null;
      if (capture.status === 'finalizing' || capture.status === 'completed') return this.detail(capture);
      if (capture.status !== 'recording') throw new DiscussionServiceError('conflict', 'Discussion cannot be finished');
      if (!capture.audioAttachmentId) throw new DiscussionServiceError('conflict', 'Original recording has not been uploaded');
      if (!Number.isInteger(lastSequence) || lastSequence < -1 || lastSequence > 2_000) {
        throw new DiscussionServiceError('invalid_input', 'Invalid final segment sequence');
      }
      if (!Number.isFinite(durationMs) || durationMs < 1_000 || durationMs > DISCUSSION_MAX_DURATION_MS) {
        throw new DiscussionServiceError('invalid_input', 'Invalid recording duration');
      }
      const now = Date.now();
      const updated = updateDiscussionCapture(id, {
        status: 'finalizing',
        processingStage: 'final_transcription',
        expectedLastSequence: lastSequence,
        durationMs: Math.round(durationMs),
        recordingFinishedAt: now,
        attemptCount: 0,
        nextAttemptAt: undefined,
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
      }, ['recording']);
      if (!updated) throw new DiscussionServiceError('conflict', 'Discussion changed while finishing');
      this.emit?.('discussion.updated', updated);
      return this.detail(updated);
    });
  }

  async retry(id: string): Promise<DiscussionDetail | null> {
    const capture = getDiscussionCapture(id);
    if (!capture) return null;
    if (capture.status !== 'failed') throw new DiscussionServiceError('conflict', 'Only failed discussions can be retried');
    const updated = updateDiscussionCapture(id, {
      status: 'finalizing',
      processingStage: capture.processingStage ?? 'final_transcription',
      attemptCount: 0,
      nextAttemptAt: undefined,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
    }, ['failed']);
    if (!updated) throw new DiscussionServiceError('conflict', 'Discussion changed while retrying');
    this.emit?.('discussion.updated', updated);
    return this.detail(updated);
  }

  async cancel(id: string): Promise<DiscussionDetail | null> {
    const capture = getDiscussionCapture(id);
    if (!capture) return null;
    if (capture.status === 'cancelled') return this.detail(capture);
    if (capture.status !== 'recording') throw new DiscussionServiceError('conflict', 'Only an active recording can be cancelled');
    const updated = updateDiscussionCapture(id, { status: 'cancelled', processingStage: undefined }, ['recording']);
    if (!updated) throw new DiscussionServiceError('conflict', 'Discussion changed while cancelling');
    deleteDiscussionSegmentAudio(id);
    this.emit?.('discussion.updated', updated);
    return this.detail(updated);
  }

  async deleteAudio(id: string): Promise<DiscussionDetail | null> {
    return this.enqueueMutation(id, async () => {
      const capture = getDiscussionCapture(id);
      if (!capture) return null;
      if (capture.status === 'recording' || capture.status === 'finalizing') {
        throw new DiscussionServiceError('conflict', 'Audio cannot be deleted while recording or finalizing');
      }
      if (!capture.audioAttachmentId) return this.detail(capture);
      const note = await this.notes.getNote(capture.noteId);
      if (!note) throw new DiscussionServiceError('not_found', 'Discussion note not found');
      const audioRef = buildNoteAttachmentRef(capture.noteId, capture.audioAttachmentId);
      const markdown = note.markdown
        .replace(new RegExp(`^\\[Discussion audio\\]\\(${escapeRegExp(audioRef)}\\)\\s*$`, 'gm'), '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (markdown !== note.markdown) await this.notes.updateNote(capture.noteId, { markdown });
      await this.notes.removeAttachment(capture.noteId, capture.audioAttachmentId);
      deleteDiscussionSegmentAudio(id);
      const updated = updateDiscussionCapture(id, {
        audioAttachmentId: undefined,
        audioDeletedAt: Date.now(),
      }, [capture.status]);
      if (!updated) throw new DiscussionServiceError('conflict', 'Discussion changed while deleting audio');
      this.emit?.('discussion.updated', updated);
      return this.detail(updated);
    });
  }

  async unlinkInferredProject(id: string): Promise<DiscussionDetail | null> {
    const capture = getDiscussionCapture(id);
    if (!capture) return null;
    if (!capture.projectId || capture.projectInferenceSource === 'context') {
      throw new DiscussionServiceError('conflict', 'The project association is not AI-inferred');
    }
    this.objectLinks.delete(`discussion:${id}:project`);
    const updated = updateDiscussionCapture(id, {
      projectId: undefined,
      projectInferenceScore: undefined,
      projectInferenceSource: undefined,
    }, [capture.status]);
    if (!updated) throw new DiscussionServiceError('conflict', 'Discussion changed while unlinking project');
    this.emit?.('discussion.updated', updated);
    return this.detail(updated);
  }

  private async detail(capture: DiscussionCapture): Promise<DiscussionDetail> {
    const note = await this.notes.getNote(capture.noteId);
    if (!note) throw new DiscussionServiceError('not_found', 'Discussion note not found');
    return { discussion: capture, note };
  }

  private enqueueMutation<T>(id: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(id);
    const current = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(mutation);
    const tracked = current.finally(() => {
      if (this.mutationTails.get(id) === tracked) this.mutationTails.delete(id);
    });
    this.mutationTails.set(id, tracked);
    return tracked;
  }
}
