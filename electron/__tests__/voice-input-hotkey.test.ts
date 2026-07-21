import { describe, expect, it } from 'vitest';

import { parseVoiceHotkeyHelperLine } from '../voice-input-hotkey';

describe('voice input hotkey protocol', () => {
  it('accepts supported modifier tap events', () => {
    expect(parseVoiceHotkeyHelperLine('{"type":"modifier-tap","key":"fn"}')).toBe('fn');
    expect(parseVoiceHotkeyHelperLine('{"type":"modifier-tap","key":"alt"}')).toBe('alt');
  });

  it('rejects malformed or unsupported helper output', () => {
    expect(parseVoiceHotkeyHelperLine('not json')).toBeNull();
    expect(parseVoiceHotkeyHelperLine('{"type":"keydown","key":"alt"}')).toBeNull();
    expect(parseVoiceHotkeyHelperLine('{"type":"modifier-tap","key":"control"}')).toBeNull();
  });
});
