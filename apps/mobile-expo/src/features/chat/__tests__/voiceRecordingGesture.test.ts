import { describe, expect, it } from 'vitest';
import { resolveVoiceRecordingDestination } from '../voiceRecordingGesture';

describe('hold-to-record destinations', () => {
  it('sends from the original position, cancels up-left, and transcribes up-right', () => {
    expect(resolveVoiceRecordingDestination(0, 0)).toBe('send');
    expect(resolveVoiceRecordingDestination(-80, -90)).toBe('cancel');
    expect(resolveVoiceRecordingDestination(80, -90)).toBe('text');
  });

  it('requires an upward diagonal instead of a horizontal or straight upward slide', () => {
    expect(resolveVoiceRecordingDestination(-100, 0)).toBe('send');
    expect(resolveVoiceRecordingDestination(100, 0)).toBe('send');
    expect(resolveVoiceRecordingDestination(0, -100)).toBe('send');
    expect(resolveVoiceRecordingDestination(80, 90)).toBe('send');
    expect(resolveVoiceRecordingDestination(-80, -40)).toBe('send');
  });

  it('keeps both corner hints stable near their entry boundaries', () => {
    expect(resolveVoiceRecordingDestination(-35, -60)).toBe('send');
    expect(resolveVoiceRecordingDestination(-35, -60, 'cancel')).toBe('cancel');
    expect(resolveVoiceRecordingDestination(35, -60)).toBe('send');
    expect(resolveVoiceRecordingDestination(35, -60, 'text')).toBe('text');
  });

  it('returns to send when moving back and lets the finger switch corners', () => {
    expect(resolveVoiceRecordingDestination(0, 0, 'cancel')).toBe('send');
    expect(resolveVoiceRecordingDestination(0, 0, 'text')).toBe('send');
    expect(resolveVoiceRecordingDestination(-80, -40, 'cancel')).toBe('send');
    expect(resolveVoiceRecordingDestination(80, -40, 'text')).toBe('send');
    expect(resolveVoiceRecordingDestination(80, -90, 'cancel')).toBe('text');
    expect(resolveVoiceRecordingDestination(-80, -90, 'text')).toBe('cancel');
  });
});
