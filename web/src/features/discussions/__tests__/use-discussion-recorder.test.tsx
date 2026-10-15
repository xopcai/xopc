// @vitest-environment jsdom
import { act } from 'react';
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
    await start(); expect(api.phase).toBe('recording');
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
