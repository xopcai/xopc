import { beforeEach, describe, expect, it, vi } from 'vitest';

const sttMocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
}));

vi.mock('../../../voice/stt/index.js', () => ({
  isSTTAvailable: () => true,
  transcribe: sttMocks.transcribe,
}));

import { mergeVoiceTranscriptsIntoUserText } from '../voice-stt-webchat.js';

describe('mergeVoiceTranscriptsIntoUserText', () => {
  beforeEach(() => {
    sttMocks.transcribe.mockReset();
    sttMocks.transcribe.mockResolvedValue({ text: '你好', provider: 'xopc-local' });
  });

  it('passes the original mobile recording name and mime type to STT', async () => {
    await mergeVoiceTranscriptsIntoUserText(
      [{
        type: 'voice',
        mimeType: 'audio/mp4',
        name: 'voice.m4a',
        size: 3,
        data: Buffer.from('abc').toString('base64'),
      }],
      '',
      { enabled: true, provider: 'xopc-local' },
    );

    expect(sttMocks.transcribe).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ provider: 'xopc-local' }),
      expect.objectContaining({
        fileName: 'voice.m4a',
        mime: 'audio/mp4',
      }),
    );
  });

  it('preserves an actionable marker when the gateway decoder is missing', async () => {
    sttMocks.transcribe.mockRejectedValueOnce(
      new Error('Audio decoder is unavailable; install ffmpeg'),
    );

    const result = await mergeVoiceTranscriptsIntoUserText(
      [{
        type: 'voice',
        mimeType: 'audio/mp4',
        name: 'voice.m4a',
        size: 3,
        data: Buffer.from('abc').toString('base64'),
      }],
      '',
      { enabled: true, provider: 'xopc-local' },
    );

    expect(result.voiceTranscripts).toEqual(['[STT failed: audio decoder unavailable]']);
  });
});
