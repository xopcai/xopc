import { describe, expect, it } from 'vitest';

import { messages } from '@/i18n/messages';
import { SETTINGS_SHELL_NAV_GROUPS } from '@/navigation';

describe('settings navigation information architecture', () => {
  it('keeps global services separate from agent capabilities', () => {
    const capabilities = SETTINGS_SHELL_NAV_GROUPS.find((group) => group.id === 'capabilities');
    const agents = SETTINGS_SHELL_NAV_GROUPS.find((group) => group.id === 'agent');

    expect(capabilities?.tabs).toEqual(['settingsCapabilities']);
    expect(agents?.tabs).toEqual(['settingsCapabilityPresets', 'settingsAgentBrowser']);
  });

  it('uses distinct service and agent capability labels', () => {
    const zh = messages('zh');
    const en = messages('en');

    expect(zh.settingsNavGroups.capabilities).toBe('模型与服务');
    expect(zh.settingsNavGroups.agent).toBe('智能体能力');
    expect(en.settingsNavGroups.capabilities).toBe('Models & services');
    expect(en.settingsNavGroups.agent).toBe('Agent capabilities');
  });
});
