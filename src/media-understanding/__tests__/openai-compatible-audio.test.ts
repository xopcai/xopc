import { describe, expect, it } from 'vitest';

import {
  buildAudioTranscriptionFormData,
  resolveAudioTranscriptionUploadFileName,
} from '../openai-compatible-audio.js';

describe('resolveAudioTranscriptionUploadFileName', () => {
  it('renames .aac to .m4a', () => {
    expect(resolveAudioTranscriptionUploadFileName('voice.aac', 'audio/aac')).toBe('voice.m4a');
  });

  it('appends .m4a for aac mime without extension', () => {
    expect(resolveAudioTranscriptionUploadFileName('audio', 'audio/aac')).toBe('audio.m4a');
  });
});

describe('buildAudioTranscriptionFormData', () => {
  it('includes model and language fields', () => {
    const form = buildAudioTranscriptionFormData({
      buffer: Buffer.from('test'),
      fileName: 'clip.ogg',
      mime: 'audio/ogg',
      fields: {
        model: 'whisper-1',
        language: 'zh',
      },
    });
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('zh');
    expect(form.get('file')).toBeTruthy();
  });
});
