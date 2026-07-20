import { afterEach, describe, expect, it } from 'vitest';

import {
  _clearMediaUnderstandingRegistryForTests,
  registerMediaUnderstandingProvider,
} from '../registry.js';
import { runAudioTranscription } from '../audio-transcription-runner.js';
import type { AudioTranscriptionRequest } from '../types.js';

describe('runAudioTranscription', () => {
  afterEach(() => {
    _clearMediaUnderstandingRegistryForTests();
  });

  it('propagates upload metadata and cancellation while recording real latency', async () => {
    let captured: AudioTranscriptionRequest | undefined;
    registerMediaUnderstandingProvider({
      id: 'test-local',
      capabilities: ['audio'],
      requiresApiKey: false,
      async transcribeAudio(req) {
        captured = req;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { text: 'hello', model: 'test-model' };
      },
    });
    const controller = new AbortController();

    const result = await runAudioTranscription({
      providers: [{ id: 'test-local', model: 'test-model' }],
      attachments: [
        {
          attachmentIndex: 0,
          buffer: Buffer.from('audio'),
          fileName: 'recording.webm',
          mime: 'audio/webm;codecs=opus',
        },
      ],
      timeoutMs: 60_000,
      signal: controller.signal,
    });

    expect(captured?.fileName).toBe('recording.webm');
    expect(captured?.mime).toBe('audio/webm;codecs=opus');
    expect(captured?.signal).toBe(controller.signal);
    expect(result.decision.attachments[0]?.chosen?.latencyMs).toBeGreaterThanOrEqual(10);
  });
});
