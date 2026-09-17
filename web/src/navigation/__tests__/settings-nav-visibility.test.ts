// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  isGatewaySettingsTabVisibleInMode,
} from '@/navigation/settings-field-visibility';
import {
  isSettingsPathVisibleInMode,
  isSettingsTabVisibleInMode,
  isSettingsPathVisibleOnPlatform,
  isSettingsTabVisibleOnPlatform,
} from '@/navigation/settings-nav-visibility';

const previousApi = window.electronAPI;
afterEach(() => { window.electronAPI = previousApi; });

describe('settings-nav-visibility', () => {
  it.each(['darwin', 'win32', 'linux', undefined])('gates computer use navigation and deep links on %s', (platform) => {
    window.electronAPI = platform ? { platform } as Window['electronAPI'] : undefined;
    const supported = platform === 'darwin';
    expect(isSettingsTabVisibleOnPlatform('settingsComputerUse')).toBe(supported);
    expect(isSettingsPathVisibleOnPlatform('/settings/computer-use')).toBe(supported);
    expect(isSettingsPathVisibleOnPlatform('/settings/computer-use/')).toBe(supported);
    expect(isSettingsTabVisibleOnPlatform('settingsAgentBrowser')).toBe(true);
    expect(isSettingsPathVisibleOnPlatform('/settings/agent-browser')).toBe(true);
    expect(isSettingsPathVisibleOnPlatform('/settings/overview')).toBe(true);
  });
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
