import { describe, expect, it } from 'vitest';

import { messages } from '@/i18n/messages';
import {
  isSettingsTabActiveAtPath,
  pathForTab,
  SETTINGS_SHELL_NAV_GROUPS,
} from '@/navigation';

describe('settings navigation information architecture', () => {
  it('groups destinations by user intent without duplicates or a catch-all system group', () => {
    expect(SETTINGS_SHELL_NAV_GROUPS.map(group => [group.id, group.tabs])).toEqual([
      ['general', ['settingsOverview', 'settingsAppearance', 'settingsKeyboardShortcuts', 'settingsSystem', 'settingsDesktopPet']],
      ['capabilities', ['settingsPersonal', 'settingsModels', 'settingsSearch', 'settingsAgentDefaults']],
      ['connection', ['settingsGateway', 'settingsDevices', 'settingsAgentBrowser', 'settingsComputerUse', 'settingsPhoneUse', 'settingsTunnel']],
      ['data', ['settingsImports', 'sessions', 'usage', 'settingsShares', 'settingsDesktopApp']],
      ['diagnostics', ['settingsRuntimes', 'tracing', 'logs']],
    ]);
    const tabs = SETTINGS_SHELL_NAV_GROUPS.flatMap(group => group.tabs);
    expect(new Set(tabs).size).toBe(tabs.length);
  });

  it('uses the same unambiguous names in navigation and page headings', () => {
    const zh = messages('zh');
    expect(zh.settingsNavGroups.connection).toBe('连接与设备');
    expect(zh.settingsNavGroups.data).toBe('数据与用量');
    expect(zh.settingsNavGroups.diagnostics).toBe('高级与诊断');
    expect(zh.settingsNavGroups.extensions).toBe('插件设置');
    expect(zh.nav.settingsGateway).toBe(zh.settingsSections.gateway);
    expect(zh.nav.settingsSystem).toBe(zh.settingsSections.system);
    expect(zh.nav.settingsDesktopPet).toBe(zh.settingsSections['desktop-pet']);
    expect(messages('en').settingsNavGroups.connection).toBe('Connections & devices');
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
