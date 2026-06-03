import { createContext, useContext, type ReactNode } from 'react';

import type { SettingsShellPopoverLayer } from '@/lib/settings-shell-layer.utils';

const SettingsShellLayerContext = createContext<SettingsShellPopoverLayer>('default');

function mergeLayer(parent: SettingsShellPopoverLayer, layer: SettingsShellPopoverLayer): SettingsShellPopoverLayer {
  if (parent === 'modal' || layer === 'modal') return 'modal';
  if (parent === 'page' || layer === 'page') return 'page';
  return 'default';
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
