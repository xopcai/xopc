import { describe, expect, it } from 'vitest';

import { defaultVoiceInputShortcut } from './voice-input-shortcut-store';

describe('voice input shortcut helpers', () => {
  it('uses the platform modifier with Shift+M', () => {
    expect(defaultVoiceInputShortcut(true)).toBe('meta+shift+m');
    expect(defaultVoiceInputShortcut(false)).toBe('control+shift+m');
  });
});
