import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sttMocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
}));

vi.mock('../../../voice/stt/index.js', () => ({
  isSTTAvailable: () => true,
  transcribe: sttMocks.transcribe,
}));

import {
  mergeVoiceTranscriptsIntoUserText,
  requestsOriginalVoiceInspection,
} from '../voice-stt-webchat.js';
import { saveMediaBuffer } from '../../../media/store.js';

describe('mergeVoiceTranscriptsIntoUserText', () => {
  let workDir = '';
  let previousStateDir: string | undefined;

  beforeEach(() => {
    sttMocks.transcribe.mockReset();
    sttMocks.transcribe.mockResolvedValue({ text: '你好', provider: 'custom-stt' });
  });

  afterEach(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
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
      { enabled: true, provider: 'custom-stt' },
    );

    expect(sttMocks.transcribe).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ provider: 'custom-stt' }),
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
      { enabled: true, provider: 'custom-stt' },
    );

    expect(result.voiceTranscripts).toEqual(['[STT failed: audio decoder unavailable]']);
    expect(result.transcribedMediaUris).toEqual([]);
  });

  it('marks a persisted voice URI as handled only after successful transcription', async () => {
    previousStateDir = process.env.XOPC_STATE_DIR;
    workDir = join(tmpdir(), `xopc-voice-stt-${Date.now()}`);
    process.env.XOPC_STATE_DIR = workDir;
    await mkdir(workDir, { recursive: true });
    const saved = await saveMediaBuffer(Buffer.from('voice'), {
      bucket: 'inbound',
      contentType: 'audio/mp4',
      originalFilename: 'voice.m4a',
    });

    const result = await mergeVoiceTranscriptsIntoUserText([{
      type: 'voice',
      mimeType: 'audio/mp4',
      name: 'voice.m4a',
      size: 5,
      uri: saved.uri,
    }], '', { enabled: true, provider: 'custom-stt' });

    expect(result.transcribedMediaUris).toEqual([saved.uri]);
  });

  it('recognizes explicit requests to inspect the original recording', () => {
    expect(requestsOriginalVoiceInspection('请分析原始音频里的背景噪声')).toBe(true);
    expect(requestsOriginalVoiceInspection('Analyze the raw audio for speaker tone')).toBe(true);
    expect(requestsOriginalVoiceInspection('帮我总结一下刚才说的内容')).toBe(false);
  });
});
