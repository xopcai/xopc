import { describe, expect, it } from 'vitest';
import { VoiceDiagnostics, voiceDiagnosticFinding } from '../voice-diagnostics';

describe('voice audio diagnostics', () => {
  it('distinguishes no audio, silence, queueing, playback and cancellation without retaining content', () => {
    const diagnostics = new VoiceDiagnostics();
    diagnostics.start();
    expect(voiceDiagnosticFinding(diagnostics.snapshot().responses.at(-1))).toBe('noResponse');
    diagnostics.response('reply');
    diagnostics.text('reply', 10);
    const finding = () => voiceDiagnosticFinding(diagnostics.snapshot().responses.at(-1));
    expect(finding()).toBe('noAudio');
    diagnostics.received('reply', new Uint8Array(4));
    expect(finding()).toBe('silentAudio');
    const backing = new Uint8Array([255, 0, 128, 255]);
    diagnostics.received('reply', backing.subarray(1, 3));
    expect(finding()).toBe('notQueued');
    diagnostics.queued('reply', 6);
    expect(finding()).toBe('notPlayed');
    diagnostics.played('reply', 6);
    diagnostics.played('reply', 2);
    expect(finding()).toBe('played');
    diagnostics.cancelled('reply', 'barge_in');
    expect(finding()).toBe('cancelled');
    expect(diagnostics.snapshot().responses[0]).toEqual({ responseId: 'reply', textCharacters: 10,
      receivedBytes: 6, queuedBytes: 6, playedBytes: 6, peakAmplitude: 32768,
      invalidPcmFrames: 0, cancelReason: 'barge_in' });
  });

  it('bounds retained responses, isolates snapshots and resets for a new call', () => {
    const diagnostics = new VoiceDiagnostics();
    diagnostics.start();
    diagnostics.setEngine('agent');
    diagnostics.inputResult(640, { accepted: true, queueAgeMs: 80 });
    diagnostics.inputResult(640, { accepted: false, queueAgeMs: 320 });
    diagnostics.congestionPause();
    diagnostics.rtt(45);
    diagnostics.route({ output: 'speaker', echoControl: 'verified', fullDuplex: true });
    for (let i = 0; i < 10; i++) diagnostics.response(String(i));
    diagnostics.received('9', new Uint8Array([1]));
    diagnostics.done('9', 'text_only');
    diagnostics.error('RESPONSE_FAILED');
    diagnostics.end('network');
    const snapshot = diagnostics.snapshot();
    expect(snapshot).toMatchObject({ engine: 'agent', inputBytes: 640, responseCount: 10,
      errorCode: 'RESPONSE_FAILED', endReason: 'network' });
    expect(snapshot).toMatchObject({
      network: { latestRttMs: 45, maxRttMs: 45, peakInputQueueAgeMs: 320, droppedInputFrames: 1, congestionPauses: 1 },
      audioRoute: { output: 'speaker', echoControl: 'verified', fullDuplex: true },
    });
    expect(snapshot.responses).toHaveLength(5);
    expect(snapshot.responses.at(-1)).toMatchObject({ invalidPcmFrames: 1, finishReason: 'text_only' });
    snapshot.responses[0].playedBytes = 999;
    expect(diagnostics.snapshot().responses[0].playedBytes).toBe(0);
    diagnostics.start();
    expect(diagnostics.snapshot()).toMatchObject({ inputBytes: 0, responseCount: 0, responses: [],
      engine: undefined, errorCode: undefined, endReason: undefined });
  });
});
