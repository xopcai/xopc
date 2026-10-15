import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { getStore: vi.fn(), create: vi.fn(), settings: vi.fn(), upload: vi.fn(), transcript: vi.fn(),
    seal: vi.fn(), sequences: vi.fn(), byNote: vi.fn(), cancel: vi.fn(), createAudio: vi.fn(), gateway: 'gateway', uuid: 0 };
});
vi.mock('@kit.AbilityKit', () => ({ abilityAccessCtrl: { createAtManager: () => ({ requestPermissionsFromUser: async () => ({ authResults: [0] }) }) } }));
vi.mock('@kit.ArkTS', () => ({ util: { generateRandomUUID: () => `local-${++mocks.uuid}` } }));
vi.mock('@kit.ArkData', () => ({ relationalStore: { SecurityLevel: { S2: 2 }, getRdbStore: mocks.getStore } }));
vi.mock('@kit.AudioKit', () => ({ audio: { createAudioCapturer: mocks.createAudio,
  AudioChannel: { CHANNEL_1: 1 }, AudioSampleFormat: { SAMPLE_FORMAT_S16LE: 1 },
  AudioEncodingType: { ENCODING_TYPE_RAW: 1 }, SourceType: { SOURCE_TYPE_MIC: 1 } } }));
vi.mock('@kit.AVSessionKit', () => ({ avSession: { createAVSession: async () => { throw new Error('no background'); } } }));
vi.mock('@kit.BackgroundTasksKit', () => ({ backgroundTaskManager: {} }));
vi.mock('@kit.PerformanceAnalysisKit', () => ({ hilog: { warn: vi.fn() } }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { currentProfile: () => ({ gatewayId: mocks.gateway }) } }));
vi.mock('../entry/src/main/ets/service/discussionLiveTranscription.ets', () => ({ XopcDiscussionLiveTranscription: class {
  start = async () => {}; close = async () => {}; audio() {} commit() {}
} }));
vi.mock('../entry/src/main/ets/repository/discussionCaptureRepository.ets', () => ({ XopcDiscussionCaptureRepository: class {
  create = mocks.create; settings = mocks.settings; uploadOriginal = mocks.upload;
  recordingSequences = mocks.sequences; uploadTranscript = mocks.transcript; seal = mocks.seal; byNote = mocks.byNote; cancel = mocks.cancel;
} }));

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
    capture.mark();
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
