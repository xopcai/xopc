import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  instances: [] as Array<{ end: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }>,
  start: vi.fn(),
  getInstances: vi.fn(),
}));

vi.mock('../../../widgets/ReadAloudLiveActivity', () => ({
  ReadAloudLiveActivity: {
    start: mocks.start,
    getInstances: mocks.getInstances,
  },
}));

const snapshot = {
  sessionKey: 'agent:main/session one',
  title: 'AI response',
  status: 'preparing' as const,
  currentChunkIndex: 0,
  chunkCount: 3,
  rate: 1,
};

describe('read aloud Live Activity', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.instances = [];
    mocks.start.mockReset();
    mocks.getInstances.mockReset();
    mocks.getInstances.mockImplementation(() => mocks.instances);
    mocks.start.mockImplementation(() => {
      const instance = { end: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined) };
      mocks.instances = [instance];
      return instance;
    });
  });

  it('starts, updates, and immediately ends one activity', async () => {
    const activity = await import('../read-aloud-live-activity.ios');
    activity.startReadAloudLiveActivity(snapshot);

    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    const instance = mocks.instances[0];
    expect(mocks.start).toHaveBeenCalledWith({
      title: 'AI response',
      detail: 'Preparing · 1×',
      status: 'preparing',
      progress: 0,
    }, 'xopc://chat/agent%3Amain%2Fsession%20one');

    activity.updateReadAloudLiveActivity({
      ...snapshot,
      status: 'paused',
      currentChunkIndex: 1,
      rate: 1.25,
    });
    await vi.waitFor(() => expect(instance?.update).toHaveBeenCalledWith(expect.objectContaining({
      detail: '2/3 · 1.25×',
      progress: 1 / 3,
      status: 'paused',
    })));

    activity.endReadAloudLiveActivity();
    await vi.waitFor(() => expect(instance?.end).toHaveBeenCalledWith('immediate'));
  });

  it('does not start an activity after playback is cancelled', async () => {
    const activity = await import('../read-aloud-live-activity.ios');
    activity.startReadAloudLiveActivity(snapshot);
    activity.endReadAloudLiveActivity();

    await vi.waitFor(() => expect(mocks.getInstances).toHaveBeenCalled());
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
