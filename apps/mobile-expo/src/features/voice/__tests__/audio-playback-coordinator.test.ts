import { describe, expect, it, vi } from 'vitest';

import {
  claimAudioPlayback,
  claimAudioCapture,
  releaseAudioCapture,
  pauseActiveAudioPlayback,
  releaseAudioPlayback,
} from '../audio-playback-coordinator';

describe('audio playback coordinator', () => {
  it('never steals a microphone or releases another capture owner', () => {
    const call = Symbol('call'); const memo = Symbol('memo');
    expect(claimAudioCapture(call)).toBe(true);
    expect(claimAudioCapture(memo)).toBe(false);
    releaseAudioCapture(memo);
    expect(() => claimAudioPlayback('reply', vi.fn())).toThrow('Microphone');
    releaseAudioCapture(call);
    expect(claimAudioCapture(memo)).toBe(true);
    releaseAudioCapture(memo);
  });
  it('pauses the previous owner and keeps only one active audio source', () => {
    const pauseFirst = vi.fn();
    const pauseSecond = vi.fn();

    claimAudioPlayback('first', pauseFirst);
    claimAudioPlayback('second', pauseSecond);
    expect(pauseFirst).toHaveBeenCalledOnce();

    pauseActiveAudioPlayback();
    expect(pauseSecond).toHaveBeenCalledOnce();

    releaseAudioPlayback('second');
    pauseActiveAudioPlayback();
    expect(pauseSecond).toHaveBeenCalledOnce();
  });
});
