import { describe, expect, it } from 'vitest';

import {
  isGatewaySettingsTabVisibleInMode,
} from '@/navigation/settings-field-visibility';
import {
  isSettingsPathVisibleInMode,
  isSettingsTabVisibleInMode,
} from '@/navigation/settings-nav-visibility';

describe('settings-nav-visibility', () => {
  it('hides power-user tabs in simple mode', () => {
    expect(isSettingsTabVisibleInMode('settingsOverview', 'simple')).toBe(true);
    expect(isSettingsTabVisibleInMode('logs', 'simple')).toBe(false);
    expect(isSettingsTabVisibleInMode('settingsTunnel', 'advanced')).toBe(true);
  });

  it('blocks advanced settings paths in simple mode', () => {
    expect(isSettingsPathVisibleInMode('/settings/overview', 'simple')).toBe(true);
    expect(isSettingsPathVisibleInMode('/settings/ext/foo', 'simple')).toBe(false);
    expect(isSettingsPathVisibleInMode('/settings/logs', 'advanced')).toBe(true);
  });

  it('hides advanced field tabs in simple mode', () => {
    expect(isGatewaySettingsTabVisibleInMode('network', 'simple')).toBe(true);
    expect(isGatewaySettingsTabVisibleInMode('security', 'simple')).toBe(false);
  });
});
