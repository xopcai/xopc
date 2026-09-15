import { applyMeetingEdits } from '../edits.js';
import { updateDiscussionCapture } from '../repository.js';
import { convertMeetingAction, meetingActionTasks } from '../action-tasks.js';
import { createDiscussionOrganization, completeDiscussionOrganization } from '../repository.js';
import { saveTranscriptRevision, replaceTranscriptSegments } from '../revisions.js';
import { claimRecordingJob, finishRecordingJob } from '../recordingJobs.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { auth } from '../../gateway/hono/middleware/auth.js';
import { gatewayScopes } from '../../gateway/hono/middleware/scopes.js';
import { getGatewayPrincipal, setGatewayPrincipal } from '../../gateway/security/gateway-principal.js';
import { registerAuthenticatedLazyRouteFallback, resetLazyRouteBundlesForTests } from '../../gateway/hono/routes/lazy-fallback.js';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { open } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  async function finalizeRecording(target: DiscussionService, id: string, input: { chunkCount: number; mimeType: string; fileName: string }) {
    await target.sealRecording(id, { ...input, lastSequence: Math.max(-1, ...target.transcript(id)!.segments.map(segment => segment.sequence)) });
    await target.processRecordingJob();
    expect(target.recordingJob(id)?.state).toBe('completed');
    return (await target.get(id))!;
  }

  async function uploadRecording(id: string, _file: unknown, durationMs: number, finalize = true) {
    const buffer = Buffer.alloc(44 + Math.round(durationMs * 32));
    buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(16_000, 24); buffer.writeUInt32LE(32_000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40);
    await service.uploadRecordingChunk(id, 0, createHash('sha256').update(buffer).digest('hex'), new Blob([buffer]).stream());
    if (!finalize) return (await service.get(id))!;
    return finalizeRecording(service, id, { chunkCount: 1, mimeType: 'audio/wav', fileName: 'meeting.wav' });
  }

  it('assembles independent mobile WAV chunks and produces a meeting summary', async () => {
    const consentPolicyVersion = service.settings().consentPolicyVersion;
    service.acknowledgeConsent(consentPolicyVersion);
    const recordedAt = Date.now() - 86_400_000;
    const created = await service.create({ clientRequestId: 'mobile-wav', source: 'mobile', recordedAt, consentPolicyVersion });
    expect(created.discussion).toMatchObject({ source: 'mobile', recordingStartedAt: recordedAt });
    const chunk = Buffer.alloc(32044);
    chunk.write('RIFF'); chunk.writeUInt32LE(chunk.length - 8, 4); chunk.write('WAVEfmt ', 8);
    chunk.writeUInt32LE(16, 16); chunk.writeUInt16LE(1, 20); chunk.writeUInt16LE(1, 22);
    chunk.writeUInt32LE(16000, 24); chunk.writeUInt32LE(32000, 28); chunk.writeUInt16LE(2, 32); chunk.writeUInt16LE(16, 34);
    chunk.write('data', 36); chunk.writeUInt32LE(32000, 40);
    for (let sequence = 0; sequence < 2; sequence++) {
      await service.uploadRecordingChunk(created.discussion.id, sequence, createHash('sha256').update(chunk).digest('hex'), new Blob([chunk]).stream());
    }
    const manifest = { chunkCount: 2, mimeType: 'audio/wav', fileName: 'meeting.wav', lastSequence: -1, containerMode: 'independent_wav' as const };
    await service.sealRecording(created.discussion.id, manifest);
    await expect(service.sealRecording(created.discussion.id, { ...manifest, containerMode: undefined })).rejects.toThrow('manifest differs');
    await service.processRecordingJob();
    const finalized = (await service.get(created.discussion.id))!;
    expect(finalized.discussion.durationMs).toBe(2000);
    const audio = await notes.getAttachmentPath(created.note.id, finalized.discussion.audioAttachmentId!);
    const assembled = await readFile(audio!.filePath);
    expect(assembled.length).toBe(64044);
    expect(assembled.readUInt32LE(40)).toBe(64000);
    expect(assembled.subarray(44)).toEqual(Buffer.alloc(64000));
    await new DiscussionSealer({ notes, getConfig: () => ({}) as never, transcribeRecording: async () => ({ text: 'Ship on Friday.' }) }).tick();
    await new DiscussionOrganizerWorker(new DiscussionOrganizer({ notes, projects, getConfig: () => ({}) as never,
      organizeTranscript: async () => ({ modelRef: 'test', organization: { title: 'Release', summary: 'Ship Friday.', keyPoints: [], decisions: [], actionItems: [], risks: [], openQuestions: [], chapters: [] } }),
    })).tick();
    const completed = (await service.get(created.discussion.id))!;
    expect(completed.discussion.status).toBe('completed');
    expect(completed.organization?.organization?.summary).toBe('Ship Friday.');
  });

  it('rejects mobile WAV chunks with a noncanonical header', async () => {
    const created = await create('bad-mobile-wav');
    const invalid = Buffer.alloc(32044);
    await service.uploadRecordingChunk(created.discussion.id, 0, createHash('sha256').update(invalid).digest('hex'), new Blob([invalid]).stream());
    const manifest = { chunkCount: 1, mimeType: 'audio/wav', fileName: 'meeting.wav', lastSequence: -1, containerMode: 'independent_wav' as const };
    await expect(service.sealRecording(created.discussion.id, { ...manifest, mimeType: 'audio/mp4' })).rejects.toThrow('Unsupported recording container');
    await service.sealRecording(created.discussion.id, manifest);
    await service.processRecordingJob();
    expect(service.recordingJob(created.discussion.id)?.state).toBe('failed');
    expect(service.recordingChunks(created.discussion.id)).toEqual([]);
  });

  it('creates one durable task per action and rejects a stale summary', async () => {
    const created = await create('action-task');
    const revision = saveTranscriptRevision(created.discussion.id);
    const record = createDiscussionOrganization({ discussionId: created.discussion.id, transcriptRevision: revision, inputTranscriptSha256: 'hash', promptVersion: 'test', modelRef: 'test' });
    completeDiscussionOrganization(record.id, { title: 'Meeting', summary: 'A plan', keyPoints: [], decisions: [], actionItems: [{ id: 'action', title: 'Write the proposal', evidenceSegmentIds: [] }], risks: [], openQuestions: [], chapters: [] });
    expect(() => convertMeetingAction(created.discussion.id, 'action', record.revision + 1)).toThrow('summary changed');
    const first = convertMeetingAction(created.discussion.id, 'action', record.revision);
    const second = convertMeetingAction(created.discussion.id, 'action', record.revision);
    expect(second.taskId).toBe(first.taskId);
    expect(second.existing).toBe(true);
    expect(meetingActionTasks(created.discussion.id)).toHaveLength(1);
  });

  it('preserves manual edits and ignored actions across regeneration without changing the linked task', async () => {
    const created = await create('edited-action');
    const revision = saveTranscriptRevision(created.discussion.id);
    const record = createDiscussionOrganization({ discussionId: created.discussion.id, transcriptRevision: revision, inputTranscriptSha256: 'hash', promptVersion: 'test', modelRef: 'test' });
    const organization = { title: 'Meeting', summary: 'AI summary', keyPoints: [], decisions: [], actionItems: [{ id: 'action', title: 'Write proposal', evidenceSegmentIds: [] }], risks: [], openQuestions: [], chapters: [] };
    completeDiscussionOrganization(record.id, organization);
    updateDiscussionCapture(created.discussion.id, { status: 'completed' });
    const task = convertMeetingAction(created.discussion.id, 'action', record.revision);
    const edited = service.editSummary(created.discussion.id, { kind: 'actionItems', itemId: 'action', text: 'Review proposal', owner: 'Ming', ignored: true, expectedRevision: record.revision });
    expect(edited.revision).toBe(record.revision + 1);
    expect(() => service.editSummary(created.discussion.id, { kind: 'summary', itemId: 'summary', text: 'Stale', expectedRevision: record.revision })).toThrow('summary changed');
    const reapplied = applyMeetingEdits(created.discussion.id, { ...organization, actionItems: [] });
    expect(reapplied.actionItems[0]).toMatchObject({ id: 'action', title: 'Review proposal', ignored: true, editedByUser: true, evidenceRevision: revision });
    expect(convertMeetingAction(created.discussion.id, 'action', edited.revision).taskId).toBe(task.taskId);
    const summary = service.editSummary(created.discussion.id, { kind: 'summary', itemId: 'summary', text: 'My own summary', expectedRevision: edited.revision });
    expect(summary.organization?.summary).toBe('My own summary');
    expect(applyMeetingEdits(created.discussion.id, organization).summary).toBe('My own summary');
    const withLaterChange = applyMeetingEdits(created.discussion.id, { ...organization, actionItems: [{ ...organization.actionItems[0]!, supersededBy: 'later-decision' }] });
    expect(withLaterChange.actionItems[0]?.supersededBy).toBe('later-decision');
    expect(withLaterChange.actionItems[0]?.reviewedChangeId).toBeUndefined();
  });

  it('renames a speaker group atomically while keeping the historical labels', async () => {
    const created = await create('speaker-merge');
    replaceTranscriptSegments(created.discussion.id, [
      { text: 'First', startedAtMs: 0, endedAtMs: 1000, speakerLabel: 'A' },
      { text: 'Second', startedAtMs: 1000, endedAtMs: 2000, speakerLabel: 'A' },
    ]);
    const before = service.transcript(created.discussion.id)!;
    const result = service.correctSegment(created.discussion.id, 0, 'First corrected', before.segments[0]!.revision, 'Ming', true, before.revision);
    expect(result.segments.map(segment => segment.speakerLabel)).toEqual(['Ming', 'Ming']);
    expect(service.transcript(created.discussion.id, before.revision)!.segments.map(segment => segment.speakerLabel)).toEqual(['A', 'A']);
    expect(() => service.correctSegment(created.discussion.id, 0, 'Another edit', result.segments[0]!.revision, 'B', true, before.revision)).toThrow('Transcript changed');
  });

  it('serves recording routes through real HTTP authentication and lazy dispatch', async () => {
    resetLazyRouteBundlesForTests();
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'meeting-test', allowTailscale: false }) }));
    app.use(async (c, next) => {
      if (c.req.header('x-test-read-only')) setGatewayPrincipal(c, { ...getGatewayPrincipal(c), scopes: ['workspace.read'] });
      await next();
    });
    app.use(gatewayScopes());
    registerAuthenticatedLazyRouteFallback(app, { service: { discussions: service, notesServiceInstance: notes }, strictRateLimitMiddleware: async (_c: unknown, next: () => Promise<void>) => next() } as never);
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
    try {
      if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address() as { port: number };
      const base = `http://127.0.0.1:${address.port}`;
      await create('http-consent');
      const mobileResponse = await fetch(`${base}/api/discussions`, { method: 'POST', headers: { authorization: 'Bearer meeting-test', 'content-type': 'application/json' }, body: JSON.stringify({ clientRequestId: 'http', source: 'mobile', recordedAt: Date.now() - 3600000, consentPolicyVersion: service.settings().consentPolicyVersion }) });
      expect(mobileResponse.status).toBe(201);
      const created = await mobileResponse.json() as Awaited<ReturnType<typeof create>>;
      expect(created.discussion.source).toBe('mobile');
      const path = `/api/discussions/${created.discussion.id}/recording/chunks/0`;
      expect((await fetch(base + path, { method: 'PUT', body: 'test' })).status).toBe(401);
      const response = await fetch(base + path, { method: 'PUT', headers: { authorization: 'Bearer meeting-test', 'x-audio-sha256': createHash('sha256').update('test').digest('hex') }, body: 'test' });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ sequence: 0, bytes: 4 });
      const sealUrl = `${base}/api/discussions/${created.discussion.id}/capture/seal`;
      expect((await fetch(sealUrl, { method: 'POST' })).status).toBe(401);
      expect((await fetch(sealUrl, { method: 'POST', headers: { authorization: 'Bearer meeting-test', 'x-test-read-only': '1' } })).status).toBe(403);
      const sealed = await fetch(sealUrl, { method: 'POST', headers: { authorization: 'Bearer meeting-test', 'content-type': 'application/json' }, body: JSON.stringify({ chunkCount: 1, mimeType: 'audio/wav', fileName: 'meeting.wav', lastSequence: -1, containerMode: 'independent_wav' }) });
      expect(sealed.status).toBe(202);
      const job = await sealed.json() as { id: string };
      const jobUrl = `${base}/api/discussions/${created.discussion.id}/recording/job`;
      expect((await fetch(jobUrl)).status).toBe(401);
      expect((await fetch(jobUrl, { headers: { authorization: 'Bearer meeting-test', 'x-test-read-only': '1' } })).status).toBe(200);
      expect(await (await fetch(jobUrl, { headers: { authorization: 'Bearer meeting-test' } })).json()).toMatchObject({ id: job.id, state: 'queued' });
      await service.cancel(created.discussion.id);
      const playable = await create('http-playback');
      await uploadRecording(playable.discussion.id, { name: 'meeting.wav', buffer: Buffer.from('audio'), mimeType: 'audio/wav' }, 2_000);
      const audioUrl = `${base}/api/discussions/${playable.discussion.id}/audio`;
      expect((await fetch(audioUrl)).status).toBe(401);
      const partial = await fetch(audioUrl, { headers: { authorization: 'Bearer meeting-test', range: 'bytes=0-3' } });
      expect(partial.status).toBe(206);
      expect(await partial.text()).toBe('RIFF');
      const invalid = await fetch(audioUrl, { headers: { authorization: 'Bearer meeting-test', range: 'bytes=999999999-' } });
      expect(invalid.status).toBe(416);
      const exported = await fetch(`${base}/api/discussions/${playable.discussion.id}/export?format=txt`, { headers: { authorization: 'Bearer meeting-test' } });
      expect(exported.status).toBe(200);

    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      resetLazyRouteBundlesForTests();
    }
  });

  it.skipIf(process.env.XOPC_MEETING_LONG_SMOKE !== '1')('ingests a two-hour recording with bounded chunks and verifies the decoded duration', async () => {
    const source = join(stateDir, 'two-hour.wav');
    const generated = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '7200', '-c:a', 'pcm_s16le', source], { timeout: 30_000 });
    expect(generated.status).toBe(0);
    const capture = await create('two-hour');
    const file = await open(source, 'r');
    let sequence = 0;
    try {
      while (true) {
        const chunk = Buffer.alloc(8 * 1024 * 1024);
        const { bytesRead } = await file.read(chunk);
        if (!bytesRead) break;
        const bytes = chunk.subarray(0, bytesRead);
        await service.uploadRecordingChunk(capture.discussion.id, sequence++, createHash('sha256').update(bytes).digest('hex'), new Blob([bytes]).stream());
      }
    } finally { await file.close(); }
    const result = await finalizeRecording(service, capture.discussion.id, { chunkCount: sequence, mimeType: 'audio/wav', fileName: 'two-hour.wav' });
    expect(result.discussion.durationMs).toBe(7_200_000);
    expect(result.discussion.audioSizeBytes).toBeGreaterThan(200_000_000);
    expect(service.recordingChunks(capture.discussion.id)).toEqual([]);
  }, 60_000);

  it('persists chunks across service reconstruction and rejects missing or changed content', async () => {
    const created = await create('durable');
    const buffer = Buffer.from('partial');
    const hash = createHash('sha256').update(buffer).digest('hex');
    await service.uploadRecordingChunk(created.discussion.id, 0, hash, new Blob([buffer]).stream());
    const restored = new DiscussionService(notes, projects);
    expect(restored.recordingChunks(created.discussion.id)).toEqual([{ sequence: 0, sha256: hash, bytes: buffer.length }]);
    await expect(restored.uploadRecordingChunk(created.discussion.id, 0, 'a'.repeat(64), new Blob([buffer]).stream())).rejects.toThrow('different audio');
    await expect(restored.sealRecording(created.discussion.id, { chunkCount: 2, mimeType: 'audio/wav', fileName: 'x.wav', lastSequence: -1 })).rejects.toThrow('missing chunks');
    await restored.cancel(created.discussion.id);
    expect(restored.recordingChunks(created.discussion.id)).toEqual([]);
    await expect(restored.uploadRecordingChunk(created.discussion.id, 1, hash, new Blob([buffer]).stream())).rejects.toThrow('no longer accepts');
  });

  it('recovers an expired finalization lease and fences the previous owner', async () => {
    const created = await create('job-restart');
    const id = created.discussion.id;
    const buffer = Buffer.from('invalid media');
    await service.uploadRecordingChunk(id, 0, createHash('sha256').update(buffer).digest('hex'), new Blob([buffer]).stream());
    const manifest = { chunkCount: 1, mimeType: 'audio/wav', fileName: 'meeting.wav', lastSequence: -1 };
    const job = await service.sealRecording(id, manifest);
    expect((await service.sealRecording(id, manifest)).id).toBe(job.id);
    await expect(service.sealRecording(id, { ...manifest, fileName: 'other.wav' })).rejects.toThrow('manifest differs');
    expect(claimRecordingJob('dead-worker')?.id).toBe(job.id);
    expect(claimRecordingJob('second-worker')).toBeNull();
    getSqliteDatabase().prepare('UPDATE discussion_recording_jobs SET lease_until=0 WHERE id=?').run(job.id);
    const restored = new DiscussionService(notes, projects);
    await restored.processRecordingJob();
    expect(restored.recordingJob(id)?.state).toBe('failed');
    expect((await restored.get(id))?.discussion.status).toBe('needs_attention');
    expect(finishRecordingJob(job.id, 'dead-worker')).toBe(false);
    expect(restored.recordingChunks(id)).toHaveLength(1);
    await restored.retry(id);
    expect(restored.recordingJob(id)).toMatchObject({ id: job.id, state: 'queued' });
    await restored.cancel(id);
    expect(restored.recordingJob(id)?.state).toBe('cancelled');
    expect(claimRecordingJob('third-worker')).toBeNull();
  });

  it('recovers the job commit after the saved recording has already advanced to organization', async () => {
    const created = await create('job-commit');
    await uploadRecording(created.discussion.id, null, 2_000);
    const job = service.recordingJob(created.discussion.id)!;
    getSqliteDatabase().prepare("UPDATE discussion_recording_jobs SET state='running', lease_owner='dead-worker', lease_until=0 WHERE id=?").run(job.id);
    updateDiscussionCapture(created.discussion.id, { status: 'organizing' });
    await new DiscussionService(notes, projects).processRecordingJob();
    expect(service.recordingJob(created.discussion.id)?.state).toBe('completed');
    expect((await service.get(created.discussion.id))?.discussion.status).toBe('organizing');
  });

  it('does not publish a recording when cancellation races attachment persistence', async () => {
    const created = await create('cancel-finalization');
    const id = created.discussion.id;
    await uploadRecording(id, null, 2_000, false);
    await service.sealRecording(id, { chunkCount: 1, mimeType: 'audio/wav', fileName: 'meeting.wav', lastSequence: -1 });
    let reachedAttachment!: () => void;
    let releaseAttachment!: () => void;
    const reached = new Promise<void>(resolve => { reachedAttachment = resolve; });
    const release = new Promise<void>(resolve => { releaseAttachment = resolve; });
    const add = notes.addAttachment.bind(notes);
    const spy = vi.spyOn(notes, 'addAttachment').mockImplementationOnce(async (...args) => {
      reachedAttachment();
      await release;
      return add(...args);
    });
    try {
      const processing = service.processRecordingJob();
      await reached;
      const cancelling = service.cancel(id);
      releaseAttachment();
      await processing;
      await cancelling;
      expect(service.recordingJob(id)?.state).toBe('cancelled');
      const capture = (await service.get(id))!.discussion;
      expect(capture.status).toBe('cancelled');
      expect(capture.audioAttachmentId).toBeUndefined();
      expect(service.recordingChunks(id)).toEqual([]);
    } finally { releaseAttachment(); spy.mockRestore(); }
  });

  it('continues into transcript processing after the submitting client disconnects', async () => {
    const created = await create('close-after-seal');
    const id = created.discussion.id;
    await uploadRecording(id, null, 2_000, false);
    await service.sealRecording(id, { chunkCount: 1, mimeType: 'audio/wav', fileName: 'meeting.wav', lastSequence: -1 });
    const restored = new DiscussionService(notes, projects);
    const sealer = new DiscussionSealer({
      notes, getConfig: () => ({}) as never,
      processRecordingJob: () => restored.processRecordingJob(),
      transcribeRecording: async () => ({ text: 'The decision remains available after closing the tab.' }),
    });
    await sealer.tick();
    expect((await restored.get(id))?.discussion).toMatchObject({ status: 'organizing', canonicalTranscript: 'The decision remains available after closing the tab.' });
    expect(restored.recordingJob(id)?.state).toBe('completed');
  });

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
    expect(first.transcript).toMatchObject({ revision: 0, text: '', segments: expect.any(Array) });
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
    expect(service.metrics()).toMatchObject({
      totalSegments: 3,
      failedSegments: 0,
      retriedSegments: 0,
      averageSegmentLatencyMs: expect.any(Number),
    });
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

    await uploadRecording(created.discussion.id, {
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
          title: 'Friday release', summary: 'Ship Friday.', keyPoints: [], decisions: [{ id: 'ship', text: 'Ship Friday.', evidenceSegmentIds: [0] }],
          actionItems: [], risks: [], openQuestions: [], chapters: [],
        },
      }),
    });
    const organizerWorker = new DiscussionOrganizerWorker(organizer);
    await organizerWorker.tick();

    const completed = await service.get(created.discussion.id);
    expect(completed?.discussion.status).toBe('completed');
    expect(completed?.organization?.organization?.decisions).toEqual([expect.objectContaining({ text: 'Ship Friday.' })]);
    const completedNote = await notes.getNote(created.note.id);
    expect(completedNote?.markdown).toBe('My own notes');
    expect(completedNote?.attachments).toEqual([
      expect.objectContaining({
        id: completed?.discussion.audioAttachmentId,
        type: 'audio',
        retainWithoutReference: true,
      }),
    ]);
    const retainedRecording = await notes.getAttachmentPath(
      created.note.id,
      completed!.discussion.audioAttachmentId!,
    );
    expect((await readFile(retainedRecording!.filePath)).subarray(0, 4).toString()).toBe('RIFF');
    const originalRevision = completed!.organization!.transcriptRevision;
    const segment = service.transcript(created.discussion.id)!.segments[0]!;
    service.correctSegment(created.discussion.id, 0, 'Updated decision', segment.revision);
    expect(service.transcript(created.discussion.id, originalRevision)!.text).toContain('ship Friday');
  });

  it('uses full recording only when live segments are incomplete', async () => {
    const created = await create('fallback');
    await uploadRecording(created.discussion.id, {
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
    const lateSegment = uploadSegment(created.discussion.id, 0, 'late live segment');
    expect(lateSegment).toMatchObject({ text: 'Recovered from full recording.', segments: expect.any(Array) });
  });

  it('requires attention when the original recording never arrives', async () => {
    const created = await create('missing-audio');
    const stopped = updateDiscussionCapture(created.discussion.id, { status: 'stopping', recordingStoppedAt: Date.now(), durationMs: 5_000 });
    const sealer = new DiscussionSealer({ notes, getConfig: () => ({}) as never });
    const firstStoppedAt = stopped!.recordingStoppedAt!;
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
    await uploadRecording(created.discussion.id, {
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
