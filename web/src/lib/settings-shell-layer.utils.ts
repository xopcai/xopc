import {
  SETTINGS_SHELL_MODAL_POPOVER_Z,
  SETTINGS_SHELL_POPOVER_Z,
} from '@/lib/settings-shell-dialog-layer';

/** Stacking tier for portaled popovers/menus under the settings shell. */
export type SettingsShellPopoverLayer = 'default' | 'page' | 'modal';

export function settingsShellPopoverZClass(layer: SettingsShellPopoverLayer): string {
  switch (layer) {
    case 'modal':
      return SETTINGS_SHELL_MODAL_POPOVER_Z;
    case 'page':
      return SETTINGS_SHELL_POPOVER_Z;
    default:
      return 'z-50';
  }
}
