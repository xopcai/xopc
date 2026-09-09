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
    expect(isSettingsTabVisibleInMode('settingsModels', 'simple')).toBe(true);
    expect(isSettingsTabVisibleInMode('settingsVoice', 'simple')).toBe(true);
    expect(isSettingsTabVisibleInMode('settingsSearch', 'simple')).toBe(true);
    expect(isSettingsTabVisibleInMode('settingsTunnel', 'simple')).toBe(true);
    expect(isSettingsTabVisibleInMode('settingsShares', 'simple')).toBe(true);
    expect(isSettingsTabVisibleInMode('settingsHeartbeat', 'simple')).toBe(true);
    expect(isSettingsTabVisibleInMode('logs', 'simple')).toBe(false);
  });

  it('blocks advanced settings paths in simple mode', () => {
    expect(isSettingsPathVisibleInMode('/settings/overview', 'simple')).toBe(true);
    expect(isSettingsPathVisibleInMode('/settings/remote-access', 'simple')).toBe(true);
    expect(isSettingsPathVisibleInMode('/settings/shares', 'simple')).toBe(true);
    expect(isSettingsPathVisibleInMode('/settings/heartbeat', 'simple')).toBe(true);
    expect(isSettingsPathVisibleInMode('/settings/ext/foo', 'simple')).toBe(false);
    expect(isSettingsPathVisibleInMode('/settings/logs', 'advanced')).toBe(true);
  });

  it('hides advanced field tabs in simple mode', () => {
    expect(isGatewaySettingsTabVisibleInMode('network', 'simple')).toBe(true);
    expect(isGatewaySettingsTabVisibleInMode('security', 'simple')).toBe(false);
  });
});
