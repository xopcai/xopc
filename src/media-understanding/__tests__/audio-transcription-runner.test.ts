import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderUsageScopeError } from '../../providers/model-usage.js';

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

  it('rejects a restricted plan before invocation and does not try another provider', async () => {
    const primary = vi.fn(); const fallback = vi.fn();
    registerMediaUnderstandingProvider({ id: 'qwen-token-plan-cn', capabilities: ['audio'], requiresApiKey: false, transcribeAudio: primary });
    registerMediaUnderstandingProvider({ id: 'paid-fallback', capabilities: ['audio'], requiresApiKey: false, transcribeAudio: fallback });
    await expect(runAudioTranscription({ providers: [{ id: 'qwen-token-plan-cn', model: 'stt' }, { id: 'paid-fallback', model: 'stt' }],
      attachments: [{ attachmentIndex: 0, buffer: Buffer.from('audio'), mime: 'audio/webm' }], timeoutMs: 1000,
    })).rejects.toThrow(ProviderUsageScopeError);
    expect(primary).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled();
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
        return {
          text: 'hello',
          model: 'test-model',
          language: 'en',
          durationSeconds: 2.5,
        };
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
    expect(result.outputs[0]).toMatchObject({ language: 'en', durationSeconds: 2.5 });
  });
});
