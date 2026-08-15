import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ObjectLinkService } from '../../activity/service.js';
import { NotesService, NotesStore } from '../../notes/index.js';
import { ProjectService } from '../../projects/index.js';
import { WorkItemService } from '../../work-items/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { DiscussionService, DiscussionServiceError } from '../service.js';
import { DiscussionPipeline } from '../pipeline.js';
import {
  claimNextDiscussionCapture,
  getDiscussionCapture,
  updateDiscussionCapture,
} from '../repository.js';
import { DiscussionWorker } from '../worker.js';

describe('DiscussionService', () => {
  let stateDir: string;
  let previousStateDir: string | undefined;
  let notes: NotesService;
  let projects: ProjectService;
  let service: DiscussionService;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-discussions-'));
    previousStateDir = process.env.XOPC_STATE_DIR;
    process.env.XOPC_STATE_DIR = stateDir;
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    notes = new NotesService(new NotesStore());
    await notes.initialize();
    projects = new ProjectService();
    service = new DiscussionService(notes, projects);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates one project-linked voice note for an idempotent request', async () => {
    const project = projects.create({ name: 'Latency project' });
    const input = {
      clientRequestId: 'draft-1',
      projectId: project.id,
      title: 'Latency review',
      captureMode: 'conversation' as const,
      consentConfirmed: true,
      source: 'web' as const,
    };

    const first = await service.create(input);
    const second = await service.create(input);

    expect(second.discussion.id).toBe(first.discussion.id);
    expect(first.note.kind).toBe('voice');
    expect(first.note.tags).toBeUndefined();
    expect((await notes.listNotes({ projectId: project.id })).items.map((item) => item.id)).toEqual([first.note.id]);
    expect(new ObjectLinkService().listForObject({ kind: 'note', id: first.note.id })).toEqual([
      expect.objectContaining({
        relation: 'belongs_to',
        to: expect.objectContaining({ kind: 'project', id: project.id }),
      }),
    ]);
  });

  it('requires consent for conversation capture and only cancels active work', async () => {
    await expect(service.create({
      clientRequestId: 'draft-no-consent',
      captureMode: 'conversation',
      consentConfirmed: false,
      source: 'electron',
    })).rejects.toMatchObject<Partial<DiscussionServiceError>>({ code: 'invalid_input' });

    const detail = await service.create({
      clientRequestId: 'draft-solo',
      captureMode: 'solo',
      consentConfirmed: false,
      source: 'electron',
    });
    const cancelled = await service.cancel(detail.discussion.id);
    expect(cancelled?.discussion.status).toBe('cancelled');
    expect((await service.cancel(detail.discussion.id))?.discussion.status).toBe('cancelled');
  });

  it('stores audio once and advances the discussion to the queue', async () => {
    const created = await service.create({
      clientRequestId: 'draft-audio',
      title: 'Audio review',
      captureMode: 'solo',
      consentConfirmed: false,
      source: 'web',
    });
    const file = {
      name: 'discussion.webm',
      buffer: Buffer.from('synthetic-audio'),
      mimeType: 'audio/webm;codecs=opus',
    };

    const uploaded = await service.uploadAudio(created.discussion.id, file, 5_000);
    const repeated = await service.uploadAudio(created.discussion.id, file, 5_000);

    expect(uploaded?.discussion).toMatchObject({
      status: 'queued',
      durationMs: 5_000,
      audioSizeBytes: file.buffer.length,
    });
    expect(repeated?.discussion.audioAttachmentId).toBe(uploaded?.discussion.audioAttachmentId);
    expect(repeated?.note.attachments).toHaveLength(1);
    expect(repeated?.note.markdown).toContain('xopc-attachment://notes/');

    await expect(service.deleteAudio(created.discussion.id))
      .rejects.toMatchObject({ code: 'conflict' });
    updateDiscussionCapture(created.discussion.id, { status: 'review_required' }, ['queued']);
    const deleted = await service.deleteAudio(created.discussion.id);
    expect(deleted?.discussion).toMatchObject({ status: 'review_required' });
    expect(deleted?.discussion.audioAttachmentId).toBeUndefined();
    expect(deleted?.discussion.audioDeletedAt).toEqual(expect.any(Number));
    expect(deleted?.note.attachments).toEqual([]);
    expect(deleted?.note.markdown).not.toContain('xopc-attachment://notes/');
    expect(service.metrics()).toMatchObject({
      total: 1,
      byStatus: { review_required: 1 },
    });
  });

  it('claims uploaded audio and writes a reviewable analysis into the note', async () => {
    const created = await service.create({
      clientRequestId: 'draft-pipeline',
      title: 'Release discussion',
      captureMode: 'solo',
      consentConfirmed: false,
      source: 'web',
    });
    await service.uploadAudio(created.discussion.id, {
      name: 'release.webm',
      buffer: Buffer.from('synthetic-audio'),
      mimeType: 'audio/webm',
    }, 5_000);
    const claimed = claimNextDiscussionCapture('worker-1');
    expect(claimed).toMatchObject({ status: 'transcribing', attemptCount: 1, leaseOwner: 'worker-1' });

    const pipeline = new DiscussionPipeline({
      notes,
      getConfig: () => ({}) as never,
      transcribeAudio: async () => ({ text: 'We will ship Friday. Lin owns the checklist.', provider: 'test-stt', language: 'en' }),
      analyzeTranscript: async () => ({
        modelRef: 'test/analyzer',
        analysis: {
          summary: 'The team agreed to ship Friday.',
          keyPoints: ['Release readiness was reviewed.'],
          decisions: ['Ship on Friday.'],
          actionItems: [{ id: 'checklist', title: 'Prepare the checklist', owner: 'Lin' }],
          risks: [],
          openQuestions: [],
        },
      }),
    });
    const completed = await pipeline.process(claimed!, 'worker-1');
    const note = await notes.getNote(created.note.id);

    expect(completed).toMatchObject({
      status: 'review_required',
      sttProvider: 'test-stt',
      analyzerModelRef: 'test/analyzer',
      analysisVersion: 1,
    });
    expect(note?.markdown).toContain('## Decisions\n- Ship on Friday.');
    expect(note?.markdown).toContain('- [ ] Prepare the checklist — Owner: Lin');
    expect(note?.markdown).toContain('## Transcript\nWe will ship Friday.');
    expect(note?.attachments?.[0]?.transcript).toBe('We will ship Friday. Lin owns the checklist.');
  });

  it('recovers an expired processing lease without double claiming', async () => {
    const created = await service.create({
      clientRequestId: 'draft-lease',
      captureMode: 'solo',
      consentConfirmed: false,
      source: 'electron',
    });
    await service.uploadAudio(created.discussion.id, {
      name: 'lease.ogg',
      buffer: Buffer.from('synthetic-audio'),
      mimeType: 'audio/ogg',
    }, 5_000);

    const first = claimNextDiscussionCapture('worker-a', 1_000, 500);
    expect(first?.attemptCount).toBe(1);
    expect(claimNextDiscussionCapture('worker-b', 1_200, 500)).toBeNull();
    const recovered = claimNextDiscussionCapture('worker-b', 1_501, 500);
    expect(recovered).toMatchObject({ leaseOwner: 'worker-b', attemptCount: 2, status: 'transcribing' });
  });

  it('backs off transient failures and stops after three attempts', async () => {
    const created = await service.create({
      clientRequestId: 'draft-retry',
      captureMode: 'solo',
      consentConfirmed: false,
      source: 'web',
    });
    await service.uploadAudio(created.discussion.id, {
      name: 'retry.wav',
      buffer: Buffer.from('synthetic-audio'),
      mimeType: 'audio/wav',
    }, 5_000);
    const worker = new DiscussionWorker({
      process: async () => { throw new Error('provider unavailable'); },
    });

    await worker.tick();
    let capture = getDiscussionCapture(created.discussion.id)!;
    expect(capture).toMatchObject({ status: 'queued', attemptCount: 1, failedStage: 'transcription' });
    expect(capture.nextAttemptAt).toBeTypeOf('number');

    updateDiscussionCapture(capture.id, { nextAttemptAt: 0 }, ['queued']);
    await worker.tick();
    capture = getDiscussionCapture(capture.id)!;
    expect(capture).toMatchObject({ status: 'queued', attemptCount: 2 });

    updateDiscussionCapture(capture.id, { nextAttemptAt: 0 }, ['queued']);
    await worker.tick();
    capture = getDiscussionCapture(capture.id)!;
    expect(capture).toMatchObject({
      status: 'failed',
      attemptCount: 3,
      lastErrorCode: 'transcription_failed',
    });
    expect(capture.leaseOwner).toBeUndefined();
  });

  it('saves an optimistic review and converts selected actions exactly once', async () => {
    const project = projects.create({ name: 'Review project' });
    const workItems = new WorkItemService();
    const emitted: Array<{ type: string; payload: unknown }> = [];
    const reviewService = new DiscussionService(notes, projects, workItems, (type, payload) => {
      emitted.push({ type, payload });
    });
    const created = await reviewService.create({
      clientRequestId: 'draft-review',
      projectId: project.id,
      captureMode: 'solo',
      consentConfirmed: false,
      source: 'web',
    });
    await reviewService.uploadAudio(created.discussion.id, {
      name: 'review.mp4',
      buffer: Buffer.from('synthetic-audio'),
      mimeType: 'audio/mp4',
    }, 5_000);
    const claimed = claimNextDiscussionCapture('review-worker')!;
    await new DiscussionPipeline({
      notes,
      getConfig: () => ({}) as never,
      transcribeAudio: async () => ({ text: 'Prepare the launch checklist.', provider: 'test-stt' }),
      analyzeTranscript: async () => ({
        modelRef: 'test/analyzer',
        analysis: {
          summary: 'Launch planning.',
          keyPoints: [],
          decisions: [],
          actionItems: [{ id: 'launch-checklist', title: 'Prepare launch checklist' }],
          risks: [],
          openQuestions: [],
        },
      }),
    }).process(claimed, 'review-worker');

    const reviewInput = {
      summary: 'Reviewed launch planning.',
      keyPoints: ['Checklist first.'],
      decisions: [],
      actionItems: [{ id: 'launch-checklist', title: 'Prepare the final launch checklist' }],
      risks: [],
      openQuestions: [],
    };
    const concurrentReviews = await Promise.allSettled([
      reviewService.saveReview(created.discussion.id, reviewInput, 0),
      reviewService.saveReview(created.discussion.id, reviewInput, 0),
    ]);
    expect(concurrentReviews.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const reviewed = concurrentReviews.find((result) => result.status === 'fulfilled')?.value;
    expect(reviewed?.discussion.reviewRevision).toBe(1);
    await expect(reviewService.saveReview(created.discussion.id, reviewed?.discussion.review, 0))
      .rejects.toMatchObject({ code: 'conflict' });

    const [first, audioDeleted] = await Promise.all([
      reviewService.complete(created.discussion.id, 1, ['launch-checklist']),
      reviewService.deleteAudio(created.discussion.id),
    ]);
    const second = await reviewService.complete(created.discussion.id, 1, ['launch-checklist']);
    expect(first?.discussion.status).toBe('completed');
    expect(first?.createdWorkItemIds).toHaveLength(1);
    expect(second?.createdWorkItemIds).toEqual(first?.createdWorkItemIds);
    expect(workItems.listProjectWorkItems(project.id).items).toHaveLength(1);
    expect((await notes.getNote(created.note.id))?.status).toBe('processed');
    expect(audioDeleted?.discussion.audioDeletedAt).toEqual(expect.any(Number));
    expect(emitted.filter((event) => event.type === 'discussion.completed')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ discussionId: created.discussion.id }) }),
    ]);
  });
});
