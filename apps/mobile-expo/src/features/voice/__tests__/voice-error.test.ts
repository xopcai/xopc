import { describe, expect, it } from 'vitest';

import { en } from '../../../i18n/locales/en';
import { voiceErrorMessage } from '../voice-error';

describe('voiceErrorMessage', () => {
  it.each([
    'AUDIO_FOCUS_UNAVAILABLE',
    'MICROPHONE_UNAVAILABLE',
    'MICROPHONE_FORMAT_UNAVAILABLE',
  ])('maps Android audio acquisition failure %s to the actionable busy message', (code) => {
    expect(voiceErrorMessage(code, en.voice)).toBe(en.voice.busy);
  });

  it('keeps Android security failures actionable as microphone permission errors', () => {
    expect(voiceErrorMessage('PERMISSION_DENIED', en.voice)).toBe(en.voice.permission);
  });
});
