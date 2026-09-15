import { createHash, randomUUID } from 'node:crypto';

import { DISCUSSION_MAX_DURATION_MS, DISCUSSION_SEGMENT_MAX_BYTES, type DiscussionRecordingManifest } from '@xopcai/gateway-contract';

import { ObjectLinkService } from '../activity/service.js';
import type { NotesService } from '../notes/service.js';
import type { ProjectService } from '../projects/project-service.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';

import {
  acknowledgeDiscussionCaptureConsent,
  createDiscussionCapture,
  createDiscussionTranscriptSegment,
  correctDiscussionTranscriptSegment,
  deleteDiscussionSegmentAudio,
  getDiscussionCapture,
  getDiscussionCaptureByClientRequestId,
  getDiscussionCaptureByNoteId,
  getDiscussionCaptureSettings,
  getDiscussionMetrics,
  getLatestDiscussionOrganization,
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
import { editMeeting } from './edits.js';
import { saveTranscriptRevision, readTranscriptRevision, refreshCanonicalTranscript } from './revisions.js';
import { assembleDiscussionTranscript } from './transcript.js';

import { DiscussionServiceError } from './errors.js';
import { listRecordingChunks, saveRecordingChunk, completeRecording, removeRecordingChunks, validateRecordingManifest } from './recording.js';
import { getRecordingJob, getRecordingJobInput, submitRecordingJob, claimRecordingJob, renewRecordingJob, finishRecordingJob, cancelRecordingJob } from './recordingJobs.js';
export { DiscussionServiceError } from './errors.js';
export { DISCUSSION_MAX_DURATION_MS, DISCUSSION_AUDIO_MAX_BYTES, DISCUSSION_SEGMENT_MAX_BYTES } from '@xopcai/gateway-contract';

const log = createLogger('DiscussionService');

function placeholderTitle(now: number): string {
  return `Discussion · ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}`;
}

export class DiscussionService {
  private readonly createsInFlight = new Map<string, Promise<DiscussionDetail>>();
  private readonly mutationTails = new Map<string, Promise<unknown>>();
  private readonly objectLinks = new ObjectLinkService();
  private readonly recordingOwner = randomUUID();
  private readonly recordingControllers = new Map<string, AbortController>();

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
      markdown: '',
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
      transcriptRevision: 0,
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
    return this.detail(discussion);
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

  transcript(id: string, revision?: number): DiscussionTranscript | null {
    const capture = getDiscussionCapture(id);
    if (!capture) return null;
    const segments = revision === undefined ? listDiscussionTranscriptSegments(id) : readTranscriptRevision(id, revision);
    if (!segments) return null;
    const count = (status: DiscussionTranscript['segments'][number]['status']) =>
      segments.filter((segment) => segment.status === status).length;
    return {
      discussionId: id,
      revision: revision ?? capture.transcriptRevision,
      segments,
      text: revision === undefined ? capture.canonicalTranscript ?? assembleDiscussionTranscript(segments) : assembleDiscussionTranscript(segments),
      stats: {
        ...(capture.expectedLastSequence != null ? { expected: capture.expectedLastSequence + 1 } : {}),
        uploaded: count('uploaded'),
        transcribing: count('transcribing'),
        confirmed: count('confirmed'),
        failed: count('failed'),
      },
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
    const acceptsSegments = capture.status === 'recording' || capture.status === 'stopping';
    const originalRecordingSupersedesSegment = capture.audioAttachmentId
      && (capture.status === 'sealing' || capture.status === 'organizing' || capture.status === 'completed');
    if (!acceptsSegments && !originalRecordingSupersedesSegment) {
      throw new DiscussionServiceError('conflict', 'Discussion no longer accepts transcript segments');
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
      || input.endedAtMs > DISCUSSION_MAX_DURATION_MS
      || input.endedAtMs - input.startedAtMs > 25_000
    ) {
      throw new DiscussionServiceError('invalid_input', 'Invalid live transcript segment timing');
    }
    const actualSha256 = createHash('sha256').update(input.file.buffer).digest('hex');
    if (input.sha256 !== actualSha256) throw new DiscussionServiceError('invalid_input', 'Segment checksum mismatch');
    if (originalRecordingSupersedesSegment) return this.transcript(input.discussionId)!;
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
      const transcript = this.transcript(input.discussionId)!;
      this.emit?.('discussion.segment.updated', {
        discussionId: input.discussionId,
        noteId: capture.noteId,
        transcriptRevision: transcript.revision,
        segment: transcript.segments.find((item) => item.sequence === input.sequence),
        text: transcript.text,
        stats: transcript.stats,
      });
    }
    return this.transcript(input.discussionId)!;
  }

  correctSegment(id: string, sequence: number, displayText: string, expectedRevision: number, speakerLabel?: string, applyToSpeakerGroup = false, expectedTranscriptRevision?: number): DiscussionTranscript {
    const capture = getDiscussionCapture(id);
    if (!capture) throw new DiscussionServiceError('not_found', 'Discussion not found');
    if (!['recording', 'stopping', 'completed', 'needs_attention'].includes(capture.status)) throw new DiscussionServiceError('conflict', 'Wait until processing has finished before editing');
    const text = displayText.trim();
    if (!text || text.length > 20_000) throw new DiscussionServiceError('invalid_input', 'Invalid transcript text');
    if (speakerLabel && speakerLabel.length > 100) throw new DiscussionServiceError('invalid_input', 'Speaker label is too long');
    if (applyToSpeakerGroup && expectedTranscriptRevision !== capture.transcriptRevision) throw new DiscussionServiceError('conflict', 'Transcript changed; reload before renaming the speaker');

    const transcript = runSqliteWriteTransaction(db => {
      const originalSpeaker = getDiscussionTranscriptSegment(id, sequence)?.speakerLabel;
      saveTranscriptRevision(id);
      const segment = correctDiscussionTranscriptSegment(id, sequence, text, expectedRevision, speakerLabel);
      if (!segment) throw new DiscussionServiceError('conflict', 'Transcript segment changed; reload and try again');
      if (applyToSpeakerGroup && originalSpeaker && speakerLabel !== undefined) db.prepare("UPDATE discussion_transcript_segments SET speaker_label=?, corrected_by_user=1, corrected_at=?, revision=revision+1, updated_at=? WHERE discussion_id=? AND speaker_label=? AND sequence<>?").run(speakerLabel.trim() || null, Date.now(), Date.now(), id, originalSpeaker, sequence);
      if (capture.canonicalTranscript) refreshCanonicalTranscript(id);
      saveTranscriptRevision(id);
      return this.transcript(id)!;
    });
    this.emit?.('discussion.segment.updated', {
      discussionId: id, noteId: capture.noteId, transcriptRevision: transcript.revision,
    });
    return transcript;
  }

  editSummary(id: string, input: Parameters<typeof editMeeting>[1]) {
    const record = editMeeting(id, input);
    this.emit?.('discussion.updated', { id, noteId: getDiscussionCapture(id)?.noteId, organizationRevision: record.revision });
    return record;
  }

  recordingChunks(id: string) {
    if (!getDiscussionCapture(id)) throw new DiscussionServiceError('not_found', 'Discussion not found');
    return listRecordingChunks(id);
  }

  async reorganize(id: string, template: string = 'general') {
    if (!['general', 'project', 'review', 'interview'].includes(template)) throw new DiscussionServiceError('invalid_input', 'Invalid meeting template');
    return this.enqueueMutation(id, async () => {
      const capture = getDiscussionCapture(id);
      if (!capture) throw new DiscussionServiceError('not_found', 'Discussion not found');
      if (!['completed', 'needs_attention'].includes(capture.status) || !capture.canonicalTranscript) throw new DiscussionServiceError('conflict', 'Transcript is not ready');
      const updated = updateDiscussionCapture(id, { status: 'organizing', template: template as import('./types.js').DiscussionTemplate, failureCode: undefined, failureMessage: undefined }, [capture.status]);
      this.emit?.('discussion.updated', updated);
      return this.detail(updated!);
    });
  }

  async uploadRecordingChunk(id: string, sequence: number, sha256: string, body: ReadableStream<Uint8Array>) {
    return this.enqueueMutation(id, async () => {
      const capture = getDiscussionCapture(id);
      if (!capture) throw new DiscussionServiceError('not_found', 'Discussion not found');
      if (!['recording', 'stopping', 'needs_attention'].includes(capture.status) || capture.audioDeletedAt || capture.audioAttachmentId) {
        throw new DiscussionServiceError('conflict', 'Recording no longer accepts chunks');
      }
      const job = getRecordingJob(id);
      if (job && ['queued', 'running'].includes(job.state)) throw new DiscussionServiceError('conflict', 'Recording is being finalized');
      return saveRecordingChunk(capture, sequence, sha256, body);
    });
  }

  recordingJob(id: string) {
    if (!getDiscussionCapture(id)) throw new DiscussionServiceError('not_found', 'Discussion not found');
    return getRecordingJob(id);
  }

  async sealRecording(id: string, input: DiscussionRecordingManifest) {
    if (!Number.isInteger(input.lastSequence) || input.lastSequence < -1 || input.lastSequence > 2_000) throw new DiscussionServiceError('invalid_input', 'Invalid final segment sequence');
    return this.enqueueMutation(id, async () => {
      const capture = getDiscussionCapture(id);
      if (!capture) throw new DiscussionServiceError('not_found', 'Discussion not found');
      const job = getRecordingJob(id);
      if (capture.audioAttachmentId && job?.state === 'completed') return submitRecordingJob(id, input);
      if (!['recording', 'stopping', 'needs_attention'].includes(capture.status) || capture.audioDeletedAt) {
        throw new DiscussionServiceError('conflict', 'Recording cannot be completed');
      }
      if (!capture.audioAttachmentId) validateRecordingManifest(capture, input);
      const submitted = runSqliteWriteTransaction(() => {
        const submitted = submitRecordingJob(id, input);
        const updated = updateDiscussionCapture(id, {
          status: 'stopping', expectedLastSequence: input.lastSequence,
          recordingStoppedAt: capture.recordingStoppedAt ?? Date.now(),
          failureStage: undefined, failureCode: undefined, failureMessage: undefined,
        }, [capture.status]);
        if (!updated) throw new DiscussionServiceError('conflict', 'Discussion changed while submitting recording');
        return submitted;
      });
      this.emit?.('discussion.updated', getDiscussionCapture(id));
      return submitted;
    });
  }

  /** Runs inside the existing sealer lifecycle; unfinished leases survive process restart. */
  async processRecordingJob(): Promise<void> {
    const job = claimRecordingJob(this.recordingOwner);
    if (!job) return;
    await this.enqueueMutation(job.discussionId, async () => {
      const controller = new AbortController();
      this.recordingControllers.set(job.discussionId, controller);
      const assertLease = () => {
        controller.signal.throwIfAborted();
        if (!renewRecordingJob(job.id, this.recordingOwner)) throw new Error('Recording job lease expired');
      };
      const renewal = setInterval(() => {
        if (!renewRecordingJob(job.id, this.recordingOwner)) controller.abort();
      }, 15_000);
      renewal.unref();
      try {
        assertLease();
        const capture = getDiscussionCapture(job.discussionId);
        if (!capture || capture.audioDeletedAt || capture.status === 'cancelled') throw new Error('Recording is no longer available');
        const updated = capture.audioAttachmentId ? capture : await completeRecording(capture, job.input, this.notes, assertLease, controller.signal);
        if (finishRecordingJob(job.id, this.recordingOwner)) this.emit?.('discussion.updated', updated);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (finishRecordingJob(job.id, this.recordingOwner, message)) {
          const failed = updateDiscussionCapture(job.discussionId, {
            status: 'needs_attention', failureStage: 'audio_upload', failureCode: 'recording_finalize_failed', failureMessage: message.slice(0, 1_000),
          }, ['stopping']);
          if (failed) this.emit?.('discussion.updated', failed);
        }
        log.warn({ err: error, discussionId: job.discussionId, jobId: job.id }, 'Recording finalization failed');
      } finally {
        clearInterval(renewal);
        this.recordingControllers.delete(job.discussionId);
      }
    });
  }

  async retry(id: string): Promise<DiscussionDetail | null> {
    const capture = getDiscussionCapture(id);
    if (!capture) return null;
    if (capture.status !== 'needs_attention') {
      throw new DiscussionServiceError('conflict', 'Only discussions needing attention can be retried');
    }
    if (getRecordingJob(id)?.state === 'failed') {
      await this.sealRecording(id, getRecordingJobInput(id)!);
      return this.get(id);
    }
    const updated = updateDiscussionCapture(id, {
      status: capture.canonicalTranscript ? 'organizing' : 'stopping',
      ...(!capture.canonicalTranscript ? { recordingStoppedAt: Date.now() } : {}),
      failureStage: undefined,
      failureCode: undefined,
      failureMessage: undefined,
    }, ['needs_attention']);
    if (!updated) throw new DiscussionServiceError('conflict', 'Discussion changed while retrying');
    this.emit?.('discussion.updated', updated);
    return this.detail(updated);
  }

  async cancel(id: string): Promise<DiscussionDetail | null> {
    const active = getDiscussionCapture(id);
    if (active && ['recording', 'stopping'].includes(active.status)) {
      cancelRecordingJob(id);
      this.recordingControllers.get(id)?.abort();
    }
    return this.enqueueMutation(id, async () => {
    const capture = getDiscussionCapture(id);
    if (!capture) return null;
    if (capture.status === 'cancelled') return this.detail(capture);
    if (capture.status !== 'recording' && capture.status !== 'stopping') {
      throw new DiscussionServiceError('conflict', 'Only an active recording can be cancelled');
    }
    const updated = updateDiscussionCapture(id, { status: 'cancelled' }, ['recording', 'stopping']);
    if (!updated) throw new DiscussionServiceError('conflict', 'Discussion changed while cancelling');
    cancelRecordingJob(id);
    deleteDiscussionSegmentAudio(id);
    await removeRecordingChunks(capture);
    this.emit?.('discussion.updated', updated);
    return this.detail(updated);
    });
  }

  async deleteAudio(id: string): Promise<DiscussionDetail | null> {
    return this.enqueueMutation(id, async () => {
      const capture = getDiscussionCapture(id);
      if (!capture) return null;
      if (!['completed', 'needs_attention', 'cancelled'].includes(capture.status)) {
        throw new DiscussionServiceError('conflict', 'Audio cannot be deleted while discussion processing is active');
      }
      await removeRecordingChunks(capture);
      cancelRecordingJob(id);
      if (capture.audioAttachmentId) await this.notes.removeAttachment(capture.noteId, capture.audioAttachmentId);
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
    const recordingJob = getRecordingJob(capture.id);
    return {
      discussion: capture,
      note,
      transcript: this.transcript(capture.id)!,
      ...(recordingJob ? { recordingJob } : {}),
      ...(getLatestDiscussionOrganization(capture.id)
        ? { organization: getLatestDiscussionOrganization(capture.id)! }
        : {}),
    };
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
