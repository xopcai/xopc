import { getDiscussionCapture } from '../repository.js';
import { chapterScope, saveReviewChapter, unionReviewRanges } from '../long-review.js';
import { createProcessingRun, saveCheckpoint } from '../processing.js';
import { applyMeetingEdits } from '../edits.js';
import { updateDiscussionCapture } from '../repository.js';
import { convertMeetingAction, meetingActionTasks } from '../action-tasks.js';
import { createDiscussionOrganization, completeDiscussionOrganization } from '../repository.js';
import { saveTranscriptRevision, replaceTranscriptSegments } from '../revisions.js';
import { claimRecordingJob, finishRecordingJob, getRecordingJobInput } from '../recordingJobs.js';
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
import { assertProviderUsage, getModelUsageOrigin, withModelUsageOrigin } from '../../providers/model-usage.js';
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

  it('exposes durable partial chapters and checkpoint text without replacing published evidence, and survives reopening', async () => {
    const created = await create('long-partial'); const id = created.discussion.id;
    await uploadRecording(id,undefined,6000);
    replaceTranscriptSegments(id,[{ text: 'Original searchable words',startedAtMs: 0,endedAtMs: 1000 },{ text: 'Tail decision',startedAtMs: 4000,endedAtMs: 5000 }]);
    const capture = getDiscussionCapture(id)!;
    const run = createProcessingRun(capture,true);
    saveCheckpoint(run.run_id,0,2000,{ segments: [{ text: 'New partial words',startedAtMs: 0,endedAtMs: 2000 }] });
    saveCheckpoint(run.run_id,3000,4000,{ segments: [{ text: 'Recovered after gap',startedAtMs: 3000,endedAtMs: 4000 }] });
    updateDiscussionCapture(id,{ status: 'sealing' });
    let review = await service.review(id);
    expect(review.coverage).toMatchObject({ processedMs: 3000,continuousThroughMs: 2000,complete: false });
    expect(review.hits.map(hit => hit.text)).toEqual(['New partial words','Recovered after gap']);
    expect(review.hits[0]).toMatchObject({ provisional: true,playback: [{ startedAtMs: 0,endedAtMs: 6000 }] });
    expect(service.transcript(id)!.segments[0]!.displayText).toBe('Original searchable words');
    expect((await service.review(id,{ query: 'partial' })).hits[0]!.id).toContain(run.run_id);
    const scope = chapterScope(id);
    const chapter = { title: 'Chapter',summary: 'A partial analysis',keyPoints: [],decisions: [],risks: [],openQuestions: [],actionItems: [],chapters: [{ title: 'Chapter',summary: 'A partial analysis',startedAtMs: 0,endedAtMs: 1000 }] };
    saveReviewChapter(id,'hash',0,chapter,scope);
    closeXopcDatabase(); openXopcDatabase({ path: join(stateDir,'xopc.db') });
    review = await service.review(id);
    expect(review.chapters[0]).toMatchObject({ provisional: true,startedAtMs: 0,endedAtMs: 1000 });
    expect(review.coverage.analysisRanges).toEqual([{ startedAtMs: 0,endedAtMs: 1000 }]);
    updateDiscussionCapture(id,{ transcriptRevision: capture.transcriptRevision + 1 });
    saveReviewChapter(id,'stale',1,chapter,scope);
    expect((await service.review(id)).chapters).toHaveLength(0);
  });

  it('searches a two-hour transcript tail and all review sources with stable pagination, historical references and literal keywords', async () => {
    const created = await create('long-search'); const id = created.discussion.id;
    updateDiscussionCapture(id,{ durationMs: 7200000,status: 'completed' });
    replaceTranscriptSegments(id,Array.from({ length: 1200 },(_,index) => ({ text: index === 1199 ? 'TARGET literal [a.*] 全角ＡＢＣ' : `context ${index}`,startedAtMs: index * 6000,endedAtMs: (index+1)*6000 })));
    const revision = service.transcript(id)!.revision;
    const record = createDiscussionOrganization({ discussionId: id,transcriptRevision: revision,inputTranscriptSha256: 'hash',promptVersion: 'test',modelRef: 'test' });
    completeDiscussionOrganization(record.id,{ title: 'Meeting',summary: 'TARGET overview',keyPoints: [],decisions: [{ id: 'decision',text: 'TARGET decision',evidenceSegmentIds: [1199] }],risks: [],openQuestions: [],actionItems: [],chapters: [{ title: 'TARGET chapter',summary: 'Ending',startedAtMs: 7140000,endedAtMs: 7200000 }] });
    service.saveAnnotation(id,{ id: 'target',kind: 'highlight',text: 'TARGET personal context',anchor: { type: 'transcript',capturedAt: 1,transcriptRevision: revision,segmentIds: [1199] },expectedRevision: 0 });
    const first = await service.review(id,{ query: 'target',limit: 2 });
    expect(first.total).toBe(5); expect(first.hasMore).toBe(true);
    expect(first.hits[0]).toMatchObject({ kind: 'transcript',startedAtMs: 7194000 });
    expect(first.hits[0]!.segments.map(s => s.text)).toContain('context 1198');
    const second = await service.review(id,{ query: 'target',offset: 2,limit: 3,version: first.version });
    expect(second.hits.map(h => h.kind)).toEqual(['analysis','analysis','annotation']);
    expect((await service.review(id,{ query: '[a.*]' })).total).toBeGreaterThan(0);
    expect((await service.review(id,{ query: 'abc' })).hits.some(h => h.kind === 'transcript')).toBe(true);
    await expect(service.review(id,{ query: 'x'.repeat(201) })).rejects.toThrow('Invalid review');
    service.correctSegment(id,1199,'Corrected tail',service.transcript(id)!.segments[1199]!.revision);
    await expect(service.review(id,{ query: 'target',version: first.version })).rejects.toThrow('restart search');
    const historical = await service.review(id,{ query: 'TARGET decision' });
    expect(historical.hits[0]).toMatchObject({ stale: true,transcriptRevision: revision });
    expect(historical.hits[0]!.segments[0]!.text).toContain('TARGET literal');
    expect(historical.coverage.analysisStale).toBe(true);
    expect(historical.coverage.analysisRanges).toEqual([]);
  });

  it('unions overlapping coverage without counting gaps or invalid intervals', () => {
    expect(unionReviewRanges([{ startedAtMs: 0,endedAtMs: 10 },{ startedAtMs: 5,endedAtMs: 20 },{ startedAtMs: 30,endedAtMs: 100 },{ startedAtMs: NaN,endedAtMs: 40 }],50)).toEqual([{ startedAtMs: 0,endedAtMs: 20 },{ startedAtMs: 30,endedAtMs: 50 }]);
  });

  it('persists highlights idempotently, fences stale edits and keeps evidence on its original transcript revision', async () => {
    const created = await create('annotations'); const id = created.discussion.id;
    await uploadRecording(id, undefined, 5000);
    replaceTranscriptSegments(id,[{ text: 'Original decision',startedAtMs: 0,endedAtMs: 2000 },{ text: 'Next action',startedAtMs: 2000,endedAtMs: 5000 }]);
    const transcript = service.transcript(id)!;
    const input = { id: 'highlight',kind: 'highlight' as const,text: 'My interpretation',anchor: { type: 'transcript' as const,capturedAt: 1,transcriptRevision: transcript.revision,segmentIds: [0] },expectedRevision: 0 };
    const saved = service.saveAnnotation(id,input);
    expect(service.saveAnnotation(id,input)).toEqual(saved);
    expect(() => service.saveAnnotation(id,{ ...input,text: 'Stale edit' })).toThrow('changed');
    expect(() => service.saveAnnotation(id,{ ...input,expectedRevision: saved.revision,anchor: { ...input.anchor,segmentIds: [1] } })).toThrow('immutable');
    service.correctSegment(id,0,'Corrected decision',transcript.segments[0]!.revision);
    const resolved = (await service.annotations(id))[0]!;
    expect(resolved.evidence).toMatchObject({ stale: true,transcriptRevision: transcript.revision,audioAvailable: true });
    expect(resolved.evidence!.segments[0]!.text).toBe('Original decision');
    expect(resolved.playback).toEqual([{ startedAtMs: 0,endedAtMs: 2000 }]);
    const removed = service.saveAnnotation(id,{ ...input,expectedRevision: saved.revision,deleted: true });
    expect(service.saveAnnotation(id,{ ...input,expectedRevision: saved.revision,deleted: true })).toEqual(removed);
    expect(() => service.saveAnnotation(id,input)).toThrow('changed');
    expect((await service.annotations(id))[0]!.annotation.deleted).toBe(true);
  });

  it('never snaps an unsaved mark to nearby text and retains readable evidence after audio deletion', async () => {
    const created = await create('missing-marker-audio'); const id = created.discussion.id;
    await uploadRecording(id,undefined,2000);
    replaceTranscriptSegments(id,[{ text: 'Saved text',startedAtMs: 0,endedAtMs: 2000 }]);
    for (const [name,position] of [['saved',1000],['missing',3000]] as const) service.saveAnnotation(id,{ id: name,kind: 'highlight',text: '',anchor: { type: 'time',capturedAt: 1,positionMs: position },expectedRevision: 0 });
    const marks = await service.annotations(id);
    expect(marks.find(row => row.annotation.id === 'saved')?.state).toBe('located');
    expect(marks.find(row => row.annotation.id === 'missing')).toMatchObject({ state: 'unavailable',playback: [] });
    const revision = service.transcript(id)!.revision;
    updateDiscussionCapture(id,{ status: 'needs_attention' }); await service.deleteAudio(id);
    const evidence = await service.evidence(id,revision,[0]);
    expect(evidence).toMatchObject({ audioAvailable: false,timingVerified: false });
    expect(evidence.segments[0]).toMatchObject({ text: 'Saved text',playback: [] });
    expect(await service.annotations(id)).toHaveLength(2);
  });

  it('generates bounded native clips without changing the original source', async () => {
    const created = await create('native-clip'); await uploadRecording(created.discussion.id,undefined,2000);
    const before = (await service.get(created.discussion.id))!.discussion.audioSha256;
    const clip = await service.audioClip(created.discussion.id,500,1500,new AbortController().signal);
    expect(clip.toString('ascii',0,4)).toBe('RIFF'); expect(clip.length).toBeGreaterThan(32000); expect(clip.length).toBeLessThan(33000);
    await expect(service.audioClip(created.discussion.id,0,121000,new AbortController().signal)).rejects.toThrow('120 seconds');
    expect((await service.get(created.discussion.id))!.discussion.audioSha256).toBe(before);
  });

  it('keeps resumed WebM originals independent and seals them into the same Note idempotently', async () => {
    const created = await create('resumed-webm');
    const audio = (frequency: number) => {
      const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=1.2`, '-c:a', 'libopus', '-f', 'webm', 'pipe:1']);
      if (result.status !== 0) throw new Error(String(result.stderr));
      return result.stdout;
    };
    const originals = [audio(440), audio(880)];
    for (const [sequence, buffer] of originals.entries()) {
      await service.uploadRecordingChunk(created.discussion.id, sequence, createHash('sha256').update(buffer).digest('hex'), new Blob([buffer]).stream());
    }
    const manifest = { chunkCount: 2, mimeType: 'audio/webm', fileName: 'resumed.webm', lastSequence: -1,
      epochs: [{ firstChunk: 0, mimeType: 'audio/webm', startedAt: 1000 }, { firstChunk: 1, mimeType: 'audio/webm', startedAt: 9000, previousEndedAt: 2200 }] };
    await expect(service.sealRecording(created.discussion.id, { ...manifest, epochs: [{ ...manifest.epochs[0]!, firstChunk: 1 }, manifest.epochs[1]!] })).rejects.toThrow('Invalid recording epochs');
    const submitted = await service.sealRecording(created.discussion.id, manifest);
    expect(await service.sealRecording(created.discussion.id, manifest)).toEqual(submitted);
    await expect(service.sealRecording(created.discussion.id, { ...manifest, epochs: manifest.epochs.map(epoch => ({ ...epoch, startedAt: 42 })) })).rejects.toThrow('manifest differs');
    const add = notes.addAttachment.bind(notes); let additions = 0;
    const failOnce = vi.spyOn(notes, 'addAttachment').mockImplementation(async (...args) => {
      if (++additions === 2) throw new Error('DISK_WRITE_INTERRUPTED');
      return add(...args);
    });
    await service.processRecordingJob();
    expect(service.recordingJob(created.discussion.id)?.state).toBe('failed');
    expect(service.recordingChunks(created.discussion.id)).toHaveLength(2);
    failOnce.mockRestore();
    await service.sealRecording(created.discussion.id, manifest);
    await service.processRecordingJob();
    expect(service.recordingJob(created.discussion.id)?.state).toBe('completed');
    const recovered = await service.get(created.discussion.id);
    expect(recovered?.note.id).toBe(created.note.id);
    expect(recovered?.discussion.mimeType).toBe('audio/wav');
    expect(recovered?.discussion.durationMs).toBeGreaterThanOrEqual(2400);
    const current = await notes.getNote(created.note.id);
    const sources = current!.attachments.filter(attachment => attachment.fileName.startsWith('recording-part-'));
    expect(sources).toHaveLength(2);
    for (const [index, attachment] of sources.entries()) {
      const source = await notes.getAttachmentPath(created.note.id, attachment.id);
      expect(await readFile(source!.filePath)).toEqual(originals[index]);
    }
    expect(current!.attachments.filter(attachment => attachment.fileName === `recording-sources-${created.discussion.id}.json`)).toHaveLength(1);
    expect((await create('resumed-webm')).note.id).toBe(created.note.id);
    expect(service.list().total).toBe(1);
    updateDiscussionCapture(created.discussion.id, { status: 'needs_attention' });
    await service.deleteAudio(created.discussion.id);
    expect((await notes.getNote(created.note.id))!.attachments).toHaveLength(0);
  });

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
      const resumed = await create('http-resumed');
      for (const sequence of [0, 1]) await service.uploadRecordingChunk(resumed.discussion.id, sequence, createHash('sha256').update('test').digest('hex'), new Blob(['test']).stream());
      const epochs = [{ firstChunk: 0, mimeType: 'audio/webm', startedAt: 1000 }, { firstChunk: 1, mimeType: 'audio/webm', startedAt: 9000, previousEndedAt: 2000 }];
      const epochResponse = await fetch(`${base}/api/discussions/${resumed.discussion.id}/capture/seal`, { method: 'POST', headers: { authorization: 'Bearer meeting-test', 'content-type': 'application/json' }, body: JSON.stringify({ chunkCount: 2, mimeType: 'audio/webm', fileName: 'meeting.webm', lastSequence: -1, epochs }) });
      expect(epochResponse.status).toBe(202); expect(getRecordingJobInput(resumed.discussion.id)?.epochs).toEqual(epochs);
      await service.cancel(resumed.discussion.id);
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
      replaceTranscriptSegments(playable.discussion.id,[{ text: 'HTTP source',startedAtMs: 0,endedAtMs: 2000 }]);
      const evidenceRevision = service.transcript(playable.discussion.id)!.revision;
      const annotationsUrl = `${base}/api/discussions/${playable.discussion.id}/annotations`;
      expect((await fetch(annotationsUrl)).status).toBe(401);
      const annotationBody = JSON.stringify({ kind: 'highlight',text: 'HTTP context',expectedRevision: 0,anchor: { type: 'transcript',capturedAt: 1,transcriptRevision: evidenceRevision,segmentIds: [0] } });
      expect((await fetch(annotationsUrl + '/http-mark',{ method: 'PUT',headers: { authorization: 'Bearer meeting-test','content-type': 'application/json','x-test-read-only': '1' },body: annotationBody })).status).toBe(403);
      expect((await fetch(annotationsUrl + '/http-mark',{ method: 'PUT',headers: { authorization: 'Bearer meeting-test','content-type': 'application/json' },body: annotationBody })).status).toBe(200);
      const evidenceUrl = `${base}/api/discussions/${playable.discussion.id}/evidence?revision=${evidenceRevision}&segments=0`;
      expect((await fetch(evidenceUrl)).status).toBe(401);
      const evidenceResponse = await fetch(evidenceUrl,{ headers: { authorization: 'Bearer meeting-test' } }); expect(evidenceResponse.status).toBe(200);
      const reviewUrl = `${base}/api/discussions/${playable.discussion.id}/review?q=HTTP`;
      expect((await fetch(reviewUrl)).status).toBe(401);
      const reviewResponse = await fetch(reviewUrl,{ headers: { authorization: 'Bearer meeting-test','x-test-read-only': '1' } });
      expect(reviewResponse.status).toBe(200);
      expect(await reviewResponse.json()).toMatchObject({ query: 'HTTP',hits: expect.arrayContaining([expect.objectContaining({ kind: 'annotation' })]) });
      expect((await fetch(`${reviewUrl}&limit=51`,{ headers: { authorization: 'Bearer meeting-test' } })).status).toBe(400);

      expect(await evidenceResponse.json()).toMatchObject({ transcriptRevision: evidenceRevision,audioAvailable: true });
      const clipUrl = `${base}/api/discussions/${playable.discussion.id}/audio-clip?startMs=0&endMs=1000`;
      expect((await fetch(clipUrl)).status).toBe(401);
      expect((await fetch(clipUrl,{ headers: { authorization: 'Bearer meeting-test' } })).status).toBe(200);
      const retryUrl = `${base}/api/discussions/${playable.discussion.id}/retry`;
      updateDiscussionCapture(playable.discussion.id, { status: 'completed' });
      const retryBody = JSON.stringify({ mode: 'from_audio' });
      expect((await fetch(retryUrl, { method: 'POST', body: retryBody })).status).toBe(401);
      expect((await fetch(retryUrl, { method: 'POST', headers: { authorization: 'Bearer meeting-test', 'x-test-read-only': '1', 'content-type': 'application/json' }, body: retryBody })).status).toBe(403);
      expect((await fetch(retryUrl, { method: 'POST', headers: { authorization: 'Bearer meeting-test', 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'unknown' }) })).status).toBe(400);
      const regenerated = await fetch(retryUrl, { method: 'POST', headers: { authorization: 'Bearer meeting-test', 'content-type': 'application/json' }, body: retryBody });
      expect(regenerated.status).toBe(200);
      expect(await regenerated.json()).toMatchObject({ discussion: { id: playable.discussion.id, status: 'sealing', audioAttachmentId: expect.any(String) }, processing: { fromAudio: true } });
      expect((await fetch(audioUrl, { headers: { authorization: 'Bearer meeting-test', range: 'bytes=0-3' } })).status).toBe(206);


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

  it.each(['live', 'saved'] as const)('retains the user origin for %s recording transcription after dispatch', async mode => {
    const created = await create(`scope-${mode}`);
    const recognize = vi.fn(async () => {
      expect(getModelUsageOrigin()).toBe('interactive');
      assertProviderUsage('qwen-token-plan-cn');
      return { text: 'Recording recognized.', provider: 'qwen-token-plan-cn' };
    });
    if (mode === 'live') {
      uploadSegment(created.discussion.id, 0, 'audio');
      await new DiscussionLiveWorker({ notes, projects, getConfig: () => ({}) as never, transcribeSegment: recognize }).tick();
      expect(service.transcript(created.discussion.id)?.segments[0]?.status).toBe('confirmed');
    } else {
      await uploadRecording(created.discussion.id, null, 2_000);
      await new DiscussionSealer({ notes, getConfig: () => ({}) as never, transcribeRecording: recognize }).tick();
      expect((await service.get(created.discussion.id))?.discussion.canonicalTranscript).toBe('Recording recognized.');
    }
    expect(recognize).toHaveBeenCalledOnce();
    expect(getModelUsageOrigin()).toBe('unknown');
    expect(() => assertProviderUsage('qwen-token-plan-cn')).toThrow('provider_usage_scope_denied');
  });

  it.each(['live', 'saved'] as const)('does not upgrade explicit background callers in %s recording transcription', async mode => {
    const created = await create(`background-${mode}`);
    const recognize = vi.fn(async () => {
      expect(getModelUsageOrigin()).toBe('background');
      assertProviderUsage('qwen-token-plan-cn');
      return { text: 'Must not publish', provider: 'qwen-token-plan-cn' };
    });
    if (mode === 'live') {
      uploadSegment(created.discussion.id, 0, 'audio');
      await withModelUsageOrigin('background', () => new DiscussionLiveWorker({ notes, projects, getConfig: () => ({}) as never, transcribeSegment: recognize }).tick());
      expect(service.transcript(created.discussion.id)?.segments[0]?.status).not.toBe('confirmed');
    } else {
      await uploadRecording(created.discussion.id, null, 2_000);
      await withModelUsageOrigin('background', () => new DiscussionSealer({ notes, getConfig: () => ({}) as never, transcribeRecording: recognize }).tick());
      expect((await service.get(created.discussion.id))?.discussion.canonicalTranscript).toBeUndefined();
    }
    expect(recognize).toHaveBeenCalledOnce();
    expect(getModelUsageOrigin()).toBe('unknown');
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
