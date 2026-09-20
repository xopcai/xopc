import { createContext, useContext, type ReactNode } from 'react';

import type { SettingsShellPopoverLayer } from '@/lib/settings-shell-layer.utils';

type SettingsShellLayerContextValue = {
  layer: SettingsShellPopoverLayer;
  portalContainer: HTMLElement | null;
};

const SettingsShellLayerContext = createContext<SettingsShellLayerContextValue>({
  layer: 'default',
  portalContainer: null,
});

function mergeLayer(parent: SettingsShellPopoverLayer, layer: SettingsShellPopoverLayer): SettingsShellPopoverLayer {
  if (parent === 'modal' || layer === 'modal') return 'modal';
  if (parent === 'page' || layer === 'page') return 'page';
  return 'default';
}

export function SettingsShellLayerProvider({
  layer,
  portalContainer,
  children,
}: {
  layer: Exclude<SettingsShellPopoverLayer, 'default'>;
  portalContainer?: HTMLElement | null;
  children: ReactNode;
}) {
  const parent = useContext(SettingsShellLayerContext);
  const nextLayer = mergeLayer(parent.layer, layer);
  return (
    <SettingsShellLayerContext.Provider
      value={{
        layer: nextLayer,
        portalContainer: portalContainer ?? parent.portalContainer,
      }}
    >
      {children}
    </SettingsShellLayerContext.Provider>
  );
}

export function useSettingsShellPopoverLayer(): SettingsShellPopoverLayer {
  return useContext(SettingsShellLayerContext).layer;
}

export function useSettingsShellPopoverPortalContainer(): HTMLElement | null {
  return useContext(SettingsShellLayerContext).portalContainer;
}

/** Keep interactive popovers inside the nearest modal so dialog scroll-lock treats them as in-scope. */
export function useResolvedPopoverPortalContainer(triggerElement: Element | null): HTMLElement | null {
  const configuredPortalContainer = useSettingsShellPopoverPortalContainer();
  return triggerElement?.closest<HTMLElement>('[role="dialog"]') ?? configuredPortalContainer;
}
