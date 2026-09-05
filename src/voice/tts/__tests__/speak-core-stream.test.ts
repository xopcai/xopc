import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  primaryStream: vi.fn(),
  fallbackStream: vi.fn(),
}));

vi.mock('../factory.js', () => {
  const primary = {
    providerId: 'alibaba',
    providerConfig: {},
    timeoutMs: 1_000,
    plugin: { id: 'alibaba', synthesizeStream: mocks.primaryStream },
  };
  const fallback = {
    providerId: 'edge',
    providerConfig: {},
    timeoutMs: 1_000,
    plugin: { id: 'edge', synthesizeStream: mocks.fallbackStream },
  };
  return {
    resolveSpeechProvider: () => primary,
    resolveSpeechProviderChain: () => [primary, fallback],
  };
});

import { speakStream } from '../speak-core.js';
import type { TTSConfig } from '../types.js';

const config = {
  enabled: true,
  provider: 'alibaba',
  trigger: 'always',
  summarization: { enabled: false },
  modelOverrides: { enabled: false },
} as TTSConfig;

function streamResult() {
  return {
    audioStream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
    outputFormat: 'pcm',
    fileExtension: 'pcm',
    voiceCompatible: false,
  };
}

describe('speakStream fallback control', () => {
  beforeEach(() => {
    mocks.primaryStream.mockReset();
    mocks.fallbackStream.mockReset();
  });

  it('does not change route when fallback is disabled', async () => {
    mocks.primaryStream.mockRejectedValueOnce(new Error('primary failed'));
    mocks.fallbackStream.mockResolvedValueOnce(streamResult());

    await expect(speakStream('hello', config, { allowFallback: false })).rejects.toThrow('primary failed');
    expect(mocks.fallbackStream).not.toHaveBeenCalled();
  });

  it('keeps the existing stream fallback behavior by default', async () => {
    mocks.primaryStream.mockRejectedValueOnce(new Error('primary failed'));
    mocks.fallbackStream.mockResolvedValueOnce(streamResult());

    const result = await speakStream('hello', config);

    expect(result.provider).toBe('edge');
    expect(mocks.fallbackStream).toHaveBeenCalledOnce();
  });
  it('never calls a provider for an already-cancelled reply', async () => {
    const controller = new AbortController();
    controller.abort('client_cancelled');
    await expect(speakStream('hello', config, { signal: controller.signal })).rejects.toBe('client_cancelled');
    expect(mocks.primaryStream).not.toHaveBeenCalled();
    expect(mocks.fallbackStream).not.toHaveBeenCalled();
  });

  it('does not treat caller cancellation as a reason to try another provider', async () => {
    const controller = new AbortController();
    mocks.primaryStream.mockImplementationOnce(async () => {
      controller.abort('barge_in');
      throw new DOMException('Interrupted', 'AbortError');
    });
    mocks.fallbackStream.mockResolvedValueOnce(streamResult());
    await expect(speakStream('hello', config, { signal: controller.signal })).rejects.toBe('barge_in');
    expect(mocks.fallbackStream).not.toHaveBeenCalled();
  });

  it('releases a provider stream that becomes ready after cancellation', async () => {
    const controller = new AbortController();
    const release = vi.fn(async () => {});
    mocks.primaryStream.mockImplementationOnce(async () => {
      controller.abort('client_cancelled');
      return { ...streamResult(), release };
    });
    await expect(speakStream('hello', config, { signal: controller.signal })).rejects.toBe('client_cancelled');
    expect(release).toHaveBeenCalledOnce();
    expect(mocks.fallbackStream).not.toHaveBeenCalled();
  });

});
