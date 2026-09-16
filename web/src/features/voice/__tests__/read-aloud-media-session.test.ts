// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { claimReadAloudMediaSession, releaseReadAloudMediaSession, updateReadAloudMediaSession } from '../read-aloud-media-session';

describe('system read aloud controls', () => {
  afterEach(() => { releaseReadAloudMediaSession(); vi.restoreAllMocks(); });
  it('routes headset controls to playback and releases them when audio ownership changes', () => {
    const handlers = new Map<string, MediaSessionActionHandler | null>();
    const session = { metadata: null, playbackState: 'none', setPositionState: vi.fn(), setActionHandler: vi.fn((action, handler) => handlers.set(action, handler)) };
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: session });
    const controls = { resume: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn(), position: () => 20 };
    claimReadAloudMediaSession(controls);
    handlers.get('pause')?.({ action: 'pause' });
    expect(controls.pause).toHaveBeenCalledOnce();
    handlers.get('seekbackward')?.({ action: 'seekbackward', seekOffset: 5 });
    expect(controls.seek).toHaveBeenCalledWith(15);
    updateReadAloudMediaSession({ source: { title: 'Title' }, status: 'playing', currentTime: 20, duration: 40, durationComplete: false, rate: 1 });
    expect(session.setPositionState).toHaveBeenLastCalledWith(undefined);
    updateReadAloudMediaSession({ source: { title: 'Title' }, status: 'paused', currentTime: 20, duration: 40, durationComplete: true, rate: 1.5 });
    expect(session.setPositionState).toHaveBeenLastCalledWith({ duration: 40, position: 20, playbackRate: 1.5 });
    releaseReadAloudMediaSession();
    expect(session.playbackState).toBe('none');
    expect([...handlers.values()].every((handler) => handler === null)).toBe(true);
  });
});
