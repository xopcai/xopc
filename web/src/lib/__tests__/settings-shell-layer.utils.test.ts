import { describe, expect, it } from 'vitest';

import {
  APP_PORTALED_POPOVER_Z,
  SETTINGS_SHELL_MODAL_POPOVER_Z,
  SETTINGS_SHELL_POPOVER_Z,
} from '@/lib/settings-shell-dialog-layer';
import { settingsShellPopoverZClass } from '@/lib/settings-shell-layer.utils';

describe('settingsShellPopoverZClass', () => {
  it('places body portals above app dialogs regardless of their logical shell layer', () => {
    expect(settingsShellPopoverZClass('default')).toBe(APP_PORTALED_POPOVER_Z);
    expect(settingsShellPopoverZClass('page')).toBe(APP_PORTALED_POPOVER_Z);
    expect(settingsShellPopoverZClass('modal')).toBe(APP_PORTALED_POPOVER_Z);
  });

  it('uses local shell tiers when the portal stays inside that stacking context', () => {
    expect(settingsShellPopoverZClass('page', true)).toBe(SETTINGS_SHELL_POPOVER_Z);
    expect(settingsShellPopoverZClass('modal', true)).toBe(SETTINGS_SHELL_MODAL_POPOVER_Z);
  });
});
