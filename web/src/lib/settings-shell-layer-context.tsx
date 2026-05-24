import { createContext, useContext, type ReactNode } from 'react';

import {
  SETTINGS_SHELL_MODAL_POPOVER_Z,
  SETTINGS_SHELL_POPOVER_Z,
} from '@/lib/settings-shell-dialog-layer';

/** Stacking tier for portaled popovers/menus under the settings shell. */
export type SettingsShellPopoverLayer = 'default' | 'page' | 'modal';

const SettingsShellLayerContext = createContext<SettingsShellPopoverLayer>('default');

function mergeLayer(parent: SettingsShellPopoverLayer, layer: SettingsShellPopoverLayer): SettingsShellPopoverLayer {
  if (parent === 'modal' || layer === 'modal') return 'modal';
  if (parent === 'page' || layer === 'page') return 'page';
  return 'default';
}

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

export function SettingsShellLayerProvider({
  layer,
  children,
}: {
  layer: Exclude<SettingsShellPopoverLayer, 'default'>;
  children: ReactNode;
}) {
  const parent = useContext(SettingsShellLayerContext);
  return (
    <SettingsShellLayerContext.Provider value={mergeLayer(parent, layer)}>
      {children}
    </SettingsShellLayerContext.Provider>
  );
}

export function useSettingsShellPopoverLayer(): SettingsShellPopoverLayer {
  return useContext(SettingsShellLayerContext);
}
