import {
  Container,
  Loader,
  type LoaderIndicatorOptions,
  ProcessTerminal,
  setKeybindings,
  TUI,
  type Component,
  type EditorComponent,
  type OverlayHandle,
  type OverlayOptions,
} from '@earendil-works/pi-tui';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import type {
  ReasoningLevel,
  ThinkLevel,
  VerboseLevel,
} from '../agent/transcript/thinking-types.js';
import { resolveEffectiveAgentProfileForSession } from '../config/agent-profile.js';
import { loadConfig } from '../config/index.js';
import { resolveStateDir, resolveXopcDatabasePath } from '../config/paths.js';
import {
  MAX_CHAT_ATTACHMENTS,
  MAX_WEBCHAT_ATTACHMENT_FILE_BYTES,
} from '../gateway/chat-limits.js';
import { resolveTuiSessionKey, resolveTuiStartupSessionKey } from '../routing/resolve-tui-session-key.js';
import { parseAgentSessionKey } from '../routing/agent-session-key.js';
import type {
  TuiBackend,
  TuiCompactionResult,
  TuiEvent,
  TuiExportFormat,
  TuiInboundAttachment,
  TuiModelChoice,
  TuiShareRequest,
  TuiStartupResources,
} from './tui-backend.js';
import { EmbeddedBackend } from './backends/embedded-backend.js';
import { GatewaySseBackend } from './backends/gateway-sse-backend.js';
import {
  clearSeenStreamEvents,
  clearSeenStreamEventsForRun,
  DEFAULT_STREAMING_WATCHDOG_MS,
  dispatchAgentEvent,
} from './tui-agent-events.js';
import { ChatLog } from './components/chat-log.js';
import { CustomEditor } from './components/custom-editor.js';
import { TuiBottomBar } from './components/tui-bottom-bar.js';
import { TuiHeader } from './components/tui-header.js';
import {
  createTuiCommandHandler,
  getSlashCommands,
  type SlashCommandDef,
} from './tui-commands.js';
import {
  formatTuiCompactionResult,
  formatTuiShareResult,
  type TuiExportRequest,
  type TuiImportRequest,
} from './tui-command-formatters.js';
import { createLocalShellRunner } from './tui-local-shell.js';
import { drainFollowUpQueue, restoreQueuedMessages } from './tui-follow-up-queue.js';
import {
  createBackspaceDeduper,
  drainAndStopTuiSafely,
  resolveCtrlCAction,
} from './tui-lifecycle.js';
import {
  openAgentPickerOverlay,
  openProjectTrustOverlay,
  openScopedModelsOverlay,
  openSessionPickerOverlay,
  openSessionTreeOverlay,
  openSettingsOverlay,
  openTranscriptTreeOverlay,
  openThinkingSelectorOverlay,
  openUserMessageForkOverlay,
} from './tui-picker-overlay.js';
import { openModelPickerOverlay } from './tui-model-picker.js';
import { runTuiOAuthLogin } from './tui-oauth-login.js';
import {
  createEditorSubmitHandler,
  createSubmitBurstCoalescer,
  shouldEnableWindowsGitBashPasteFallback,
} from './tui-submit.js';
import { installTuiStdioFilter } from './tui-stdio-filter.js';
import { withTuiSuspended } from './tui-suspend.js';
import { extensionForImageMimeType, readClipboardImage } from './clipboard-image.js';
import { copyTextToClipboard } from './clipboard-text.js';
import {
  renderWorkflowFinalSummary,
  renderWorkflowPanel,
} from '../agent/workflow/snapshot.js';
import { isTerminalWorkflowRunStatus, type WorkflowRunView } from '../workflows/domain/index.js';
import { runViewToSnapshot } from '../workflows/service/run-view-to-snapshot.js';
import {
  applyThemeById,
  getCustomThemesDir,
  getThemeExports,
  getBashExcludeBorderColor,
  getBashModeBorderColor,
  getThinkingBorderColor,
  initTuiTheme,
  listAvailableThemeIds,
  resolveThemePalette,
} from './theme-manager.js';
import { editorTheme, theme } from './theme.js';
import { loadTuiSettings, saveTuiSettings, type TuiSettings } from './tui-settings.js';
import { resolveFdPath } from './tui-fd-path.js';
import packageJson from '../../package.json' with { type: 'json' };
import { createSessionActions } from './tui-session-actions.js';
import { createInitialState, type TuiOptions, type TuiResult, type TuiState } from './tui-types.js';
import { createXopcTuiKeybindingsManager } from './tui-keybindings-file.js';
import { formatKeyIds } from './format-tui-hotkeys.js';
import { formatTuiStartupText } from './tui-startup-text.js';
import {
  filterModelsForCycle,
  loadScopedModelRefs,
  saveScopedModelRefs,
} from './tui-scoped-models.js';
import {
  formatBusyResponseHint,
  formatSteerUnavailableHint,
  formatSuspendUnsupportedHint,
} from './tui-runtime-hints.js';
import { loadExtensionsForTuiLocalMode } from './extension-host/load-extensions.js';
import { createTuiExtensionRuntime } from './extension-host/runtime.js';
import { TuiSessionSnapshot } from './tui-session-snapshot.js';
import {
  extensionCustomMessageContentToText,
  extensionCustomMessageToTurnText,
  extensionUserMessageContentToText,
} from './tui-extension-user-message.js';
import type { ExtensionRegistryImpl } from '../extensions/loader.js';
import type {
  ExtensionCustomMessage,
  ExtensionSendMessageOptions,
  ExtensionSendUserMessageOptions,
  ExtensionUserMessageContent,
} from '../extensions/types/core.js';
import type {
  TuiEditorFactory,
  TuiForkOptions,
  TuiModelRegistryModel,
  TuiNavigateTreeOptions,
  TuiNewSessionOptions,
  TuiReasoningLevel,
  TuiReplacedSessionContext,
  TuiReplacementResult,
  TuiSwitchSessionOptions,
  TuiThinkingLevel,
  TuiVerboseLevel,
} from '../extensions/types/tui.js';
import { getAllModels, getAllProviders, getApiKey, isProviderConfiguredSync } from '../providers/index.js';
import {
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
} from '../project-trust/trust-store.js';
import { transcriptTreeEntryIdToRowNumber } from './tui-transcript-tree.js';
import {
  isActiveRunStreamStale,
  markActiveRunStalled,
  markRunSending,
  markRunRecovering,
  markRunRecoveryComplete,
} from './tui-run-state.js';

export type { TuiOptions, TuiResult };

export {
  createBackspaceDeduper,
  drainAndStopTuiSafely,
  type DrainableTui,
  isIgnorableTuiStopError,
  resolveCtrlCAction,
  stopTuiSafely,
} from './tui-lifecycle.js';

export { withTuiSuspended } from './tui-suspend.js';

const THINK_LEVEL_CYCLE: ThinkLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'adaptive',
];

function nextThinkLevel(current: string | undefined): ThinkLevel {
  const c = (current ?? 'medium').toLowerCase();
  const idx = THINK_LEVEL_CYCLE.indexOf(c as ThinkLevel);
  const mediumIdx = THINK_LEVEL_CYCLE.indexOf('medium');
  const base = idx >= 0 ? idx : mediumIdx >= 0 ? mediumIdx : 0;
  return THINK_LEVEL_CYCLE[(base + 1) % THINK_LEVEL_CYCLE.length]!;
}

const DOUBLE_ESCAPE_WINDOW_MS = 500;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function exportExtension(format: TuiExportFormat): string {
  if (format === 'json') return 'json';
  if (format === 'markdown') return 'md';
  return 'html';
}

function wrapMarkdownExportAsHtml(markdown: string): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<title>xopc session export</title>',
    '<style>body{font:14px/1.5 system-ui,sans-serif;margin:32px;max-width:960px}pre{white-space:pre-wrap}</style>',
    '</head>',
    '<body>',
    '<pre>',
    escapeHtml(markdown),
    '</pre>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function defaultExportPath(sessionKey: string, format: TuiExportFormat): string {
  const safeKey = sessionKey.replace(/[^a-z0-9_.-]+/gi, '_').replace(/^_+|_+$/g, '') || 'session';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return resolve(process.cwd(), `xopc-session-${safeKey}-${stamp}.${exportExtension(format)}`);
}

function userDisplayContentForAttachments(
  text: string,
  attachments: readonly TuiInboundAttachment[] | undefined,
): string | unknown[] {
  if (!attachments?.length) return text;
  const blocks: unknown[] = [];
  if (text.trim()) {
    blocks.push({ type: 'text', text });
  }
  for (const att of attachments) {
    if (att.mimeType?.startsWith('image/') || att.type === 'image' || att.type === 'photo') {
      blocks.push({ type: 'image', name: att.name });
      continue;
    }
    blocks.push({ type: 'file', name: att.name });
  }
  return blocks;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:@%+=,.-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatTuiResumeCommand(opts: TuiOptions, sessionKey: string): string {
  const parts = ['xopc', 'tui'];
  if (opts.local === true) {
    parts.push('--local');
  }
  if (opts.url) {
    parts.push('--url', shellQuote(opts.url));
  }
  parts.push('--session', shellQuote(sessionKey));
  return parts.join(' ');
}

function isLoopbackGatewayUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function resolveStartupWorkingDirectory(opts: TuiOptions, isLocalMode: boolean): string | undefined {
  const explicit = opts.workdir?.trim();
  if (explicit) {
    return resolve(explicit);
  }
  if (opts.useStartupCwd === false || opts.session?.trim()) {
    return undefined;
  }
  const gatewayUrl = opts.url ?? 'http://localhost:3120';
  if (isLocalMode || isLoopbackGatewayUrl(gatewayUrl)) {
    return process.cwd();
  }
  return undefined;
}

function isPathSameOrInside(parentDir: string, childDir: string): boolean {
  const rel = relative(resolve(parentDir), resolve(childDir));
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function assistantMessagePlainText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const rec = block as { type?: unknown; text?: unknown };
      return rec.type === 'text' && typeof rec.text === 'string' ? rec.text : '';
    })
    .join('');
}

export async function runTui(opts: TuiOptions): Promise<TuiResult> {
  const stdioFilter = installTuiStdioFilter();
  const restoreStdio = () => stdioFilter.restore();

  const isLocalMode = opts.local === true;
  const config = loadConfig();
  const startup = resolveTuiStartupSessionKey({
    cfg: config,
    sessionOption: opts.session,
    cwd: process.cwd(),
  });
  let currentAgentId = startup.agentId;
  const sessionScope = startup.sessionScope;
  const sessionMainKey = startup.sessionMainKey;
  const resolveSessionKey = (raw?: string) =>
    resolveTuiSessionKey({
      raw,
      sessionScope,
      currentAgentId,
      sessionMainKey,
    });
  let tuiSettings = loadTuiSettings();
  initTuiTheme({ themeId: opts.theme ?? tuiSettings.theme });
  const state = createInitialState(startup.sessionKey);
  const startupWorkingDirectory = resolveStartupWorkingDirectory(opts, isLocalMode);
  const implicitTrustedWorkspace = startupWorkingDirectory ?? (isLocalMode ? process.cwd() : undefined);
  const projectTrustStore = new ProjectTrustStore();
  let projectTrustSessionDecision: boolean | null = null;
  const isCurrentProjectTrusted = () => {
    if (projectTrustSessionDecision !== null) return projectTrustSessionDecision;
    const persisted = projectTrustStore.get(process.cwd());
    if (persisted !== null) return persisted;
    if (!hasTrustRequiringProjectResources(process.cwd())) return true;
    return !!implicitTrustedWorkspace && isPathSameOrInside(implicitTrustedWorkspace, process.cwd());
  };
  const sessionStateDir = resolveStateDir();
  const sessionDatabasePath = resolveXopcDatabasePath();
  const sessionSnapshot = new TuiSessionSnapshot(
    () => state.currentSessionKey,
    () => process.cwd(),
    () => state.sessionInfo.displayName,
    () => `${sessionDatabasePath}#session=${encodeURIComponent(state.currentSessionKey)}`,
    () => sessionStateDir,
  );
  state.scopedModelRefs = loadScopedModelRefs();
  state.showThinking = tuiSettings.showThinking;
  state.toolsExpanded = tuiSettings.toolsExpanded;
  let pendingImageAttachments: TuiInboundAttachment[] = [];
  const pendingNextTurnCustomMessages: string[] = [];
  let lastRetryMessageText: string | null = null;
  let setExtensionLabel = (_entryId: string, _label: string | undefined): void => {};
  let sendExtensionUserMessage = (
    _content: ExtensionUserMessageContent,
    _options?: ExtensionSendUserMessageOptions,
  ): void => {};
  let appendExtensionEntry = <T = unknown>(_customType: string, _data?: T): void => {};
  let sendExtensionMessage = <T = unknown>(
    _message: ExtensionCustomMessage<T>,
    _options?: ExtensionSendMessageOptions,
  ): void => {};

  let extensionRegistry: ExtensionRegistryImpl | undefined;
  if (isLocalMode) {
    extensionRegistry = await loadExtensionsForTuiLocalMode({
      setLabel: (entryId, label) => setExtensionLabel(entryId, label),
      sendUserMessage: (content, options) => sendExtensionUserMessage(content, options),
      appendEntry: (customType, data) => appendExtensionEntry(customType, data),
      sendMessage: (message, options) => sendExtensionMessage(message, options),
    });
  }

  const client: TuiBackend = isLocalMode
    ? new EmbeddedBackend({
        extensionRegistry,
        implicitTrustedWorkspace,
        isWorkspaceTrusted: () => projectTrustSessionDecision,
      })
    : new GatewaySseBackend({ url: opts.url ?? 'http://localhost:3120', token: opts.token });
  if (startupWorkingDirectory) {
    state.sessionInfo.effectiveWorkspacePath = startupWorkingDirectory;
  }
  let startupWorkingDirectoryApplied = false;

  const keybindings = createXopcTuiKeybindingsManager();
  setKeybindings(keybindings);

  let modelChoices: TuiModelChoice[] = [];
  const cycleModelChoices = (): TuiModelChoice[] =>
    filterModelsForCycle(modelChoices, state.scopedModelRefs);

  const refreshCycleModels = () => {
    bottomBar.invalidate();
    tui.requestRender();
  };

  const tui = new TUI(new ProcessTerminal());
  tui.setShowHardwareCursor(tuiSettings.showHardwareCursor);
  tui.setClearOnShrink(tuiSettings.clearOnShrink);
  const dedupeBackspace = createBackspaceDeduper();
  tui.addInputListener((data) => {
    const next = dedupeBackspace(data);
    if (next.length === 0) {
      return { consume: true };
    }
    return { data: next };
  });

  const header = new TuiHeader(() => ({
    version: packageJson.version ?? 'dev',
    connectionLabel: client.connectionLabel,
    sessionKey: state.currentSessionKey,
    showHints: tuiSettings.showStartupHints,
  }), keybindings);
  const statusContainer = new Container();
  const bottomBar = new TuiBottomBar(
    () => state,
    () => opts.thinking,
    () => formatKeyIds(keybindings, 'app.message.dequeue', { capitalize: true }),
  );
  const chatLog = new ChatLog(keybindings);
  let startupResources: TuiStartupResources | undefined;
  let startupCardShown = false;
  chatLog.setShowThinking(state.showThinking);
  chatLog.setToolsExpanded(state.toolsExpanded);
  chatLog.setToolImageOptions({
    showImages: tuiSettings.showImages,
    imageWidthCells: tuiSettings.imageWidthCells,
    cwd: process.cwd(),
  });
  setExtensionLabel = (entryId, label) => {
    sessionSnapshot.setLabel(entryId, label);
    void client
      .setTranscriptLabel(state.currentSessionKey, entryId, label)
      .catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        chatLog.addSystem(`Label update failed: ${errorMessage}`);
      })
      .finally(() => {
        updateFooter();
        tui.requestRender();
      });
  };
  appendExtensionEntry = (customType, data) => {
    const normalized = customType.trim();
    if (!normalized) {
      throw new Error('appendEntry requires customType.');
    }
    sessionSnapshot.appendCustomEntry(normalized, data);
    void client
      .appendCustomEntry(state.currentSessionKey, normalized, data)
      .catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        chatLog.addSystem(`Custom entry append failed: ${errorMessage}`);
      })
      .finally(() => {
        updateFooter();
        tui.requestRender();
      });
  };
  sendExtensionMessage = (message, options) => {
    const customType = message.customType.trim();
    if (!customType) {
      throw new Error('sendMessage requires customType.');
    }
    const display = message.display ?? true;
    const nextMessage = {
      customType,
      content: message.content,
      display,
      details: message.details,
    };
    sessionSnapshot.appendCustomMessage(nextMessage);
    if (display) {
      chatLog.addCustomMessage({
        customType,
        content: extensionCustomMessageContentToText(message.content),
        rawContent: message.content,
        details: message.details,
        display,
      });
      tui.requestRender();
    }
    const persist = client
      .appendCustomMessage(state.currentSessionKey, nextMessage)
      .catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        chatLog.addSystem(`Custom message append failed: ${errorMessage}`);
        throw err;
      })
      .finally(() => {
        updateFooter();
        tui.requestRender();
      });

    const turnText = extensionCustomMessageToTurnText(nextMessage).trim();
    if (!turnText) {
      return;
    }
    void persist.then(() => {
      const controlText = `Continue with the extension message "${customType}" above.`;
      if (options?.deliverAs === 'nextTurn') {
        pendingNextTurnCustomMessages.push(controlText);
        chatLog.addSystem(
          theme.dim(`Queued extension message for next turn (${pendingNextTurnCustomMessages.length}).`),
        );
        bottomBar.invalidate();
        tui.requestRender();
        return;
      }
      if (state.activeRunId) {
        if (options?.deliverAs === 'followUp') {
          state.messageFollowUpQueue.push(controlText);
          chatLog.addSystem(
            theme.dim(
              `Queued extension follow-up (${state.messageFollowUpQueue.length} in queue). ${tuiSettings.followUpMode === 'all' ? 'All queued messages send together when this reply finishes.' : 'Next sends when this reply finishes.'}`,
            ),
          );
          bottomBar.invalidate();
          tui.requestRender();
          return;
        }
        steerMessage(turnText);
        return;
      }
      if (options?.triggerTurn) {
        sendMessage(controlText);
      }
    }).catch(() => {});
  };
  const defaultEditor = new CustomEditor(tui, editorTheme, keybindings, {
    paddingX: tuiSettings.editorPaddingX,
    autocompleteMaxVisible: tuiSettings.autocompleteMaxVisible,
  });
  let editor: EditorComponent = defaultEditor;
  let editorComponentFactory: TuiEditorFactory | undefined;
  const editorContainer = new Container();
  editorContainer.addChild(editor as Component);
  const root = new Container();
  root.addChild(header);
  root.addChild(chatLog);
  root.addChild(statusContainer);
  root.addChild(editorContainer);
  root.addChild(bottomBar);
  tui.addChild(root);
  tui.setFocus(editor as Component);

  let isBashMode = false;
  let isBashExcludeContext = false;

  const updateEditorBorderColor = () => {
    if (isBashMode) {
      editor.borderColor = isBashExcludeContext
        ? getBashExcludeBorderColor()
        : getBashModeBorderColor();
    } else {
      const level = state.sessionInfo.thinkingLevel ?? opts.thinking ?? 'off';
      editor.borderColor = getThinkingBorderColor(level);
    }
    tui.requestRender();
  };

  editor.onChange = (text: string) => {
    const trimmed = text.trimStart();
    const nextExclude = trimmed.startsWith('!!');
    const nextBash = trimmed.startsWith('!');
    if (nextBash !== isBashMode || nextExclude !== isBashExcludeContext) {
      isBashMode = nextBash;
      isBashExcludeContext = nextExclude;
      updateEditorBorderColor();
    }
  };

  const copyDefaultEditorAppHandlers = (target: EditorComponent) => {
    const customEditor = target as unknown as {
      actionHandlers?: unknown;
      onEscape?: () => void;
      onCtrlD?: () => void;
      onPasteImage?: () => void;
      onExtensionShortcut?: (data: string) => boolean;
    };
    if (!(customEditor.actionHandlers instanceof Map)) return;
    customEditor.onEscape ??= () => defaultEditor.onEscape?.();
    customEditor.onCtrlD ??= () => defaultEditor.onCtrlD?.();
    customEditor.onPasteImage ??= () => defaultEditor.onPasteImage?.();
    customEditor.onExtensionShortcut ??= (data: string) =>
      defaultEditor.onExtensionShortcut?.(data) ?? false;
    for (const [action, handler] of defaultEditor.actionHandlers) {
      customEditor.actionHandlers.set(action, handler);
    }
  };

  const setEditorExtensionShortcut = () => {
    const customEditor = editor as unknown as {
      onExtensionShortcut?: (data: string) => boolean;
    };
    customEditor.onExtensionShortcut = (data: string) => extensionRuntime.handleShortcut(data);
  };

  const setEditorComponent = (factory: TuiEditorFactory | undefined) => {
    editorComponentFactory = factory;
    const currentText = editor.getText();
    editorContainer.clear();
    if (factory) {
      const nextEditor = factory(tui, editorTheme, keybindings) as EditorComponent;
      nextEditor.onSubmit = defaultEditor.onSubmit;
      nextEditor.onChange = defaultEditor.onChange;
      nextEditor.setText(currentText);
      if (nextEditor.borderColor !== undefined) {
        nextEditor.borderColor = defaultEditor.borderColor;
      }
      nextEditor.setPaddingX?.(tuiSettings.editorPaddingX);
      nextEditor.setAutocompleteMaxVisible?.(tuiSettings.autocompleteMaxVisible);
      nextEditor.setAutocompleteProvider?.(extensionRuntime.autocompleteProvider);
      copyDefaultEditorAppHandlers(nextEditor);
      editor = nextEditor;
    } else {
      defaultEditor.setText(currentText);
      editor = defaultEditor;
    }
    editorContainer.addChild(editor as Component);
    setEditorExtensionShortcut();
    tui.setFocus(editor as Component);
    updateEditorBorderColor();
    tui.requestRender();
  };

  let activeEditorSelectorClose: (() => void) | null = null;

  const closeEditorSelector = () => {
    const close = activeEditorSelectorClose;
    close?.();
  };

  const openEditorSelector = (component: Component, focus: Component = component) => {
    closeEditorSelector();
    editorContainer.clear();
    editorContainer.addChild(component);
    tui.setFocus(focus);
    tui.requestRender();
    const close = () => {
      if (activeEditorSelectorClose !== close) return;
      activeEditorSelectorClose = null;
      editorContainer.clear();
      editorContainer.addChild(editor as Component);
      tui.setFocus(editor as Component);
      tui.requestRender();
    };
    activeEditorSelectorClose = close;
    return close;
  };

  const openCommandOverlay = (
    component: Component,
    _options?: OverlayOptions,
  ): OverlayHandle => {
    let hidden = false;
    let closeCurrent = openEditorSelector(component, component);
    return {
      hide: () => closeCurrent(),
      setHidden: (nextHidden: boolean) => {
        hidden = nextHidden;
        if (nextHidden) {
          closeCurrent();
        } else {
          closeCurrent = openEditorSelector(component, component);
        }
      },
      isHidden: () => hidden,
      focus: () => tui.setFocus(component),
      unfocus: () => tui.setFocus(editor as Component),
      isFocused: () => false,
    };
  };

  const closeCommandOverlay = () => {
    closeEditorSelector();
  };

  const slashCommands = getSlashCommands(isLocalMode, keybindings);
  const resourceSlashCommands: SlashCommandDef[] = [];
  const skillSlashCommands: SlashCommandDef[] = [];
  const workflowSlashCommands: SlashCommandDef[] = [];
  const visibleWorkflowRunIds = new Set<string>();
  const syncResourceSlashCommands = (resources: TuiStartupResources | undefined) => {
    resourceSlashCommands.length = 0;
    skillSlashCommands.length = 0;
    for (const name of resources?.skills ?? []) {
      const skillName = name.trim();
      if (!skillName) continue;
      const command = {
        name: `skill:${skillName}`,
        description: 'Apply skill to the next turn',
      };
      skillSlashCommands.push(command);
      resourceSlashCommands.push(command);
    }
    workflowSlashCommands.length = 0;
    for (const name of resources?.workflows ?? []) {
      const workflowName = name.trim();
      if (!workflowName) continue;
      const command = {
        name: `workflow:${workflowName}`,
        description: 'Run workflow',
      };
      workflowSlashCommands.push(command);
      resourceSlashCommands.push(command);
    }
  };
  let extensionWorkingMessage: string | undefined;
  let extensionWorkingVisible = true;
  let extensionWorkingIndicator: LoaderIndicatorOptions | undefined;

  const getAllExtensionThemes = () => {
    const customDir = getCustomThemesDir();
    return listAvailableThemeIds().map((name) => ({
      name,
      path: name === 'auto' || name === 'dark' || name === 'light'
        ? undefined
        : join(customDir, `${name}.json`),
    }));
  };

  const getExtensionTheme = (name: string) => {
    const normalized = name.trim().toLowerCase() || 'auto';
    if (!listAvailableThemeIds().includes(normalized)) return undefined;
    const currentTheme = tuiSettings.theme;
    applyThemeById(normalized);
    const resolved = getThemeExports().theme;
    applyThemeById(currentTheme);
    return resolved;
  };

  const setExtensionTheme = (nextTheme: string) => {
    const normalized = nextTheme.trim().toLowerCase() || 'auto';
    if (!listAvailableThemeIds().includes(normalized)) {
      return { success: false, error: `Unknown theme: ${nextTheme}` };
    }
    try {
      resolveThemePalette(normalized);
      tuiSettings = { ...tuiSettings, theme: normalized };
      saveTuiSettings(tuiSettings);
      applyThemeById(normalized);
      updateEditorBorderColor();
      chatLog.invalidate();
      header.invalidate();
      bottomBar.invalidate();
      tui.requestRender();
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const getAvailableProviderCount = () =>
    getAllProviders().filter((provider) => isProviderConfiguredSync(provider)).length;

  const getExtensionSystemPrompt = () =>
    resolveEffectiveAgentProfileForSession(config, state.currentSessionKey).systemPromptOverride ?? '';

  const waitForTuiIdle = async () => {
    while (
      state.activeRunId != null ||
      state.isCompacting ||
      state.activityStatus === 'sending' ||
      state.activityStatus === 'waiting' ||
      state.activityStatus === 'streaming' ||
      state.activityStatus === 'running' ||
      state.activityStatus === 'compacting'
    ) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  };

  const createReplacementContext = (): TuiReplacedSessionContext => {
    const model = state.sessionInfo.model
      ? {
          ...(state.sessionInfo.modelProvider ? { provider: state.sessionInfo.modelProvider } : {}),
          id: state.sessionInfo.model,
          ref: state.sessionInfo.modelProvider
            ? `${state.sessionInfo.modelProvider}/${state.sessionInfo.model}`
            : state.sessionInfo.model,
          contextWindow: state.sessionInfo.contextWindow ?? null,
        }
      : undefined;
    return {
      mode: 'tui',
      hasUI: true,
      signal: client.getActiveSignal?.(),
      ui: {
        select: async () => undefined,
        confirm: async () => false,
        input: async () => undefined,
        notify: (message, level) => {
          const prefix = level === 'error' ? 'Error: ' : level === 'warn' || level === 'warning' ? 'Warning: ' : '';
          chatLog.addSystem(`${prefix}${message}`);
          tui.requestRender();
        },
        onTerminalInput: (handler) => tui.addInputListener(handler),
        setStatus: () => {},
        setWorkingMessage: (message) => {
          extensionWorkingMessage = message?.trim() || undefined;
          renderStatus();
        },
        setWorkingVisible: (visible) => {
          extensionWorkingVisible = visible;
          renderStatus();
        },
        setWorkingIndicator: (indicator) => {
          extensionWorkingIndicator = indicator ?? undefined;
          statusLoader?.setIndicator(indicator ?? undefined);
          renderStatus();
        },
        setHiddenThinkingLabel: (label) => {
          chatLog.setHiddenThinkingLabel(label ?? undefined);
          tui.requestRender();
        },
        setWidget: () => {},
        setFooter: () => {},
        setHeader: () => {},
        custom: async () => undefined as never,
        setTitle: (title) => tui.terminal.setTitle(title),
        pasteToEditor: (text) => editor.handleInput(`\x1b[200~${text}\x1b[201~`),
        setEditorText: (text) => editor.setText(text),
        getEditorText: () => editor.getExpandedText?.() ?? editor.getText(),
        editor: async () => undefined,
        addAutocompleteProvider: () => () => {},
        setEditorComponent,
        getEditorComponent: () => editorComponentFactory,
        theme,
        getAllThemes: getAllExtensionThemes,
        getTheme: getExtensionTheme,
        setTheme: setExtensionTheme,
        getToolsExpanded: () => state.toolsExpanded,
        setToolsExpanded: (expanded) => {
          state.toolsExpanded = expanded;
          tuiSettings = { ...tuiSettings, toolsExpanded: expanded };
          saveTuiSettings(tuiSettings);
          chatLog.setToolsExpanded(expanded);
          updateFooter();
          tui.requestRender();
        },
      },
      sessionManager: sessionSnapshot.manager(),
      modelRegistry: {
        find(provider, modelId) {
          return getAllModels().find(
            (candidate) => candidate.provider === provider && candidate.id === modelId,
          ) as unknown as TuiModelRegistryModel | undefined;
        },
        async getApiKeyAndHeaders(nextModel) {
          const provider = typeof nextModel.provider === 'string' ? nextModel.provider : undefined;
          if (!provider) return { ok: false, error: 'Model provider is missing.' };
          try {
            return { ok: true, apiKey: await getApiKey(provider), headers: {} };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
          }
        },
      },
      model,
      cwd: process.cwd(),
      sessionKey: state.currentSessionKey,
      isProjectTrusted: isCurrentProjectTrusted,
      isIdle: () => !state.activeRunId && !state.isCompacting,
      hasPendingMessages: () =>
        state.messageFollowUpQueue.length > 0 ||
        state.steeringQueue.length > 0 ||
        state.compactionQueue.length > 0,
      abort: () => abortActive(),
      shutdown: () => requestExit(),
      compact: (options) => runCompaction(options?.customInstructions, {
        onComplete: options?.onComplete,
        onError: options?.onError,
      }),
      getSystemPrompt: getExtensionSystemPrompt,
      getSystemPromptOptions: () => ({
        cwd: process.cwd(),
        sessionKey: state.currentSessionKey,
        ...(model ? { model } : {}),
      }),
      waitForIdle: waitForTuiIdle,
      newSession: (options) => runExtensionNewSession(options),
      fork: (entryId, options) => runExtensionFork(entryId, options),
      navigateTree: (targetId, options) => runExtensionNavigateTree(targetId, options),
      switchSession: (sessionPath, options) => runExtensionSwitchSession(sessionPath, options),
      reload: async () => {
        await loadSessionHistory({ merge: true });
        await refreshSessionInfoWithBorder();
      },
      getModel: () => model,
      setModel: (modelRef) => switchCurrentModel(modelRef),
      getThinkingLevel: () => state.sessionInfo.thinkingLevel as TuiThinkingLevel | undefined,
      setThinkingLevel,
      getReasoningLevel: () => state.sessionInfo.reasoningLevel as TuiReasoningLevel | undefined,
      setReasoningLevel,
      getVerboseLevel: () => state.sessionInfo.verboseLevel as TuiVerboseLevel | undefined,
      setVerboseLevel,
      getCommands: () => slashCommands.map((command) => ({
        name: command.name,
        description: command.description,
        source: 'builtin' as const,
      })),
      getContextUsage: () => {
        const tokens = state.sessionInfo.totalTokens ?? state.sessionInfo.contextTokens ?? null;
        const contextWindow = state.sessionInfo.contextWindow ?? null;
        const percent = state.sessionInfo.contextUsagePercent ?? null;
        if (tokens == null && contextWindow == null) return undefined;
        return {
          estimatedTokens: tokens,
          tokens,
          contextWindow,
          usagePercent: percent,
          percent,
        };
      },
      notify: (message, level) => {
        const prefix = level === 'error' ? 'Error: ' : level === 'warn' || level === 'warning' ? 'Warning: ' : '';
        chatLog.addSystem(`${prefix}${message}`);
        tui.requestRender();
      },
      sendMessage: async (message, options) => sendExtensionMessage(message, options),
      sendUserMessage: async (content, options) =>
        sendExtensionUserMessage(content as ExtensionUserMessageContent, options),
    };
  };

  const runWithReplacementContext = async (
    callback: ((ctx: TuiReplacedSessionContext) => Promise<void>) | undefined,
  ) => {
    if (callback) {
      await callback(createReplacementContext());
    }
  };

  const runExtensionNewSession = async (
    options?: TuiNewSessionOptions,
  ): Promise<TuiReplacementResult> => {
    await abortActive({ clearUi: false });
    const targetKey = resolveSessionKey(`session-${randomUUID()}`);
    await setSession(targetKey);
    await options?.setup?.(sessionSnapshot.manager());
    await runWithReplacementContext(options?.withSession);
    return { cancelled: false };
  };

  const runExtensionFork = async (
    entryId: string,
    options?: TuiForkOptions,
  ): Promise<TuiReplacementResult> => {
    const rowNumber = transcriptTreeEntryIdToRowNumber(entryId);
    if (rowNumber == null) {
      throw new Error(`Invalid entry ID for forking: ${entryId}`);
    }
    const throughRow = options?.position === 'before' ? rowNumber - 1 : rowNumber;
    if (throughRow <= 0) {
      throw new Error(`Invalid entry ID for forking: ${entryId}`);
    }
    const sourceSessionKey = state.currentSessionKey;
    const targetKey = resolveSessionKey(`fork-${randomUUID()}`);
    await abortActive({ clearUi: false });
    const result = await client.forkSessionAt(sourceSessionKey, targetKey, `row-${throughRow}`);
    await setSession(result.sessionKey);
    chatLog.addBranchSummary({
      sourceSessionKey,
      targetSessionKey: result.sessionKey,
      rowCount: result.rowCount,
      entryId,
    });
    await runWithReplacementContext(options?.withSession);
    return { cancelled: false };
  };

  const runExtensionNavigateTree = async (
    targetId: string,
    options?: TuiNavigateTreeOptions,
  ): Promise<TuiReplacementResult> => {
    if (options?.label) {
      setExtensionLabel(targetId, options.label);
    }
    return runExtensionFork(targetId, { position: 'at' });
  };

  const runExtensionSwitchSession = async (
    sessionPath: string,
    options?: TuiSwitchSessionOptions,
  ): Promise<TuiReplacementResult> => {
    await abortActive({ clearUi: false });
    await setSession(sessionPath);
    await runWithReplacementContext(options?.withSession);
    return { cancelled: false };
  };

  const extensionRuntime = createTuiExtensionRuntime({
    registry: extensionRegistry,
    tui,
    chatLog,
    header,
    bottomBar,
    getState: () => state,
    baseSlashCommands: slashCommands,
    additionalSlashCommands: resourceSlashCommands,
    keybindings,
    addInputListener: (handler) => tui.addInputListener(handler),
    setTitle: (title) => tui.terminal.setTitle(title),
    pasteToEditor: (text) => editor.handleInput(`\x1b[200~${text}\x1b[201~`),
    setEditorText: (text) => editor.setText(text),
    getEditorText: () => editor.getExpandedText?.() ?? editor.getText(),
    setEditorComponent,
    getEditorComponent: () => editorComponentFactory,
    searchWorkspaceFiles: (sessionKey, query, options) =>
      client.searchWorkspaceFiles?.(sessionKey, query, options) ?? Promise.resolve([]),
    getThemeObject: () => theme,
    getAllThemes: getAllExtensionThemes,
    getTheme: getExtensionTheme,
    setTheme: setExtensionTheme,
    getToolsExpanded: () => state.toolsExpanded,
    setToolsExpanded: (expanded) => {
      state.toolsExpanded = expanded;
      tuiSettings = { ...tuiSettings, toolsExpanded: expanded };
      saveTuiSettings(tuiSettings);
      chatLog.setToolsExpanded(expanded);
      updateFooter();
      tui.requestRender();
    },
    getAvailableProviderCount,
    getActiveSignal: () => client.getActiveSignal?.(),
    isProjectTrusted: isCurrentProjectTrusted,
    getSessionManager: () => sessionSnapshot.manager(),
    getSystemPrompt: getExtensionSystemPrompt,
    getSystemPromptOptions: () => ({
      cwd: process.cwd(),
      sessionKey: state.currentSessionKey,
      ...(state.sessionInfo.model
        ? {
            model: {
              ...(state.sessionInfo.modelProvider ? { provider: state.sessionInfo.modelProvider } : {}),
              id: state.sessionInfo.model,
              ref: state.sessionInfo.modelProvider
                ? `${state.sessionInfo.modelProvider}/${state.sessionInfo.model}`
                : state.sessionInfo.model,
              contextWindow: state.sessionInfo.contextWindow ?? null,
            },
          }
        : {}),
    }),
    waitForIdle: waitForTuiIdle,
    newSession: runExtensionNewSession,
    forkSession: runExtensionFork,
    navigateTree: runExtensionNavigateTree,
    switchSession: runExtensionSwitchSession,
    reload: async () => {
      await loadSessionHistory();
      await refreshSessionInfoWithBorder();
    },
    sendUserMessage: async (content, options) =>
      sendExtensionUserMessage(content as ExtensionUserMessageContent, options),
    sendMessage: async (message, options) => sendExtensionMessage(message, options),
    cwd: process.cwd(),
    fdPath: resolveFdPath(),
    openOverlay: openCommandOverlay,
    closeOverlay: closeCommandOverlay,
    onInvalidate: () => {
      updateHeader();
      updateFooter();
      tui.requestRender();
    },
    abortActive: () => abortActive(),
    requestExit: () => requestExit(),
    compactSession: (options) => runCompaction(options?.customInstructions, {
      onComplete: options?.onComplete,
      onError: options?.onError,
    }),
    setModel: (modelRef) => switchCurrentModel(modelRef),
    setThinkingLevel: (level) => setThinkingLevel(level),
    setReasoningLevel: (level) => setReasoningLevel(level),
    setVerboseLevel: (level) => setVerboseLevel(level),
    setWorkingMessage: (message?: string) => {
      extensionWorkingMessage = message?.trim() || undefined;
      renderStatus();
    },
    setWorkingVisible: (visible: boolean) => {
      extensionWorkingVisible = visible;
      renderStatus();
    },
    setWorkingIndicator: (indicator?: LoaderIndicatorOptions) => {
      extensionWorkingIndicator = indicator;
      statusLoader?.setIndicator(indicator);
      renderStatus();
    },
  });

  editor.setAutocompleteProvider?.(extensionRuntime.autocompleteProvider);
  setEditorExtensionShortcut();

  let statusLoader: Loader | null = null;
  let statusStartedAt: number | null = null;
  let lastActivityStatus = '';
  let elapsedTimerId: ReturnType<typeof setInterval> | null = null;
  const busyStates = new Set(['sending', 'waiting', 'streaming', 'running', 'compacting', 'recovering']);

  const syncTerminalProgress = () => {
    if (!tuiSettings.showTerminalProgress) {
      tui.terminal.setProgress(false);
      return;
    }
    tui.terminal.setProgress(busyStates.has(state.activityStatus));
  };

  let lastStreamActivityAt = Date.now();
  let streamWatchdogId: ReturnType<typeof setInterval> | null = null;

  const touchStreamingActivity = () => {
    lastStreamActivityAt = Date.now();
    if (state.activeRunId && state.runStatus.lastActivityAt == null) {
      state.runStatus = {
        ...state.runStatus,
        runId: state.activeRunId,
        lastActivityAt: lastStreamActivityAt,
      };
    }
  };

  const formatElapsed = (startMs: number) => {
    const totalSeconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  };

  const renderStatus = () => {
    const isBusy = busyStates.has(state.activityStatus);
    if (isBusy && extensionWorkingVisible) {
      if (!statusStartedAt || lastActivityStatus !== state.activityStatus) {
        statusStartedAt = Date.now();
      }
      if (!statusLoader) {
        statusContainer.clear();
        statusLoader = new Loader(
          tui,
          (spinner) => theme.accent(spinner),
          (text) => theme.bold(theme.accentSoft(text)),
          '',
          extensionWorkingIndicator,
        );
        statusContainer.addChild(statusLoader);
      }
      const elapsed = formatElapsed(statusStartedAt);
      const loaderMessage = state.progressMessage ?? extensionWorkingMessage ?? state.activityStatus;
      statusLoader.setMessage(
        `${loaderMessage} • ${elapsed} | ${state.connectionStatus}`,
      );
      if (!elapsedTimerId) {
        elapsedTimerId = setInterval(() => {
          if (statusStartedAt && statusLoader) {
            const el = formatElapsed(statusStartedAt);
            const message = state.progressMessage ?? extensionWorkingMessage ?? state.activityStatus;
            statusLoader.setMessage(
              `${message} • ${el} | ${state.connectionStatus}`,
            );
          }
        }, 1000);
      }
    } else {
      if (!isBusy) {
        state.progressMessage = null;
        statusStartedAt = null;
      }
      if (elapsedTimerId) {
        clearInterval(elapsedTimerId);
        elapsedTimerId = null;
      }
      statusLoader?.stop();
      statusLoader = null;
      statusContainer.clear();
    }
    lastActivityStatus = state.activityStatus;
    bottomBar.invalidate();
    syncTerminalProgress();
    tui.requestRender();
  };

  const setActivityStatus = (status: string) => {
    state.activityStatus = status as TuiState['activityStatus'];
    renderStatus();
  };

  const setConnectionStatus = (text: string) => {
    state.connectionStatus = text;
    renderStatus();
  };

  const updateHeader = () => {
    header.invalidate();
    syncTerminalTitle();
  };

  const syncTerminalTitle = () => {
    const shortKey =
      state.currentSessionKey.length > 48
        ? `${state.currentSessionKey.slice(0, 45)}…`
        : state.currentSessionKey;
    tui.terminal.setTitle(`xopc · ${shortKey}`);
  };

  const updateFooter = () => {
    bottomBar.invalidate();
  };

  const refreshModelChoices = async () => {
    try {
      modelChoices = await client.listModels();
    } catch {
      modelChoices = [];
    }
    bottomBar.invalidate();
    tui.requestRender();
  };

  let finishTui: (() => void) | null = null;
  let exitResult: TuiResult = { exitReason: 'exit' };

  const requestExit = () => {
    if (state.exitRequested) return;
    state.exitRequested = true;
    if (elapsedTimerId) {
      clearInterval(elapsedTimerId);
      elapsedTimerId = null;
    }
    if (streamWatchdogId) {
      clearInterval(streamWatchdogId);
      streamWatchdogId = null;
    }
    client.stop();
    tui.terminal.setProgress(false);
    void drainAndStopTuiSafely(tui).then(() => {
      restoreStdio();
      process.stdout.write(
        `\nTo resume this session: ${formatTuiResumeCommand(opts, state.currentSessionKey)}\n`,
      );
      finishTui?.();
      process.exit(0);
    });
  };

  const sessionActions = createSessionActions({
    client,
    chatLog,
    tui,
    state,
    resolveSessionKey,
    updateHeader,
    updateFooter,
    setActivityStatus,
    sessionSnapshot,
    onAgentIdChange: (agentId) => {
      currentAgentId = agentId;
    },
  });

  const {
    refreshSessionInfo,
    loadHistory: loadSessionHistory,
    setSession,
    abortActive,
    resetCurrentSession,
    clearChatForSessionSwitch,
  } = sessionActions;

  const refreshSessionInfoWithBorder = async () => {
    await refreshSessionInfo();
    updateEditorBorderColor();
  };

  const refreshStartupResources = async () => {
    if (!client.getStartupResources) {
      startupResources = undefined;
      syncResourceSlashCommands(undefined);
      return;
    }
    try {
      startupResources = await client.getStartupResources(state.currentSessionKey);
    } catch {
      startupResources = undefined;
    }
    syncResourceSlashCommands(startupResources);
  };

  const showStartupCardOnce = () => {
    if (startupCardShown) return;
    startupCardShown = true;
    chatLog.addSystem(formatTuiStartupText({
      state,
      isLocal: isLocalMode,
      keybindings,
      resources: startupResources,
      expanded: false,
    }));
  };

  const applyStartupWorkingDirectory = async () => {
    if (startupWorkingDirectoryApplied || !startupWorkingDirectory) return;
    startupWorkingDirectoryApplied = true;
    await client.patchSession(state.currentSessionKey, {
      workingDirectory: startupWorkingDirectory,
    });
    state.sessionInfo.effectiveWorkspacePath = startupWorkingDirectory;
    state.sessionInfo.workingDirectoryLocked = true;
  };

  let streamRecoveryPromise: Promise<void> | null = null;
  const recoverActiveRunFromHistory = (reason: string) => {
    if (!state.activeRunId) return Promise.resolve();
    if (streamRecoveryPromise) return streamRecoveryPromise;
    const runId = state.activeRunId;
    markRunRecovering(state, Date.now());
    state.progressMessage = 'recovering stream history';
    setActivityStatus('recovering');
    streamRecoveryPromise = (async () => {
      try {
        await loadSessionHistory();
        await refreshSessionInfoWithBorder();
        if (state.activeRunId === runId) {
          clearSeenStreamEventsForRun(runId);
          if (client.resumeChat) {
            const resumed = await client.resumeChat({ sessionKey: state.currentSessionKey, runId });
            if (resumed.ok) {
              state.progressMessage = 'resuming stream';
              setActivityStatus('recovering');
              chatLog.addSystem(theme.dim(`Reattached to active run after ${reason}.`));
            } else {
              markRunRecoveryComplete(state, Date.now());
              state.progressMessage = 'stream stalled; resume unavailable';
              setActivityStatus('stalled');
              chatLog.addSystem(
                theme.dim(
                  `Recovered persisted history after ${reason}, but could not resume stream: ${resumed.reason ?? 'run relay unavailable'}. Press Escape or /abort to stop it.`,
                ),
              );
            }
          } else {
            markRunRecoveryComplete(state, Date.now());
            state.progressMessage = 'stream stalled; waiting for new events or abort';
            setActivityStatus('stalled');
            chatLog.addSystem(
              theme.dim(
                `Recovered persisted history after ${reason}. Active run is still marked stalled; press Escape or /abort to stop it.`,
              ),
            );
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        chatLog.addSystem(theme.dim(`Stream recovery failed after ${reason}: ${errorMessage}`));
        if (state.activeRunId === runId) {
          markRunRecoveryComplete(state, Date.now());
          setActivityStatus('stalled');
        }
      } finally {
        streamRecoveryPromise = null;
        updateFooter();
        tui.requestRender();
      }
    })();
    return streamRecoveryPromise;
  };

  const setThinkingLevel = async (level: ThinkLevel) => {
    try {
      await client.patchSession(state.currentSessionKey, { thinkingLevel: level });
      state.sessionInfo.thinkingLevel = level;
      await refreshSessionInfoWithBorder();
      updateFooter();
      chatLog.addStatus(theme.dim(`Thinking level: ${level}`));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      chatLog.addSystem(`Thinking level change failed: ${errorMessage}`);
    } finally {
      tui.requestRender();
    }
  };

  const setReasoningLevel = async (level: ReasoningLevel) => {
    try {
      await client.patchSession(state.currentSessionKey, { reasoningLevel: level });
      state.sessionInfo.reasoningLevel = level;
      await refreshSessionInfoWithBorder();
      updateFooter();
      chatLog.addStatus(theme.dim(`Reasoning visibility: ${level}`));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      chatLog.addSystem(`Reasoning visibility change failed: ${errorMessage}`);
    } finally {
      tui.requestRender();
    }
  };

  const setVerboseLevel = async (level: VerboseLevel) => {
    try {
      await client.patchSession(state.currentSessionKey, { verboseLevel: level });
      state.sessionInfo.verboseLevel = level;
      await refreshSessionInfoWithBorder();
      updateFooter();
      chatLog.addStatus(theme.dim(`Verbose mode: ${level}`));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      chatLog.addSystem(`Verbose mode change failed: ${errorMessage}`);
    } finally {
      tui.requestRender();
    }
  };

  const copyLastAssistant = async () => {
    const text = chatLog.getLastAssistantText().trim();
    if (!text) {
      chatLog.addSystem('No assistant messages to copy yet.');
      tui.requestRender();
      return;
    }
    try {
      await copyTextToClipboard(text);
      chatLog.addStatus(theme.dim('Copied last assistant message to clipboard'));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      chatLog.addSystem(`Copy failed: ${errorMessage}`);
    } finally {
      tui.requestRender();
    }
  };

  const renameCurrentSession = async (name: string) => {
    const nextName = name.trim();
    if (!nextName) {
      chatLog.addSystem('Usage: /name <name>');
      tui.requestRender();
      return;
    }
    try {
      const result = await client.renameSession(state.currentSessionKey, nextName);
      if (!result.ok) {
        chatLog.addSystem('Session rename failed.');
        tui.requestRender();
        return;
      }
      state.sessionInfo.displayName = nextName;
      updateFooter();
      updateHeader();
      chatLog.addStatus(theme.dim(`Session name set: ${nextName}`));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      chatLog.addSystem(`Session rename failed: ${errorMessage}`);
    } finally {
      tui.requestRender();
    }
  };

  const resolveModelChoiceIndex = (): number => {
    const choices = cycleModelChoices();
    if (choices.length === 0) return -1;
    const p = state.sessionInfo.modelProvider;
    const m = state.sessionInfo.model;
    if (p && m) {
      const byParts = choices.findIndex((x) => x.provider === p && x.id === m);
      if (byParts >= 0) return byParts;
    }
    if (m?.includes('/')) {
      const [a, b] = m.split('/', 2);
      const bySlash = choices.findIndex((x) => x.provider === a && x.id === b);
      if (bySlash >= 0) return bySlash;
    }
    return 0;
  };

  const cycleModel = (dir: 'forward' | 'backward') => {
    const choices = cycleModelChoices();
    if (choices.length === 0) {
      void refreshModelChoices().then(() => {
        if (cycleModelChoices().length === 0) {
          chatLog.addSystem('No models available to cycle.');
          tui.requestRender();
          return;
        }
        cycleModel(dir);
      });
      return;
    }
    const idx = resolveModelChoiceIndex();
    const base = idx >= 0 ? idx : 0;
    const delta = dir === 'forward' ? 1 : -1;
    const next = choices[(base + delta + choices.length) % choices.length]!;
    void switchCurrentModel(`${next.provider}/${next.id}`);
  };

  const listCurrentModels = async (): Promise<TuiModelChoice[]> => {
    if (modelChoices.length === 0) {
      await refreshModelChoices();
    }
    return modelChoices;
  };

  const switchCurrentModel = async (modelRef: string) => {
    const trimmed = modelRef.trim();
    if (!trimmed.includes('/')) {
      chatLog.addSystem('Usage: /switch <provider/model>');
      tui.requestRender();
      return;
    }
    if (modelChoices.length === 0) {
      await refreshModelChoices();
    }
    const [provider, id] = trimmed.split('/', 2);
    const selected = modelChoices.find((choice) => choice.provider === provider && choice.id === id);
    if (!selected) {
      chatLog.addSystem(`Model not found: ${trimmed}`);
      tui.requestRender();
      return;
    }
    try {
      await client.patchSession(state.currentSessionKey, { model: trimmed });
      state.sessionInfo.modelProvider = selected.provider;
      state.sessionInfo.model = selected.id;
      if (selected.contextWindow != null) {
        state.sessionInfo.contextWindow = selected.contextWindow;
      }
      await refreshSessionInfoWithBorder();
      updateFooter();
      updateHeader();
      chatLog.addStatus(theme.dim(`Model: ${trimmed}`));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      chatLog.addSystem(`Model switch failed: ${errorMessage}`);
    } finally {
      tui.requestRender();
    }
  };

  const exportCurrentSession = async (request: TuiExportRequest) => {
    const outputPath = request.outputPath
      ? isAbsolute(request.outputPath)
        ? request.outputPath
        : resolve(process.cwd(), request.outputPath)
      : defaultExportPath(state.currentSessionKey, request.format);
    try {
      const backendFormat = request.format === 'json' ? 'json' : 'markdown';
      const raw = await client.exportSession(state.currentSessionKey, backendFormat);
      const content = request.format === 'html' ? wrapMarkdownExportAsHtml(raw) : raw;
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, content, 'utf8');
      chatLog.addStatus(theme.dim(`Exported ${request.format} session to: ${outputPath}`));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      chatLog.addSystem(`Export failed: ${errorMessage}`);
    } finally {
      tui.requestRender();
    }
  };

  const importSessionExport = async (request: TuiImportRequest) => {
    const rawPath = request.inputPath?.trim();
    if (!rawPath) {
      chatLog.addSystem('Usage: /import <path.json> [target-session]');
      tui.requestRender();
      return;
    }
    const inputPath = isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath);
    const targetRaw = request.targetKey?.trim() || `import-${randomUUID()}`;
    const targetKey = resolveSessionKey(targetRaw);
    try {
      const content = readFileSync(inputPath, 'utf8');
      const result = await client.importSession(targetKey, content);
      await setSession(result.sessionKey);
      chatLog.addStatus(theme.dim(`Imported ${result.rowCount} transcript rows from: ${inputPath}`));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      chatLog.addSystem(`Import failed: ${errorMessage}`);
    } finally {
      tui.requestRender();
    }
  };

  const createShareLink = async (request: TuiShareRequest) => {
    try {
      chatLog.addStatus(theme.dim(`Creating share for: ${request.path}`));
      tui.requestRender();
      const result = await client.createShare(state.currentSessionKey, request, { agentId: currentAgentId });
      chatLog.addSystem(formatTuiShareResult(result));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      chatLog.addSystem(`Share failed: ${errorMessage}`);
    } finally {
      tui.requestRender();
    }
  };

  const startWorkflowRun = async (request: { definitionId: string; goal?: string }) => {
    if (!client.startWorkflowRun) {
      throw new Error('Workflow runs are not available in this mode.');
    }
    const result = await client.startWorkflowRun({
      sessionKey: state.currentSessionKey,
      definitionId: request.definitionId,
      agentId: currentAgentId,
      goal: request.goal,
    });
    visibleWorkflowRunIds.add(result.runId);
    return result;
  };

  const runBtwQuery = async (question: string) => {
    const previousStatus = state.activityStatus;
    const runId = `btw-${randomUUID()}`;
    try {
      setActivityStatus('waiting');
      state.progressMessage = 'btw';
      chatLog.addUser(`/btw ${question}`);
      chatLog.addStatus(theme.dim('BTW running...'));
      tui.requestRender();
      const result = await client.btwQuery(state.currentSessionKey, question);
      if (result.error) {
        chatLog.addSystem(`BTW failed: ${result.error}`);
        return;
      }
      chatLog.finalizeAssistant({
        role: 'assistant',
        content: [{ type: 'text', text: `BTW\n\n${result.text}` }],
        timestamp: Date.now(),
      } as AgentMessage, runId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      chatLog.addSystem(`BTW failed: ${errorMessage}`);
    } finally {
      state.activityStatus = previousStatus;
      renderStatus();
      tui.requestRender();
    }
  };

  const forkCurrentSession = async (rawKey?: string) => {
    const targetRaw = rawKey?.trim() || `fork-${randomUUID()}`;
    const targetKey = resolveSessionKey(targetRaw);
    if (targetKey === state.currentSessionKey) {
      chatLog.addSystem('Fork target must be different from the current session.');
      tui.requestRender();
      return;
    }
    const sourceSessionKey = state.currentSessionKey;
    try {
      await abortActive({ clearUi: false });
      const result = await client.forkSession(sourceSessionKey, targetKey);
      await setSession(result.sessionKey);
      chatLog.addBranchSummary({
        sourceSessionKey,
        targetSessionKey: result.sessionKey,
        rowCount: result.rowCount,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      chatLog.addSystem(`Fork failed: ${errorMessage}`);
    } finally {
      tui.requestRender();
    }
  };

  const handleCtrlZ = () => {
    if (process.platform === 'win32') {
      chatLog.addSystem(formatSuspendUnsupportedHint(keybindings));
      tui.requestRender();
      return;
    }
    const suspendKeepAlive = setInterval(() => {}, 2 ** 30);
    const ignoreSigint = () => {};
    process.on('SIGINT', ignoreSigint);
    process.once('SIGCONT', () => {
      clearInterval(suspendKeepAlive);
      process.removeListener('SIGINT', ignoreSigint);
      tui.start();
      tui.setFocus(editor);
      tui.requestRender(true);
    });
    try {
      tui.stop();
      process.kill(0, 'SIGTSTP');
    } catch {
      clearInterval(suspendKeepAlive);
      process.removeListener('SIGINT', ignoreSigint);
    }
  };

  const openExternalEditor = () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-tui-edit-'));
    const filePath = join(dir, 'message.md');
    writeFileSync(filePath, editor.getText(), 'utf8');
    const editorBin = process.env.EDITOR || process.env.VISUAL || 'vi';
    void (async () => {
      await withTuiSuspended(tui, async () => {
        spawnSync(editorBin, [filePath], { stdio: 'inherit' });
      });
      try {
        const next = readFileSync(filePath, 'utf8');
        editor.setText(next.replace(/\r\n/g, '\n'));
      } catch {
        // ignore
      }
      try {
        unlinkSync(filePath);
      } catch {
        // ignore
      }
      tui.setFocus(editor);
      tui.requestRender(true);
    })();
  };

  const isAgentBusy = () =>
    state.activeRunId != null || state.isCompacting || busyStates.has(state.activityStatus);

  let steeringInFlightForRunId: string | null = null;

  const sendSteeringToActiveRun = (text: string) => {
    chatLog.addUser(text);
    touchStreamingActivity();
    tui.requestRender();
    void client
      .steerChat({ sessionKey: state.currentSessionKey, message: text })
      .then(({ ok }) => {
        if (!ok) {
          chatLog.addSystem(
            theme.dim(
              formatSteerUnavailableHint(keybindings),
            ),
          );
        } else {
          chatLog.addSystem(
            theme.dim('Steered — message injects at the next tool boundary (pi-style).'),
          );
        }
        tui.requestRender();
      })
      .catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        chatLog.addSystem(theme.dim(`Steer failed: ${errorMessage}`));
        tui.requestRender();
      });
  };

  const flushSteeringQueue = () => {
    if (state.exitRequested) return;
    if (state.activeRunId) return;
    const next = drainFollowUpQueue(state.steeringQueue, tuiSettings.steeringMode);
    if (next === undefined) return;
    sendMessage(next);
  };

  const steerMessage = (text: string) => {
    if (!state.activeRunId) {
      sendMessage(text);
      return;
    }
    if (steeringInFlightForRunId === state.activeRunId) {
      state.steeringQueue.push(text);
      chatLog.addSystem(
        theme.dim(
          `Queued steering (${state.steeringQueue.length} in queue). ${tuiSettings.steeringMode === 'all' ? 'All queued steering sends together after this reply.' : 'Next sends after this reply.'}`,
        ),
      );
      bottomBar.invalidate();
      tui.requestRender();
      return;
    }
    steeringInFlightForRunId = state.activeRunId;
    sendSteeringToActiveRun(text);
  };

  const sendMessage = (text: string) => {
    if (state.activeRunId && pendingImageAttachments.length > 0) {
      chatLog.addSystem(
        theme.dim('Image attachments cannot be steered into an active run. Wait for this reply to finish, then send.'),
      );
      tui.requestRender();
      return;
    }
    const pendingCustomText = pendingNextTurnCustomMessages.splice(0).join('\n\n').trim();
    const messageText = [text, pendingCustomText].filter(Boolean).join('\n\n');
    const attachments = pendingImageAttachments;
    pendingImageAttachments = [];
    if (state.isCompacting) {
      state.compactionQueue.push(messageText);
      if (attachments.length > 0) {
        pendingImageAttachments.unshift(...attachments);
      }
      chatLog.addSystem(
        theme.dim(`Queued during compaction (${state.compactionQueue.length}). Sends when compact finishes.`),
      );
      bottomBar.invalidate();
      tui.requestRender();
      return;
    }

    if (state.activeRunId) {
      chatLog.addSystem(
        formatBusyResponseHint(keybindings),
      );
      if (pendingCustomText) {
        pendingNextTurnCustomMessages.unshift(pendingCustomText);
      }
      if (attachments.length > 0) {
        pendingImageAttachments.unshift(...attachments);
      }
      tui.requestRender();
      return;
    }

    chatLog.addUser(userDisplayContentForAttachments(text, attachments));
    sessionSnapshot.appendMessage('user', messageText);
    lastRetryMessageText = messageText;
    markRunSending(state);
    setActivityStatus('sending');
    touchStreamingActivity();
    tui.requestRender();

    void client
      .sendChat({
        sessionKey: state.currentSessionKey,
        message: messageText,
        attachments: attachments.length > 0 ? attachments : undefined,
        thinking: opts.thinking,
      })
      .catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (attachments.length > 0) {
          pendingImageAttachments.unshift(...attachments);
        }
        chatLog.addSystem(`❌ Failed to send: ${errorMessage}`);
        setActivityStatus('idle');
        tui.requestRender();
      });
  };

  sendExtensionUserMessage = (content, options) => {
    const text = extensionUserMessageContentToText(content).trim();
    if (!text) {
      throw new Error('sendUserMessage requires text content.');
    }
    if (!state.activeRunId) {
      sendMessage(text);
      return;
    }
    if (options?.deliverAs === 'steer') {
      steerMessage(text);
      return;
    }
    if (options?.deliverAs === 'followUp') {
      state.messageFollowUpQueue.push(text);
      chatLog.addSystem(
        theme.dim(
          `Queued follow-up (${state.messageFollowUpQueue.length} in queue). ${tuiSettings.followUpMode === 'all' ? 'All queued messages send together when this reply finishes.' : 'Next sends when this reply finishes.'}`,
        ),
      );
      bottomBar.invalidate();
      tui.requestRender();
      return;
    }
    throw new Error('Agent is busy. Use deliverAs: "steer" or "followUp".');
  };

  const runCompaction = async (
    instructions?: string,
    callbacks?: {
      onComplete?: (result: TuiCompactionResult) => void;
      onError?: (error: Error) => void;
    },
  ): Promise<TuiCompactionResult | undefined> => {
    if (state.isCompacting) return undefined;
    state.isCompacting = true;
    setActivityStatus('compacting');
    chatLog.addSystem(
      theme.dim(
        instructions ? `Compacting session with instructions: ${instructions}` : 'Compacting session…',
      ),
    );
    tui.requestRender();
    try {
      const result = await client.compactSession(state.currentSessionKey, { force: true, instructions });
      if (result.compacted) {
        clearSeenStreamEvents();
        state.historyLoaded = false;
        await loadSessionHistory();
        chatLog.addCompactionSummary(result);
      } else {
        chatLog.addSystem(formatTuiCompactionResult(result));
      }
      callbacks?.onComplete?.(result);
      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      chatLog.addSystem(`❌ Compaction failed: ${errorMessage}`);
      callbacks?.onError?.(error instanceof Error ? error : new Error(errorMessage));
      return undefined;
    } finally {
      state.isCompacting = false;
      setActivityStatus('idle');
      await refreshSessionInfoWithBorder();
      const queued = state.compactionQueue.shift();
      if (queued && !state.activeRunId) {
        sendMessage(queued);
      }
      updateFooter();
      tui.requestRender();
    }
  };

  const applyTuiSettings = (settings: TuiSettings) => {
    tuiSettings = { ...settings };
    saveTuiSettings(tuiSettings);
    state.showThinking = tuiSettings.showThinking;
    state.toolsExpanded = tuiSettings.toolsExpanded;
    chatLog.setShowThinking(tuiSettings.showThinking);
    chatLog.setToolsExpanded(tuiSettings.toolsExpanded);
    chatLog.setToolImageOptions({
      showImages: tuiSettings.showImages,
      imageWidthCells: tuiSettings.imageWidthCells,
      cwd: process.cwd(),
    });
    tui.setShowHardwareCursor(tuiSettings.showHardwareCursor);
    tui.setClearOnShrink(tuiSettings.clearOnShrink);
    defaultEditor.setPaddingX(tuiSettings.editorPaddingX);
    defaultEditor.setAutocompleteMaxVisible(tuiSettings.autocompleteMaxVisible);
    if (editor !== defaultEditor) {
      editor.setPaddingX?.(tuiSettings.editorPaddingX);
      editor.setAutocompleteMaxVisible?.(tuiSettings.autocompleteMaxVisible);
    }
    applyThemeById(tuiSettings.theme);
    header.invalidate();
    updateEditorBorderColor();
    syncTerminalProgress();
    bottomBar.invalidate();
    tui.requestRender();
  };

  const previewTheme = (themeId: string) => {
    applyThemeById(themeId);
    updateEditorBorderColor();
    tui.requestRender();
  };

  const reloadTuiRuntime = async () => {
    if (state.activeRunId) {
      throw new Error('Wait for the current response to finish before reloading.');
    }
    if (state.isCompacting) {
      throw new Error('Wait for compaction to finish before reloading.');
    }
    keybindings.reload();
    setKeybindings(keybindings);
    applyTuiSettings(loadTuiSettings());
    extensionRuntime.dispose();
    await extensionRuntime.activate();
    editor.setAutocompleteProvider?.(extensionRuntime.autocompleteProvider);
    setEditorExtensionShortcut();
    updateHeader();
    updateFooter();
    tui.requestRender();
  };

  const uiOverlays = {
    openModelPicker: (_initialSearch?: string) => {},
    openAgentPicker: () => {},
    openSessionPicker: () => {},
    openSessionTree: () => {},
    openTranscriptTree: () => {},
    openUserMessageFork: () => {},
    openScopedModels: () => {},
    openThinkingSelector: () => {},
    openSettings: () => {},
    openProjectTrust: () => {},
    reloadKeybindings: () => reloadTuiRuntime(),
  };

  const recoverCurrentStream = async () => {
    if (state.activeRunId) {
      await recoverActiveRunFromHistory('manual recover');
      return;
    }
    await loadSessionHistory({ merge: true });
    await refreshSessionInfoWithBorder();
    chatLog.addSystem(theme.dim('Reloaded persisted history; no active run to recover.'));
    tui.requestRender();
  };

  const retryLastMessage = async () => {
    const message = lastRetryMessageText?.trim();
    if (!message) {
      chatLog.addSystem('No previous user message to retry.');
      return;
    }
    if (state.activeRunId) {
      await abortActive({ clearUi: false });
    }
    sendMessage(message);
  };

  const switchAgentSession = async (sessionKey: string, agentId: string) => {
    const previousWorkspace = state.sessionInfo.effectiveWorkspacePath?.trim();
    await setSession(sessionKey);
    await refreshStartupResources();
    if (previousWorkspace && state.sessionInfo.workingDirectoryLocked !== true) {
      try {
        await client.patchSession(state.currentSessionKey, { workingDirectory: previousWorkspace });
        state.sessionInfo.effectiveWorkspacePath = previousWorkspace;
        state.sessionInfo.workingDirectoryLocked = true;
        await refreshSessionInfoWithBorder();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        chatLog.addSystem(`Switched agent, but workspace was not copied: ${errorMessage}`);
      }
    }
    currentAgentId = agentId;
    updateHeader();
    updateFooter();
  };

  const handleCommand = createTuiCommandHandler({
    state,
    chatLog,
    tui,
    isLocalMode,
    abortActive,
    sendMessage,
    requestExit,
    updateFooter,
    keybindings,
    recoverStream: recoverCurrentStream,
    retryLastMessage,
    uiOverlays,
    setThinkingLevel,
    setReasoningLevel,
    setVerboseLevel,
    copyLastAssistant,
    renameCurrentSession,
    runCompaction,
    listModels: listCurrentModels,
    switchModel: switchCurrentModel,
    listSessions: () => client.listSessions(),
    listAgents: () => client.listAgents(),
    switchAgentSession,
    getSessionStats: () => client.getSessionStats(state.currentSessionKey),
    getStartupResources: () => startupResources,
    loadTranscriptTree: () => client.loadTranscriptTree(state.currentSessionKey),
    exportSession: exportCurrentSession,
    importSession: importSessionExport,
    createShare: createShareLink,
    startWorkflowRun,
    runBtwQuery,
    forkSession: forkCurrentSession,
    extensionSlashCommands: extensionRuntime.slashCommands,
    skillSlashCommands,
    workflowSlashCommands,
    extensionShortcuts: extensionRuntime.shortcuts,
    currentAgentId,
    setSession: async (rawKey) => {
      await setSession(rawKey);
      await refreshStartupResources();
    },
    resetSession: resetCurrentSession,
    projectTrust: {
      cwd: process.cwd(),
      hasProjectResources: () => hasTrustRequiringProjectResources(process.cwd()),
      getStorePath: () => projectTrustStore.getPath(),
      getEntry: () => projectTrustStore.getEntry(process.cwd()),
      getSessionDecision: () => projectTrustSessionDecision,
    },
    runLogin: (provider) =>
      runTuiOAuthLogin(provider, {
        chatLog,
        tui,
        editor,
        openOverlay: openCommandOverlay,
        closeOverlay: closeCommandOverlay,
        keybindings,
      }),
  });

  const { runLocalShellLine } = createLocalShellRunner({
    chatLog,
    tui,
    editor,
    openOverlay: openCommandOverlay,
    closeOverlay: closeCommandOverlay,
    pauseStdioFilter: () => stdioFilter.pause(),
    resumeStdioFilter: () => stdioFilter.resume(),
    runWithInheritedStdio: async (work) => {
      await withTuiSuspended(tui, work);
    },
    keybindings,
    getCwd: () => {
      const workspace = state.sessionInfo.effectiveWorkspacePath?.trim();
      if (!workspace) {
        throw new Error('Workspace is not loaded yet.');
      }
      return workspace;
    },
    onComplete: async (entry) => {
      await client
        .appendBashExecution(state.currentSessionKey, entry)
        .catch((err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          chatLog.addSystem(`Bash transcript append failed: ${errorMessage}`);
        })
        .finally(() => {
          updateFooter();
          tui.requestRender();
        });
    },
  });

  const submitCore = createEditorSubmitHandler({
    editor: {
      setText: (value) => editor.setText(value),
      addToHistory: (value) => editor.addToHistory?.(value),
    },
    handleCommand,
    sendMessage,
    handleBangLine: runLocalShellLine,
    isAgentBusy,
    steerWhileBusy: steerMessage,
    hasPendingAttachments: () => pendingImageAttachments.length > 0,
    defaultAttachmentMessage: 'Please analyze the attached image.',
  });

  const submitBurst = createSubmitBurstCoalescer({
    submit: submitCore,
    enabled: shouldEnableWindowsGitBashPasteFallback(),
  });
  defaultEditor.onSubmit = submitBurst;

  const flushFollowUpQueue = () => {
    if (state.exitRequested) return;
    if (state.activeRunId) return;
    const next = drainFollowUpQueue(state.messageFollowUpQueue, tuiSettings.followUpMode);
    if (next === undefined) return;
    sendMessage(next);
  };

  const handleFollowUp = () => {
    const text = editor.getText().trim();
    if (!text && pendingImageAttachments.length === 0) return;
    if (isAgentBusy()) {
      if (pendingImageAttachments.length > 0) {
        chatLog.addSystem(
          theme.dim('Image attachments cannot be queued while the agent is busy. Wait for this reply to finish, then send.'),
        );
        tui.requestRender();
        return;
      }
      editor.addToHistory(text);
      state.messageFollowUpQueue.push(text);
      editor.setText('');
      chatLog.addSystem(
        theme.dim(
          `Queued follow-up (${state.messageFollowUpQueue.length} in queue). ${tuiSettings.followUpMode === 'all' ? 'All queued messages send together when this reply finishes.' : 'Next sends when this reply finishes.'}`,
        ),
      );
      bottomBar.invalidate();
      tui.requestRender();
      return;
    }
    submitBurst(text);
  };

  const handleDequeue = () => {
    const restored = restoreQueuedMessages(
      {
        steeringQueue: state.steeringQueue,
        followUpQueue: state.messageFollowUpQueue,
      },
      editor.getText(),
    );
    if (restored.restoredCount === 0) {
      chatLog.addStatus(theme.dim('No queued messages to restore.'));
      tui.requestRender();
      return;
    }
    editor.setText(restored.text);
    chatLog.addStatus(
      theme.dim(
        `Restored ${restored.restoredCount} queued message${restored.restoredCount > 1 ? 's' : ''} to editor.`,
      ),
    );
    bottomBar.invalidate();
    tui.requestRender();
  };

  const setSessionKey = (key: string) => {
    state.currentSessionKey = resolveSessionKey(key);
    updateAgentFromPicker(key);
  };

  const updateAgentFromPicker = (key: string) => {
    const parsed = parseAgentSessionKey(resolveSessionKey(key));
    if (parsed?.agentId) {
      currentAgentId = parsed.agentId;
    }
  };

  let ctrlCHandling = false;
  const handleCtrlC = () => {
    if (ctrlCHandling) return;
    ctrlCHandling = true;
    try {
      const now = Date.now();
      const decision = resolveCtrlCAction({
        hasInput: editor.getText().trim().length > 0,
        now,
        lastCtrlCAt: state.lastCtrlCAt,
      });
      state.lastCtrlCAt = decision.nextLastCtrlCAt;
      if (decision.action === 'clear') {
        editor.setText('');
        setActivityStatus('cleared input; press ctrl+c again to exit');
        tui.requestRender();
        return;
      }
      if (decision.action === 'exit') {
        requestExit();
        return;
      }
      setActivityStatus('press ctrl+c again to exit');
      tui.requestRender();
    } finally {
      ctrlCHandling = false;
    }
  };

  const setModelChoices = (models: TuiModelChoice[]) => {
    modelChoices = models;
  };

  const pickerSvc = {
    tui,
    editor,
    openOverlay: openCommandOverlay,
    closeOverlay: closeCommandOverlay,
    chatLog,
    client,
    sendMessage,
    switchModel: switchCurrentModel,
    openEditorSelector,
    refreshSessionInfo,
    updateHeader,
    state,
    setSessionKey,
    switchAgentSession,
    clearChatForSessionSwitch,
    loadSessionHistory,
    setEditorText: (text: string) => editor.setText(text),
    setModelChoices,
    getScopedModelRefs: () => state.scopedModelRefs,
    setScopedModelRefs: (refs: string[] | null) => {
      state.scopedModelRefs = refs;
      saveScopedModelRefs(refs);
    },
    refreshCycleModels,
    getTuiSettings: () => ({ ...tuiSettings }),
    applyTuiSettings,
    previewTheme,
    reloadKeybindings: reloadTuiRuntime,
    setThinkingLevel,
    getProjectTrustStore: () => projectTrustStore,
    getProjectTrustSessionDecision: () => projectTrustSessionDecision,
    setProjectTrustSessionDecision: (decision: boolean | null) => {
      projectTrustSessionDecision = decision;
    },
    keybindings,
  };

  uiOverlays.openModelPicker = (initialSearch?: string) =>
    void openModelPickerOverlay(pickerSvc, initialSearch);
  uiOverlays.openAgentPicker = () => void openAgentPickerOverlay(pickerSvc);
  uiOverlays.openSessionPicker = () => void openSessionPickerOverlay(pickerSvc);
  uiOverlays.openSessionTree = () => void openSessionTreeOverlay(pickerSvc);
  uiOverlays.openTranscriptTree = () => void openTranscriptTreeOverlay(pickerSvc);
  uiOverlays.openUserMessageFork = () => void openUserMessageForkOverlay(pickerSvc);
  uiOverlays.openScopedModels = () => void openScopedModelsOverlay(pickerSvc);
  uiOverlays.openThinkingSelector = () => openThinkingSelectorOverlay(pickerSvc);
  uiOverlays.openSettings = () => openSettingsOverlay(pickerSvc);
  uiOverlays.openProjectTrust = () => openProjectTrustOverlay(pickerSvc);

  const showSessionTree = () => {
    uiOverlays.openTranscriptTree();
  };

  const handleDoubleEscape = () => {
    switch (tuiSettings.doubleEscapeAction) {
      case 'tree':
        showSessionTree();
        break;
      case 'fork':
        uiOverlays.openUserMessageFork();
        break;
      default:
        break;
    }
  };

  defaultEditor.onEscape = () => {
    if (state.activeRunId) {
      void abortActive();
      return;
    }
    if (editor.getText().trim().length > 0) return;
    const now = Date.now();
    if (now - state.lastEscapeAt <= DOUBLE_ESCAPE_WINDOW_MS) {
      state.lastEscapeAt = 0;
      handleDoubleEscape();
      return;
    }
    state.lastEscapeAt = now;
  };
  defaultEditor.onCtrlD = () => requestExit();

  defaultEditor.onAction('app.clear', handleCtrlC);
  defaultEditor.onAction('app.exit', () => requestExit());
  defaultEditor.onAction('app.suspend', handleCtrlZ);
  defaultEditor.onAction('app.thinking.cycle', () => {
    const cur = state.sessionInfo.thinkingLevel ?? opts.thinking ?? 'medium';
    void setThinkingLevel(nextThinkLevel(cur));
  });
  defaultEditor.onAction('app.model.cycleForward', () => cycleModel('forward'));
  defaultEditor.onAction('app.model.cycleBackward', () => cycleModel('backward'));
  defaultEditor.onAction('app.model.select', () => uiOverlays.openModelPicker());
  defaultEditor.onAction('app.session.resume', () => void openSessionPickerOverlay(pickerSvc));
  defaultEditor.onAction('app.session.tree', showSessionTree);
  defaultEditor.onAction('app.session.fork', () => uiOverlays.openUserMessageFork());
  defaultEditor.onAction('app.tools.expand', () => {
    state.toolsExpanded = !state.toolsExpanded;
    tuiSettings = { ...tuiSettings, toolsExpanded: state.toolsExpanded };
    saveTuiSettings(tuiSettings);
    chatLog.setToolsExpanded(state.toolsExpanded);
    setActivityStatus(state.toolsExpanded ? 'tools expanded' : 'tools collapsed');
    tui.requestRender();
  });
  defaultEditor.onAction('app.thinking.toggle', () => {
    state.showThinking = !state.showThinking;
    tuiSettings = { ...tuiSettings, showThinking: state.showThinking };
    saveTuiSettings(tuiSettings);
    chatLog.setShowThinking(state.showThinking);
    updateFooter();
    tui.requestRender();
  });
  defaultEditor.onAction('app.editor.external', openExternalEditor);
  defaultEditor.onPasteImage = () => {
    void (async () => {
      const image = await readClipboardImage();
      if (!image) {
        chatLog.addStatus(theme.dim('No image found on clipboard.'));
        tui.requestRender();
        return;
      }
      if (pendingImageAttachments.length >= MAX_CHAT_ATTACHMENTS) {
        chatLog.addSystem(`Attachment limit reached (${MAX_CHAT_ATTACHMENTS}). Send or clear the current draft first.`);
        tui.requestRender();
        return;
      }
      if (image.bytes.byteLength > MAX_WEBCHAT_ATTACHMENT_FILE_BYTES) {
        chatLog.addSystem(
          `Clipboard image is too large (${image.bytes.byteLength} bytes; max ${MAX_WEBCHAT_ATTACHMENT_FILE_BYTES}).`,
        );
        tui.requestRender();
        return;
      }
      const ext = extensionForImageMimeType(image.mimeType) ?? 'png';
      const name = `clipboard-${pendingImageAttachments.length + 1}.${ext}`;
      pendingImageAttachments.push({
        type: 'image',
        mimeType: image.mimeType,
        data: Buffer.from(image.bytes).toString('base64'),
        name,
        size: image.bytes.byteLength,
      });
      chatLog.addStatus(
        theme.dim(
          `Attached image: ${name} (${pendingImageAttachments.length} pending). Send a message to include it.`,
        ),
      );
      tui.requestRender();
    })();
  };
  defaultEditor.onAction('app.message.followUp', handleFollowUp);
  defaultEditor.onAction('app.message.dequeue', handleDequeue);

  streamWatchdogId = setInterval(() => {
    const now = Date.now();
    if (!isActiveRunStreamStale(state, now, DEFAULT_STREAMING_WATCHDOG_MS)) return;
    if (!markActiveRunStalled(state, now)) return;
    chatLog.addSystem(
      theme.dim(
        'No stream activity for 30s; preserving active run and reloading persisted history.',
      ),
    );
    setActivityStatus('stalled');
    void recoverActiveRunFromHistory('stream watchdog');
    tui.requestRender();
  }, 5000);

  const onAgentRunEnded = () => {
    state.progressMessage = null;
    steeringInFlightForRunId = null;
    void refreshSessionInfoWithBorder().finally(() => {
      updateFooter();
      tui.requestRender();
    });
    flushSteeringQueue();
    flushFollowUpQueue();
  };

  const handleWorkflowRunUpdated = (data: Record<string, unknown>): boolean => {
    const runId = typeof data.runId === 'string' ? data.runId : '';
    const view = data.view && typeof data.view === 'object' ? data.view as WorkflowRunView : null;
    if (!runId || !view || !visibleWorkflowRunIds.has(runId)) return false;

    const snapshot = runViewToSnapshot(view);
    const completed = isTerminalWorkflowRunStatus(view.run.status);
    chatLog.updateWorkflowRun(runId, renderWorkflowPanel(snapshot, { status: view.run.status }));
    if (completed) {
      chatLog.addSystem(renderWorkflowFinalSummary(snapshot, { status: view.run.status }));
      visibleWorkflowRunIds.delete(runId);
      void refreshSessionInfoWithBorder().finally(() => {
        updateFooter();
      });
    }
    tui.requestRender();
    return true;
  };

  client.onEvent = (evt: TuiEvent) => {
    const data = (evt.data ?? {}) as Record<string, unknown>;
    if (evt.event === 'workflow.run.updated' && handleWorkflowRunUpdated(data)) {
      return;
    }
    dispatchAgentEvent(
      evt.event,
      data,
      state,
      chatLog,
      tui,
      setActivityStatus,
      touchStreamingActivity,
      onAgentRunEnded,
      (message) => sessionSnapshot.appendMessage('assistant', assistantMessagePlainText(message)),
      evt.source,
    );
  };

  client.onConnected = () => {
    state.isConnected = true;
    setConnectionStatus(isLocalMode ? 'local ready' : 'gateway connected');
    touchStreamingActivity();
    void (async () => {
      try {
        await applyStartupWorkingDirectory();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        chatLog.addSystem(`Working directory not changed: ${errorMessage}`);
      }
      await refreshSessionInfoWithBorder();
      await refreshModelChoices();
      await loadSessionHistory({ merge: true });
      showStartupCardOnce();
      void refreshStartupResources().then(() => {
        updateFooter();
        tui.requestRender();
      });
      if (state.activeRunId) {
        void recoverActiveRunFromHistory('broadcast reconnect');
      }
      updateHeader();
      updateFooter();
      tui.requestRender();
      if (!state.autoMessageSent && opts.message) {
        state.autoMessageSent = true;
        sendMessage(opts.message);
      }
    })();
  };

  client.onDisconnected = (reason: string) => {
    const wasConnected = state.isConnected;
    state.isConnected = false;
    touchStreamingActivity();
    if (isLocalMode) {
      setConnectionStatus(`local stopped: ${reason}`);
    } else {
      const hint =
        wasConnected || state.historyLoaded
          ? ` (${reason}). Reconnecting broadcast stream…`
          : `. Ensure gateway is running (xopc gateway) or use --local.`;
      setConnectionStatus(`disconnected${hint}`);
      if (!wasConnected && !state.historyLoaded) {
        const gatewayUrl = opts.url ?? 'http://localhost:3120';
        chatLog.addSystem(
          `Cannot reach gateway at ${gatewayUrl}.\n` +
            'Start the gateway (`xopc gateway`) or run `xopc tui --local` for embedded mode.',
        );
      }
    }
    tui.requestRender();
  };

  client.onGap = (info) => {
    chatLog.addSystem(
      `⚠️ Event gap: expected ${info.expected}, received ${info.received}. Some updates may be missing.`,
    );
    setConnectionStatus(`event gap: expected ${info.expected}, got ${info.received}`);
    if (state.activeRunId) {
      void recoverActiveRunFromHistory('broadcast event gap');
    } else {
      void loadSessionHistory({ merge: true });
    }
    tui.requestRender();
  };

  const sigintHandler = () => handleCtrlC();
  const sigtermHandler = () => requestExit();
  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);

  updateHeader();
  updateEditorBorderColor();
  setConnectionStatus(isLocalMode ? 'starting local runtime' : 'connecting');
  updateFooter();
  await extensionRuntime.activate();
  tui.start();
  client.start();

  await new Promise<void>((resolve) => {
    finishTui = () => {
      process.removeListener('SIGINT', sigintHandler);
      process.removeListener('SIGTERM', sigtermHandler);
      if (streamWatchdogId) {
        clearInterval(streamWatchdogId);
        streamWatchdogId = null;
      }
      finishTui = null;
      resolve();
    };
  });

  return exitResult;
}
