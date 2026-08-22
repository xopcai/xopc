import { describe, expect, it, vi } from 'vitest';

import {
  claimAudioPlayback,
  pauseActiveAudioPlayback,
  releaseAudioPlayback,
} from '../audio-playback-coordinator';

describe('audio playback coordinator', () => {
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
