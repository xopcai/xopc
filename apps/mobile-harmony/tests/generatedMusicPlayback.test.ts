import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return {
    download: vi.fn(), downloadLibrary: vi.fn(), remove: vi.fn(), open: vi.fn(),
    stop: vi.fn(), play: vi.fn(), pause: vi.fn(), seek: vi.fn(),
    prepare: vi.fn(), release: vi.fn(), publishSystem: vi.fn(),
    readResume: vi.fn(), writeResume: vi.fn(),
  };
});
vi.mock('@kit.CoreFileKit', () => ({ fileIo: {}, picker: {} }));
vi.mock('@kit.PerformanceAnalysisKit', () => ({ hilog: { warn: vi.fn() } }));
vi.mock('../entry/src/main/ets/service/generatedMediaFile.ets', () => ({
  downloadGeneratedMedia: mocks.download, downloadGatewayMediaFile: mocks.downloadLibrary, removeGeneratedMediaFile: mocks.remove,
}));
vi.mock('../entry/src/main/ets/service/chatMediaPlayback.ets', () => ({
  XopcChatMediaPlayback: class {
    state = 'idle';
    position = 0;
    open = mocks.open;
    stop = mocks.stop;
    play = mocks.play;
    pause = mocks.pause;
    seek = mocks.seek;
  },
}));
vi.mock('../entry/src/main/ets/service/musicSystemSession.ets', () => ({
  XopcMusicSystemSession: class {
    attach() {}
    prepare = mocks.prepare;
    suspend() { return Promise.resolve(); }
    release = mocks.release;
    publish = mocks.publishSystem;
  },
}));
vi.mock('../entry/src/main/ets/service/musicResumeStore.ets', () => ({
  readMusicResume: mocks.readResume,
  writeMusicResume: mocks.writeResume,
}));

import { XopcGeneratedMusicPlayback } from '../entry/src/main/ets/service/generatedMusicPlayback.ets';

function track(id: string, conversationId = 'chat') {
  return { id, conversationId, title: 'Rain', sourceTitle: 'Ada', durationMs: 120_000 };
}
function player() {
  const music = new XopcGeneratedMusicPlayback();
  music.attach({ cacheDir: '/cache', filesDir: '/files' } as Parameters<typeof music.attach>[0], async () => true);
  music.setGateway('gateway');
  return music;
}
function state(music: XopcGeneratedMusicPlayback, name: string) {
  music.player.state = name;
  mocks.open.mock.calls.at(-1)?.[4].onState(name);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.download.mockResolvedValue(1024);
  mocks.downloadLibrary.mockResolvedValue(1024);
  mocks.stop.mockResolvedValue(undefined);
  mocks.release.mockResolvedValue(undefined);
});

it('uses the same native player and media session for in-app and system controls', async () => {
  const music = player();
  await music.play('/cache', track('song'));
  state(music, 'playing');
  music.open();
  music.expanded = false;
  music.checkpoint();
  expect(music.matches('another-chat', 'song')).toBe(false);
  expect(music.matches('chat', 'song')).toBe(true);
  expect(mocks.open).toHaveBeenCalledTimes(1);

  const commands = mocks.prepare.mock.calls[0][1];
  commands.pause();
  expect(mocks.pause).toHaveBeenCalledOnce();
  state(music, 'paused');
  commands.play();
  await vi.waitFor(() => expect(mocks.play).toHaveBeenCalledOnce());
  expect(mocks.download).toHaveBeenCalledTimes(1);
  expect(mocks.publishSystem).toHaveBeenCalledWith(track('song'), 'paused', 0, 120);
});

it('previews another song without interrupting playback and starts library audio explicitly', async () => {
  const music = player();
  await music.play('/cache', track('first'));
  state(music, 'playing');
  const library = { ...track('second'), libraryItemId: 'item', libraryVersionId: 'version' };
  music.openPreview(library);
  expect(music.songId).toBe('first');
  expect(music.previewTrack).toEqual(library);
  expect(mocks.downloadLibrary).not.toHaveBeenCalled();
  music.closePreview();
  expect(music.previewTrack).toBeUndefined();
  expect(music.player.state).toBe('playing');
  await music.play('/cache', library);
  expect(mocks.downloadLibrary).toHaveBeenCalledWith('/api/spaces/items/item/versions/version/content',
    expect.any(String), expect.any(Function));
  expect(music.matches('chat', 'second')).toBe(true);
});

it('retries an interrupted song at its last position and ignores stale native callbacks', async () => {
  const music = player();
  await music.play('/cache', track('first'));
  const original = mocks.open.mock.calls[0];
  original[3](119);
  original[4].onPosition(37.2);
  state(music, 'error');
  await music.toggle();
  expect(mocks.open.mock.calls[1][4]).toMatchObject({ initialPosition: 37.2, music: true });
  await music.play('/cache', track('second'));
  original[3](122);
  original[4].onPosition(87);
  expect(music.durationFor('chat', 'first', 120_000)).toBe(119);
  expect(music.position).toBe(0);
  expect(music.songId).toBe('second');
});

it('discards the old download when a different conversation starts a song with the same ID', async () => {
  let finishOld!: (length: number) => void;
  mocks.download.mockImplementationOnce(() => new Promise<number>(resolve => { finishOld = resolve; }));
  const music = player();
  const old = music.play('/cache', track('song', 'old'));
  await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
  const [, , , oldPath, isCurrent] = mocks.download.mock.calls[0];
  await music.play('/cache', track('song', 'new'));
  expect(isCurrent()).toBe(false);
  finishOld(2048);
  await old;
  expect(mocks.open).toHaveBeenCalledTimes(1);
  expect(mocks.remove).toHaveBeenCalledWith(oldPath);
  expect(music.track?.conversationId).toBe('new');
});

it('waits for native release before starting a different track', async () => {
  const music = player();
  await music.play('/cache', track('first'));
  let finishStop!: () => void;
  mocks.stop.mockImplementationOnce(() => new Promise<void>(resolve => { finishStop = resolve; }));
  const second = music.play('/cache', track('second'));
  expect(mocks.download).toHaveBeenCalledTimes(1);
  finishStop();
  await second;
  expect(mocks.download).toHaveBeenCalledTimes(2);
});

it('offers cold resume without autoplay and clears the title and checkpoint across gateways', async () => {
  const saved = { gatewayId: 'gateway', track: track('song'), position: 57 };
  mocks.readResume.mockReturnValue(saved);
  const music = new XopcGeneratedMusicPlayback();
  music.attach({ cacheDir: '/cache', filesDir: '/files' } as Parameters<typeof music.attach>[0], async () => true);
  music.setGateway('gateway');
  expect(music.position).toBe(57);
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
  await music.resume();
  expect(mocks.open.mock.calls[0][4].initialPosition).toBe(57);
  music.setGateway('another-gateway');
  expect(music.track).toBeUndefined();
  expect(music.position).toBe(0);
  expect(mocks.writeResume).toHaveBeenLastCalledWith('/files');
});

it('cancels pending autoplay when the microphone is requested during a download', async () => {
  let finish!: (length: number) => void;
  mocks.download.mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve; }));
  const music = player();
  const playing = music.play('/cache', track('song'));
  await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledOnce());
  await music.pause();
  finish(1024);
  await playing;
  expect(mocks.open.mock.calls[0][2]).toBe(false);
  expect(mocks.prepare).not.toHaveBeenCalled();
});
