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
      'settingsVoice',
      'settingsSearch',
      'settingsAgentBrowser',
      'settingsAgentDefaults',
    ]);
    expect(connection?.tabs).toEqual(['settingsDevices', 'settingsTunnel', 'settingsShares']);
    expect(system?.tabs).toEqual(['settingsGateway', 'settingsRuntimes', 'sessions', 'logs']);
  });

  it('uses concise group labels', () => {
    const zh = messages('zh');
    const en = messages('en');

    expect(zh.settingsNavGroups.capabilities).toBe('智能');
    expect(zh.settingsNavGroups.connection).toBe('设备与连接');
    expect(en.settingsNavGroups.capabilities).toBe('Intelligence');
    expect(en.settingsNavGroups.connection).toBe('Devices & connections');
  });

  it('maps each intelligence destination directly and keeps image models under Models', () => {
    expect(pathForTab('settingsModels')).toBe('/settings/capabilities/models');
    expect(pathForTab('settingsVoice')).toBe('/settings/capabilities/voice');
    expect(pathForTab('settingsSearch')).toBe('/settings/capabilities/search');
    expect(isSettingsTabActiveAtPath('settingsModels', '/settings/capabilities/image')).toBe(true);
    expect(isSettingsTabActiveAtPath('settingsVoice', '/settings/capabilities/image')).toBe(false);
  });
});
