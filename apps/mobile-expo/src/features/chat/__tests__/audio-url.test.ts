import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../stores/gateway-store', () => ({
  useGatewayStore: {
    getState: () => ({
      apiUrl: (path: string) => `http://gateway.test${path.startsWith('/') ? path : `/${path}`}`,
    }),
  },
}));

import { resolveAudioPlaybackUrl } from '../audio-url';

describe('resolveAudioPlaybackUrl', () => {
  it('converts media:// audio uris to the gateway media read endpoint', () => {
    expect(resolveAudioPlaybackUrl(
      { type: 'audio', uri: 'media://tts/reply.mp3' },
      'agent:main:webchat:default:direct:chat_1',
    )).toBe(
      'http://gateway.test/api/media/read?uri=media%3A%2F%2Ftts%2Freply.mp3&sessionKey=agent%3Amain%3Awebchat%3Adefault%3Adirect%3Achat_1',
    );
  });

  it('keeps regular audio uris unchanged', () => {
    expect(resolveAudioPlaybackUrl({ type: 'audio', uri: 'file:///tmp/voice.m4a' })).toBe('file:///tmp/voice.m4a');
  });
});
