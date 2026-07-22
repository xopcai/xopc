import { describe, expect, it } from 'vitest';

import {
  parseVoiceHotkeyHelperLine,
  resolveVoiceInputHotkeyHelperPath,
} from '../voice-input-hotkey';

describe('voice input hotkey protocol', () => {
  it('accepts supported modifier hold events', () => {
    expect(parseVoiceHotkeyHelperLine('{"type":"modifier-hold","action":"press","key":"fn"}')).toEqual({ action: 'press', key: 'fn' });
    expect(parseVoiceHotkeyHelperLine('{"type":"modifier-hold","action":"release","key":"alt"}')).toEqual({ action: 'release', key: 'alt' });
  });

  it('rejects malformed or unsupported helper output', () => {
    expect(parseVoiceHotkeyHelperLine('not json')).toBeNull();
    expect(parseVoiceHotkeyHelperLine('{"type":"modifier-hold","action":"repeat","key":"alt"}')).toBeNull();
    expect(parseVoiceHotkeyHelperLine('{"type":"modifier-hold","action":"press","key":"control"}')).toBeNull();
  });

  it('resolves the development helper relative to the bundled main process', () => {
    expect(resolveVoiceInputHotkeyHelperPath({
      platform: 'darwin',
      packaged: false,
      resourcesPath: '/Applications/xopc.app/Contents/Resources',
      mainDir: '/workspace/out/main',
    })).toBe('/workspace/dist/electron/native/voice-hotkey-helper');
  });

  it('resolves the packaged helper from Electron resources', () => {
    expect(resolveVoiceInputHotkeyHelperPath({
      platform: 'win32',
      packaged: true,
      resourcesPath: '/resources',
      mainDir: '/workspace/out/main',
    })).toBe('/resources/bin/voice-hotkey-helper.exe');
  });
});
