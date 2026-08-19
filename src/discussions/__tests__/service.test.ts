import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NotesService, NotesStore } from '../../notes/index.js';
import { ProjectService } from '../../projects/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { DiscussionLiveWorker } from '../live-worker.js';
import { DiscussionOrganizer } from '../organizer.js';
import { DiscussionOrganizerWorker } from '../organizer-worker.js';
import { DiscussionSealer } from '../sealer.js';
import { DiscussionService, DiscussionServiceError } from '../service.js';

describe('discussion note document', () => {
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

  async function create(clientRequestId: string) {
    const consentPolicyVersion = service.settings().consentPolicyVersion;
    service.acknowledgeConsent(consentPolicyVersion);
    return service.create({ clientRequestId, consentPolicyVersion, source: 'web' });
  }

  function uploadSegment(discussionId: string, sequence: number, text: string) {
    const buffer = Buffer.from(text);
    return service.uploadSegment({
      discussionId,
      sequence,
      file: { buffer, mimeType: 'audio/wav' },
      startedAtMs: sequence * 7_250,
      endedAtMs: sequence * 7_250 + 8_000,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    });
  }

  it('requires consent and creates an idempotent note with isolated user markdown', async () => {
    const consentPolicyVersion = service.settings().consentPolicyVersion;
    await expect(service.create({ clientRequestId: 'no-consent', consentPolicyVersion, source: 'web' }))
      .rejects.toMatchObject<Partial<DiscussionServiceError>>({ code: 'conflict' });

    service.acknowledgeConsent(consentPolicyVersion);
    const first = await service.create({ clientRequestId: 'draft-1', consentPolicyVersion, source: 'web' });
    const second = await service.create({ clientRequestId: 'draft-1', consentPolicyVersion, source: 'web' });

    expect(second.discussion.id).toBe(first.discussion.id);
    expect(first.discussion).toMatchObject({ status: 'recording', transcriptRevision: 0 });
    expect(first.note.markdown).toBe('');
    expect(first.transcript).toMatchObject({ revision: 0, text: '', segments: [] });
  });

  it('transcribes several segments concurrently and supports revision-checked correction', async () => {
    const created = await create('live');
    uploadSegment(created.discussion.id, 0, 'one');
    uploadSegment(created.discussion.id, 1, 'two');
    uploadSegment(created.discussion.id, 2, 'three');

    const worker = new DiscussionLiveWorker({
      notes,
      projects,
      getConfig: () => ({}) as never,
      transcribeSegment: async (buffer) => ({ text: buffer.toString(), provider: 'test' }),
    });
    await worker.tick();

    const transcript = service.transcript(created.discussion.id)!;
    expect(transcript.segments.map((segment) => segment.status)).toEqual(['confirmed', 'confirmed', 'confirmed']);
    const first = transcript.segments[0]!;
    const corrected = service.correctSegment(created.discussion.id, 0, 'corrected one', first.revision);
    expect(corrected.segments[0]).toMatchObject({ displayText: 'corrected one', correctedByUser: true });
    expect(() => service.correctSegment(created.discussion.id, 0, 'stale', first.revision))
      .toThrowError(DiscussionServiceError);
  });

  it('stops immediately, accepts late uploads, seals confirmed segments, and organizes without changing user markdown', async () => {
    const created = await create('complete');
    await notes.updateNote(created.note.id, { markdown: 'My own notes' });
    uploadSegment(created.discussion.id, 0, 'We decided to ship Friday.');
    const liveWorker = new DiscussionLiveWorker({
      notes,
      projects,
      getConfig: () => ({}) as never,
      transcribeSegment: async () => ({ text: 'We decided to ship Friday.', provider: 'test' }),
    });
    await liveWorker.tick();

    const stopped = await service.stop(created.discussion.id, 0, 8_000);
    expect(stopped?.discussion.status).toBe('stopping');
    await service.uploadRecording(created.discussion.id, {
      name: 'discussion.webm', buffer: Buffer.from('audio'), mimeType: 'audio/webm',
    }, 8_000);

    let fallbackCalls = 0;
    const sealer = new DiscussionSealer({
      notes,
      getConfig: () => ({}) as never,
      transcribeRecording: async () => { fallbackCalls += 1; return { text: 'fallback' }; },
    });
    await sealer.tick();
    expect(fallbackCalls).toBe(0);
    expect((await service.get(created.discussion.id))?.discussion).toMatchObject({
      status: 'organizing', canonicalTranscript: 'We decided to ship Friday.',
    });

    const organizer = new DiscussionOrganizer({
      notes,
      projects,
      getConfig: () => ({}) as never,
      organizeTranscript: async () => ({
        modelRef: 'test/organizer',
        organization: {
          title: 'Friday release', summary: 'Ship Friday.', keyPoints: [], decisions: ['Ship Friday.'],
          actionItems: [], risks: [], openQuestions: [],
        },
      }),
    });
    const organizerWorker = new DiscussionOrganizerWorker(organizer);
    await organizerWorker.tick();

    const completed = await service.get(created.discussion.id);
    expect(completed?.discussion.status).toBe('completed');
    expect(completed?.organization?.organization?.decisions).toEqual(['Ship Friday.']);
    expect((await notes.getNote(created.note.id))?.markdown).toBe('My own notes');
    expect(() => service.correctSegment(created.discussion.id, 0, 'too late', 3))
      .toThrowError(DiscussionServiceError);
  });

  it('uses full recording only when live segments are incomplete', async () => {
    const created = await create('fallback');
    await service.stop(created.discussion.id, 0, 8_000);
    await service.uploadRecording(created.discussion.id, {
      name: 'discussion.ogg', buffer: Buffer.from('audio'), mimeType: 'audio/ogg',
    }, 8_000);
    const sealer = new DiscussionSealer({
      notes,
      getConfig: () => ({}) as never,
      transcribeRecording: async () => ({ text: 'Recovered from full recording.', language: 'en' }),
    });
    const stoppedAt = (await service.get(created.discussion.id))!.discussion.recordingStoppedAt!;
    await sealer.tick(stoppedAt + 2 * 60_000);
    expect((await service.get(created.discussion.id))?.discussion).toMatchObject({
      status: 'organizing',
      canonicalTranscript: 'Recovered from full recording.',
      transcriptLanguage: 'en',
    });
    expect(service.transcript(created.discussion.id)?.text).toBe('Recovered from full recording.');
  });

  it('requires attention when the original recording never arrives', async () => {
    const created = await create('missing-audio');
    const stopped = await service.stop(created.discussion.id, -1, 5_000);
    const sealer = new DiscussionSealer({ notes, getConfig: () => ({}) as never });
    const firstStoppedAt = stopped!.discussion.recordingStoppedAt!;
    await sealer.tick(firstStoppedAt + 2 * 60_000);
    expect((await service.get(created.discussion.id))?.discussion).toMatchObject({
      status: 'needs_attention', failureStage: 'audio_upload', failureCode: 'recording_missing',
    });
    const retried = await service.retry(created.discussion.id);
    expect(retried?.discussion.status).toBe('stopping');
    expect(retried!.discussion.recordingStoppedAt).toBeGreaterThanOrEqual(firstStoppedAt);
  });

  it('falls back to the original recording when no live segment was emitted', async () => {
    const created = await create('short-recording');
    await service.stop(created.discussion.id, -1, 2_000);
    await service.uploadRecording(created.discussion.id, {
      name: 'short.webm', buffer: Buffer.from('audio'), mimeType: 'audio/webm',
    }, 2_000);
    let fallbackCalls = 0;
    const sealer = new DiscussionSealer({
      notes,
      getConfig: () => ({}) as never,
      transcribeRecording: async () => {
        fallbackCalls += 1;
        return { text: 'A short note.' };
      },
    });
    await sealer.tick();
    expect(fallbackCalls).toBe(1);
    expect((await service.get(created.discussion.id))?.discussion.canonicalTranscript).toBe('A short note.');
  });
});
