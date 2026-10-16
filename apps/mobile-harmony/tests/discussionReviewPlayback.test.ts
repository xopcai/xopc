import { beforeEach,expect,it,vi } from 'vitest';
const mocks = vi.hoisted(() => {
  Object.assign(globalThis,{ ObservedV2: (value: unknown) => value,Trace: () => undefined });
  return { clip: vi.fn(),open: vi.fn(),stop: vi.fn(),position: vi.fn(),write: vi.fn(),unlink: vi.fn() };
});
vi.mock('@kit.AbilityKit', () => ({}));
vi.mock('@kit.ArkTS', () => ({ util: { generateRandomUUID: () => 'file' } }));
vi.mock('@kit.CoreFileKit', () => ({ fileIo: { OpenMode: { CREATE: 1,WRITE_ONLY: 2 },open: async () => ({ fd: 1 }),write: mocks.write,close: async () => {},unlink: mocks.unlink } }));
vi.mock('../entry/src/main/ets/repository/discussionCaptureRepository.ets', () => ({ XopcDiscussionCaptureRepository: class { audioClip = mocks.clip; } }));
vi.mock('../entry/src/main/ets/service/discussionAnnotations.ets', () => ({ XopcAnnotationStore: class { initialize = async () => {}; saveReviewPosition = mocks.position; } }));
vi.mock('../entry/src/main/ets/service/chatMediaPlayback.ets', () => ({ XopcChatMediaPlayback: class { position = 0; open = mocks.open; stop = mocks.stop; } }));
import { XopcDiscussionReviewPlayback } from '../entry/src/main/ets/service/discussionReviewPlayback.ets';
beforeEach(() => { vi.clearAllMocks(); mocks.clip.mockResolvedValue(new ArrayBuffer(100)); mocks.write.mockResolvedValue(100); });
it('plays a bounded source clip and saves the source-relative position on stop', async () => {
  const playback = new XopcDiscussionReviewPlayback();
  await playback.play({ cacheDir: '/cache' } as never,'note','discussion',{ startedAtMs: 3000,endedAtMs: 200000 },'audio');
  expect(mocks.clip).toHaveBeenCalledWith('discussion',3000,123000); expect(mocks.open).toHaveBeenCalledOnce();
  playback.player.position = 3.5; await playback.stop();
  expect(mocks.position).toHaveBeenCalledWith('note',6500,'audio'); expect(mocks.unlink).toHaveBeenCalled(); expect(playback.noteId).toBe('');
});
it('does not play a late response after another Note takes ownership', async () => {
  let finish!: (value: ArrayBuffer) => void; mocks.clip.mockImplementationOnce(() => new Promise(done => { finish = done; }));
  const playback = new XopcDiscussionReviewPlayback(); const old = playback.play({ cacheDir: '/cache' } as never,'old','old-discussion',{ startedAtMs: 0,endedAtMs: 1000 });
  await vi.waitFor(() => expect(mocks.clip).toHaveBeenCalledOnce());
  await playback.play({ cacheDir: '/cache' } as never,'new','new-discussion',{ startedAtMs: 2000,endedAtMs: 3000 });
  finish(new ArrayBuffer(100)); await old;
  expect(playback.noteId).toBe('new'); expect(mocks.open).toHaveBeenCalledTimes(1);
});
it('retains a clear error instead of claiming playback when original audio is unavailable', async () => {
  mocks.clip.mockRejectedValue(new Error('404 Original audio unavailable'));
  const playback = new XopcDiscussionReviewPlayback(); await playback.play({ cacheDir: '/cache' } as never,'note','discussion',{ startedAtMs: 0,endedAtMs: 1000 });
  expect(playback.error).toContain('unavailable'); expect(mocks.open).not.toHaveBeenCalled();
});

it('closes and removes a partial playback cache on short writes', async () => {
  mocks.write.mockResolvedValueOnce(1); const playback = new XopcDiscussionReviewPlayback();
  await playback.play({ cacheDir: '/cache' } as never,'note','discussion',{ startedAtMs: 0,endedAtMs: 1000 });
  expect(playback.error).toBe('INCOMPLETE_MEDIA'); expect(mocks.unlink).toHaveBeenCalledWith('/cache/note-review-file.wav'); expect(mocks.open).not.toHaveBeenCalled();
});
