import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { download: vi.fn(), remove: vi.fn(), open: vi.fn(), stop: vi.fn(), toggle: vi.fn() };
});
vi.mock('../entry/src/main/ets/service/generatedMediaFile.ets', () => ({
  downloadGeneratedMedia: mocks.download, removeGeneratedMediaFile: mocks.remove,
}));
vi.mock('../entry/src/main/ets/service/chatMediaPlayback.ets', () => ({
  XopcChatMediaPlayback: class {
    state = 'playing';
    open = mocks.open;
    stop = mocks.stop;
    toggle = mocks.toggle;
  },
}));

import { XopcGeneratedMusicPlayback } from '../entry/src/main/ets/service/generatedMusicPlayback.ets';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.download.mockResolvedValue(1024);
});

it('pauses and resumes a selected song without downloading it again', async () => {
  const music = new XopcGeneratedMusicPlayback();
  await music.play('/cache', 'chat', 'song');
  await music.play('/cache', 'chat', 'song');
  await music.play('/cache', 'chat', 'song');
  expect(mocks.download).toHaveBeenCalledTimes(1);
  expect(mocks.open).toHaveBeenCalledWith(expect.stringMatching(/^\/cache\/generated-music-/), 1024, true, expect.any(Function));
  expect(mocks.toggle).toHaveBeenCalledTimes(2);
  expect(music.songId).toBe('song');
});

it('uses the measured duration for the same song after closing and ignores stale player callbacks', async () => {
  const music = new XopcGeneratedMusicPlayback();
  expect(music.durationFor('first', 125_000)).toBe(125);
  await music.play('/cache', 'chat', 'first');
  const firstDuration = mocks.open.mock.calls[0][3] as (seconds: number) => void;
  firstDuration(123.4);
  expect(music.durationFor('first', 125_000)).toBe(123.4);
  await music.play('/cache', 'chat', 'second');
  firstDuration(122);
  expect(music.durationFor('first', 125_000)).toBe(123.4);
  expect(music.durationFor('second', 100_000)).toBe(100);
  const secondDuration = mocks.open.mock.calls[1][3] as (seconds: number) => void;
  secondDuration(98);
  await music.stop();
  expect(music.durationFor('second', 100_000)).toBe(98);
  music.clearDurations();
  expect(music.durationFor('second', 100_000)).toBe(100);
});

it('discards the old download if another song starts first', async () => {
  let finishOld!: (length: number) => void;
  mocks.download.mockImplementationOnce(() => new Promise<number>(resolve => { finishOld = resolve; }));
  const music = new XopcGeneratedMusicPlayback();
  const old = music.play('/cache', 'chat', 'old');
  await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
  const [, , , oldPath, isCurrent] = mocks.download.mock.calls[0];
  await music.play('/cache', 'chat', 'new');
  expect(isCurrent()).toBe(false);
  finishOld(2048);
  await old;
  expect(mocks.open).toHaveBeenCalledTimes(1);
  expect(mocks.remove).toHaveBeenCalledWith(oldPath);
  expect(music.songId).toBe('new');
  expect(music.loading).toBe(false);
});

it('waits for the previous native player to release before starting another', async () => {
  const music = new XopcGeneratedMusicPlayback();
  await music.play('/cache', 'chat', 'first');
  let finishStop!: () => void;
  mocks.stop.mockImplementationOnce(() => new Promise<void>(resolve => { finishStop = resolve; }));
  const second = music.play('/cache', 'chat', 'second');
  expect(mocks.download).toHaveBeenCalledTimes(1);
  finishStop();
  await second;
  expect(mocks.download).toHaveBeenCalledTimes(2);
  expect(music.songId).toBe('second');
});
