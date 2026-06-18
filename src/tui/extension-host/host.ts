import type { Component } from '@earendil-works/pi-tui';

import type {
  TuiAutocompleteProvider,
  TuiAutocompleteProviderFactory,
  TuiCustomFactory,
  TuiCustomOptions,
  TuiDialogOptions,
  TuiEditorFactory,
  TuiExtensionHostContract,
  TuiExtensionRegistrar,
  TuiFooterFactory,
  TuiHeaderFactory,
  TuiMessageRenderer,
  TuiNotifyLevel,
  TuiShortcutHandler,
  TuiSlashCommandHandler,
  TuiTerminalInputHandler,
  TuiSetThemeResult,
  TuiTheme,
  TuiThemeInfo,
  TuiWidgetFactory,
  TuiWorkingIndicatorOptions,
} from '../../extensions/types/tui.js';
import { TuiExtensionSurface } from './surface.js';
import { registerTuiToolRenderer } from './tool-renderers.js';

const MAX_WIDGET_LINES = 10;
const WIDGET_TRUNCATED_LINE = '... (widget truncated)';

export interface TuiExtensionHostDeps {
  extensionId: string;
  surface: TuiExtensionSurface;
  getSessionKey: () => string;
  notify: (message: string, level?: TuiNotifyLevel) => void;
  onTerminalInputAdded: (handler: TuiTerminalInputHandler) => () => void;
  showOverlay: (component: Component) => void;
  hideOverlay: () => void;
  custom: <T>(factory: TuiCustomFactory<T>, options?: TuiCustomOptions) => Promise<T>;
  createWidgetComponent: (factory: TuiWidgetFactory) => Component & { dispose?(): void };
  setFooter: (factory: TuiFooterFactory | undefined) => void;
  setHeader: (factory: TuiHeaderFactory | undefined) => void;
  setTitle: (title: string) => void;
  pasteToEditor: (text: string) => void;
  setEditorText: (text: string) => void;
  getEditorText: () => string;
  editor: (title: string, prefill?: string) => Promise<string | undefined>;
  setEditorComponent: (factory: TuiEditorFactory | undefined) => void;
  getEditorComponent: () => TuiEditorFactory | undefined;
  getThemeObject: () => TuiTheme;
  getAllThemes: () => TuiThemeInfo[];
  getTheme: (name: string) => TuiTheme | undefined;
  setTheme: (theme: string) => TuiSetThemeResult;
  getToolsExpanded: () => boolean;
  setToolsExpanded: (expanded: boolean) => void;
  select: (
    title: string,
    options: string[],
    opts?: TuiDialogOptions,
  ) => Promise<string | undefined>;
  confirm: (title: string, message: string, opts?: TuiDialogOptions) => Promise<boolean>;
  input: (
    title: string,
    placeholder?: string,
    opts?: TuiDialogOptions,
  ) => Promise<string | undefined>;
  onAutocompleteProviderAdded: (provider: TuiAutocompleteProvider) => () => void;
  onAutocompleteProviderFactoryAdded: (factory: TuiAutocompleteProviderFactory) => () => void;
  onMessageRendererAdded: (customType: string, renderer: TuiMessageRenderer) => () => void;
  onSlashCommandAdded: (
    name: string,
    description: string,
    handler: TuiSlashCommandHandler,
  ) => () => void;
  onShortcutAdded: (
    key: string,
    description: string,
    handler: TuiShortcutHandler,
  ) => () => void;
  setWorkingMessage: (message?: string) => void;
  setWorkingVisible: (visible: boolean) => void;
  setWorkingIndicator: (options?: TuiWorkingIndicatorOptions) => void;
  setHiddenThinkingLabel: (label?: string) => void;
  onInvalidate: () => void;
}

export function createTuiExtensionHost(deps: TuiExtensionHostDeps): TuiExtensionHostContract {
  const widgetKey = (key: string) => `${deps.extensionId}:${key}`;
  const setWidgetLines = (
    map: Map<string, string[]>,
    fullKey: string,
    lines: string[] | null | undefined,
    options: { bounded?: boolean } = {},
  ) => {
    if (!lines || lines.length === 0) {
      map.delete(fullKey);
    } else {
      map.set(fullKey, options.bounded ? boundedWidgetLines(lines) : lines);
    }
  };

  const boundedWidgetLines = (lines: string[]): string[] => {
    if (lines.length <= MAX_WIDGET_LINES) return lines;
    return [...lines.slice(0, MAX_WIDGET_LINES), WIDGET_TRUNCATED_LINE];
  };

  const disposeComponent = (component: { dispose?(): void } | undefined) => {
    try {
      component?.dispose?.();
    } catch {
      // Ignore extension component cleanup failures.
    }
  };

  const clearWidgetKey = (fullKey: string) => {
    deps.surface.headerWidgets.delete(fullKey);
    deps.surface.footerWidgets.delete(fullKey);
    const headerComponent = deps.surface.headerWidgetComponents.get(fullKey);
    const footerComponent = deps.surface.footerWidgetComponents.get(fullKey);
    deps.surface.headerWidgetComponents.delete(fullKey);
    deps.surface.footerWidgetComponents.delete(fullKey);
    disposeComponent(headerComponent);
    disposeComponent(footerComponent);
  };

  return {
    extensionId: deps.extensionId,

    get theme() {
      return deps.getThemeObject();
    },

    setFooterWidget(key, lines) {
      const fullKey = widgetKey(key);
      setWidgetLines(deps.surface.footerWidgets, fullKey, lines);
      deps.onInvalidate();
    },

    setHeaderWidget(key, lines) {
      const fullKey = widgetKey(key);
      setWidgetLines(deps.surface.headerWidgets, fullKey, lines);
      deps.onInvalidate();
    },

    setWidget(key, content, options) {
      const fullKey = widgetKey(key);
      clearWidgetKey(fullKey);
      if (!content) {
        deps.onInvalidate();
        return;
      }
      if (typeof content === 'function') {
        const target = options?.placement === 'belowEditor'
          ? deps.surface.footerWidgetComponents
          : deps.surface.headerWidgetComponents;
        target.set(fullKey, deps.createWidgetComponent(content as TuiWidgetFactory));
      } else {
        const target = options?.placement === 'belowEditor'
          ? deps.surface.footerWidgets
          : deps.surface.headerWidgets;
        setWidgetLines(target, fullKey, content, { bounded: true });
      }
      deps.onInvalidate();
    },

    setFooter(factory) {
      deps.setFooter(factory);
    },

    setHeader(factory) {
      deps.setHeader(factory);
    },

    addAutocompleteProvider(providerOrFactory) {
      if (providerOrFactory.length <= 1) {
        return deps.onAutocompleteProviderFactoryAdded(
          providerOrFactory as TuiAutocompleteProviderFactory,
        );
      }
      return deps.onAutocompleteProviderAdded(providerOrFactory as TuiAutocompleteProvider);
    },

    registerToolRenderer(toolName, renderer) {
      return registerTuiToolRenderer(toolName, renderer);
    },

    registerMessageRenderer(customType, renderer) {
      return deps.onMessageRendererAdded(customType, renderer as TuiMessageRenderer);
    },

    registerSlashCommand(name, description, handler) {
      return deps.onSlashCommandAdded(name, description, handler);
    },

    registerShortcut(key, description, handler) {
      return deps.onShortcutAdded(key, description, handler);
    },

    notify(message, level) {
      deps.notify(message, level);
    },

    onTerminalInput(handler) {
      return deps.onTerminalInputAdded(handler);
    },

    showOverlay(component) {
      deps.showOverlay(component as Component);
    },

    hideOverlay() {
      deps.hideOverlay();
    },

    custom(factory, options) {
      return deps.custom(factory, options);
    },

    setTitle(title) {
      deps.setTitle(title);
    },

    pasteToEditor(text) {
      deps.pasteToEditor(text);
    },

    setEditorText(text) {
      deps.setEditorText(text);
    },

    getEditorText() {
      return deps.getEditorText();
    },

    editor(title, prefill) {
      return deps.editor(title, prefill);
    },

    setEditorComponent(factory) {
      deps.setEditorComponent(factory);
    },

    getEditorComponent() {
      return deps.getEditorComponent();
    },

    getAllThemes() {
      return deps.getAllThemes();
    },

    getTheme(name) {
      return deps.getTheme(name);
    },

    setTheme(theme) {
      return deps.setTheme(theme);
    },

    getToolsExpanded() {
      return deps.getToolsExpanded();
    },

    setToolsExpanded(expanded) {
      deps.setToolsExpanded(expanded);
    },

    select(title, options, opts) {
      return deps.select(title, options, opts);
    },

    confirm(title, message, opts) {
      return deps.confirm(title, message, opts);
    },

    input(title, placeholder, opts) {
      return deps.input(title, placeholder, opts);
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

    setHiddenThinkingLabel(label) {
      deps.setHiddenThinkingLabel(label ?? undefined);
      deps.onInvalidate();
    },

    setWorkingMessage(message) {
      deps.setWorkingMessage(message ?? undefined);
      deps.onInvalidate();
    },

    setWorkingVisible(visible) {
      deps.setWorkingVisible(visible);
      deps.onInvalidate();
    },

    setWorkingIndicator(options) {
      deps.setWorkingIndicator(options ?? undefined);
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
