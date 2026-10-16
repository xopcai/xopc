import { XopcDiscussionRecordingPanel } from '../entry/src/main/ets/viewmodel/discussionRecordingPanel.ets';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { getStore: vi.fn(), saveAnnotation: vi.fn(), create: vi.fn(), settings: vi.fn(), upload: vi.fn(), transcript: vi.fn(),
    seal: vi.fn(), sequences: vi.fn(), byNote: vi.fn(), cancel: vi.fn(), createAudio: vi.fn(), gateway: 'gateway', uuid: 0 };
});
vi.mock('../entry/src/main/ets/service/discussionRecordingExport.ets', () => ({ xopcExportRecording: vi.fn() }));
vi.mock('@kit.AbilityKit', () => ({ abilityAccessCtrl: { createAtManager: () => ({ requestPermissionsFromUser: async () => ({ authResults: [0] }) }) } }));
vi.mock('@kit.ArkTS', () => ({ util: { generateRandomUUID: () => `local-${++mocks.uuid}` } }));
vi.mock('@kit.ArkData', () => ({ relationalStore: { SecurityLevel: { S2: 2 }, getRdbStore: mocks.getStore } }));
vi.mock('@kit.AudioKit', () => ({ audio: { createAudioCapturer: mocks.createAudio,
  AudioChannel: { CHANNEL_1: 1 }, AudioSampleFormat: { SAMPLE_FORMAT_S16LE: 1 },
  AudioEncodingType: { ENCODING_TYPE_RAW: 1 }, SourceType: { SOURCE_TYPE_MIC: 1 } } }));
vi.mock('@kit.AVSessionKit', () => ({ avSession: { createAVSession: async () => { throw new Error('no background'); } } }));
vi.mock('@kit.BackgroundTasksKit', () => ({ backgroundTaskManager: {} }));
vi.mock('@kit.PerformanceAnalysisKit', () => ({ hilog: { warn: vi.fn() } }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { currentProfile: () => ({ gatewayId: mocks.gateway }), connectionRevision: () => 1, assertConnection: () => {} } }));
vi.mock('../entry/src/main/ets/service/discussionLiveTranscription.ets', () => ({ XopcDiscussionLiveTranscription: class {
  start = async () => {}; close = async () => {}; audio() {} commit() {}
} }));
vi.mock('../entry/src/main/ets/repository/discussionCaptureRepository.ets', () => ({ XopcDiscussionCaptureRepository: class {
  saveAnnotation = mocks.saveAnnotation; create = mocks.create; settings = mocks.settings; uploadOriginal = mocks.upload;
  recordingSequences = mocks.sequences; uploadTranscript = mocks.transcript; seal = mocks.seal; byNote = mocks.byNote; cancel = mocks.cancel;
} }));

import { XopcAnnotationStore } from '../entry/src/main/ets/service/discussionAnnotations.ets';
import { XopcDiscussionRecordingStore } from '../entry/src/main/ets/service/discussionRecordingStore.ets';
import { XopcDiscussionCapture } from '../entry/src/main/ets/service/discussionCapture.ets';

let directory: string;
let db: DatabaseSync;
let failSequence: number | undefined;
let readResolve: ((buffer: ArrayBuffer) => void) | undefined;
let interrupt: (() => void) | undefined;
let capture: XopcDiscussionCapture;
const detail = (saved = false) => ({ discussion: { id: 'discussion', noteId: 'note', ...(saved ? { audioAttachmentId: 'original' } : {}) } });
const context = {} as never;
const count = () => Number((db.prepare('SELECT COUNT(*) n FROM recording_audio').get() as { n: number }).n);
async function feed(bytes = 96_000) {
  await vi.waitFor(() => expect(readResolve).toBeDefined());
  const resolve = readResolve!; readResolve = undefined; resolve(new ArrayBuffer(bytes));
}

function adapter() {
  return {
    executeSql: async (sql: string, bindings: never[] = []) => {
      if (sql.startsWith('INSERT INTO recording_audio') && bindings[1] === failSequence) throw new Error('DISK_FULL');
      db.prepare(sql).run(...bindings);
    },
    querySql: async (sql: string, bindings: never[] = []) => {
      const rows = db.prepare(sql).all(...bindings) as Record<string, unknown>[];
      const names = Object.keys(rows[0] ?? {}); let index = -1;
      const get = (column: number) => rows[index][names[column]];
      return { goToFirstRow: () => { index = 0; return rows.length > 0; }, goToNextRow: () => ++index < rows.length,
        getColumnIndex: (name: string) => names.indexOf(name), getString: (column: number) => String(get(column)),
        getLong: (column: number) => Number(get(column)), getBlob: (column: number) => get(column), close() {} };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.uuid = 0; mocks.gateway = 'gateway'; failSequence = undefined; readResolve = undefined;
  directory = mkdtempSync(join(tmpdir(), 'xopc-recording-recovery-'));
  db = new DatabaseSync(join(directory, 'recordings.db'));
  mocks.getStore.mockImplementation(async () => adapter());
  mocks.saveAnnotation.mockImplementation(async (_id, input) => ({ ...input,revision: input.expectedRevision + 1 }));
  mocks.settings.mockResolvedValue({ consentPolicyVersion: 1, consentAcknowledgedAt: 1 });
  mocks.create.mockResolvedValue(detail()); mocks.byNote.mockResolvedValue(detail());
  mocks.sequences.mockResolvedValue([]);
  mocks.upload.mockRejectedValue(new Error('OFFLINE')); mocks.seal.mockResolvedValue(undefined);
  mocks.transcript.mockResolvedValue({ text: 'words' });
  mocks.createAudio.mockResolvedValue({
    on: (_name: string, handler: () => void) => { interrupt = handler; }, off() {}, start: async () => {},
    getBufferSizeSync: () => 640,
    read: () => new Promise<ArrayBuffer>(resolve => { readResolve = resolve; }),
    stop: async () => { readResolve?.(new ArrayBuffer(0)); readResolve = undefined; }, release: async () => {},
  });
  capture = new XopcDiscussionCapture();
});
afterEach(async () => {
  // Stop the reader without deleting recovery data; network work in these tests is bounded.
  if (capture.phase === 'recording' || capture.phase === 'paused') {
    interrupt?.(); await vi.waitFor(() => expect(capture.phase).toBe('error'));
  }
  db.close(); rmSync(directory, { recursive: true, force: true });
});

describe('HarmonyOS durable original audio', () => {
  it('continues after interruption using the same recording and Note without replacing original WAVs', async () => {
    await capture.start(context); await feed();
    await vi.waitFor(() => expect(count()).toBe(1));
    interrupt?.(); await vi.waitFor(() => expect(capture.phase).toBe('error'));
    const original = db.prepare('SELECT audio FROM recording_audio WHERE sequence=0').get()!.audio;
    const id = String(db.prepare('SELECT id FROM recording_sessions').get()!.id);
    await capture.continueRecording(context, id);
    expect(capture.captureStatus).toBe('waiting');
    await feed(); await vi.waitFor(() => expect(count()).toBe(2));
    expect(db.prepare('SELECT audio FROM recording_audio WHERE sequence=0').get()!.audio).toEqual(original);
    expect(db.prepare('SELECT COUNT(*) n FROM recording_sessions').get()!.n).toBe(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT COUNT(*) n FROM recording_events WHERE kind='resume'").get()!.n).toBe(1);
  });
  it('fences continuation after a lost seal response and retries the exact same Note and event manifest', async () => {
    await capture.start(context); await feed(); await vi.waitFor(() => expect(count()).toBe(1));
    interrupt?.(); await vi.waitFor(() => expect(capture.phase).toBe('error'));
    mocks.upload.mockResolvedValue(undefined); mocks.seal.mockRejectedValueOnce(new Error('RESPONSE_LOST'));
    await capture.stop(); expect(capture.phase).toBe('error');
    const first = mocks.seal.mock.calls[0][1];
    const id = String(db.prepare('SELECT id FROM recording_sessions').get()!.id);
    const restarted = new XopcDiscussionCapture(); await restarted.restore(context, id);
    await restarted.continueRecording(context, id);
    expect(restarted.phase).toBe('error'); expect(restarted.error).toBe('RECORDING_ALREADY_SUBMITTED');
    expect(mocks.createAudio).toHaveBeenCalledTimes(1); expect(count()).toBe(1);
    await restarted.recoverRecording(context, id);
    expect(mocks.seal.mock.calls[1][1]).toEqual(first);
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(count()).toBe(1);
  });

  it('discards only the selected local copy and never cancels or deletes its server Note', async () => {
    await capture.start(context); await feed(); await vi.waitFor(() => expect(count()).toBe(1));
    interrupt?.(); await vi.waitFor(() => expect(capture.phase).toBe('error'));
    await capture.discard();
    expect(mocks.cancel).not.toHaveBeenCalled(); expect(count()).toBe(0);
  });

  it('keeps the same durable recording while the floating panel moves, minimizes, marks, pauses and ends', async () => {
    const panel = new XopcDiscussionRecordingPanel(); panel.resize(400,800);
    await capture.start(context); await feed(); await vi.waitFor(() => expect(count()).toBe(1));
    const id = capture.noteId;
    panel.setCompact(true); panel.dragStart(); panel.dragTo(-200,-300); panel.dragEnd(); await panel.mark(capture);
    expect(capture.markers).toEqual([3000]); expect(capture.noteId).toBe(id); expect(count()).toBe(1);
    panel.pause(capture); expect(capture.phase).toBe('paused');
    await feed(); await vi.waitFor(() => expect(readResolve).toBeDefined()); expect(count()).toBe(1);
    panel.resize(800,400); panel.setCompact(false); panel.pause(capture); expect(capture.captureStatus).toBe('waiting');
    await feed(); await vi.waitFor(() => expect(count()).toBe(2)); await panel.mark(capture);
    expect(capture.markers).toEqual([3000,6000]);
    mocks.upload.mockResolvedValue(undefined); const saved = vi.fn();
    const ending = panel.finish(capture,saved); panel.setCompact(true); const duplicate = panel.finish(capture,saved);
    await Promise.all([ending,duplicate]);
    expect(capture.phase).toBe('completed'); expect(capture.localSaveComplete).toBe(true);
    expect(saved).toHaveBeenCalledExactlyOnceWith(id); expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.seal).toHaveBeenCalledTimes(1); expect(count()).toBe(2);
    expect(mocks.seal.mock.calls[0][1]).toMatchObject({chunkCount:2,containerMode:'independent_wav'});
  });

  it('keeps the saved prefix recoverable after a disk failure even when its window is collapsed and dragged', async () => {
    const panel = new XopcDiscussionRecordingPanel(); panel.resize(375,812); panel.setCompact(true);
    await capture.start(context); await feed(); await vi.waitFor(() => expect(count()).toBe(1)); const id = capture.noteId;
    failSequence = 1; await feed(); await vi.waitFor(() => expect(capture.phase).toBe('error'));
    panel.dragStart(); panel.dragTo(5000,5000); panel.dragEnd(); panel.setCompact(false);
    const saved = vi.fn(); await panel.finish(capture,saved); expect(saved).not.toHaveBeenCalled();
    expect(capture.localSaveComplete).toBe(false); expect(count()).toBe(1);
    failSequence = undefined; const restarted = new XopcDiscussionCapture(); await restarted.restore(context);
    expect(restarted.noteId).toBe(id); expect(restarted.savedDurationMs).toBe(3000); expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('keeps source capture alive when a highlight commit fails', async () => {
    await capture.start(context); await feed(); await vi.waitFor(() => expect(count()).toBe(1));
    const failure = vi.spyOn(XopcAnnotationStore.prototype,'save').mockRejectedValueOnce(new Error('ANNOTATION_DISK_FULL'));
    const panel = new XopcDiscussionRecordingPanel(); panel.resize(375,812); panel.setCompact(true);
    await panel.mark(capture); expect(capture.markerError).toBe('ANNOTATION_DISK_FULL'); expect(capture.phase).toBe('recording');
    failure.mockRestore(); await feed(); await vi.waitFor(() => expect(count()).toBe(2));
  });

  it('seals original audio even when highlight synchronization is temporarily unavailable', async () => {
    await capture.start(context); await feed(); await vi.waitFor(() => expect(count()).toBe(1)); await capture.mark();
    mocks.upload.mockResolvedValue(undefined); mocks.saveAnnotation.mockRejectedValue(new Error('ANNOTATION_SYNC_OFFLINE'));
    await capture.stop();
    expect(mocks.seal).toHaveBeenCalled(); expect(capture.phase).toBe('completed'); expect(capture.markerError).toBe('ANNOTATION_SYNC_OFFLINE');
    expect(count()).toBe(1);
    const seals = mocks.seal.mock.calls.length;
    mocks.saveAnnotation.mockImplementation(async (_id,input) => ({ ...input,revision: input.expectedRevision + 1 }));
    await capture.retryAnnotations();
    expect(capture.markerError).toBe(''); expect(count()).toBe(1);
    expect(mocks.seal).toHaveBeenCalledTimes(seals);expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('does not claim capture before its first real PCM input and reconfirms input after pause', async () => {
    await capture.start(context);
    expect(capture.captureStatus).toBe('waiting'); expect(capture.inputConfirmed).toBe(false);
    await feed(32_000); await vi.waitFor(() => expect(capture.captureStatus).toBe('recording'));
    const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 16_000);
    try { await vi.waitFor(() => expect(capture.captureStatus).toBe('waiting')); }
    finally { clock.mockRestore(); }
    await feed(32_000); await vi.waitFor(() => expect(capture.captureStatus).toBe('recording'));
    capture.togglePause(); expect(capture.captureStatus).toBe('paused');
    capture.togglePause(); expect(capture.captureStatus).toBe('waiting');
    await feed(32_000); await vi.waitFor(() => expect(capture.captureStatus).toBe('recording'));
  });

  it('confirms local completion independently of failed network sync and a queued server seal', async () => {
    await capture.start(context); await feed(); await vi.waitFor(() => expect(capture.savedDurationMs).toBe(3_000));
    expect(capture.localSaveComplete).toBe(false);
    await capture.stop();
    expect(capture.localSaveComplete).toBe(true); expect(capture.captureStatus).toBe('stopped');
    expect(capture.syncStatus).toBe('failed'); expect(capture.processingStatus).toBe('waiting');
    mocks.upload.mockResolvedValue(undefined);
    await capture.stop();
    expect(capture.syncStatus).toBe('verifying'); expect(capture.syncStatus).not.toBe('available');
  });

  it('does not label interrupted or storage-failed capture as a complete saved recording', async () => {
    await capture.start(context); await feed(); await vi.waitFor(() => expect(capture.savedDurationMs).toBe(3_000));
    interrupt?.(); expect(capture.captureStatus).toBe('interrupted');
    await vi.waitFor(() => expect(capture.phase).toBe('error'));
    expect(capture.localSaveComplete).toBe(false);
    const restored = new XopcDiscussionCapture(); await restored.restore(context);
    expect(restored.localSaveComplete).toBe(false); expect(restored.captureStatus).toBe('interrupted');
  });
  it('does not mistake a deleted server attachment for confirmed source availability on recovery', async () => {
    await capture.start(context); await feed(); await vi.waitFor(() => expect(capture.savedDurationMs).toBe(3_000));
    interrupt?.(); await vi.waitFor(() => expect(capture.phase).toBe('error'));
    mocks.byNote.mockResolvedValue({ discussion: { id: 'discussion', noteId: 'note', audioAttachmentId: 'original', audioDeletedAt: 1 } });
    const restored = new XopcDiscussionCapture(); await restored.restore(context);
    expect(restored.savedDurationMs).toBe(3_000); expect(count()).toBe(1); expect(restored.syncStatus).not.toBe('available');
  });
  it('commits new chunks while an earlier original upload is blocked, retaining only bounded audio buffers', async () => {
    let release!: () => void;
    mocks.upload.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    await capture.start(context);
    await feed(); await vi.waitFor(() => expect({ saved: capture.savedDurationMs, error: capture.error, uploads: mocks.upload.mock.calls.length }).toMatchObject({ saved: 3_000, uploads: 1 }));
    await feed(); await vi.waitFor(() => expect(capture.savedDurationMs).toBe(6_000));
    expect(count()).toBe(2);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    release();
    interrupt?.(); await vi.waitFor(() => expect(capture.phase).toBe('error'));
  });

  it('flushes a short tail on interruption and reconstructs the same session after reopening SQLite', async () => {
    await capture.start(context);
    await feed(32_000); await vi.waitFor(() => expect(readResolve).toBeDefined());
    interrupt?.(); await vi.waitFor(() => expect(capture.phase).toBe('error'));
    expect(count()).toBe(1); expect(capture.savedDurationMs).toBe(1_000);
    db.close(); db = new DatabaseSync(join(directory, 'recordings.db'));
    const restarted = new XopcDiscussionCapture(); await restarted.restore(context);
    expect(restarted.recovered).toBe(true); expect(restarted.savedDurationMs).toBe(1_000);
    expect(restarted.noteId).toBe('note'); expect(restarted.phase).toBe('error');
  });

  it('retains the contiguous committed prefix after disk full and can upload it on restart', async () => {
    await capture.start(context); await feed(); await vi.waitFor(() => expect(count()).toBe(1));
    failSequence = 1; await feed(); await vi.waitFor(() => expect(capture.phase).toBe('error'));
    expect(count()).toBe(1); expect(capture.savedDurationMs).toBe(3_000);
    failSequence = undefined; mocks.upload.mockResolvedValue(undefined);
    const restarted = new XopcDiscussionCapture(); await restarted.restore(context); await restarted.stop();
    expect(mocks.seal).toHaveBeenCalledWith('discussion', expect.objectContaining({ chunkCount: 1, containerMode: 'independent_wav' }));
    expect(count()).toBe(1); // Queued seal does not authorize deletion.
  });

  it('can start offline after consent was cached, without creating a second server identity on recovery', async () => {
    const store = new XopcDiscussionRecordingStore(); await store.initialize(context); await store.saveConsent('gateway', 1);
    mocks.settings.mockRejectedValue(new Error('OFFLINE')); mocks.create.mockRejectedValue(new Error('OFFLINE'));
    await capture.start(context); expect(capture.phase).toBe('recording'); expect(mocks.settings).not.toHaveBeenCalled();
    await feed(); await vi.waitFor(() => expect(count()).toBe(1));
    interrupt?.(); await vi.waitFor(() => expect(capture.phase).toBe('error'));
    const restarted = new XopcDiscussionCapture(); await restarted.restore(context);
    mocks.create.mockResolvedValue(detail()); mocks.upload.mockResolvedValue(undefined);
    await restarted.stop();
    expect(mocks.create).toHaveBeenLastCalledWith('local-1', 1, expect.any(Number));
    expect(restarted.noteId).toBe('note'); expect(count()).toBe(1);
  });

  it('does not require live STT to finish originals, and deletes local audio only after attachment confirmation', async () => {
    mocks.upload.mockResolvedValue(undefined); mocks.transcript.mockReturnValue(new Promise(() => {}));
    await capture.start(context); await feed(); await vi.waitFor(() => expect(count()).toBe(1));
    await capture.stop(); expect(capture.phase).toBe('completed'); expect(count()).toBe(1);
    mocks.byNote.mockResolvedValue(detail(true));
    const restarted = new XopcDiscussionCapture(); await restarted.restore(context);
    expect(restarted.phase).toBe('idle'); expect(count()).toBe(0);
  });

  it('does not restore or upload a recording into another gateway', async () => {
    await capture.start(context); await feed(); await vi.waitFor(() => expect(count()).toBe(1));
    interrupt?.(); await vi.waitFor(() => expect(capture.phase).toBe('error'));
    mocks.gateway = 'another';
    const restarted = new XopcDiscussionCapture(); await restarted.restore(context);
    expect(restarted.phase).toBe('idle');
    await capture.stop(); expect(capture.phase).toBe('error'); expect(count()).toBe(1);
    expect(capture.error).toBe('RECORDING_GATEWAY_CHANGED');
  });

  it('rejects missing local chunks instead of sealing a silently truncated timeline', async () => {
    await capture.start(context); await feed(); await vi.waitFor(() => expect(count()).toBe(1));
    await feed(); await vi.waitFor(() => expect(count()).toBe(2));
    interrupt?.(); await vi.waitFor(() => expect(capture.phase).toBe('error'));
    db.prepare('DELETE FROM recording_audio WHERE sequence=0').run();
    const restarted = new XopcDiscussionCapture();
    await expect(restarted.restore(context)).rejects.toThrow('RECORDING_CHUNK_GAP');
    expect(mocks.seal).not.toHaveBeenCalled(); expect(count()).toBe(1);
  });

  it('reopens all 2,400 independent WAV chunks of a two-hour recording without loading the whole audio', async () => {
    const store = new XopcDiscussionRecordingStore(); await store.initialize(context);
    await store.create({ id: 'two-hour', gatewayId: 'gateway', consentVersion: 1, recordedAt: 1,
      discussionId: '', noteId: '', markers: [] });
    const { xopcPcm16Wav } = await import('../entry/src/main/ets/common/discussionAudio.ets');
    const wav = xopcPcm16Wav([new Uint8Array(96_000)]);
    for (let sequence = 0; sequence < 2_400; sequence++) {
      await store.append('two-hour', { sequence, startedAtMs: sequence * 3_000, endedAtMs: (sequence + 1) * 3_000, uploaded: false }, wav);
    }
    db.close(); db = new DatabaseSync(join(directory, 'recordings.db'));
    const restarted = new XopcDiscussionRecordingStore(); await restarted.initialize(context);
    const chunks = await restarted.chunks('two-hour');
    expect(chunks).toHaveLength(2_400);
    expect(chunks.at(-1)?.endedAtMs).toBe(7_200_000);
    expect(await restarted.audio('two-hour', 0)).toEqual(wav);
    expect(await restarted.audio('two-hour', 2_399)).toEqual(wav);
    expect(Number((db.prepare('SELECT SUM(length(audio)-44) bytes FROM recording_audio').get() as { bytes: number }).bytes)).toBe(230_400_000);
  }, 60_000);


  it('reuploads a locally acknowledged chunk if server reconciliation finds it missing', async () => {
    mocks.upload.mockResolvedValue(undefined);
    await capture.start(context); await feed();
    await vi.waitFor(() => expect(mocks.transcript).toHaveBeenCalled());
    const originalCalls = mocks.upload.mock.calls.length;
    await capture.stop();
    expect(mocks.sequences).toHaveBeenCalledWith('discussion');
    expect(mocks.upload.mock.calls.length).toBeGreaterThan(originalCalls);
    expect(count()).toBe(1);
  });

  it('persists markers and does not replace a recovered session when starting a new recording', async () => {
    await capture.start(context); await feed(); await vi.waitFor(() => expect(capture.savedDurationMs).toBe(3_000));
    await capture.mark();
    interrupt?.(); await vi.waitFor(() => expect(capture.phase).toBe('error'));
    const restarted = new XopcDiscussionCapture(); await restarted.start(context);
    expect(restarted.markers).toEqual([3_000]); expect(restarted.recovered).toBe(true);
    expect(mocks.createAudio).toHaveBeenCalledTimes(1); expect(count()).toBe(1);
  });


  it('saves the buffered tail even when native stop, release and the outstanding read never resolve', async () => {
    await capture.start(context); await feed(32_000); await vi.waitFor(() => expect(readResolve).toBeDefined());
    const native = await mocks.createAudio.mock.results[0].value;
    native.stop = () => new Promise(() => {}); native.release = () => new Promise(() => {});
    vi.useFakeTimers();
    try {
      interrupt?.(); await vi.advanceTimersByTimeAsync(4_501);
      expect(capture.phase).toBe('error'); expect(capture.savedDurationMs).toBe(1_000); expect(count()).toBe(1);
      expect(capture.shutdownIncomplete).toBe(true); expect(capture.localSaveComplete).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('completes cleanup after a process exits between its completion marker and audio deletion', async () => {
    await capture.start(context); await feed(); await vi.waitFor(() => expect(capture.savedDurationMs).toBe(3_000));
    interrupt?.(); await vi.waitFor(() => expect(capture.phase).toBe('error'));
    db.prepare('UPDATE recording_sessions SET completed=1').run();
    const restarted = new XopcDiscussionRecordingStore(); await restarted.initialize(context);
    expect(await restarted.pending('gateway')).toEqual([]); expect(count()).toBe(0);
  });


  it('submits the saved prefix on the first explicit retry after a recording-time storage failure', async () => {
    await capture.start(context); await feed(); await vi.waitFor(() => expect(capture.savedDurationMs).toBe(3_000));
    failSequence = 1; await feed(); await vi.waitFor(() => expect(capture.phase).toBe('error'));
    failSequence = undefined; mocks.upload.mockResolvedValue(undefined);
    await capture.stop();
    expect(capture.phase).toBe('completed');
    expect(mocks.seal).toHaveBeenCalledWith('discussion', expect.objectContaining({ chunkCount: 1 }));
    expect(count()).toBe(1);
  });

});
