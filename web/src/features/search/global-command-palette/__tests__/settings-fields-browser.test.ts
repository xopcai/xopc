import { describe, expect, it, vi } from 'vitest';

import { buildSettingsFieldHits } from '@/features/search/global-command-palette/settings-fields-provider';
import { useSettingsModeStore } from '@/stores/settings-mode-store';

describe('settings-fields browser palette entries', () => {
  it('opens the selected panel and reveals advanced fields only when requested', () => {
    useSettingsModeStore.setState({ mode: 'simple' });
    const navigate = vi.fn();
    const hits = buildSettingsFieldHits('en', navigate, vi.fn(), 'Settings');
    hits.find((hit) => hit.id === 'field:agent-defaults:tools')!.run();
    expect(navigate).toHaveBeenLastCalledWith('/settings/agent-defaults?panel=tools');
    expect(useSettingsModeStore.getState().mode).toBe('simple');
    hits.find((hit) => hit.id === 'field:agent-defaults:runtime')!.run();
    expect(navigate).toHaveBeenLastCalledWith('/settings/agent-defaults?panel=runtime');
    expect(useSettingsModeStore.getState().mode).toBe('advanced');
    useSettingsModeStore.setState({ mode: 'simple' });
  });
  it('includes focus deep-links for extension, playwright, and security', () => {
    const navigate = vi.fn();
    const close = vi.fn();
    const hits = buildSettingsFieldHits('en', navigate, close, 'Settings');

    const extension = hits.find((h) => h.id === 'field:agent:browser-extension');
    const playwright = hits.find((h) => h.id === 'field:agent:browser-playwright');
    const security = hits.find((h) => h.id === 'field:agent:browser-private-urls');

    expect(extension?.subtitle).toContain('bridge');
    expect(playwright?.id).toBe('field:agent:browser-playwright');
    expect(security?.id).toBe('field:agent:browser-private-urls');

    extension?.run();
    expect(close).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/settings/agent-browser');
  });
});
