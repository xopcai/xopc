import { describe, expect, it } from 'vitest';

import { resolveVoiceRecordingZone } from '../voiceRecordingGesture';

describe('resolveVoiceRecordingZone', () => {
  it('maps dominant gestures to cancel, text, and lock', () => {
    expect(resolveVoiceRecordingZone(-80, 0)).toBe('cancel');
    expect(resolveVoiceRecordingZone(80, 0)).toBe('text');
    expect(resolveVoiceRecordingZone(10, -80)).toBe('lock');
  });

  it('keeps the current zone until the gesture crosses the smaller exit threshold', () => {
    expect(resolveVoiceRecordingZone(-60, 0, 'cancel')).toBe('cancel');
    expect(resolveVoiceRecordingZone(60, 0, 'text')).toBe('text');
    expect(resolveVoiceRecordingZone(0, -60, 'lock')).toBe('lock');
    expect(resolveVoiceRecordingZone(-40, 0, 'cancel')).toBe('center');
  });

  it('prefers horizontal actions when horizontal movement dominates', () => {
    expect(resolveVoiceRecordingZone(-90, -80)).toBe('cancel');
    expect(resolveVoiceRecordingZone(90, -80)).toBe('text');
  });
});
