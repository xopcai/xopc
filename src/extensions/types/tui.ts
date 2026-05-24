/**
 * TUI extension host contract — minimal surface for `api.registerTui()`.
 * Implementations live under `src/tui/extension-host/` (pi-tui types stay there).
 */

export type TuiNotifyLevel = 'info' | 'warn' | 'error';

export interface TuiAutocompleteSuggestion {
  name: string;
  description?: string;
}

export type TuiAutocompleteProvider = (
  query: string,
  context: { cwd: string; sessionKey: string },
) => TuiAutocompleteSuggestion[] | Promise<TuiAutocompleteSuggestion[]>;

export interface TuiToolRenderContext {
  toolName: string;
  args: unknown;
  resultText: string;
  isError: boolean;
  expanded: boolean;
}

export type TuiToolRenderer = (ctx: TuiToolRenderContext) => string[] | null;

export type TuiSlashCommandHandler = (args: string) => void | Promise<void>;

/** Host passed to extension `registerTui` callbacks when `xopc tui` starts. */
export interface TuiExtensionHostContract {
  readonly extensionId: string;
  setFooterWidget(key: string, lines: string[] | null): void;
  setHeaderWidget(key: string, lines: string[] | null): void;
  addAutocompleteProvider(provider: TuiAutocompleteProvider): () => void;
  registerToolRenderer(toolName: string, renderer: TuiToolRenderer): () => void;
  registerSlashCommand(
    name: string,
    description: string,
    handler: TuiSlashCommandHandler,
  ): () => void;
  notify(message: string, level?: TuiNotifyLevel): void;
  showOverlay(component: unknown): void;
  hideOverlay(): void;
  setStatus(key: string, text: string | null): void;
}

export type TuiExtensionRegistrar = (
  host: TuiExtensionHostContract,
) => void | Promise<void>;

export interface TuiExtensionRegistration {
  extensionId: string;
  register: TuiExtensionRegistrar;
}
