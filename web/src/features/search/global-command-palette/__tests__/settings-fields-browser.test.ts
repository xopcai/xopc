import { describe, expect, it, vi } from 'vitest';

import { buildSettingsFieldHits } from '@/features/search/global-command-palette/settings-fields-provider';

describe('settings-fields browser palette entries', () => {
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
    expect(navigate).toHaveBeenCalledWith('/settings/agent-browser?tab=extension');
  });
});
