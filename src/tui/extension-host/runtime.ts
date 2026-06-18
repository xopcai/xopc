import {
  CombinedAutocompleteProvider,
  matchesKey,
  type Component,
  type AutocompleteItem,
  type AutocompleteProvider,
  type KeybindingsManager,
  type OverlayHandle,
  type OverlayOptions,
  type TUI,
} from '@earendil-works/pi-tui';

import type { ExtensionRegistryImpl } from '../../extensions/loader.js';
import type {
  TuiAutocompleteProvider,
  TuiAutocompleteProviderFactory,
  TuiAutocompleteSuggestion,
  TuiActionUiContext,
  TuiCompactOptions,
  TuiCompactResult,
  TuiContextUsage,
  TuiCustomComponent,
  TuiCustomFactory,
  TuiCustomFullFactory,
  TuiCustomLegacyFactory,
  TuiCustomOptions,
  TuiDialogOptions,
  TuiEditorFactory,
  TuiForkOptions,
  TuiFooterDataProvider,
  TuiFooterFactory,
  TuiHeaderFactory,
  TuiModelInfo,
  TuiModelRegistry,
  TuiModelRegistryModel,
  TuiNotifyLevel,
  TuiOverlayHandle,
  TuiNavigateTreeOptions,
  TuiNewSessionOptions,
  TuiReasoningLevel,
  TuiReplacedSessionContext,
  TuiReplacementResult,
  TuiReadonlySessionManager,
  TuiSlashCommandContext,
  TuiShortcutHandler,
  TuiSlashCommandHandler,
  TuiSwitchSessionOptions,
  TuiSystemPromptOptions,
  TuiTerminalInputHandler,
  TuiSetThemeResult,
  TuiTheme,
  TuiThemeInfo,
  TuiThinkingLevel,
  TuiVerboseLevel,
  TuiWidgetFactory,
  TuiWorkingIndicatorOptions,
} from '../../extensions/types/tui.js';
import type { ChatLog } from '../components/chat-log.js';
import {
  ExtensionEditorDialog,
  ExtensionInputDialog,
  ExtensionSelectDialog,
} from '../components/extension-dialog.js';
import type { TuiHeader } from '../components/tui-header.js';
import type { TuiBottomBar } from '../components/tui-bottom-bar.js';
import type { TuiState } from '../tui-types.js';
import { theme } from '../theme.js';
import { getGitBranchCached } from '../tui-git-branch.js';
import { createSkillsAutocompleteProvider } from '../tui-skills-autocomplete.js';
import { createTuiExtensionHost, invokeTuiExtensionRegistrars } from './host.js';
import { ChainedAutocompleteProvider, WrappedAutocompleteProvider } from './autocomplete.js';
import {
  STALE_EXTENSION_CONTEXT_MESSAGE,
  boundedWidgetLines,
  createDefaultModelRegistry,
  createEmptySessionManager,
  getTuiContextUsage,
  getTuiModelInfo,
  getTuiReasoningLevel,
  getTuiThinkingLevel,
  getTuiVerboseLevel,
  hasPendingTuiMessages,
  invokeCustomFactory,
  isTuiIdle,
  notifyInChatLog,
  resolveCustomOverlayOptions,
  disposeComponent,
} from './runtime-context.js';
import { clearTuiToolRenderers } from './tool-renderers.js';
import { TuiExtensionSurface } from './surface.js';

export interface TuiExtensionSlashCommand {
  originalName: string;
  name: string;
  description: string;
  handler: TuiSlashCommandHandler;
  getContext: () => TuiSlashCommandContext;
}

export interface TuiExtensionShortcut {
  key: string;
  description: string;
  handler: TuiShortcutHandler;
  getContext: () => TuiSlashCommandContext;
}

export interface TuiExtensionRuntime {
  surface: TuiExtensionSurface;
  slashCommands: TuiExtensionSlashCommand[];
  shortcuts: TuiExtensionShortcut[];
  autocompleteProvider: AutocompleteProvider;
  handleShortcut(data: string): boolean;
  activate(): Promise<void>;
  dispose(): void;
}

export interface CreateTuiExtensionRuntimeOptions {
  registry?: ExtensionRegistryImpl;
  tui: TUI;
  chatLog: ChatLog;
  header: TuiHeader;
  bottomBar: TuiBottomBar;
  getState: () => TuiState;
  baseSlashCommands: Array<{ name: string; description: string }>;
  keybindings?: KeybindingsManager;
  addInputListener?: (handler: TuiTerminalInputHandler) => () => void;
  setTitle?: (title: string) => void;
  pasteToEditor?: (text: string) => void;
  setEditorText?: (text: string) => void;
  getEditorText?: () => string;
  setEditorComponent?: (factory: TuiEditorFactory | undefined) => void;
  getEditorComponent?: () => TuiEditorFactory | undefined;
  getThemeObject?: () => TuiTheme;
  getAllThemes?: () => TuiThemeInfo[];
  getTheme?: (name: string) => TuiTheme | undefined;
  setTheme?: (theme: string) => TuiSetThemeResult;
  getToolsExpanded?: () => boolean;
  setToolsExpanded?: (expanded: boolean) => void;
  getAvailableProviderCount?: () => number;
  getActiveSignal?: () => AbortSignal | undefined;
  isProjectTrusted?: () => boolean;
  getSessionManager?: () => TuiReadonlySessionManager;
  getModelRegistry?: () => TuiModelRegistry;
  getSystemPrompt?: () => string;
  getSystemPromptOptions?: () => TuiSystemPromptOptions;
  waitForIdle?: () => Promise<void>;
  newSession?: (options?: TuiNewSessionOptions) => Promise<TuiReplacementResult>;
  forkSession?: (entryId: string, options?: TuiForkOptions) => Promise<TuiReplacementResult>;
  navigateTree?: (targetId: string, options?: TuiNavigateTreeOptions) => Promise<TuiReplacementResult>;
  switchSession?: (sessionPath: string, options?: TuiSwitchSessionOptions) => Promise<TuiReplacementResult>;
  reload?: () => Promise<void>;
  sendUserMessage?: TuiReplacedSessionContext['sendUserMessage'];
  sendMessage?: TuiReplacedSessionContext['sendMessage'];
  cwd: string;
  fdPath: string | null;
  openOverlay: (component: Component, options?: OverlayOptions) => OverlayHandle | void;
  closeOverlay: () => void;
  onInvalidate: () => void;
  abortActive?: () => void | Promise<void>;
  requestExit?: () => void;
  compactSession?: (options?: TuiCompactOptions) => void | Promise<void | TuiCompactResult>;
  setModel?: (modelRef: string) => void | Promise<void>;
  setThinkingLevel?: (level: TuiThinkingLevel) => void | Promise<void>;
  setReasoningLevel?: (level: TuiReasoningLevel) => void | Promise<void>;
  setVerboseLevel?: (level: TuiVerboseLevel) => void | Promise<void>;
  setWorkingMessage?: (message?: string) => void;
  setWorkingVisible?: (visible: boolean) => void;
  setWorkingIndicator?: (options?: TuiWorkingIndicatorOptions) => void;
}

function recomputeSlashCommandInvocationNames(commands: TuiExtensionSlashCommand[]) {
  const counts = new Map<string, number>();
  for (const command of commands) {
    counts.set(command.originalName, (counts.get(command.originalName) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  const taken = new Set<string>();
  for (const command of commands) {
    const occurrence = (seen.get(command.originalName) ?? 0) + 1;
    seen.set(command.originalName, occurrence);

    let name = (counts.get(command.originalName) ?? 0) > 1
      ? `${command.originalName}:${occurrence}`
      : command.originalName;
    if (taken.has(name)) {
      let suffix = occurrence;
      do {
        suffix += 1;
        name = `${command.originalName}:${suffix}`;
      } while (taken.has(name));
    }
    command.name = name;
    taken.add(name);
  }
}

function suggestionsToAutocompleteItems(
  suggestions: TuiAutocompleteSuggestion[],
): AutocompleteItem[] {
  return suggestions.map((s) => ({
    value: `@${s.name}`,
    label: s.name,
    description: s.description,
  }));
}

export function createTuiExtensionRuntime(
  opts: CreateTuiExtensionRuntimeOptions,
): TuiExtensionRuntime {
  const surface = new TuiExtensionSurface();
  const slashCommands: TuiExtensionSlashCommand[] = [];
  const shortcuts: TuiExtensionShortcut[] = [];
  const autocompleteProviders: TuiAutocompleteProvider[] = [
    createSkillsAutocompleteProvider(),
  ];
  const autocompleteProviderFactories: TuiAutocompleteProviderFactory[] = [];
  const disposers: Array<() => void> = [];

  const baseProvider = new CombinedAutocompleteProvider(
    opts.baseSlashCommands.map((c) => ({ name: c.name, description: c.description })),
    opts.cwd,
    opts.fdPath,
  );

  const chainedProvider = new ChainedAutocompleteProvider(
    baseProvider,
    autocompleteProviders,
    slashCommands,
    new Set(opts.baseSlashCommands.map((command) => command.name)),
    () => opts.getState().currentSessionKey,
    opts.cwd,
  );
  const autocompleteProvider = new WrappedAutocompleteProvider(
    chainedProvider,
    autocompleteProviderFactories,
  );

  const invalidate = () => {
    opts.header.setCustomComponent?.(surface.customHeader);
    opts.header.setExtensionLines(surface.getHeaderLines());
    opts.header.setExtensionComponents?.(surface.getHeaderComponents());
    opts.bottomBar.setCustomComponent?.(surface.customFooter);
    opts.bottomBar.setExtensionLines(surface.getFooterLines());
    opts.bottomBar.setExtensionComponents?.(surface.getFooterComponents());
    opts.bottomBar.setExtensionStatusParts(surface.getStatusParts());
    opts.onInvalidate();
  };

  const createWidgetComponent = (factory: TuiWidgetFactory): Component & { dispose?(): void } =>
    factory(opts.tui, theme) as Component & { dispose?(): void };

  const footerDataProvider: TuiFooterDataProvider = {
    getGitBranch: () => getGitBranchCached(opts.cwd),
    getExtensionStatuses: () => surface.statusSlots,
    getAvailableProviderCount: () => opts.getAvailableProviderCount?.() ?? 0,
    onBranchChange: () => () => {},
  };
  const modelRegistry = opts.getModelRegistry?.() ?? createDefaultModelRegistry();

  const setCustomHeader = (factory: TuiHeaderFactory | undefined) => {
    disposeComponent(surface.customHeader);
    surface.customHeader = factory
      ? (factory(opts.tui, theme) as Component & { dispose?(): void })
      : undefined;
    invalidate();
  };

  const setCustomFooter = (factory: TuiFooterFactory | undefined) => {
    disposeComponent(surface.customFooter);
    surface.customFooter = factory
      ? (factory(opts.tui, theme, footerDataProvider) as Component & { dispose?(): void })
      : undefined;
    invalidate();
  };

  const clearWidgetKey = (fullKey: string) => {
    surface.headerWidgets.delete(fullKey);
    surface.footerWidgets.delete(fullKey);
    const headerComponent = surface.headerWidgetComponents.get(fullKey);
    const footerComponent = surface.footerWidgetComponents.get(fullKey);
    surface.headerWidgetComponents.delete(fullKey);
    surface.footerWidgetComponents.delete(fullKey);
    disposeComponent(headerComponent);
    disposeComponent(footerComponent);
  };

  const createActionUiContext = (extensionId: string): TuiActionUiContext => {
    const widgetKey = (key: string) => `${extensionId}:${key}`;
    return {
      select: selectDialog,
      confirm: confirmDialog,
      input: inputDialog,
      notify: (message, level) => notifyInChatLog(opts.chatLog, opts.tui, message, level),
      onTerminalInput: (handler) => {
        const unregister = opts.addInputListener?.(handler);
        if (!unregister) return () => {};
        disposers.push(unregister);
        return () => {
          unregister();
          const idx = disposers.indexOf(unregister);
          if (idx >= 0) disposers.splice(idx, 1);
        };
      },
      setStatus: (key, text) => {
        const fullKey = widgetKey(key);
        if (!text) {
          surface.statusSlots.delete(fullKey);
        } else {
          surface.statusSlots.set(fullKey, text);
        }
        invalidate();
      },
      setWorkingMessage: (message) => {
        opts.setWorkingMessage?.(message ?? undefined);
        invalidate();
      },
      setWorkingVisible: (visible) => {
        opts.setWorkingVisible?.(visible);
        invalidate();
      },
      setWorkingIndicator: (indicator) => {
        opts.setWorkingIndicator?.(indicator ?? undefined);
        invalidate();
      },
      setHiddenThinkingLabel: (label) => {
        opts.chatLog.setHiddenThinkingLabel(label ?? undefined);
        invalidate();
      },
      setWidget: (key, content, options) => {
        const fullKey = widgetKey(key);
        clearWidgetKey(fullKey);
        if (!content) {
          invalidate();
          return;
        }
        if (typeof content === 'function') {
          const target = options?.placement === 'belowEditor'
            ? surface.footerWidgetComponents
            : surface.headerWidgetComponents;
          target.set(fullKey, createWidgetComponent(content as TuiWidgetFactory));
        } else {
          const target = options?.placement === 'belowEditor'
            ? surface.footerWidgets
            : surface.headerWidgets;
          target.set(fullKey, boundedWidgetLines(content));
        }
        invalidate();
      },
      setFooter: setCustomFooter,
      setHeader: setCustomHeader,
      custom: customOverlay,
      setTitle: (title) => opts.setTitle?.(title),
      pasteToEditor: (text) => opts.pasteToEditor?.(text),
      setEditorText: (text) => opts.setEditorText?.(text),
      getEditorText: () => opts.getEditorText?.() ?? '',
      editor: editorDialog,
      addAutocompleteProvider: (factory) => {
        autocompleteProviderFactories.push(factory);
        const dispose = () => {
          const idx = autocompleteProviderFactories.indexOf(factory);
          if (idx >= 0) autocompleteProviderFactories.splice(idx, 1);
        };
        disposers.push(dispose);
        return dispose;
      },
      setEditorComponent: (factory) => opts.setEditorComponent?.(factory),
      getEditorComponent: () => opts.getEditorComponent?.(),
      get theme() {
        return opts.getThemeObject?.() ?? {};
      },
      getAllThemes: () => opts.getAllThemes?.() ?? [],
      getTheme: (name) => opts.getTheme?.(name),
      setTheme: (nextTheme) => opts.setTheme?.(nextTheme) ?? {
        success: false,
        error: 'Theme switching is not available in this TUI host.',
      },
      getToolsExpanded: () => opts.getToolsExpanded?.() ?? false,
      setToolsExpanded: (expanded) => opts.setToolsExpanded?.(expanded),
    };
  };

  const createActionContext = (extensionId: string): TuiSlashCommandContext => {
    let staleMessage: string | undefined;
    const assertActive = () => {
      if (staleMessage) {
        throw new Error(staleMessage);
      }
    };
    const markStale = () => {
      staleMessage ??= STALE_EXTENSION_CONTEXT_MESSAGE;
    };
    const guardedReplacement = async (
      work: () => Promise<TuiReplacementResult>,
    ): Promise<TuiReplacementResult> => {
      assertActive();
      const result = await work();
      if (!result.cancelled) {
        markStale();
      }
      return result;
    };

    const context = Object.defineProperties(
      {
        isProjectTrusted: () => {
          assertActive();
          return opts.isProjectTrusted?.() ?? false;
        },
        isIdle: () => {
          assertActive();
          return isTuiIdle(opts.getState());
        },
        hasPendingMessages: () => {
          assertActive();
          return hasPendingTuiMessages(opts.getState());
        },
        abort: () => {
          assertActive();
          return opts.abortActive?.();
        },
        shutdown: () => {
          assertActive();
          return opts.requestExit?.();
        },
        compact: (options?: TuiCompactOptions) => {
          assertActive();
          return opts.compactSession?.(options);
        },
        getSystemPrompt: () => {
          assertActive();
          return opts.getSystemPrompt?.() ?? '';
        },
        getSystemPromptOptions: () => {
          assertActive();
          return opts.getSystemPromptOptions?.() ?? {
            cwd: opts.cwd,
            sessionKey: opts.getState().currentSessionKey,
            model: getTuiModelInfo(opts.getState()),
          };
        },
        waitForIdle: () => {
          assertActive();
          return opts.waitForIdle?.() ?? Promise.resolve();
        },
        newSession: (options?: TuiNewSessionOptions) =>
          guardedReplacement(() => opts.newSession?.(options) ?? Promise.resolve({ cancelled: true })),
        fork: (entryId: string, options?: TuiForkOptions) =>
          guardedReplacement(() => opts.forkSession?.(entryId, options) ?? Promise.resolve({ cancelled: true })),
        navigateTree: (targetId: string, options?: TuiNavigateTreeOptions) => {
          assertActive();
          return opts.navigateTree?.(targetId, options) ?? Promise.resolve({ cancelled: true });
        },
        switchSession: (sessionPath: string, options?: TuiSwitchSessionOptions) =>
          guardedReplacement(() =>
            opts.switchSession?.(sessionPath, options) ?? Promise.resolve({ cancelled: true }),
          ),
        reload: async () => {
          assertActive();
          await (opts.reload?.() ?? Promise.resolve());
          markStale();
        },
        getModel: () => {
          assertActive();
          return getTuiModelInfo(opts.getState());
        },
        setModel: (modelRef: string) => {
          assertActive();
          return opts.setModel?.(modelRef);
        },
        getThinkingLevel: () => {
          assertActive();
          return getTuiThinkingLevel(opts.getState());
        },
        setThinkingLevel: (level: TuiThinkingLevel) => {
          assertActive();
          return opts.setThinkingLevel?.(level);
        },
        getReasoningLevel: () => {
          assertActive();
          return getTuiReasoningLevel(opts.getState());
        },
        setReasoningLevel: (level: TuiReasoningLevel) => {
          assertActive();
          return opts.setReasoningLevel?.(level);
        },
        getVerboseLevel: () => {
          assertActive();
          return getTuiVerboseLevel(opts.getState());
        },
        setVerboseLevel: (level: TuiVerboseLevel) => {
          assertActive();
          return opts.setVerboseLevel?.(level);
        },
        getCommands: () => {
          assertActive();
          return [
            ...opts.baseSlashCommands.map((command) => ({
              name: command.name,
              description: command.description,
              source: 'builtin' as const,
            })),
            ...slashCommands.map((command) => ({
              name: command.name,
              description: command.description,
              source: 'extension' as const,
            })),
          ];
        },
        getContextUsage: () => {
          assertActive();
          return getTuiContextUsage(opts.getState());
        },
        notify: (message: string, level?: TuiNotifyLevel) => {
          assertActive();
          return notifyInChatLog(opts.chatLog, opts.tui, message, level);
        },
      },
      {
        mode: {
          enumerable: true,
          get: () => {
            assertActive();
            return 'tui';
          },
        },
        hasUI: {
          enumerable: true,
          get: () => {
            assertActive();
            return true;
          },
        },
        signal: {
          enumerable: true,
          get: () => {
            assertActive();
            return opts.getActiveSignal?.();
          },
        },
        ui: {
          enumerable: true,
          get: () => {
            assertActive();
            return createActionUiContext(extensionId);
          },
        },
        sessionManager: {
          enumerable: true,
          get: () => {
            assertActive();
            return opts.getSessionManager?.() ??
              createEmptySessionManager(opts.cwd, opts.getState().currentSessionKey);
          },
        },
        modelRegistry: {
          enumerable: true,
          get: () => {
            assertActive();
            return modelRegistry;
          },
        },
        model: {
          enumerable: true,
          get: () => {
            assertActive();
            return getTuiModelInfo(opts.getState());
          },
        },
        cwd: {
          enumerable: true,
          get: () => {
            assertActive();
            return opts.cwd;
          },
        },
        sessionKey: {
          enumerable: true,
          get: () => {
            assertActive();
            return opts.getState().currentSessionKey;
          },
        },
      },
    ) as TuiSlashCommandContext;
    return context;
  };

  const runDialog = <T>(
    createDialog: (resolve: (value: T) => void, cancel: () => void) => Component & {
      setCountdownSeconds?: (seconds: number | undefined) => void;
    },
    dialogOpts: TuiDialogOptions | undefined,
    cancelValue: T,
  ): Promise<T> =>
    new Promise((resolve) => {
      if (dialogOpts?.signal?.aborted) {
        resolve(cancelValue);
        return;
      }

      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let interval: ReturnType<typeof setInterval> | undefined;
      const finish = (value: T) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        if (interval) clearInterval(interval);
        dialogOpts?.signal?.removeEventListener('abort', onAbort);
        opts.closeOverlay();
        opts.onInvalidate();
        resolve(value);
      };
      const onAbort = () => finish(cancelValue);

      dialogOpts?.signal?.addEventListener('abort', onAbort, { once: true });
      const dialog = createDialog(finish, () => finish(cancelValue));
      if (dialogOpts?.timeout != null && dialogOpts.timeout > 0) {
        const deadline = Date.now() + dialogOpts.timeout;
        const updateCountdown = () => {
          const remainingMs = Math.max(0, deadline - Date.now());
          dialog.setCountdownSeconds?.(Math.ceil(remainingMs / 1000));
          opts.onInvalidate();
        };
        updateCountdown();
        interval = setInterval(updateCountdown, 250);
        timeout = setTimeout(() => finish(cancelValue), dialogOpts.timeout);
      }

      opts.openOverlay(dialog);
      opts.onInvalidate();
    });

  const selectDialog = (
    title: string,
    options: string[],
    dialogOpts?: TuiDialogOptions,
  ): Promise<string | undefined> => {
    if (options.length === 0) return Promise.resolve(undefined);
    return runDialog(
      (resolve, cancel) =>
        new ExtensionSelectDialog(title, options, {
          onSelect: resolve,
          onCancel: cancel,
        }, opts.keybindings),
      dialogOpts,
      undefined,
    );
  };

  const confirmDialog = async (
    title: string,
    message: string,
    dialogOpts?: TuiDialogOptions,
  ): Promise<boolean> => {
    const result = await selectDialog(`${title}\n${message}`, ['Yes', 'No'], dialogOpts);
    return result === 'Yes';
  };

  const inputDialog = (
    title: string,
    placeholder?: string,
    dialogOpts?: TuiDialogOptions,
  ): Promise<string | undefined> =>
    runDialog(
      (resolve, cancel) =>
        new ExtensionInputDialog(title, placeholder, {
          onSubmit: resolve,
          onCancel: cancel,
        }, opts.keybindings),
      dialogOpts,
      undefined,
    );

  const editorDialog = (
    title: string,
    prefill?: string,
  ): Promise<string | undefined> =>
    runDialog(
      (resolve, cancel) =>
        new ExtensionEditorDialog(opts.tui, title, prefill, {
          onSubmit: resolve,
          onCancel: cancel,
        }, opts.keybindings),
      undefined,
      undefined,
    );

  const customOverlay = <T>(
    factory: TuiCustomFactory<T>,
    customOpts?: TuiCustomOptions,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      let closed = false;
      let component: TuiCustomComponent | undefined;
      let cleanup: (() => void) | undefined;
      const removeCleanup = () => {
        if (!cleanup) return;
        const idx = disposers.indexOf(cleanup);
        if (idx >= 0) disposers.splice(idx, 1);
      };
      const close = (result: T) => {
        if (closed) return;
        closed = true;
        removeCleanup();
        opts.closeOverlay();
        opts.onInvalidate();
        try {
          component?.dispose?.();
        } catch {
          // Ignore extension component cleanup failures.
        }
        resolve(result);
      };

      Promise.resolve()
        .then(() => invokeCustomFactory(factory, opts.tui, opts.keybindings, close))
        .then((nextComponent) => {
          if (closed) return;
          component = nextComponent;
          cleanup = () => {
            if (closed) return;
            closed = true;
            opts.closeOverlay();
            opts.onInvalidate();
            try {
              component?.dispose?.();
            } catch {
              // Ignore extension component cleanup failures.
            }
          };
          disposers.push(cleanup);
          const overlayOptions = resolveCustomOverlayOptions(nextComponent, customOpts);
          const handle = opts.openOverlay(nextComponent as Component, overlayOptions);
          if (handle) {
            customOpts?.onHandle?.(handle as TuiOverlayHandle);
          }
          opts.onInvalidate();
        })
        .catch((err: unknown) => {
          if (closed) return;
          closed = true;
          removeCleanup();
          try {
            component?.dispose?.();
          } catch {
            // Ignore extension component cleanup failures.
          }
          reject(err);
        });
    });

  const createHost = (extensionId: string) =>
    createTuiExtensionHost({
      extensionId,
      surface,
      getSessionKey: () => opts.getState().currentSessionKey,
      notify: (message, level) => notifyInChatLog(opts.chatLog, opts.tui, message, level),
      onTerminalInputAdded: (handler) => {
        const unregister = opts.addInputListener?.(handler);
        if (!unregister) return () => {};
        disposers.push(unregister);
        return () => {
          unregister();
          const idx = disposers.indexOf(unregister);
          if (idx >= 0) disposers.splice(idx, 1);
        };
      },
      showOverlay: opts.openOverlay,
      hideOverlay: opts.closeOverlay,
      custom: customOverlay,
      createWidgetComponent,
      setFooter: setCustomFooter,
      setHeader: setCustomHeader,
      setTitle: (title) => opts.setTitle?.(title),
      pasteToEditor: (text) => opts.pasteToEditor?.(text),
      setEditorText: (text) => opts.setEditorText?.(text),
      getEditorText: () => opts.getEditorText?.() ?? '',
      editor: editorDialog,
      setEditorComponent: (factory) => opts.setEditorComponent?.(factory),
      getEditorComponent: () => opts.getEditorComponent?.(),
      getThemeObject: () => opts.getThemeObject?.() ?? {},
      getAllThemes: () => opts.getAllThemes?.() ?? [],
      getTheme: (name) => opts.getTheme?.(name),
      setTheme: (nextTheme) => opts.setTheme?.(nextTheme) ?? {
        success: false,
        error: 'Theme switching is not available in this TUI host.',
      },
      getToolsExpanded: () => opts.getToolsExpanded?.() ?? false,
      setToolsExpanded: (expanded) => opts.setToolsExpanded?.(expanded),
      select: selectDialog,
      confirm: confirmDialog,
      input: inputDialog,
      onAutocompleteProviderAdded: (provider) => {
        autocompleteProviders.push(provider);
        const dispose = () => {
          const idx = autocompleteProviders.indexOf(provider);
          if (idx >= 0) autocompleteProviders.splice(idx, 1);
        };
        disposers.push(dispose);
        return dispose;
      },
      onAutocompleteProviderFactoryAdded: (factory) => {
        autocompleteProviderFactories.push(factory);
        const dispose = () => {
          const idx = autocompleteProviderFactories.indexOf(factory);
          if (idx >= 0) autocompleteProviderFactories.splice(idx, 1);
        };
        disposers.push(dispose);
        return dispose;
      },
      onMessageRendererAdded: (customType, renderer) => {
        const normalized = customType.trim();
        if (!normalized) return () => {};
        opts.chatLog.setCustomMessageRenderer(normalized, renderer);
        opts.onInvalidate();
        const dispose = () => {
          opts.chatLog.setCustomMessageRenderer(normalized, undefined);
          opts.onInvalidate();
        };
        disposers.push(dispose);
        return dispose;
      },
      onSlashCommandAdded: (name, description, handler) => {
        const normalized = name.replace(/^\//, '').toLowerCase();
        const entry: TuiExtensionSlashCommand = {
          originalName: normalized,
          name: normalized,
          description,
          handler,
          getContext: () => createActionContext(extensionId),
        };
        slashCommands.push(entry);
        recomputeSlashCommandInvocationNames(slashCommands);
        const dispose = () => {
          const idx = slashCommands.indexOf(entry);
          if (idx >= 0) slashCommands.splice(idx, 1);
          recomputeSlashCommandInvocationNames(slashCommands);
        };
        disposers.push(dispose);
        return dispose;
      },
      onShortcutAdded: (key, description, handler) => {
        const entry: TuiExtensionShortcut = {
          key,
          description,
          handler,
          getContext: () => createActionContext(extensionId),
        };
        shortcuts.push(entry);
        const dispose = () => {
          const idx = shortcuts.indexOf(entry);
          if (idx >= 0) shortcuts.splice(idx, 1);
        };
        disposers.push(dispose);
        return dispose;
      },
      setHiddenThinkingLabel: (label) => {
        opts.chatLog.setHiddenThinkingLabel(label);
      },
      setWorkingMessage: (message) => {
        opts.setWorkingMessage?.(message);
      },
      setWorkingVisible: (visible) => {
        opts.setWorkingVisible?.(visible);
      },
      setWorkingIndicator: (options) => {
        opts.setWorkingIndicator?.(options);
      },
      onInvalidate: invalidate,
    });

  return {
    surface,
    slashCommands,
    shortcuts,
    autocompleteProvider,
    handleShortcut(data: string): boolean {
      for (const shortcut of shortcuts) {
        if (data !== shortcut.key && !matchesKey(data, shortcut.key as never)) {
          continue;
        }
        Promise.resolve(
          shortcut.handler(shortcut.getContext()),
        ).catch((err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          notifyInChatLog(
            opts.chatLog,
            opts.tui,
            `Shortcut handler error: ${errorMessage}`,
            'error',
          );
        });
        return true;
      }
      return false;
    },
    async activate() {
      const registrars = opts.registry?.getTuiRegistrations() ?? [];
      await invokeTuiExtensionRegistrars(registrars, createHost, (extensionId, errorMessage) => {
        notifyInChatLog(
          opts.chatLog,
          opts.tui,
          `[${extensionId}] TUI init failed: ${errorMessage}`,
          'error',
        );
      });
      invalidate();
    },
    dispose() {
      for (const dispose of disposers) dispose();
      disposers.length = 0;
      clearTuiToolRenderers();
      disposeComponent(surface.customHeader);
      disposeComponent(surface.customFooter);
      surface.disposeWidgetComponents();
      surface.customHeader = undefined;
      surface.customFooter = undefined;
      surface.headerWidgets.clear();
      surface.footerWidgets.clear();
      surface.statusSlots.clear();
      opts.chatLog.setHiddenThinkingLabel();
      opts.setWorkingMessage?.();
      opts.setWorkingVisible?.(true);
      opts.setWorkingIndicator?.();
      opts.setEditorComponent?.(undefined);
      slashCommands.length = 0;
      shortcuts.length = 0;
      autocompleteProviders.length = 1;
      autocompleteProviderFactories.length = 0;
      invalidate();
    },
  };
}

/** Exported for tests */
export { suggestionsToAutocompleteItems };
