import { describe, expect, it, vi } from 'vitest';

import { buildAutomationActionHits } from '@/features/search/global-command-palette/actions-provider';

describe('buildAutomationActionHits', () => {
  it('offers a create-app action that opens the local app workbench', () => {
    const navigate = vi.fn();
    const closePalette = vi.fn();
    const actions = buildAutomationActionHits('en', navigate, closePalette);
    const createApp = actions.find((action) => action.id === 'action:local-app:create');

    expect(createApp).toBeDefined();
    createApp?.run();
    expect(closePalette).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/local-apps/new');
  });
});
