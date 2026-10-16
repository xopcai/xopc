// @vitest-environment jsdom
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
    expect(isSettingsTabVisibleInMode('settingsSearch', 'simple')).toBe(true);
    expect(isSettingsTabVisibleInMode('settingsTunnel', 'simple')).toBe(true);
    expect(isSettingsTabVisibleInMode('settingsShares', 'simple')).toBe(true);
    expect(isSettingsTabVisibleInMode('logs', 'simple')).toBe(false);
    expect(isSettingsTabVisibleInMode('tracing', 'simple')).toBe(false);
    expect(isSettingsTabVisibleInMode('settingsRuntimes', 'simple')).toBe(false);
    expect(isSettingsTabVisibleInMode('settingsGateway', 'simple')).toBe(true);
    expect(isSettingsTabVisibleInMode('sessions', 'simple')).toBe(true);
    expect(isSettingsTabVisibleInMode('usage', 'simple')).toBe(true);
  });

  it('blocks advanced settings paths in simple mode', () => {
    expect(isSettingsPathVisibleInMode('/settings/overview', 'simple')).toBe(true);
    expect(isSettingsPathVisibleInMode('/settings/remote-access', 'simple')).toBe(true);
    expect(isSettingsPathVisibleInMode('/settings/shares', 'simple')).toBe(true);
    expect(isSettingsPathVisibleInMode('/settings/ext/foo', 'simple')).toBe(false);
    expect(isSettingsPathVisibleInMode('/settings/logs', 'advanced')).toBe(true);
    expect(isSettingsPathVisibleInMode('/settings/runtimes', 'simple')).toBe(false);
    expect(isSettingsPathVisibleInMode('/settings/tracing', 'simple')).toBe(false);
    expect(isSettingsPathVisibleInMode('/settings/tracing-more', 'simple')).toBe(true);
    expect(isSettingsPathVisibleInMode('/settings/runtimes', 'advanced')).toBe(true);
  });

  it('hides advanced field tabs in simple mode', () => {
    expect(isGatewaySettingsTabVisibleInMode('network', 'simple')).toBe(true);
    expect(isGatewaySettingsTabVisibleInMode('security', 'simple')).toBe(false);
    expect(isGatewaySettingsTabVisibleInMode('access', 'simple')).toBe(true);
    expect(isGatewaySettingsTabVisibleInMode('updates', 'simple')).toBe(true);
  });
});
