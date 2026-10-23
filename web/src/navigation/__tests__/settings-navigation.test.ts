import { describe, expect, it } from 'vitest';

import { messages } from '@/i18n/messages';
import {
  isSettingsTabActiveAtPath,
  pathForTab,
  SETTINGS_SHELL_NAV_GROUPS,
} from '@/navigation';

describe('settings navigation information architecture', () => {
  it('groups settings by user intent', () => {
    const capabilities = SETTINGS_SHELL_NAV_GROUPS.find((group) => group.id === 'capabilities');
    const connection = SETTINGS_SHELL_NAV_GROUPS.find((group) => group.id === 'connection');
    const system = SETTINGS_SHELL_NAV_GROUPS.find((group) => group.id === 'system');

    expect(capabilities?.tabs).toEqual([
      'settingsModels',
      'settingsSearch',
      'settingsAgentDefaults',
    ]);
    expect(SETTINGS_SHELL_NAV_GROUPS.find(group => group.id === 'integrations')?.tabs).toEqual([
      'settingsAgentBrowser',
      'settingsComputerUse',
      'settingsPhoneUse',
    ]);
    expect(connection?.tabs).toEqual(['settingsDevices', 'settingsTunnel', 'settingsShares']);
    expect(system?.tabs).toEqual(['settingsGateway', 'settingsRuntimes', 'settingsImports', 'sessions', 'usage', 'tracing', 'logs']);
  });

  it('uses concise group labels', () => {
    const zh = messages('zh');
    const en = messages('en');

    expect(zh.settingsNavGroups.capabilities).toBe('智能');
    expect(zh.settingsNavGroups.connection).toBe('设备与连接');
    expect(en.settingsNavGroups.capabilities).toBe('Intelligence');
    expect(en.settingsNavGroups.connection).toBe('Devices & connections');
    expect(zh.settingsNavGroups.integrations).toBe('集成');
    expect(en.settingsNavGroups.integrations).toBe('Integrations');
  });

  it('maps each intelligence destination directly and keeps image models under Models', () => {
    expect(pathForTab('settingsModels')).toBe('/settings/capabilities/models');
    expect(pathForTab('settingsSearch')).toBe('/settings/capabilities/search');
    expect(pathForTab('settingsComputerUse')).toBe('/settings/computer-use');
    expect(isSettingsTabActiveAtPath('settingsComputerUse', '/settings/computer-use')).toBe(true);
    expect(isSettingsTabActiveAtPath('settingsAgentBrowser', '/settings/computer-use')).toBe(false);
    expect(isSettingsTabActiveAtPath('settingsModels', '/settings/capabilities/models')).toBe(true);
    expect(isSettingsTabActiveAtPath('settingsModels', '/settings/capabilities/voice')).toBe(false);
  });
});
