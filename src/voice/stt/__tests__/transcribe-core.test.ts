import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveSTTProviderChain: vi.fn(),
  runAudioTranscription: vi.fn(),
}));

vi.mock('../../../media-understanding/audio-transcription-runner.js', () => ({
  runAudioTranscription: mocks.runAudioTranscription,
}));

vi.mock('../factory.js', () => ({
  resolveSTTProviderChain: mocks.resolveSTTProviderChain,
}));

import { transcribe } from '../transcribe-core.js';

describe('STT transcription outcomes', () => {
  beforeEach(() => {
    mocks.resolveSTTProviderChain.mockReset().mockReturnValue([
      { id: 'xopc-local', model: 'sensevoice-small' },
    ]);
    mocks.runAudioTranscription.mockReset();
  });

  it('returns an empty successful result when providers detect no speech', async () => {
    mocks.runAudioTranscription.mockResolvedValue({
      decision: {
        capability: 'audio',
        task: 'failed',
        attachments: [{
          attachmentIndex: 0,
          attempts: [{
            provider: 'xopc-local',
            type: 'provider',
            task: 'failed',
            reason: 'empty transcription/description text',
            latencyMs: 12,
          }],
        }],
      },
      outputs: [],
    });

    await expect(transcribe(Buffer.from('audio'), {
      enabled: true,
      provider: 'xopc-local',
    })).resolves.toMatchObject({
      text: '',
      provider: 'xopc-local',
      attempts: [{ reasonCode: 'no_speech' }],
    });
  });
});
