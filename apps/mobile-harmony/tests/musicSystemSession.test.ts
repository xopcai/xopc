import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  create: vi.fn(), launchAgent: vi.fn(), startTask: vi.fn(), stopTask: vi.fn(), onCancel: vi.fn(), offCancel: vi.fn(),
}));
vi.mock('@kit.AbilityKit', () => ({ wantAgent: {
  getWantAgent: mock.launchAgent, OperationType: { START_ABILITY: 0 }, WantAgentFlags: { UPDATE_PRESENT_FLAG: 0 },
} }));
vi.mock('@kit.AVSessionKit', () => ({ avSession: {
  createAVSession: mock.create, PlaybackState: {
    PLAYBACK_STATE_PLAY: 2, PLAYBACK_STATE_PAUSE: 3, PLAYBACK_STATE_COMPLETED: 7,
    PLAYBACK_STATE_ERROR: 9, PLAYBACK_STATE_BUFFERING: 11,
  },
} }));
vi.mock('@kit.BackgroundTasksKit', () => ({ backgroundTaskManager: {
  ContinuousTaskRequest: class {},
  BackgroundTaskMode: { MODE_AUDIO_PLAYBACK: 2 },
  BackgroundTaskSubmode: { SUBMODE_NORMAL_NOTIFICATION: 2 },
  startBackgroundRunning: mock.startTask, stopBackgroundRunning: mock.stopTask,
  on: mock.onCancel, off: mock.offCancel,
} }));
vi.mock('@kit.PerformanceAnalysisKit', () => ({ hilog: { warn: vi.fn() } }));

import { XopcMusicSystemSession } from '../entry/src/main/ets/service/musicSystemSession.ets';

const track = { id: 'job', conversationId: 'chat', title: 'Rain', sourceTitle: 'Ada', durationMs: 120_000 };
const context = { abilityInfo: { bundleName: 'ai.xopc.xopc', name: 'EntryAbility' } };
const commands = { play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn() };

function setup() {
  const native = {
    on: vi.fn(), setAVMetadata: vi.fn(), setAVPlaybackState: vi.fn(),
    setLaunchAbility: vi.fn(), activate: vi.fn(), destroy: vi.fn(),
  };
  mock.create.mockResolvedValue(native);
  mock.startTask.mockResolvedValue({ continuousTaskId: 19 });
  mock.launchAgent.mockResolvedValue({ launch: true });
  const session = new XopcMusicSystemSession();
  session.attach(context as Parameters<typeof session.attach>[0]);
  return { session, native };
}

beforeEach(() => vi.resetAllMocks());

it('publishes milliseconds to the lock screen and releases only the music background task on pause', async () => {
  const { session, native } = setup();
  await session.prepare(track, commands);
  expect(native.setAVMetadata).toHaveBeenCalledWith({ assetId: 'job', title: 'Rain', artist: 'Ada', duration: 120_000 });
  native.on.mock.calls.find(([name]) => name === 'seek')?.[1](43_000);
  expect(commands.seek).toHaveBeenCalledWith(43);

  session.publish(track, 'playing', 43, 119);
  await vi.waitFor(() => expect(mock.startTask).toHaveBeenCalledOnce());
  expect(mock.startTask).toHaveBeenCalledWith(context, expect.objectContaining({
    backgroundTaskModes: [2], backgroundTaskSubmodes: [2],
  }));
  expect(native.setAVPlaybackState).toHaveBeenLastCalledWith(expect.objectContaining({
    state: 2, position: expect.objectContaining({ elapsedTime: 43_000 }),
  }));

  session.publish(track, 'paused', 44, 119);
  await session.suspend();
  expect(mock.stopTask).toHaveBeenCalledExactlyOnceWith(context, 19);
  expect(native.destroy).not.toHaveBeenCalled();
  await session.release();
  expect(native.destroy).toHaveBeenCalledOnce();
});

it('ignores controls from a session that is being replaced', async () => {
  const { session, native } = setup();
  await session.prepare(track, commands);
  const shutdown = session.release();
  native.on.mock.calls.find(([name]) => name === 'stop')?.[1]();
  await shutdown;
  expect(commands.stop).not.toHaveBeenCalled();
});
