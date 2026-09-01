import { beforeEach, describe, expect, it, vi } from 'vitest';

const persistOutboundTtsAudioMock = vi.fn();

vi.mock('../../../voice/tts/speak-core.js', () => ({
  speak: vi.fn(async () => ({
    audio: Buffer.from('speech'),
    format: 'mp3',
    provider: 'edge',
  })),
}));

vi.mock('../../../voice/tts/merge-config.js', () => ({
  mergeTtsConfigFromAppConfig: vi.fn(() => ({ enabled: true, maxTextLength: 4096 })),
}));

vi.mock('../../../voice/tts/service.js', () => ({
  getChannelOutputFormat: vi.fn(() => ({ format: 'mp3', voiceCompatible: true })),
}));

vi.mock('../../../voice/tts/audio.js', () => ({
  compressAudio: vi.fn(async (buffer: Buffer) => ({ buffer, format: 'mp3' })),
}));

vi.mock('../../../channels/attachments/outbound-tts-persist.js', () => ({
  persistOutboundTtsAudio: (...args: unknown[]) => persistOutboundTtsAudioMock(...args),
}));

import { createTextToSpeechTool } from '../tts-tool.js';

const media = {
  id: 'assist---id.mp3',
  bucket: 'tts',
  type: 'voice',
  mimeType: 'audio/mpeg',
  name: 'assist---id.mp3',
  size: 6,
  uri: 'media://tts/assist---id.mp3',
  path: '/state/media/tts/assist---id.mp3',
};

describe('text_to_speech', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistOutboundTtsAudioMock.mockResolvedValue(media);
  });

  it('attaches persisted audio to Webchat without using a channel adapter', async () => {
    const publishOutbound = vi.fn();
    const tool = createTextToSpeechTool({
      bus: { publishOutbound } as never,
      getContext: () => ({ channel: 'webchat', chatId: 'agent:main:main' }),
      getConfig: () => undefined,
    });

    const result = await tool.execute('call-1', { text: 'Hello' });

    expect(publishOutbound).not.toHaveBeenCalled();
    expect(persistOutboundTtsAudioMock).toHaveBeenCalledWith(Buffer.from('speech'), 'mp3');
    expect(result.details).toEqual({
      provider: 'edge',
      format: 'mp3',
      media: [media],
    });
    expect(result.content[0]?.text).toContain('Attached voice message');
  });

  it('keeps non-Webchat delivery on the channel adapter path', async () => {
    const publishOutbound = vi.fn().mockResolvedValue(undefined);
    const tool = createTextToSpeechTool({
      bus: { publishOutbound } as never,
      getContext: () => ({ channel: 'telegram', chatId: '123456' }),
      getConfig: () => undefined,
    });

    const result = await tool.execute('call-1', { text: 'Hello' });

    expect(publishOutbound).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'telegram',
      mediaType: 'audio',
      mediaUrl: expect.stringMatching(/^data:audio\/mpeg;base64,/),
    }));
    expect(persistOutboundTtsAudioMock).not.toHaveBeenCalled();
    expect(result.details).toEqual({ provider: 'edge', format: 'mp3' });
    expect(result.content[0]?.text).toContain('Sent voice message');
  });
});
