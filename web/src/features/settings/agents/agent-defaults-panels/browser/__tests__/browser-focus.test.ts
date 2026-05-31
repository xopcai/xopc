import { describe, expect, it } from 'vitest';

import {
  browserFocusElementId,
  parseBrowserSettingsFocus,
} from '@/features/settings/agents/agent-defaults-panels/browser/browser-focus';

describe('browser-focus', () => {
  it('maps focus ids to stable element ids', () => {
    expect(browserFocusElementId('extension')).toBe('browser-focus-extension');
    expect(browserFocusElementId('security')).toBe('browser-focus-security');
  });

  it('parses known focus query values', () => {
    expect(parseBrowserSettingsFocus('extension')).toBe('extension');
    expect(parseBrowserSettingsFocus('local')).toBe('local');
    expect(parseBrowserSettingsFocus('runtime')).toBe('runtime');
    expect(parseBrowserSettingsFocus('security')).toBe('security');
  });

  it('returns null for unknown focus values', () => {
    expect(parseBrowserSettingsFocus(null)).toBeNull();
    expect(parseBrowserSettingsFocus('')).toBeNull();
    expect(parseBrowserSettingsFocus('playwright')).toBeNull();
  });
});
