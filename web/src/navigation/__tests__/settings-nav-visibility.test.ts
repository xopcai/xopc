import { describe, expect, it } from 'vitest';

import {
  isAgentDefaultsTabVisibleInMode,
  isBrowserSettingsTabVisibleInMode,
  isGatewaySettingsTabVisibleInMode,
} from '@/navigation/settings-field-visibility';
import {
  isSettingsPathVisibleInMode,
  isSettingsTabVisibleInMode,
} from '@/navigation/settings-nav-visibility';

describe('settings-nav-visibility', () => {
  it('hides power-user tabs in simple mode', () => {
    expect(isSettingsTabVisibleInMode('settingsOverview', 'simple')).toBe(true);
    expect(isSettingsTabVisibleInMode('settingsAgentMcp', 'simple')).toBe(false);
    expect(isSettingsTabVisibleInMode('logs', 'simple')).toBe(false);
    expect(isSettingsTabVisibleInMode('settingsAgentMcp', 'advanced')).toBe(true);
  });

  it('blocks advanced settings paths in simple mode', () => {
    expect(isSettingsPathVisibleInMode('/settings/overview', 'simple')).toBe(true);
    expect(isSettingsPathVisibleInMode('/settings/agent-mcp', 'simple')).toBe(false);
    expect(isSettingsPathVisibleInMode('/settings/ext/foo', 'simple')).toBe(false);
    expect(isSettingsPathVisibleInMode('/settings/logs', 'advanced')).toBe(true);
  });

  it('hides advanced field tabs in simple mode', () => {
    expect(isAgentDefaultsTabVisibleInMode('model-strategy', 'simple')).toBe(true);
    expect(isAgentDefaultsTabVisibleInMode('runtime', 'simple')).toBe(false);
    expect(isGatewaySettingsTabVisibleInMode('network', 'simple')).toBe(true);
    expect(isGatewaySettingsTabVisibleInMode('security', 'simple')).toBe(false);
    expect(isBrowserSettingsTabVisibleInMode('overview', 'simple')).toBe(true);
    expect(isBrowserSettingsTabVisibleInMode('cloakbrowser', 'simple')).toBe(true);
    expect(isBrowserSettingsTabVisibleInMode('local', 'simple')).toBe(false);
    expect(isBrowserSettingsTabVisibleInMode('cdp', 'simple')).toBe(false);
  });
});
