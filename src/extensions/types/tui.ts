/**
 * TUI extension host contract — minimal surface for `api.registerTui()`.
 * Implementations live under `src/tui/extension-host/` (pi-tui types stay there).
 */

export type TuiNotifyLevel = 'info' | 'warn' | 'warning' | 'error';

export interface TuiAutocompleteSuggestion {
  name: string;
  value?: string;
  label?: string;
  description?: string;
}

export type TuiAutocompleteProvider = (
  query: string,
  context: { cwd: string; sessionKey: string },
) => TuiAutocompleteSuggestion[] | Promise<TuiAutocompleteSuggestion[]>;

export interface TuiAutocompleteItem {
  value: string;
  label: string;
  description?: string;
}

export interface TuiAutocompleteSuggestions {
  items: TuiAutocompleteItem[];
  prefix: string;
}

export interface TuiAutocompleteProviderApi {
  getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<TuiAutocompleteSuggestions | null>;
  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: TuiAutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number };
  shouldTriggerFileCompletion?(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): boolean;
  triggerCharacters?: string[];
}

export type TuiAutocompleteProviderFactory = (
  current: TuiAutocompleteProviderApi,
) => TuiAutocompleteProviderApi;

export interface TuiToolRenderContext {
  toolName: string;
  toolCallId: string;
  args: unknown;
  resultText: string;
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details?: unknown;
  invalidate: () => void;
  lastComponent: unknown;
  state: Record<string, unknown>;
  cwd: string;
  executionStarted: boolean;
  argsComplete: boolean;
  isError: boolean;
  isPartial?: boolean;
  expanded: boolean;
  showImages: boolean;
}

export type TuiToolRendererResult = string[] | TuiRenderableComponent | null | undefined;

export type TuiToolRenderer = (ctx: TuiToolRenderContext) => TuiToolRendererResult;

export interface TuiToolRenderResultOptions {
  expanded: boolean;
  isPartial: boolean;
}

export interface TuiToolRendererDefinition {
  renderShell?: 'default' | 'self';
  render?: TuiToolRenderer;
  renderCall?: (
    args: unknown,
    theme: TuiTheme,
    context: TuiToolRenderContext,
  ) => TuiToolRendererResult;
  renderResult?: (
    result: { content?: TuiToolRenderContext['content']; details?: unknown; text: string },
    options: TuiToolRenderResultOptions,
    theme: TuiTheme,
    context: TuiToolRenderContext,
  ) => TuiToolRendererResult;
}

export type TuiToolRendererRegistration = TuiToolRenderer | TuiToolRendererDefinition;

export interface TuiCommandInfo {
  name: string;
  description?: string;
  source: 'builtin' | 'extension';
}

export interface TuiContextUsage {
  /** xopc-native token estimate field. */
  estimatedTokens: number | null;
  /** pi-compatible token estimate field. */
  tokens: number | null;
  contextWindow: number | null;
  /** xopc-native context usage percent field. */
  usagePercent: number | null;
  /** pi-compatible context usage percent field. */
  percent: number | null;
}

export interface TuiModelInfo {
  provider?: string;
  id: string;
  ref: string;
  contextWindow?: number | null;
}

export type TuiModelRegistryModel = {
  provider: string;
  id: string;
  ref?: string;
  contextWindow?: number | null;
} & Record<string, unknown>;

export type TuiModelAuthResult =
  | { ok: true; apiKey?: string; headers?: Record<string, string> }
  | { ok: false; error: string };

export interface TuiModelRegistry {
  find(provider: string, modelId: string): TuiModelRegistryModel | undefined;
  getApiKeyAndHeaders(model: TuiModelRegistryModel): Promise<TuiModelAuthResult>;
}

export type TuiThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'adaptive';

export type TuiReasoningLevel = 'off' | 'on' | 'stream';

export type TuiVerboseLevel = 'off' | 'on' | 'full';

export interface TuiDialogOptions {
  signal?: AbortSignal;
  timeout?: number;
}

export type TuiTheme = Record<string, unknown>;

export interface TuiThemeInfo {
  name: string;
  path: string | undefined;
}

export interface TuiSetThemeResult {
  success: boolean;
  error?: string;
}

export interface TuiCustomMessage<T = unknown> {
  customType: string;
  content: string | unknown[];
  display?: boolean;
  details?: T;
}

export interface TuiMessageRenderOptions {
  expanded: boolean;
}

export type TuiMessageRenderer<T = unknown> = (
  message: TuiCustomMessage<T>,
  options: TuiMessageRenderOptions,
  theme: TuiTheme,
) => TuiRenderableComponent | undefined;

export type TuiWidgetPlacement = 'aboveEditor' | 'belowEditor';

export interface TuiWidgetOptions {
  placement?: TuiWidgetPlacement;
}

export type TuiRenderableComponent = {
  render(width: number): string[];
  invalidate?(): void;
  dispose?(): void;
};

export type TuiWidgetFactory = (
  tui: unknown,
  theme: unknown,
) => TuiRenderableComponent;

export type TuiHeaderFactory = (
  tui: unknown,
  theme: unknown,
) => TuiRenderableComponent;

export interface TuiFooterDataProvider {
  getGitBranch(): string | null;
  getExtensionStatuses(): ReadonlyMap<string, string>;
  getAvailableProviderCount(): number;
  onBranchChange(callback: () => void): () => void;
}

export type TuiFooterFactory = (
  tui: unknown,
  theme: unknown,
  footerData: TuiFooterDataProvider,
) => TuiRenderableComponent;

export type TuiEditorComponent = TuiRenderableComponent & {
  getText(): string;
  setText(text: string): void;
  handleInput(data: string): void;
  onSubmit?: (text: string) => void;
  onChange?: (text: string) => void;
  addToHistory?(text: string): void;
  insertTextAtCursor?(text: string): void;
  getExpandedText?(): string;
  setAutocompleteProvider?(provider: TuiAutocompleteProviderApi): void;
  borderColor?: (text: string) => string;
  setPaddingX?(padding: number): void;
  setAutocompleteMaxVisible?(maxVisible: number): void;
};

export type TuiEditorFactory = (
  tui: unknown,
  theme: unknown,
  keybindings: unknown,
) => TuiEditorComponent;

export type TuiCustomComponent = unknown & { dispose?(): void };

export type TuiOverlayAnchor =
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center'
  | 'left-center'
  | 'right-center';

export interface TuiOverlayMargin {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export type TuiOverlaySizeValue = number | `${number}%`;

export interface TuiOverlayOptions {
  width?: TuiOverlaySizeValue;
  minWidth?: number;
  maxHeight?: TuiOverlaySizeValue;
  anchor?: TuiOverlayAnchor;
  offsetX?: number;
  offsetY?: number;
  row?: TuiOverlaySizeValue;
  col?: TuiOverlaySizeValue;
  margin?: TuiOverlayMargin | number;
  visible?: (termWidth: number, termHeight: number) => boolean;
  nonCapturing?: boolean;
}

export interface TuiOverlayHandle {
  hide(): void;
  setHidden(hidden: boolean): void;
  isHidden(): boolean;
  focus(): void;
  unfocus(options?: { target: unknown | null }): void;
  isFocused(): boolean;
}

export type TuiCustomFactoryResult = TuiCustomComponent | Promise<TuiCustomComponent>;

export type TuiCustomLegacyFactory<T> = (
  done: (result: T) => void,
) => TuiCustomFactoryResult;

export type TuiCustomFullFactory<T> = (
  tui: unknown,
  theme: unknown,
  keybindings: unknown,
  done: (result: T) => void,
) => TuiCustomFactoryResult;

export type TuiCustomFactory<T> = TuiCustomLegacyFactory<T> | TuiCustomFullFactory<T>;

export interface TuiCustomOptions {
  /** xopc currently renders custom components as overlays. */
  overlay?: boolean;
  overlayOptions?: TuiOverlayOptions | (() => TuiOverlayOptions | undefined);
  onHandle?: (handle: TuiOverlayHandle) => void;
}

export type TuiTerminalInputHandler = (
  data: string,
) => { consume?: boolean; data?: string } | undefined;

export interface TuiCompactOptions {
  customInstructions?: string;
  onComplete?: (result: TuiCompactResult) => void;
  onError?: (error: Error) => void;
}

export interface TuiCompactResult {
  compacted: boolean;
  summary?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  transcriptSummary?: string;
}

export interface TuiSystemPromptOptions {
  cwd: string;
  sessionKey?: string;
  model?: TuiModelInfo;
}

export interface TuiReplacementResult {
  cancelled: boolean;
}

export interface TuiReplacedSessionContext extends TuiActionContext {
  sendMessage<T = unknown>(
    message: TuiCustomMessage<T>,
    options?: { triggerTurn?: boolean; deliverAs?: 'steer' | 'next' | 'nextTurn' },
  ): Promise<void>;
  sendUserMessage(
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>,
    options?: { deliverAs?: 'steer' | 'next' },
  ): Promise<void>;
}

export interface TuiNewSessionOptions {
  parentSession?: string;
  setup?: (sessionManager: TuiReadonlySessionManager) => Promise<void>;
  withSession?: (ctx: TuiReplacedSessionContext) => Promise<void>;
}

export interface TuiForkOptions {
  position?: 'before' | 'at';
  withSession?: (ctx: TuiReplacedSessionContext) => Promise<void>;
}

export interface TuiNavigateTreeOptions {
  summarize?: boolean;
  customInstructions?: string;
  replaceInstructions?: boolean;
  label?: string;
}

export interface TuiSwitchSessionOptions {
  withSession?: (ctx: TuiReplacedSessionContext) => Promise<void>;
}

export interface TuiSessionSnapshotEntry {
  id: string;
  type: string;
  parentId: string | null;
  userLabel?: string;
  labelTimestamp?: string;
  role?: 'user' | 'assistant' | 'system';
  message?: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    usage?: {
      input: number;
      output: number;
      cost: { total: number };
    };
  };
  content: string;
  timestamp?: number;
  raw?: unknown;
}

export interface TuiSessionSnapshotHeader {
  type: 'session';
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface TuiSessionSnapshotTreeNode {
  entry: TuiSessionSnapshotEntry;
  children: TuiSessionSnapshotTreeNode[];
  label?: string;
  labelTimestamp?: string;
}

export interface TuiReadonlySessionManager {
  getEntries(): TuiSessionSnapshotEntry[];
  getBranch(): TuiSessionSnapshotEntry[];
  getLeafEntry(): TuiSessionSnapshotEntry | undefined;
  getLeafId(): string | null;
  getEntry(entryId: string): TuiSessionSnapshotEntry | undefined;
  getLabel(entryId: string): string | undefined;
  getHeader(): TuiSessionSnapshotHeader | null;
  getTree(): TuiSessionSnapshotTreeNode[];
  getSessionId(): string;
  getSessionFile(): string | undefined;
  getSessionDir(): string | undefined;
  getSessionName(): string | undefined;
  getCwd(): string;
}

export interface TuiActionUiContext {
  select(title: string, options: string[], opts?: TuiDialogOptions): Promise<string | undefined>;
  confirm(title: string, message: string, opts?: TuiDialogOptions): Promise<boolean>;
  input(title: string, placeholder?: string, opts?: TuiDialogOptions): Promise<string | undefined>;
  notify(message: string, level?: TuiNotifyLevel): void;
  onTerminalInput(handler: TuiTerminalInputHandler): () => void;
  setStatus(key: string, text: string | null | undefined): void;
  setWorkingMessage(message?: string | null): void;
  setWorkingVisible(visible: boolean): void;
  setWorkingIndicator(options?: TuiWorkingIndicatorOptions | null): void;
  setHiddenThinkingLabel(label?: string | null): void;
  setWidget(key: string, lines: string[] | null | undefined, options?: TuiWidgetOptions): void;
  setWidget(key: string, factory: TuiWidgetFactory | undefined, options?: TuiWidgetOptions): void;
  setFooter(factory: TuiFooterFactory | undefined): void;
  setHeader(factory: TuiHeaderFactory | undefined): void;
  custom<T>(factory: TuiCustomFactory<T>, options?: TuiCustomOptions): Promise<T>;
  setTitle(title: string): void;
  pasteToEditor(text: string): void;
  setEditorText(text: string): void;
  getEditorText(): string;
  editor(title: string, prefill?: string): Promise<string | undefined>;
  addAutocompleteProvider(factory: TuiAutocompleteProviderFactory): () => void;
  setEditorComponent(factory: TuiEditorFactory | undefined): void;
  getEditorComponent(): TuiEditorFactory | undefined;
  readonly theme: TuiTheme;
  getAllThemes(): TuiThemeInfo[];
  getTheme(name: string): TuiTheme | undefined;
  setTheme(theme: string): TuiSetThemeResult;
  getToolsExpanded(): boolean;
  setToolsExpanded(expanded: boolean): void;
}

export interface TuiActionContext {
  readonly mode: 'tui';
  readonly hasUI: true;
  readonly signal?: AbortSignal;
  readonly ui: TuiActionUiContext;
  readonly sessionManager: TuiReadonlySessionManager;
  readonly modelRegistry: TuiModelRegistry;
  readonly model: TuiModelInfo | undefined;
  cwd: string;
  sessionKey: string;
  isProjectTrusted(): boolean;
  isIdle(): boolean;
  hasPendingMessages(): boolean;
  abort(): void | Promise<void>;
  shutdown(): void;
  compact(options?: TuiCompactOptions): void | Promise<void | TuiCompactResult>;
  getSystemPrompt(): string;
  getSystemPromptOptions(): TuiSystemPromptOptions;
  waitForIdle(): Promise<void>;
  newSession(options?: TuiNewSessionOptions): Promise<TuiReplacementResult>;
  fork(entryId: string, options?: TuiForkOptions): Promise<TuiReplacementResult>;
  navigateTree(targetId: string, options?: TuiNavigateTreeOptions): Promise<TuiReplacementResult>;
  switchSession(sessionPath: string, options?: TuiSwitchSessionOptions): Promise<TuiReplacementResult>;
  reload(): Promise<void>;
  getModel(): TuiModelInfo | undefined;
  setModel(modelRef: string): void | Promise<void>;
  getThinkingLevel(): TuiThinkingLevel | undefined;
  setThinkingLevel(level: TuiThinkingLevel): void | Promise<void>;
  getReasoningLevel(): TuiReasoningLevel | undefined;
  setReasoningLevel(level: TuiReasoningLevel): void | Promise<void>;
  getVerboseLevel(): TuiVerboseLevel | undefined;
  setVerboseLevel(level: TuiVerboseLevel): void | Promise<void>;
  getCommands(): TuiCommandInfo[];
  getContextUsage(): TuiContextUsage | undefined;
  notify(message: string, level?: TuiNotifyLevel): void;
}

export type TuiSlashCommandContext = TuiActionContext;

export type TuiSlashCommandHandler = (
  args: string,
  context?: TuiSlashCommandContext,
) => void | Promise<void>;

export type TuiShortcutContext = TuiActionContext;

export type TuiShortcutHandler = (context: TuiShortcutContext) => void | Promise<void>;

export interface TuiWorkingIndicatorOptions {
  /** Animation frames. Use an empty array to hide the indicator. */
  frames?: string[];
  /** Frame interval in milliseconds for animated indicators. */
  intervalMs?: number;
}

/** Host passed to extension `registerTui` callbacks when `xopc tui` starts. */
export interface TuiExtensionHostContract {
  readonly extensionId: string;
  setFooterWidget(key: string, lines: string[] | null): void;
  setHeaderWidget(key: string, lines: string[] | null): void;
  setWidget(key: string, lines: string[] | null | undefined, options?: TuiWidgetOptions): void;
  setWidget(key: string, factory: TuiWidgetFactory | undefined, options?: TuiWidgetOptions): void;
  setFooter(factory: TuiFooterFactory | undefined): void;
  setHeader(factory: TuiHeaderFactory | undefined): void;
  addAutocompleteProvider(provider: TuiAutocompleteProvider): () => void;
  addAutocompleteProvider(factory: TuiAutocompleteProviderFactory): () => void;
  registerToolRenderer(toolName: string, renderer: TuiToolRendererRegistration): () => void;
  registerMessageRenderer<T = unknown>(
    customType: string,
    renderer: TuiMessageRenderer<T>,
  ): () => void;
  registerSlashCommand(
    name: string,
    description: string,
    handler: TuiSlashCommandHandler,
  ): () => void;
  registerShortcut(
    key: string,
    description: string,
    handler: TuiShortcutHandler,
  ): () => void;
  notify(message: string, level?: TuiNotifyLevel): void;
  onTerminalInput(handler: TuiTerminalInputHandler): () => void;
  showOverlay(component: unknown): void;
  hideOverlay(): void;
  custom<T>(factory: TuiCustomFactory<T>, options?: TuiCustomOptions): Promise<T>;
  setTitle(title: string): void;
  pasteToEditor(text: string): void;
  setEditorText(text: string): void;
  getEditorText(): string;
  editor(title: string, prefill?: string): Promise<string | undefined>;
  setEditorComponent(factory: TuiEditorFactory | undefined): void;
  getEditorComponent(): TuiEditorFactory | undefined;
  readonly theme: TuiTheme;
  getAllThemes(): TuiThemeInfo[];
  getTheme(name: string): TuiTheme | undefined;
  setTheme(theme: string): TuiSetThemeResult;
  getToolsExpanded(): boolean;
  setToolsExpanded(expanded: boolean): void;
  select(title: string, options: string[], opts?: TuiDialogOptions): Promise<string | undefined>;
  confirm(title: string, message: string, opts?: TuiDialogOptions): Promise<boolean>;
  input(title: string, placeholder?: string, opts?: TuiDialogOptions): Promise<string | undefined>;
  setStatus(key: string, text: string | null | undefined): void;
  setWorkingMessage(message?: string | null): void;
  setWorkingVisible(visible: boolean): void;
  setWorkingIndicator(options?: TuiWorkingIndicatorOptions | null): void;
  setHiddenThinkingLabel(label?: string | null): void;
}

export type TuiExtensionRegistrar = (
  host: TuiExtensionHostContract,
) => void | Promise<void>;

export interface TuiExtensionRegistration {
  extensionId: string;
  register: TuiExtensionRegistrar;
}
