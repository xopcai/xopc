// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { listLocalAnnotations } from '../discussion-annotation-store';
import { act } from 'react';
import { Blob as NodeBlob } from 'node:buffer';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiscussionDraft, DiscussionDraftChunk } from '../discussion-types';

const mocks = vi.hoisted(() => ({
  drafts: new Map<string, DiscussionDraft>(), chunks: new Map<string, Blob>(),
  save: vi.fn(), saveChunk: vi.fn(), segmenterStart: vi.fn(), cancel: vi.fn(),
  release: vi.fn(), acquire: vi.fn(),
}));
vi.mock('../discussion-draft-store', () => ({
  listDiscussionDrafts: async () => [...mocks.drafts.values()].map(draft => ({ ...draft })),
  loadDiscussionDraftForRecovery: async (id: string) => {
    const draft = mocks.drafts.get(id); if (!draft) throw new Error('missing draft'); return { ...draft };
  },
  saveDiscussionDraft: mocks.save, saveDiscussionDraftChunk: mocks.saveChunk,
  deleteDiscussionDraft: async (id: string) => { mocks.drafts.delete(id); },
}));
vi.mock('../live-pcm-segmenter', () => ({ LivePcmSegmenter: { start: mocks.segmenterStart } }));
vi.mock('@/features/voice/microphone-lease', () => ({ acquireMicrophoneLease: mocks.acquire, releaseMicrophoneLease: mocks.release }));

import { useDiscussionRecorder } from '../use-discussion-recorder';
import { projectRecordingStatus } from '../recording-status';
import { recordingSaveLabel } from '../recording-status-panel';
import { mediaHeader, mediaCluster } from './recording-media-fixture';

class Recorder {
  static latest: Recorder;
  static isTypeSupported = () => true;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  hung = false;
  stopCalls = 0;
  constructor() { Recorder.latest = this; }
  start() { this.state = 'recording'; }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  requestData() { this.emit(); }
  emit(text = 'audio') { this.ondataavailable?.({ data: new Blob([text]) }); }
  stop() {
    this.stopCalls++;
    this.state = 'inactive';
    if (!this.hung) queueMicrotask(() => { this.emit('tail'); this.onstop?.(); });
  }
}

let api: ReturnType<typeof useDiscussionRecorder>;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let track: EventTarget & { stop: ReturnType<typeof vi.fn> };
function Harness() { api = useDiscussionRecorder(); return null; }
async function mount() {
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(<Harness />); });
}
async function start() { await act(async () => { await api.start({ onLiveSegment: vi.fn() }); }); }
async function emit() { await act(async () => { Recorder.latest.emit(); }); }

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.drafts.clear(); mocks.chunks.clear();
  mocks.acquire.mockReturnValue(true);
  mocks.save.mockImplementation(async (draft: DiscussionDraft) => { mocks.drafts.set(draft.id, { ...draft }); });
  mocks.saveChunk.mockImplementation(async (chunk: DiscussionDraftChunk, draft: DiscussionDraft) => {
    mocks.chunks.set(`${chunk.draftId}:${chunk.index}`, chunk.blob);
    mocks.drafts.set(draft.id, { ...draft });
  });
  mocks.segmenterStart.mockResolvedValue({ cancel: mocks.cancel, stop: () => new Promise(() => {}), pause: vi.fn(), resume: vi.fn() });
  track = Object.assign(new EventTarget(), { stop: vi.fn() });
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('Blob', NodeBlob);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: vi.fn(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] })),
  } });
  await mount();
});
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('original recording durability and recovery', () => {
  it('persists a one-click highlight before feedback and resolves it only from newly committed encoded media', async () => {
    vi.useRealTimers(); vi.stubGlobal('indexedDB',new IDBFactory()); vi.stubGlobal('IDBKeyRange',IDBKeyRange);
    await start();
    await act(async () => { await api.mark(); });
    expect(api.markerMessage).toBe('saved');
    const pending = (await listLocalAnnotations(api.draft!.id))[0]; expect(pending.annotation.anchor.offsetMs).toBeUndefined();
    await act(async () => { Recorder.latest.ondataavailable?.({ data: new Blob([Uint8Array.from([...mediaHeader,...mediaCluster(0)])]) }); });
    // Invalid earlier bytes must never manufacture a timed anchor.
    expect((await listLocalAnnotations(api.draft!.id))[0].annotation.id).toBe(pending.annotation.id);
    expect(api.phase).not.toBe('error');
  });
  it('anchors a new highlight to committed encoded media instead of the UI clock', async () => {
    vi.useRealTimers(); vi.stubGlobal('indexedDB',new IDBFactory()); vi.stubGlobal('IDBKeyRange',IDBKeyRange);
    await start();
    Recorder.latest.requestData = () => Recorder.latest.ondataavailable?.({ data: new Blob([Uint8Array.from([...mediaHeader,...mediaCluster(0)])]) });
    await act(async () => { await api.mark(); });
    await vi.waitFor(async () => expect((await listLocalAnnotations(api.draft!.id))[0].annotation.anchor.offsetMs).toBeGreaterThan(0));
    expect((await listLocalAnnotations(api.draft!.id))[0].annotation.anchor.epoch).toBe(0);
    expect(api.phase).toBe('recording');
  });

  it('does not stop healthy source capture when local highlight persistence fails', async () => {
    vi.useRealTimers(); vi.stubGlobal('indexedDB',undefined);
    await start(); await act(async () => { await api.mark(); });
    expect(api.markerError).toBeTruthy(); expect(Recorder.latest.state).toBe('recording');
    expect(api.markerMessage).toBeNull();
  });

  it('continues a committed interrupted draft with unchanged identity and immutable old chunks', async () => {
    await start(); await emit();
    await act(async () => { await api.stop(); });
    const original = api.draft!;
    const chunks = [...mocks.chunks.entries()]; const oldRecorder = Recorder.latest;
    await act(async () => { await api.start({ continuation: original, onLiveSegment: vi.fn() }); });
    expect(api.draft!.id).toBe(original.id); expect(api.phase).toBe('waiting_for_audio');
    expect(api.draft!.epochs).toHaveLength(2);
    expect(api.draft!.epochs![1].firstChunk).toBe(original.chunkCount);
    await act(async () => { oldRecorder.emit('late-old-event'); });
    expect(api.draft!.chunkCount).toBe(original.chunkCount);
    await emit();
    expect(api.draft!.chunkCount).toBe(original.chunkCount + 1);
    for (const [key, blob] of chunks) expect(mocks.chunks.get(key)).toBe(blob);
    await act(async () => { await api.stop(); });
    expect(mocks.drafts.size).toBe(1);
  });
  it('refuses to continue a possibly committed seal or a draft belonging to a different Gateway', async () => {
    await start(); await emit(); await act(async () => { await api.stop(); });
    const original = api.draft!;
    mocks.drafts.set(original.id, { ...original, sealRequested: true });
    await act(async () => { expect(await api.start({ continuation: original, onLiveSegment: vi.fn() })).toBeNull(); });
    expect(api.error).toContain('submitted');
    mocks.drafts.set(original.id, { ...original, gatewayUrl: 'https://old.example' });
    await act(async () => { expect(await api.start({ continuation: original, gatewayUrl: 'https://new.example', onLiveSegment: vi.fn() })).toBeNull(); });
    expect(api.error).toContain('original Gateway'); expect(mocks.drafts.get(original.id)!.chunkCount).toBe(original.chunkCount);
  });

  it('waits for actual samples and does not treat permission or an empty recorder header as audio input', async () => {
    await start(); expect(api.phase).toBe('waiting_for_audio');
    await act(async () => { Recorder.latest.ondataavailable?.({ data: new Blob([Uint8Array.from(mediaHeader)]) }); });
    expect(api.phase).toBe('waiting_for_audio');
    await act(async () => { mocks.segmenterStart.mock.calls[0][2](0); });
    expect(api.phase).toBe('recording'); expect(api.inputLevel).toBe(0);
    await act(async () => { api.pause(); api.resume(); });
    expect(api.phase).toBe('waiting_for_audio');
    await act(async () => { mocks.segmenterStart.mock.calls[0][2](0.2); });
    expect(api.phase).toBe('recording');
  });
  it('stops advertising active capture when both audio callbacks stall and reconfirms actual input', async () => {
    await start(); await act(async () => { mocks.segmenterStart.mock.calls[0][2](0); });
    expect(api.phase).toBe('recording');
    await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
    expect(api.phase).toBe('waiting_for_audio'); expect(api.inputLevel).toBeNull();
    await act(async () => { mocks.segmenterStart.mock.calls[0][2](0); });
    expect(api.phase).toBe('recording');
  });

  it('publishes only committed encoded media time and leaves the boundary unchanged when the next write fails', async () => {
    await start();
    let commit!: () => void;
    const save = mocks.saveChunk.getMockImplementation()!;
    mocks.saveChunk.mockImplementationOnce(async (...args) => { await new Promise<void>(done => { commit = done; }); await save(...args); });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      Recorder.latest.ondataavailable?.({ data: new Blob([Uint8Array.from([...mediaHeader, ...mediaCluster(0)])]) });
    });
    expect(api.draft?.mediaCoverage).toBeUndefined();
    await act(async () => { commit(); });
    expect(api.draft?.mediaCoverage).toMatchObject({ verifiedThroughMs: 20, committedChunkCount: 1 });
    mocks.saveChunk.mockRejectedValueOnce(new Error('Disk full'));
    await act(async () => { Recorder.latest.ondataavailable?.({ data: new Blob([Uint8Array.from(mediaCluster(20))]) }); });
    expect(api.draft?.mediaCoverage?.verifiedThroughMs).toBe(20); expect(api.phase).toBe('error');
    expect(api.draft?.saveOutcome).toBe('incomplete');
  });

  it.each([false, true])('projects committed quantized media and preserves real gaps (missing frame: %s)', async missing => {
    await start();
    await act(async () => {
      Recorder.latest.ondataavailable?.({ data: new Blob([Uint8Array.from([...mediaHeader, ...mediaCluster(0), ...mediaCluster(19)])]) });
    });
    expect(api.draft?.mediaCoverage).toMatchObject({ status: 'verified', verifiedThroughMs: 39 });
    let commit!: () => void;
    const save = mocks.saveChunk.getMockImplementation()!;
    mocks.saveChunk.mockImplementationOnce(async (...args) => { await new Promise<void>(done => { commit = done; }); await save(...args); });
    const packets: number[] = [];
    for (let time = 40; time < 3000; time += 20) if (!missing || time !== 40) packets.push(...mediaCluster(time));
    await act(async () => { Recorder.latest.ondataavailable?.({ data: new Blob([Uint8Array.from(packets)]) }); });
    expect(api.draft?.mediaCoverage?.verifiedThroughMs).toBe(39);
    await act(async () => { commit(); });
    const status = projectRecordingStatus({ phase: api.phase, draft: api.draft, online: true, syncStage: 'pending', pendingText: 0, liveAvailable: true });
    expect(status).toMatchObject({ savedThroughMs: missing ? 39 : 3000, timingUncertain: missing });
    expect(recordingSaveLabel(status, 'zh')).toBe(missing ? '本机已确认保存至 00:00' : '本机已确认保存至 00:03');
    expect(api.draft?.mediaCoverage?.committedChunkCount).toBe(2);
  });

  it('does not declare local completion until stop metadata commits and ignores packets delivered after a stop timeout', async () => {
    await start(); await emit();
    let commit!: () => void;
    const save = mocks.save.getMockImplementation()!;
    mocks.save.mockImplementationOnce(async (...args) => { await new Promise<void>(done => { commit = done; }); await save(...args); });
    let stopping!: Promise<DiscussionDraft | null>;
    await act(async () => { stopping = api.stop(); });
    expect(api.phase).toBe('stopping'); expect(api.draft?.saveOutcome).toBeUndefined();
    await act(async () => { commit(); await stopping; });
    expect(api.draft?.saveOutcome).toBe('complete');
    await start(); await emit(); Recorder.latest.hung = true;
    await act(async () => { const pending = api.stop().catch(() => null); await vi.advanceTimersByTimeAsync(5_001); await pending; });
    const count = api.draft!.chunkCount;
    await emit(); expect(api.draft!.chunkCount).toBe(count); expect(api.draft?.saveOutcome).toBe('incomplete');
  });

  it('retains the interruption outcome after a real track-ended event instead of claiming a complete recording', async () => {
    await start(); await emit();
    await act(async () => { track.dispatchEvent(new Event('ended')); });
    expect(api.phase).toBe('stopped'); expect(api.draft?.saveOutcome).toBe('interrupted');
    expect(track.stop).toHaveBeenCalled();
  });
  it.each(['mute', 'freeze'])('closes an interrupted epoch on %s and continues the same saved recording', async event => {
    await start(); await emit();
    await act(async () => { await api.setServerDiscussionId('same-note-source'); });
    const original = api.draft!;
    const prefix = mocks.chunks.get(`${original.id}:0`);
    await act(async () => { (event === 'mute' ? track : document).dispatchEvent(new Event(event)); });
    expect(api.phase).toBe('stopped');
    expect(api.draft).toMatchObject({ id: original.id, serverDiscussionId: 'same-note-source', saveOutcome: 'interrupted', chunkCount: 2 });
    await act(async () => { await api.start({ continuation: api.draft!, onLiveSegment: vi.fn() }); });
    expect(api.draft!.epochs).toHaveLength(2);
    expect(api.draft!.serverDiscussionId).toBe('same-note-source');
    expect(api.phase).toBe('waiting_for_audio');
    expect(mocks.chunks.get(`${original.id}:0`)).toBe(prefix);
    expect(mocks.drafts.size).toBe(1);
  });

  it('keeps recording when a healthy source is hidden and removes old lifecycle listeners', async () => {
    await start(); await emit();
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(Recorder.latest.state).toBe('recording');
    await act(async () => { await api.stop(); });
    const stopped = api.draft;
    await act(async () => { document.dispatchEvent(new Event('freeze')); track.dispatchEvent(new Event('mute')); });
    expect(api.draft).toBe(stopped);
    expect(api.draft!.saveOutcome).toBe('complete');
  });

  it('detects a silent recorder shutdown and ignores ended events from an earlier recording', async () => {
    await start(); await emit();
    const previous = Recorder.latest;
    await act(async () => { await api.stop(); });
    await start();
    await act(async () => { previous.onerror?.(); previous.onstop?.(); });
    expect(api.phase).toBe('waiting_for_audio');
    await act(async () => {
      Recorder.latest.state = 'inactive';
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(api.phase).toBe('stopping');
    await act(async () => { Recorder.latest.emit('last'); Recorder.latest.onstop?.(); });
    expect(api.draft?.saveOutcome).toBe('interrupted'); expect(api.phase).toBe('stopped');
  });
  it('stops original audio once and saves its tail without waiting for a hung live segmenter', async () => {
    await start(); await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); await emit();
    let first!: Promise<DiscussionDraft | null>; let second!: Promise<DiscussionDraft | null>;
    await act(async () => { first = api.stop(); second = api.stop(); await first; });
    expect(first).toBe(second);
    expect(Recorder.latest.stopCalls).toBe(1);
    expect(api.phase).toBe('stopped'); expect(api.draft?.chunkCount).toBe(2);
    expect(mocks.chunks.size).toBe(2); expect(track.stop).toHaveBeenCalled(); expect(mocks.cancel).toHaveBeenCalled();
  });

  it('starts and stops original audio even if live capture initialization never resolves', async () => {
    mocks.segmenterStart.mockReturnValue(new Promise(() => {}));
    await start(); expect(api.phase).toBe('waiting_for_audio');
    await act(async () => { await api.stop(); });
    expect(api.phase).toBe('stopped'); expect(track.stop).toHaveBeenCalled();
  });

  it('releases the microphone and retains the saved prefix when the stop event never arrives', async () => {
    await start(); await emit(); Recorder.latest.hung = true;
    await act(async () => {
      const stopping = api.stop().catch(error => error);
      await vi.advanceTimersByTimeAsync(5_001);
      expect(await stopping).toBeInstanceOf(Error);
    });
    expect(api.phase).toBe('error'); expect(track.stop).toHaveBeenCalled();
    expect([...mocks.drafts.values()][0].chunkCount).toBe(1);
    expect(mocks.release).toHaveBeenCalled();
  });

  it('keeps only the committed prefix after a disk write failure and offers it on restart', async () => {
    await start(); await emit();
    mocks.saveChunk.mockRejectedValueOnce(new Error('QuotaExceededError'));
    await emit();
    await act(async () => { await Promise.resolve(); });
    expect(api.phase).toBe('error'); expect(api.draft?.chunkCount).toBe(1);
    expect(mocks.chunks.size).toBe(1); expect(track.stop).toHaveBeenCalled();
    const candidate = { ...api.draft! };
    await act(async () => { root.unmount(); }); container.remove();
    await mount();
    expect(api.recoverableDrafts[0].id).toBe(candidate.id);
    await act(async () => { await api.restore(api.recoverableDrafts[0]); });
    expect(api.phase).toBe('stopped'); expect(api.draft?.chunkCount).toBe(1);
  });

  it('serializes server metadata behind chunk commits instead of overwriting the saved count', async () => {
    await start();
    let commit!: () => void;
    const save = mocks.saveChunk.getMockImplementation()!;
    mocks.saveChunk.mockImplementationOnce(async (...args) => { await new Promise<void>(resolve => { commit = resolve; }); await save(...args); });
    await act(async () => { Recorder.latest.emit(); });
    await act(async () => {
      const attaching = api.setServerDiscussionId('server');
      commit(); await attaching;
    });
    expect(mocks.drafts.get(api.draft!.id)).toMatchObject({ chunkCount: 1, serverDiscussionId: 'server' });
  });

  it('waits for the tail after a recorder error has already set its state inactive', async () => {
    await start();
    await act(async () => {
      Recorder.latest.state = 'inactive'; Recorder.latest.onerror?.();
      await Promise.resolve();
      Recorder.latest.emit('tail-after-error'); Recorder.latest.onstop?.();
    });
    expect(api.draft?.chunkCount).toBe(1); expect(api.phase).toBe('stopped');
  });

  it('finalizes local audio when its owner unmounts, allowing a new owner to recover it', async () => {
    await start(); await emit();
    await act(async () => { root.unmount(); }); container.remove();
    expect(track.stop).toHaveBeenCalled();
    await mount();
    expect(api.recoverableDrafts[0]).toMatchObject({ state: 'stopped', chunkCount: 2 });
  });

  it('still saves original audio and releases the microphone when live teardown throws', async () => {
    await start(); await emit();
    mocks.cancel.mockImplementationOnce(() => { throw new Error('AudioContext already disconnected'); });
    await act(async () => { await api.stop(); });
    expect(api.phase).toBe('stopped'); expect(api.draft?.chunkCount).toBe(2);
    expect(track.stop).toHaveBeenCalled();
  });


  it('commits a two-hour sequence and automatically finalizes with a recoverable contiguous prefix', async () => {
    await start();
    for (let index = 0; index < 1_439; index++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); Recorder.latest.emit(); });
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(api.phase).toBe('stopped');
    expect(api.draft).toMatchObject({ chunkCount: 1_440, durationMs: 7_200_000 });
    for (let index = 0; index < 1_440; index++) expect(mocks.chunks.has(`${api.draft!.id}:${index}`)).toBe(true);
    expect(track.stop).toHaveBeenCalled();
  });

  it('stops when a browser delivers an oversized delayed chunk without discarding the saved prefix', async () => {
    await start(); await emit();
    await act(async () => {
      Recorder.latest.ondataavailable?.({ data: new Blob([new Uint8Array(32 * 1024 * 1024 + 1)]) });
    });
    expect(api.phase).toBe('error'); expect(api.draft?.chunkCount).toBe(1);
    expect(mocks.chunks.size).toBe(1); expect(track.stop).toHaveBeenCalled();
  });

});
