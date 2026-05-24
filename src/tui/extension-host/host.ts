import type { Component } from '@earendil-works/pi-tui';

import type {
  TuiAutocompleteProvider,
  TuiExtensionHostContract,
  TuiExtensionRegistrar,
  TuiNotifyLevel,
  TuiSlashCommandHandler,
  TuiToolRenderer,
} from '../../extensions/types/tui.js';
import { TuiExtensionSurface } from './surface.js';
import { registerTuiToolRenderer } from './tool-renderers.js';

export interface TuiExtensionHostDeps {
  extensionId: string;
  surface: TuiExtensionSurface;
  getSessionKey: () => string;
  notify: (message: string, level?: TuiNotifyLevel) => void;
  showOverlay: (component: Component) => void;
  hideOverlay: () => void;
  onAutocompleteProviderAdded: (provider: TuiAutocompleteProvider) => () => void;
  onSlashCommandAdded: (
    name: string,
    description: string,
    handler: TuiSlashCommandHandler,
  ) => () => void;
  onInvalidate: () => void;
}

export function createTuiExtensionHost(deps: TuiExtensionHostDeps): TuiExtensionHostContract {
  const widgetKey = (key: string) => `${deps.extensionId}:${key}`;

  return {
    extensionId: deps.extensionId,

    setFooterWidget(key, lines) {
      const fullKey = widgetKey(key);
      if (!lines || lines.length === 0) {
        deps.surface.footerWidgets.delete(fullKey);
      } else {
        deps.surface.footerWidgets.set(fullKey, lines);
      }
      deps.onInvalidate();
    },

    setHeaderWidget(key, lines) {
      const fullKey = widgetKey(key);
      if (!lines || lines.length === 0) {
        deps.surface.headerWidgets.delete(fullKey);
      } else {
        deps.surface.headerWidgets.set(fullKey, lines);
      }
      deps.onInvalidate();
    },

    addAutocompleteProvider(provider) {
      return deps.onAutocompleteProviderAdded(provider);
    },

    registerToolRenderer(toolName, renderer) {
      return registerTuiToolRenderer(toolName, renderer);
    },

    registerSlashCommand(name, description, handler) {
      return deps.onSlashCommandAdded(name, description, handler);
    },

    notify(message, level) {
      deps.notify(message, level);
    },

    showOverlay(component) {
      deps.showOverlay(component as Component);
    },

    hideOverlay() {
      deps.hideOverlay();
    },

    setStatus(key, text) {
      const fullKey = widgetKey(key);
      if (!text) {
        deps.surface.statusSlots.delete(fullKey);
      } else {
        deps.surface.statusSlots.set(fullKey, text);
      }
      deps.onInvalidate();
    },
  };
}

export async function invokeTuiExtensionRegistrars(
  registrars: ReadonlyArray<{ extensionId: string; register: TuiExtensionRegistrar }>,
  createHost: (extensionId: string) => TuiExtensionHostContract,
  onError?: (extensionId: string, errorMessage: string) => void,
): Promise<void> {
  for (const { extensionId, register } of registrars) {
    try {
      await register(createHost(extensionId));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      onError?.(extensionId, errorMessage);
    }
  }
}
