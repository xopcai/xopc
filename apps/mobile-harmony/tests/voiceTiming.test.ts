import { describe, expect, it } from 'vitest';
import { XopcVoiceTiming } from '../entry/src/main/ets/common/voiceTiming.ets';

describe('Harmony voice phase timing', () => {
  it('separates receipt, buffering and observed playback and emits only one first-audio metric', () => {
    const timing = new XopcVoiceTiming();
    timing.speechStopped(100); timing.created('first', 300);
    expect(timing.received('first', 400)).toBe(300);
    expect(timing.received('first', 420)).toBeUndefined();
    timing.buffered('first', 20, 450); timing.buffered('first', 40, 460);
    timing.played('first', 20, 500, 'timestamp'); timing.played('first', 40, 550, 'drain');
    expect(timing.finish('first', 'natural', 'speaker', 'completed')).toMatchObject({
      speechStopToResponseMs: 200, speechStopToAudioReceivedMs: 300,
      audioReceivedToBufferedMs: 50, audioReceivedToPlaybackProgressMs: 100,
      bufferedDurationMs: 40, playedDurationMs: 40,
    });
    expect(timing.finish('first', 'natural', 'speaker', 'completed')).toBeUndefined();
  });

  it('does not turn a drain acknowledgement into a first-sound measurement', () => {
    const timing = new XopcVoiceTiming(); timing.created('reply', 100); timing.received('reply', 200);
    timing.played('reply', 1000, 1500, 'drain');
    expect(timing.finish('reply', 'assistant', 'headset', 'completed')?.audioReceivedToPlaybackProgressMs).toBeUndefined();
  });

  it('preserves queued reply timing across handoff and clears endpoints on reset', () => {
    const timing = new XopcVoiceTiming(); timing.created('first', 10);
    timing.speechStopped(100); timing.created('second', 200); timing.received('second', 300);
    timing.finish('first', 'natural', 'speaker', 'completed');
    timing.created('second', 500); timing.buffered('second', 20, 600);
    expect(timing.finish('second', 'natural', 'speaker', 'completed')).toMatchObject({
      speechStopToResponseMs: 100, speechStopToAudioReceivedMs: 200, audioReceivedToBufferedMs: 300,
    });
    timing.speechStopped(700); timing.reset(); timing.created('new-session', 900);
    expect(timing.received('new-session', 1000)).toBeUndefined();
  });
});
