import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../../config/schema.js';
import {
  isSuccessfulWebchatTtsToolEvent,
  maybeEmitWebchatTts,
} from '../webchat-tts.js';
import { speak } from '../../../voice/tts/index.js';

const persistence = vi.hoisted(() => ({
  append: vi.fn(() => true),
  findLatest: vi.fn(() => 'assistant-entry-1'),
  removeUnused: vi.fn(async () => {}),
}));

vi.mock('../../../storage/sqlite/index.js', () => ({
  appendMediaToAssistantTranscriptEntry: persistence.append,
  findLatestAssistantTranscriptEntryId: persistence.findLatest,
}));

vi.mock('../../../media/session-references.js', () => ({
  deleteMediaUris: persistence.removeUnused,
}));

vi.mock('../../../voice/tts/factory.js', () => ({
  isTTSAvailable: vi.fn(() => true),
}));

vi.mock('../../../voice/tts/index.js', () => ({
  speak: vi.fn(async () => ({
    audio: Buffer.from('speech'),
    format: 'mp3',
    provider: 'edge',
  })),
}));

vi.mock('../../../voice/tts/audio.js', () => ({
  compressAudio: vi.fn(async (buffer: Buffer, format: string) => ({ buffer, format })),
}));

vi.mock('../../../channels/attachments/outbound-tts-persist.js', () => ({
  persistOutboundTtsAudio: vi.fn(async () => ({
    id: 'reply---uuid.mp3',
    bucket: 'tts',
    type: 'voice',
    mimeType: 'audio/mpeg',
    name: 'reply.mp3',
    size: 6,
    uri: 'media://tts/reply---uuid.mp3',
    path: '/tmp/reply.mp3',
  })),
}));

describe('maybeEmitWebchatTts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistence.append.mockReturnValue(true);
    persistence.findLatest.mockReturnValue('assistant-entry-1');
  });

  it('uses the webchat cached assistant plain text when generating TTS', async () => {
    const getLastAssistantPlainText = vi.fn(() => 'hello from cache');

    const result = await maybeEmitWebchatTts(
      {
        config: {
          messages: {
            tts: {
              enabled: true,
              provider: 'edge',
              trigger: 'always',
              providers: { edge: { enabled: true } },
            },
          },
        } as unknown as Config,
        getLastAssistantPlainText,
        log: { warn: vi.fn() },
      },
      'agent:main:main',
      false,
    );

    expect(result).toEqual({
      type: 'tts_audio',
      uri: 'media://tts/reply---uuid.mp3',
      mimeType: 'audio/mpeg',
      name: 'reply.mp3',
    });
    expect(getLastAssistantPlainText).toHaveBeenCalledWith('agent:main:main');
    expect(speak).toHaveBeenCalledWith(
      'hello from cache',
      expect.objectContaining({ enabled: true, provider: 'edge', trigger: 'always' }),
      expect.objectContaining({ tts: { format: 'mp3' } }),
    );
    expect(persistence.append).toHaveBeenCalledWith(
      'agent:main:main',
      'assistant-entry-1',
      expect.objectContaining({ type: 'voice', uri: 'media://tts/reply---uuid.mp3' }),
    );
  });

  it('keeps automatic replies silent when TTS config is absent', async () => {
    const result = await maybeEmitWebchatTts(
      {
        config: { messages: undefined } as unknown as Config,
        getLastAssistantPlainText: vi.fn(() => 'should stay text only'),
        log: { warn: vi.fn() },
      },
      'agent:main:silent',
      true,
    );

    expect(result).toBeNull();
    expect(speak).not.toHaveBeenCalled();
  });

  it('discards generated audio when the target assistant transcript changed', async () => {
    persistence.append.mockReturnValue(false);

    const result = await maybeEmitWebchatTts(
      {
        config: {
          messages: {
            tts: {
              enabled: true,
              provider: 'edge',
              trigger: 'always',
              providers: { edge: { enabled: true } },
            },
          },
        } as unknown as Config,
        getLastAssistantPlainText: vi.fn(() => 'reply'),
        log: { warn: vi.fn() },
      },
      'agent:main:changed',
      false,
    );

    expect(result).toBeNull();
    expect(persistence.removeUnused).toHaveBeenCalledWith(['media://tts/reply---uuid.mp3']);
  });

  it('does not generate audio before an assistant transcript row exists', async () => {
    persistence.findLatest.mockReturnValue(null);

    const result = await maybeEmitWebchatTts(
      {
        config: {
          messages: {
            tts: {
              enabled: true,
              provider: 'edge',
              trigger: 'always',
              providers: { edge: { enabled: true } },
            },
          },
        } as unknown as Config,
        getLastAssistantPlainText: vi.fn(() => 'reply'),
        log: { warn: vi.fn() },
      },
      'agent:main:missing',
      false,
    );

    expect(result).toBeNull();
    expect(speak).not.toHaveBeenCalled();
  });
});

describe('isSuccessfulWebchatTtsToolEvent', () => {
  it('recognizes durable media from a successful explicit TTS tool call', () => {
    expect(isSuccessfulWebchatTtsToolEvent({
      type: 'tool_execution_end',
      toolName: 'text_to_speech',
      isError: false,
      result: {
        details: {
          media: [{ uri: 'media://tts/assist.mp3', type: 'voice' }],
        },
      },
    })).toBe(true);
  });

  it('does not suppress automatic TTS when the explicit tool produced no media', () => {
    expect(isSuccessfulWebchatTtsToolEvent({
      type: 'tool_execution_end',
      toolName: 'text_to_speech',
      isError: false,
      result: { details: { error: 'provider unavailable' } },
    })).toBe(false);
  });
});
