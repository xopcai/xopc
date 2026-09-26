import { describe, expect, it } from 'vitest';
import { resolveVoiceRecordingDestination } from '../entry/src/main/ets/common/voiceRecordingGesture.ets';

describe('Harmony hold-to-record destinations', () => {
  it('sends from the original position, cancels up-left, and transcribes up-right', () => {
    expect(resolveVoiceRecordingDestination(0, 0)).toBe('send');
    expect(resolveVoiceRecordingDestination(-80, -90)).toBe('cancel');
    expect(resolveVoiceRecordingDestination(80, -90)).toBe('text');
  });

  it('requires an upward diagonal instead of a horizontal or vertical-only slide', () => {
    expect(resolveVoiceRecordingDestination(-100, 0)).toBe('send');
    expect(resolveVoiceRecordingDestination(100, 0)).toBe('send');
    expect(resolveVoiceRecordingDestination(0, -100)).toBe('send');
    expect(resolveVoiceRecordingDestination(-80, -40)).toBe('send');
    expect(resolveVoiceRecordingDestination(-40, -72)).toBe('send');
    expect(resolveVoiceRecordingDestination(40, -72)).toBe('send');
    expect(resolveVoiceRecordingDestination(-41, -73)).toBe('cancel');
    expect(resolveVoiceRecordingDestination(41, -73)).toBe('text');
  });

  it('uses hysteresis near a selected corner and allows switching corners', () => {
    expect(resolveVoiceRecordingDestination(-35, -60, 'cancel')).toBe('cancel');
    expect(resolveVoiceRecordingDestination(35, -60, 'text')).toBe('text');
    expect(resolveVoiceRecordingDestination(0, 0, 'cancel')).toBe('send');
    expect(resolveVoiceRecordingDestination(80, -90, 'cancel')).toBe('text');
    expect(resolveVoiceRecordingDestination(-80, -90, 'text')).toBe('cancel');
  });
});
