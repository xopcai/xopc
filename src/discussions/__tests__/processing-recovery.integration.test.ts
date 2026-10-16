import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotesService, NotesStore } from '../../notes/index.js';
import { ProjectService } from '../../projects/index.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { decodeWavToMonoFloat32 } from '../../voice/audio/wav.js';
import type { STTResult } from '../../voice/stt/types.js';
import { DiscussionOrganizer } from '../organizer.js';
import { DiscussionOrganizerWorker } from '../organizer-worker.js';
import { getProcessingRun, processingProgress } from '../processing.js';
import { createDiscussionOrganization, completeDiscussionOrganization, getDiscussionCapture, updateDiscussionCapture } from '../repository.js';
import { readTranscriptRevision, replaceTranscriptSegments, refreshCanonicalTranscript } from '../revisions.js';
import { DiscussionSealer } from '../sealer.js';
import { DiscussionService } from '../service.js';
import type { DiscussionOrganization } from '../types.js';

const modelMocks = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('../../providers/model-call.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../providers/model-call.js')>(), completeWithResolvedCredentials: modelMocks.complete,
}));
vi.mock('../../config/schema.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../config/schema.js')>(), getAgentDefaultModelRef: () => 'test/model',
}));
vi.mock('../../providers/index.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../providers/index.js')>(), resolveModel: () => ({ id: 'model', provider: 'test' }),
}));

const unavailable = () => Object.assign(new Error('Provider temporarily unavailable'), { status: 503 });
const recognized = (text: string): STTResult => ({ text, provider: 'test', language: 'zh' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function wav(durationMs: number) {
  const buffer = Buffer.alloc(44 + durationMs * 32);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer;
}
const organization = (summary: string): DiscussionOrganization => ({ title: 'Meeting', summary, keyPoints: [], decisions: [], risks: [], actionItems: [], openQuestions: [], chapters: [] });

describe('saved original to Note recovery', () => {
  let directory: string;
  let previousStateDir: string | undefined;
  let notes: NotesService;
  let projects: ProjectService;
  let service: DiscussionService;
  beforeEach(async () => {
    modelMocks.complete.mockReset();
    directory = mkdtempSync(join(tmpdir(), 'xopc-processing-recovery-'));
    previousStateDir = process.env.XOPC_STATE_DIR; process.env.XOPC_STATE_DIR = directory;
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'xopc.db') });
    notes = new NotesService(new NotesStore()); await notes.initialize(); projects = new ProjectService();
    service = new DiscussionService(notes, projects); service.acknowledgeConsent(service.settings().consentPolicyVersion);
  });
  afterEach(() => {
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR; else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(directory, { recursive: true, force: true });
  });
  async function recording(durationMs = 45_000) {
    const detail = await service.create({ clientRequestId: crypto.randomUUID(), source: 'web', consentPolicyVersion: service.settings().consentPolicyVersion });
    const buffer = wav(durationMs);
    await service.uploadRecordingChunk(detail.discussion.id, 0, createHash('sha256').update(buffer).digest('hex'), new Blob([buffer]).stream());
    await service.sealRecording(detail.discussion.id, { chunkCount: 1, mimeType: 'audio/wav', fileName: 'original.wav', lastSequence: -1 });
    await service.processRecordingJob();
    return (await service.get(detail.discussion.id))!;
  }
  const sealer = (transcribeSegment: (buffer: Buffer, signal: AbortSignal) => Promise<STTResult>, requestTimeoutMs?: number) =>
    new DiscussionSealer({ notes, getConfig: () => ({}) as never, transcribeSegment, requestTimeoutMs });
  async function nextTick(worker: DiscussionSealer, id: string) {
    await worker.tick((processingProgress(id)?.nextAttemptAt ?? Date.now()) + 1);
  }

  it('commits each successful audio range and resumes from SQLite after a later range fails and the gateway restarts', async () => {
    const detail = await recording(); const id = detail.discussion.id;
    const provider = vi.fn().mockResolvedValueOnce(recognized('First section')).mockRejectedValueOnce(unavailable());
    await sealer(provider).tick();
    expect(processingProgress(id)).toMatchObject({ completedChunks: 1, attemptCount: 1, transcribedMs: 20_000 });
    expect(getDiscussionCapture(id)?.status).toBe('sealing');
    expect(service.transcript(id)?.segments).toEqual([]);
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'xopc.db') });
    service = new DiscussionService(notes, projects);
    const resumedProvider = vi.fn().mockResolvedValueOnce(recognized('Second section')).mockResolvedValueOnce(recognized('Third section'));
    await nextTick(sealer(resumedProvider), id);
    expect(resumedProvider).toHaveBeenCalledTimes(2);
    expect(getDiscussionCapture(id)).toMatchObject({ status: 'organizing', canonicalTranscript: 'First section\nSecond section\nThird section' });
    expect((await service.get(id))?.discussion.audioAttachmentId).toBe(detail.discussion.audioAttachmentId);
  });

  it('does not call the provider before persisted backoff expires and exhausts automatic attempts without deleting audio', async () => {
    const detail = await recording(2_000); const id = detail.discussion.id;
    const provider = vi.fn().mockRejectedValue(unavailable()); const worker = sealer(provider);
    await worker.tick(); await worker.tick(); expect(provider).toHaveBeenCalledTimes(1);
    await nextTick(worker, id); await nextTick(worker, id);
    expect(provider).toHaveBeenCalledTimes(3);
    expect(getDiscussionCapture(id)).toMatchObject({ status: 'needs_attention', failureStage: 'transcript_sealing', audioAttachmentId: detail.discussion.audioAttachmentId });
    await worker.tick(); expect(provider).toHaveBeenCalledTimes(3);
    await service.retry(id); provider.mockResolvedValue(recognized('Recovered'));
    await worker.tick(); expect(getDiscussionCapture(id)?.canonicalTranscript).toBe('Recovered');
  });

  it('fails authentication immediately instead of retrying an invalid credential', async () => {
    const detail = await recording(2_000);
    const provider = vi.fn().mockRejectedValue(Object.assign(new Error('Invalid API key'), { status: 401 }));
    await sealer(provider).tick(); expect(getDiscussionCapture(detail.discussion.id)?.status).toBe('needs_attention');
    expect(processingProgress(detail.discussion.id)?.nextAttemptAt).toBeUndefined();
  });

  it('regenerates machine text from saved audio while retaining old results, human corrections, note Markdown and summary edits', async () => {
    const detail = await recording(); const id = detail.discussion.id;
    replaceTranscriptSegments(id, [
      { text: 'Old machine first', startedAtMs: 0, endedAtMs: 20_000 },
      { text: 'Old machine middle', startedAtMs: 20_000, endedAtMs: 40_000 },
      { text: 'Old machine final', startedAtMs: 40_000, endedAtMs: 45_000 },
    ]);
    refreshCanonicalTranscript(id); updateDiscussionCapture(id, { status: 'completed', completedAt: Date.now() });
    service.correctSegment(id, 1, 'My corrected words', 1, 'Alice');
    const sourceRevision = getDiscussionCapture(id)!.transcriptRevision;
    const record = createDiscussionOrganization({ discussionId: id, transcriptRevision: sourceRevision,
      inputTranscriptSha256: getDiscussionCapture(id)!.canonicalTranscriptSha256!, promptVersion: 'test', modelRef: 'test' });
    completeDiscussionOrganization(record.id, organization('Old generated overview'));
    service.editSummary(id, { kind: 'summary', itemId: 'summary', expectedRevision: record.revision, text: 'My edited overview' });
    await notes.updateNote(detail.note.id, { markdown: 'My independent notes' });
    const originalTranscript = getDiscussionCapture(id)!.canonicalTranscript;
    const rerun = await service.retry(id, 'from_audio');
    expect(rerun?.discussion.canonicalTranscript).toBe(originalTranscript);
    expect(rerun?.organization?.organization?.summary).toBe('My edited overview');
    const durations: number[] = [];
    await sealer(async buffer => { durations.push(decodeWavToMonoFloat32(buffer).durationSeconds); return recognized(durations.length === 1 ? 'Fresh first' : 'Fresh final'); }).tick();
    expect(durations).toEqual([20, 5]);
    expect(service.transcript(id)?.text).toBe('Fresh first\nMy corrected words\nFresh final');
    expect(service.transcript(id)?.segments[1]).toMatchObject({ correctedByUser: true, speakerLabel: 'Alice' });
    expect(readTranscriptRevision(id, sourceRevision)?.[0].displayText).toBe('Old machine first');
    await new DiscussionOrganizerWorker(new DiscussionOrganizer({ notes, projects, getConfig: () => ({}) as never,
      organizeTranscript: async () => ({ organization: organization('Fresh generated overview'), modelRef: 'test' }),
    })).tick();
    expect((await service.get(id))?.organization?.organization?.summary).toBe('My edited overview');
    expect((await notes.getNote(detail.note.id))?.markdown).toBe('My independent notes');
    expect(getDiscussionCapture(id)?.status).toBe('completed');
  });

  it('keeps a previous complete transcript after a failed forced generation and resumes that generation rather than analyzing stale text', async () => {
    const detail = await recording(); const id = detail.discussion.id;
    replaceTranscriptSegments(id, [{ text: 'Published old text', startedAtMs: 0, endedAtMs: 45_000 }]);
    refreshCanonicalTranscript(id); updateDiscussionCapture(id, { status: 'completed' });
    await service.retry(id, 'from_audio'); const runId = getProcessingRun(id)!.run_id;
    const provider = vi.fn().mockResolvedValueOnce(recognized('Fresh first')).mockRejectedValueOnce(new Error('Bad credentials'));
    await sealer(provider).tick();
    expect(getDiscussionCapture(id)).toMatchObject({ status: 'needs_attention', canonicalTranscript: 'Published old text' });
    expect((await service.retry(id))?.discussion.status).toBe('sealing');
    expect(getProcessingRun(id)?.run_id).toBe(runId);
    const resumed = vi.fn().mockResolvedValue(recognized('Fresh remainder'));
    await sealer(resumed).tick(); expect(resumed).toHaveBeenCalledTimes(2);
    expect(getDiscussionCapture(id)?.canonicalTranscript).toContain('Fresh first');
  });

  it('uses a new generation on an explicit rerun and rejects duplicate reruns while processing', async () => {
    const detail = await recording(2_000); const id = detail.discussion.id;
    await sealer(async () => recognized('Text')).tick(); updateDiscussionCapture(id, { status: 'completed' });
    const oldRun = getProcessingRun(id)!.run_id;
    await service.retry(id, 'from_audio'); expect(getProcessingRun(id)!.run_id).not.toBe(oldRun);
    expect(processingProgress(id)?.completedChunks).toBe(0);
    await expect(service.retry(id, 'from_audio')).rejects.toThrow('Wait for current processing');
  });

  it('rejects regeneration after the saved original was explicitly deleted without disturbing the existing note', async () => {
    const detail = await recording(2_000); const id = detail.discussion.id;
    await sealer(async () => recognized('Keep me')).tick(); updateDiscussionCapture(id, { status: 'completed' });
    await service.deleteAudio(id);
    await expect(service.retry(id, 'from_audio')).rejects.toThrow('Saved original audio is unavailable');
    expect(getDiscussionCapture(id)).toMatchObject({ status: 'completed', canonicalTranscript: 'Keep me' });
  });

  it('fences a worker whose lease expired while the provider request was in flight', async () => {
    const detail = await recording(2_000); const id = detail.discussion.id;
    const pending = deferred<STTResult>(); const oldProvider = vi.fn(() => pending.promise);
    const old = sealer(oldProvider).tick(); await vi.waitFor(() => expect(oldProvider).toHaveBeenCalledOnce());
    getSqliteDatabase().prepare('UPDATE discussion_processing SET lease_until=0 WHERE discussion_id=?').run(id);
    await sealer(async () => recognized('New owner result')).tick();
    pending.resolve(recognized('Stale owner result')); await old;
    expect(getDiscussionCapture(id)?.canonicalTranscript).toBe('New owner result');
  });

  it('times out an uncooperative provider and ignores its late successful result', async () => {
    const detail = await recording(2_000); const id = detail.discussion.id;
    const pending = deferred<STTResult>();
    await sealer(() => pending.promise, 10).tick();
    expect(processingProgress(id)?.nextAttemptAt).toBeTypeOf('number');
    pending.resolve(recognized('Too late')); await Promise.resolve();
    expect(getDiscussionCapture(id)?.canonicalTranscript).toBeUndefined();
    expect(processingProgress(id)?.completedChunks).toBe(0);
  });

  it('stops without waiting for an uncooperative provider and leaves its job resumable', async () => {
    const detail = await recording(2_000); const id = detail.discussion.id;
    const pending = deferred<STTResult>(); const provider = vi.fn(() => pending.promise); const worker = sealer(provider);
    const running = worker.tick(); await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    await worker.stop(); await running;
    expect(getDiscussionCapture(id)?.status).toBe('sealing');
    expect(processingProgress(id)?.attemptCount).toBe(0);
    await sealer(async () => recognized('Restarted result')).tick();
    pending.resolve(recognized('Late stopped worker')); await Promise.resolve();
    expect(getDiscussionCapture(id)?.canonicalTranscript).toBe('Restarted result');
  });

  it('continues assembling other original recordings while transcription is blocked', async () => {
    await recording(2_000);
    const pending = deferred<STTResult>(); const provider = vi.fn(() => pending.promise); const assemble = vi.fn(async () => {});
    const worker = new DiscussionSealer({ notes, getConfig: () => ({}) as never, transcribeSegment: provider, processRecordingJob: assemble });
    const running = worker.tick(); await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    await worker.tick(); expect(assemble).toHaveBeenCalledTimes(2);
    await worker.stop(); await running;
  });

  it('persists organization retries without invoking STT again', async () => {
    const detail = await recording(2_000); const id = detail.discussion.id;
    const stt = vi.fn(async () => recognized('Saved transcript')); await sealer(stt).tick();
    const llm = vi.fn().mockRejectedValueOnce(unavailable()).mockResolvedValue({ organization: organization('Recovered overview'), modelRef: 'test' });
    const worker = new DiscussionOrganizerWorker(new DiscussionOrganizer({ notes, projects, getConfig: () => ({}) as never, organizeTranscript: llm }));
    await worker.tick(); expect(getDiscussionCapture(id)?.status).toBe('organizing');
    await worker.tick(); expect(llm).toHaveBeenCalledTimes(1);
    getSqliteDatabase().prepare('UPDATE discussion_processing SET next_attempt_at=0 WHERE discussion_id=?').run(id);
    await worker.tick(); expect(getDiscussionCapture(id)?.status).toBe('completed'); expect(stt).toHaveBeenCalledTimes(1);
    expect((await service.get(id))?.organization?.organization?.summary).toBe('Recovered overview');
  });

  it('checkpoints silence so a later failure does not retranscribe the same silent range', async () => {
    const detail = await recording(); const id = detail.discussion.id;
    await sealer(vi.fn().mockResolvedValueOnce(recognized('')).mockRejectedValueOnce(unavailable())).tick();
    expect(processingProgress(id)).toMatchObject({ completedChunks: 1, transcribedMs: 20_000 });
    const provider = vi.fn(async () => recognized('Spoken remainder'));
    await nextTick(sealer(provider), id); expect(provider).toHaveBeenCalledTimes(2);
    expect(getDiscussionCapture(id)?.status).toBe('organizing');
  });

  it('does not feed changed original bytes to STT or overwrite published text', async () => {
    const detail = await recording(2_000); const id = detail.discussion.id;
    await sealer(async () => recognized('Published text')).tick(); updateDiscussionCapture(id, { status: 'completed' });
    await service.retry(id, 'from_audio');
    const audio = await notes.getAttachmentPath(detail.note.id, detail.discussion.audioAttachmentId!);
    const bytes = await readFile(audio!.filePath); bytes[100] ^= 1; await writeFile(audio!.filePath, bytes);
    const provider = vi.fn(async () => recognized('Corrupt replacement')); await sealer(provider).tick();
    expect(provider).not.toHaveBeenCalled();
    expect(getDiscussionCapture(id)).toMatchObject({ status: 'needs_attention', canonicalTranscript: 'Published text' });
    expect(getDiscussionCapture(id)?.failureMessage).toContain('checksum mismatch');
  });

  it('fences a late LLM completion after the organization request timed out', async () => {
    const detail = await recording(2_000); const id = detail.discussion.id;
    await sealer(async () => recognized('Saved transcript')).tick();
    const pending = deferred<{ organization: DiscussionOrganization; modelRef: string }>();
    const worker = new DiscussionOrganizerWorker(new DiscussionOrganizer({ notes, projects, getConfig: () => ({}) as never,
      organizeTranscript: () => pending.promise,
    }), undefined, 1_000, 10);
    await worker.tick(); expect(processingProgress(id)?.nextAttemptAt).toBeTypeOf('number');
    pending.resolve({ organization: organization('Late overview'), modelRef: 'test' });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect((await service.get(id))?.organization).toBeUndefined();
    expect(getDiscussionCapture(id)?.status).toBe('organizing');
  });


  it('reuses validated analysis chapters after an LLM failure and a gateway restart', async () => {
    const detail = await recording(40_000); const id = detail.discussion.id;
    let section = 0;
    await sealer(async () => recognized((section++ === 0 ? 'A' : 'B').repeat(5_000))).tick();
    const response = (value: object) => ({ stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify(value) }] });
    modelMocks.complete.mockResolvedValueOnce(response(organization('First chapter')))
      .mockResolvedValueOnce({ stopReason: 'error', errorMessage: '503 Service Unavailable', content: [] })
      .mockResolvedValueOnce(response(organization('Second chapter')))
      .mockResolvedValueOnce(response({ title: 'Meeting', summary: 'Final recovered overview' }));
    const worker = () => new DiscussionOrganizerWorker(new DiscussionOrganizer({ notes, projects, getConfig: () => ({}) as never }));
    await worker().tick();
    expect(getDiscussionCapture(id)?.status).toBe('organizing');
    expect(modelMocks.complete).toHaveBeenCalledTimes(2);
    expect((await service.review(id)).chapters).toEqual([expect.objectContaining({ text: 'First chapter',provisional: true })]);
    expect(Number(getSqliteDatabase().prepare('SELECT COUNT(*) n FROM discussion_analysis_chunks WHERE discussion_id=?').get(id)!.n)).toBe(1);
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'xopc.db') });
    getSqliteDatabase().prepare('UPDATE discussion_processing SET next_attempt_at=0 WHERE discussion_id=?').run(id);
    expect((await service.review(id)).chapters[0]?.text).toBe('First chapter');
    await worker().tick();
    expect(modelMocks.complete).toHaveBeenCalledTimes(4);
    expect(modelMocks.complete.mock.calls[2][1].messages[0].content).toContain('B'.repeat(5_000));
    expect((await service.get(id))?.organization?.organization?.summary).toBe('Final recovered overview');
    expect(getDiscussionCapture(id)?.status).toBe('completed');
  });

});
