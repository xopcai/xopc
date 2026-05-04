import {
  CombinedAutocompleteProvider,
  Container,
  getKeybindings,
  isKeyRelease,
  Key,
  Loader,
  matchesKey,
  parseKey,
  ProcessTerminal,
  Text,
  TUI,
} from '@mariozechner/pi-tui';

import type { TuiBackend, TuiEvent } from './tui-backend.js';
import { EmbeddedBackend } from './backends/embedded-backend.js';
import { GatewaySseBackend } from './backends/gateway-sse-backend.js';
import {
  clearPendingToolCallIds,
  DEFAULT_STREAMING_WATCHDOG_MS,
  dispatchAgentSSE,
} from './tui-agent-events.js';
import { ChatLog } from './components/chat-log.js';
import { CustomEditor } from './components/custom-editor.js';
import { StreamAssembler } from './stream-assembler.js';
import { createTuiCommandHandler, getSlashCommands } from './tui-commands.js';
import { createLocalShellRunner } from './tui-local-shell.js';
import {
  createBackspaceDeduper,
  drainAndStopTuiSafely,
  resolveCtrlCAction,
} from './tui-lifecycle.js';
import { openModelPickerOverlay, openSessionPickerOverlay } from './tui-picker-overlay.js';
import { createOverlayHandlers } from './tui-overlays.js';
import {
  createEditorSubmitHandler,
  createSubmitBurstCoalescer,
  shouldEnableWindowsGitBashPasteFallback,
} from './tui-submit.js';
import { appendHistoryToChatLog } from './chat-history.js';
import { installTuiStdioFilter } from './tui-stdio-filter.js';
import { withTuiSuspended } from './tui-suspend.js';
import { editorTheme, theme } from './theme.js';
import { createInitialState, type TuiOptions, type TuiResult, type TuiState } from './tui-types.js';

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

function matchesCtrlCSequence(data: string): boolean {
  if (isKeyRelease(data)) return false;
  if (data === '\x03') return true;
  if (parseKey(data) === 'ctrl+c') return true;
  const kb = getKeybindings();
  return matchesKey(data, Key.ctrl('c')) || kb.matches(data, 'tui.input.copy');
}

export async function runTui(opts: TuiOptions): Promise<TuiResult> {
  const stdioFilter = installTuiStdioFilter();
  const restoreStdio = () => stdioFilter.restore();

  const isLocalMode = opts.local === true;
  const sessionKey = opts.session ?? 'cli:tui';
  const state = createInitialState(sessionKey);
  const assembler = new StreamAssembler();

  const client: TuiBackend = isLocalMode
    ? new EmbeddedBackend()
    : new GatewaySseBackend({ url: opts.url ?? 'http://localhost:3120', token: opts.token });

  const tui = new TUI(new ProcessTerminal());
  const dedupeBackspace = createBackspaceDeduper();
  tui.addInputListener((data) => {
    const next = dedupeBackspace(data);
    if (next.length === 0) {
      return { consume: true };
    }
    return { data: next };
  });

  const header = new Text('', 1, 0);
  const statusContainer = new Container();
  const footer = new Text('', 1, 0);
  const chatLog = new ChatLog();
  const editor = new CustomEditor(tui, editorTheme);
  const root = new Container();
  root.addChild(header);
  root.addChild(chatLog);
  root.addChild(statusContainer);
  root.addChild(footer);
  root.addChild(editor);
  tui.addChild(root);
  tui.setFocus(editor);

  const { openOverlay, closeOverlay } = createOverlayHandlers(tui, editor);

  const slashCommands = getSlashCommands(isLocalMode);
  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(
      slashCommands.map((c) => ({ name: c.name, description: c.description })),
      process.cwd(),
    ),
  );

  let statusText: Text | null = null;
  let statusLoader: Loader | null = null;
  let statusStartedAt: number | null = null;
  let lastActivityStatus = '';
  let elapsedTimerId: ReturnType<typeof setInterval> | null = null;
  const busyStates = new Set(['sending', 'waiting', 'streaming', 'running']);

  let lastStreamActivityAt = Date.now();
  let streamWatchdogId: ReturnType<typeof setInterval> | null = null;

  const touchStreamingActivity = () => {
    lastStreamActivityAt = Date.now();
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
    if (isBusy) {
      if (!statusStartedAt || lastActivityStatus !== state.activityStatus) {
        statusStartedAt = Date.now();
      }
      if (!statusLoader) {
        statusContainer.clear();
        statusText = null;
        statusLoader = new Loader(
          tui,
          (spinner) => theme.accent(spinner),
          (text) => theme.bold(theme.accentSoft(text)),
          '',
        );
        statusContainer.addChild(statusLoader);
      }
      const elapsed = formatElapsed(statusStartedAt);
      statusLoader.setMessage(`${state.activityStatus} • ${elapsed} | ${state.connectionStatus}`);
      if (!elapsedTimerId) {
        elapsedTimerId = setInterval(() => {
          if (statusStartedAt && statusLoader) {
            const el = formatElapsed(statusStartedAt);
            statusLoader.setMessage(`${state.activityStatus} • ${el} | ${state.connectionStatus}`);
          }
        }, 1000);
      }
    } else {
      statusStartedAt = null;
      if (elapsedTimerId) {
        clearInterval(elapsedTimerId);
        elapsedTimerId = null;
      }
      statusLoader?.stop();
      statusLoader = null;
      if (!statusText) {
        statusContainer.clear();
        statusText = new Text('', 1, 0);
        statusContainer.addChild(statusText);
      }
      const text = state.activityStatus
        ? `${state.connectionStatus} | ${state.activityStatus}`
        : state.connectionStatus;
      statusText.setText(theme.dim(text));
    }
    lastActivityStatus = state.activityStatus;
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
    const title = 'xopc tui';
    header.setText(
      theme.header(`${title} — ${client.connectionLabel} — session ${state.currentSessionKey}`),
    );
  };

  const updateFooter = () => {
    const modelLabel = state.sessionInfo.model
      ? state.sessionInfo.modelProvider
        ? `${state.sessionInfo.modelProvider}/${state.sessionInfo.model}`
        : state.sessionInfo.model
      : 'unknown';
    const tokens =
      state.sessionInfo.totalTokens != null ? `${state.sessionInfo.totalTokens} tokens` : '';
    const thinking = state.showThinking ? 'thinking:on' : '';
    const parts = [`session ${state.currentSessionKey}`, modelLabel, thinking, tokens].filter(
      Boolean,
    );
    footer.setText(theme.dim(parts.join(' | ')));
  };

  const refreshSessionInfo = async () => {
    try {
      state.sessionInfo = await client.getSessionInfo(state.currentSessionKey);
      updateFooter();
      tui.requestRender();
    } catch {
      // ignore
    }
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
    void drainAndStopTuiSafely(tui).then(() => {
      restoreStdio();
      finishTui?.();
    });
  };

  const abortActive = async () => {
    if (!state.activeRunId) return;
    const runId = state.activeRunId;
    state.activeRunId = null;
    assembler.drop(runId);
    chatLog.dropAssistant(runId);
    setActivityStatus('idle');
    tui.requestRender();
    await client.abortChat({ sessionKey: state.currentSessionKey, runId }).catch(() => {});
  };

  const sendMessage = (text: string) => {
    if (state.activeRunId) {
      chatLog.addSystem('A response is still in progress. Use /abort or press Escape to cancel.');
      tui.requestRender();
      return;
    }

    chatLog.addUser(text);
    setActivityStatus('sending');
    touchStreamingActivity();
    tui.requestRender();

    void client
      .sendChat({
        sessionKey: state.currentSessionKey,
        message: text,
        thinking: opts.thinking,
      })
      .catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        chatLog.addSystem(`❌ Failed to send: ${errorMessage}`);
        setActivityStatus('idle');
        tui.requestRender();
      });
  };

  const handleCommand = createTuiCommandHandler({
    state,
    chatLog,
    tui,
    assembler,
    isLocalMode,
    abortActive,
    sendMessage,
    requestExit,
    updateFooter,
  });

  const { runLocalShellLine } = createLocalShellRunner({
    chatLog,
    tui,
    editor,
    openOverlay,
    closeOverlay,
    pauseStdioFilter: () => stdioFilter.pause(),
    resumeStdioFilter: () => stdioFilter.resume(),
    runWithInheritedStdio: async (work) => {
      await withTuiSuspended(tui, work);
    },
  });

  const submitCore = createEditorSubmitHandler({
    editor,
    handleCommand,
    sendMessage,
    handleBangLine: runLocalShellLine,
  });

  editor.onSubmit = createSubmitBurstCoalescer({
    submit: submitCore,
    enabled: shouldEnableWindowsGitBashPasteFallback(),
  });

  const setSessionKey = (key: string) => {
    state.currentSessionKey = key;
  };

  const clearChatForSessionSwitch = () => {
    assembler.clear();
    chatLog.clearAll();
    clearPendingToolCallIds();
    state.historyLoaded = false;
  };

  const loadSessionHistory = async () => {
    try {
      const { messages } = await client.loadHistory({
        sessionKey: state.currentSessionKey,
        limit: 200,
      });
      appendHistoryToChatLog(chatLog, messages, state.toolsExpanded);
    } catch {
      // ignore; footer already hints on disconnect
    } finally {
      state.historyLoaded = true;
      tui.requestRender();
    }
  };

  const pickerSvc = {
    tui,
    editor,
    openOverlay,
    closeOverlay,
    chatLog,
    client,
    sendMessage,
    refreshSessionInfo,
    updateHeader,
    state,
    setSessionKey,
    clearChatForSessionSwitch,
    loadSessionHistory,
  };

  editor.onEscape = () => void abortActive();
  editor.onCtrlD = () => requestExit();
  editor.onCtrlL = () => void openModelPickerOverlay(pickerSvc);
  editor.onCtrlP = () => void openSessionPickerOverlay(pickerSvc);
  editor.onCtrlO = () => {
    state.toolsExpanded = !state.toolsExpanded;
    chatLog.setToolsExpanded(state.toolsExpanded);
    setActivityStatus(state.toolsExpanded ? 'tools expanded' : 'tools collapsed');
    tui.requestRender();
  };
  editor.onCtrlT = () => {
    state.showThinking = !state.showThinking;
    updateFooter();
    tui.requestRender();
  };

  const handleCtrlC = () => {
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
  };
  editor.onCtrlC = handleCtrlC;

  tui.addInputListener((data) => {
    if (!matchesCtrlCSequence(data)) return undefined;
    handleCtrlC();
    return { consume: true };
  });

  streamWatchdogId = setInterval(() => {
    if (!state.activeRunId) return;
    if (!busyStates.has(state.activityStatus)) return;
    if (Date.now() - lastStreamActivityAt < DEFAULT_STREAMING_WATCHDOG_MS) return;

    const rid = state.activeRunId;
    const finalText = assembler.finalize(rid, state.showThinking);
    if (finalText) {
      chatLog.finalizeAssistant(finalText, rid);
    }
    chatLog.addSystem(
      '⚠️ No stream activity for 30s; UI reset (connection may have stalled). Retry or check gateway.',
    );
    state.activeRunId = null;
    setActivityStatus('idle');
    tui.requestRender();
  }, 5000);

  client.onEvent = (evt: TuiEvent) => {
    const data = (evt.data ?? {}) as Record<string, unknown>;
    dispatchAgentSSE(evt.event, data, state, chatLog, assembler, tui, setActivityStatus, touchStreamingActivity);
  };

  client.onConnected = () => {
    state.isConnected = true;
    setConnectionStatus(isLocalMode ? 'local ready' : 'gateway connected');
    touchStreamingActivity();
    void (async () => {
      await refreshSessionInfo();
      await loadSessionHistory();
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
    tui.requestRender();
  };

  const sigintHandler = () => handleCtrlC();
  const sigtermHandler = () => requestExit();
  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);

  updateHeader();
  setConnectionStatus(isLocalMode ? 'starting local runtime' : 'connecting');
  updateFooter();
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
