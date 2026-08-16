import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ObjectLinkService } from '../../activity/service.js';
import { NotesService, NotesStore } from '../../notes/index.js';
import { ProjectService } from '../../projects/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { DiscussionLiveWorker } from '../live-worker.js';
import { DiscussionPipeline } from '../pipeline.js';
import {
  claimNextDiscussionCapture,
  claimNextDiscussionTranscriptSegment,
  getDiscussionCapture,
  updateDiscussionCapture,
} from '../repository.js';
import { DiscussionService, DiscussionServiceError } from '../service.js';
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

  function acknowledge(): number {
    const version = service.settings().consentPolicyVersion;
    service.acknowledgeConsent(version);
    return version;
  }

  async function create(clientRequestId: string, projectId?: string) {
    const consentPolicyVersion = acknowledge();
    return service.create({
      clientRequestId,
      ...(projectId ? { contextProjectId: projectId } : {}),
      consentPolicyVersion,
      source: 'web',
    });
  }

  it('requires one policy acknowledgement and creates an idempotent recording note', async () => {
    const policyVersion = service.settings().consentPolicyVersion;
    await expect(service.create({
      clientRequestId: 'draft-no-consent',
      consentPolicyVersion: policyVersion,
      source: 'web',
    })).rejects.toMatchObject<Partial<DiscussionServiceError>>({ code: 'conflict' });

    service.acknowledgeConsent(policyVersion);
    const project = projects.create({ name: 'Latency project' });
    const input = {
      clientRequestId: 'draft-1',
      contextProjectId: project.id,
      consentPolicyVersion: policyVersion,
      source: 'web' as const,
    };
    const first = await service.create(input);
    const second = await service.create(input);

    expect(second.discussion.id).toBe(first.discussion.id);
    expect(first.discussion).toMatchObject({
      status: 'recording',
      processingStage: 'original_upload',
      projectInferenceSource: 'context',
    });
    expect(first.note.markdown).toContain('Recording in progress');
    expect(new ObjectLinkService().listForObject({ kind: 'note', id: first.note.id })).toEqual([
      expect.objectContaining({ relation: 'belongs_to', to: expect.objectContaining({ id: project.id }) }),
    ]);
  });

  it('stores ordered live segments, transcribes them, and enriches the note once', async () => {
    const project = projects.create({ name: 'Launch Project' });
    const created = await create('draft-live');
    const audio = [Buffer.from('wav-segment-one'), Buffer.from('wav-segment-two')];
    for (let sequence = 0; sequence < audio.length; sequence += 1) {
      const buffer = audio[sequence]!;
      service.uploadSegment({
        discussionId: created.discussion.id,
        sequence,
        file: { buffer, mimeType: 'audio/wav' },
        startedAtMs: sequence * 19_000,
        endedAtMs: sequence * 19_000 + 20_000,
        sha256: createHash('sha256').update(buffer).digest('hex'),
      });
    }

    let calls = 0;
    const worker = new DiscussionLiveWorker({
      notes,
      projects,
      getConfig: () => ({}) as never,
      transcribeSegment: async () => ({
        text: calls++ === 0
          ? 'We discussed the Launch Project release plan and agreed to prepare the final checklist. '
          : 'final checklist. The release owner will confirm the rollout window tomorrow.',
        provider: 'test-live-stt',
      }),
      enrichTranscript: async () => ({
        title: 'Launch release plan',
        projectCandidateId: project.id,
        projectConfidence: 0.94,
        projectAlternativeConfidence: 0.1,
        modelRef: 'test/live',
      }),
    });
    await worker.tick();
    await worker.tick();

    const transcript = service.transcript(created.discussion.id)!;
    const detail = await service.get(created.discussion.id);
    expect(transcript.segments.map((segment) => segment.status)).toEqual(['completed', 'completed']);
    expect(transcript.text.match(/final checklist/g)).toHaveLength(1);
    expect(detail?.note.title).toBe('Launch release plan');
    expect(detail?.discussion).toMatchObject({
      projectId: project.id,
      projectInferenceSource: 'exact_name',
      generatedTitle: 'Launch release plan',
    });
  });

  it('uses the full recording as authority and completes the note without review', async () => {
    const project = projects.create({ name: 'Release project' });
    const created = await create('draft-final', project.id);
    await service.uploadRecording(created.discussion.id, {
      name: 'release.webm',
      buffer: Buffer.from('synthetic-audio'),
      mimeType: 'audio/webm',
    }, 5_000);
    const finishing = await service.finish(created.discussion.id, -1, 5_000);
    expect(finishing?.discussion).toMatchObject({ status: 'finalizing', processingStage: 'final_transcription' });
    const claimed = claimNextDiscussionCapture('worker-1');
    const completedEvents: string[] = [];
    const pipeline = new DiscussionPipeline({
      notes,
      projects,
      getConfig: () => ({}) as never,
      transcribeAudio: async () => ({
        text: 'We will ship Friday. Lin owns the checklist.',
        provider: 'test-stt',
        language: 'en',
      }),
      analyzeTranscript: async () => ({
        modelRef: 'test/analyzer',
        analysis: {
          title: 'Friday release decision',
          summary: 'The team agreed to ship Friday.',
          keyPoints: ['Release readiness was reviewed.'],
          decisions: ['Ship on Friday.'],
          actionItems: [{ id: 'checklist', title: 'Prepare the checklist', owner: 'Lin' }],
          risks: [],
          openQuestions: [],
        },
      }),
      onCompleted: (capture) => completedEvents.push(capture.id),
    });
    const completed = await pipeline.process(claimed!, 'worker-1');
    const note = await notes.getNote(created.note.id);

    expect(completed).toMatchObject({ status: 'completed', finalizationRevision: 1, sttProvider: 'test-stt' });
    expect(note).toMatchObject({ title: 'Friday release decision', status: 'processed' });
    expect(note?.markdown).toContain('## Decisions\n- Ship on Friday.');
    expect(note?.markdown).toContain('## Transcript\nWe will ship Friday.');
    expect(note?.attachments?.[0]?.transcript).toContain('We will ship Friday.');
    expect(completedEvents).toEqual([created.discussion.id]);

    const withoutAudio = await service.deleteAudio(created.discussion.id);
    const retainedNote = await notes.getNote(created.note.id);
    expect(withoutAudio?.discussion.audioAttachmentId).toBeUndefined();
    expect(retainedNote?.attachments).toEqual([]);
    expect(retainedNote?.markdown).not.toContain('[Discussion audio]');
    expect(retainedNote?.markdown).toContain('## Transcript\nWe will ship Friday.');
  });

  it('recovers an expired finalization lease without double claiming', async () => {
    const created = await create('draft-lease');
    await service.uploadRecording(created.discussion.id, {
      name: 'lease.ogg',
      buffer: Buffer.from('synthetic-audio'),
      mimeType: 'audio/ogg',
    }, 5_000);
    await service.finish(created.discussion.id, -1, 5_000);

    const first = claimNextDiscussionCapture('worker-a', 1_000, 500);
    expect(first?.attemptCount).toBe(1);
    expect(claimNextDiscussionCapture('worker-b', 1_200, 500)).toBeNull();
    const recovered = claimNextDiscussionCapture('worker-b', 1_501, 500);
    expect(recovered).toMatchObject({ leaseOwner: 'worker-b', attemptCount: 2, status: 'finalizing' });
  });

  it('recovers an expired live transcription lease before claiming later segments', async () => {
    const created = await create('draft-live-lease');
    for (let sequence = 0; sequence < 2; sequence += 1) {
      const buffer = Buffer.from(`segment-${sequence}`);
      service.uploadSegment({
        discussionId: created.discussion.id,
        sequence,
        file: { buffer, mimeType: 'audio/wav' },
        startedAtMs: sequence * 1_000,
        endedAtMs: (sequence + 1) * 1_000,
        sha256: createHash('sha256').update(buffer).digest('hex'),
      });
    }

    const first = claimNextDiscussionTranscriptSegment('worker-a', 1_000, 500);
    expect(first).toMatchObject({ sequence: 0, leaseOwner: 'worker-a', attemptCount: 1 });
    expect(claimNextDiscussionTranscriptSegment('worker-b', 1_200, 500)).toBeNull();

    const recovered = claimNextDiscussionTranscriptSegment('worker-b', 1_501, 500);
    expect(recovered).toMatchObject({ sequence: 0, leaseOwner: 'worker-b', attemptCount: 2 });
  });

  it('backs off finalization failures and stops after three attempts', async () => {
    const created = await create('draft-retry');
    await service.uploadRecording(created.discussion.id, {
      name: 'retry.wav',
      buffer: Buffer.from('synthetic-audio'),
      mimeType: 'audio/wav',
    }, 5_000);
    await service.finish(created.discussion.id, -1, 5_000);
    const worker = new DiscussionWorker({ process: async () => { throw new Error('provider unavailable'); } });

    await worker.tick();
    let capture = getDiscussionCapture(created.discussion.id)!;
    expect(capture).toMatchObject({ status: 'finalizing', attemptCount: 1 });
    updateDiscussionCapture(capture.id, { nextAttemptAt: 0 }, ['finalizing']);
    await worker.tick();
    capture = getDiscussionCapture(capture.id)!;
    updateDiscussionCapture(capture.id, { nextAttemptAt: 0 }, ['finalizing']);
    await worker.tick();
    capture = getDiscussionCapture(capture.id)!;
    expect(capture).toMatchObject({ status: 'failed', attemptCount: 3, lastErrorCode: 'final_transcription_failed' });

    expect((await service.retry(capture.id))?.discussion).toMatchObject({ status: 'finalizing', attemptCount: 0 });
  });

  it('allows an inferred project association to be undone', async () => {
    const project = projects.create({ name: 'Undo project' });
    const created = await create('draft-cleanup');
    updateDiscussionCapture(created.discussion.id, {
      projectId: project.id,
      projectInferenceScore: 0.9,
      projectInferenceSource: 'model',
      status: 'completed',
    }, ['recording']);
    new ObjectLinkService().create({
      id: `discussion:${created.discussion.id}:project`,
      from: { kind: 'note', id: created.note.id },
      to: { kind: 'project', id: project.id },
      relation: 'belongs_to',
      source: 'agent',
    });

    const unlinked = await service.unlinkInferredProject(created.discussion.id);
    expect(unlinked?.discussion.projectId).toBeUndefined();
    expect(new ObjectLinkService().listForObject({ kind: 'note', id: created.note.id })).toEqual([]);
  });
});
