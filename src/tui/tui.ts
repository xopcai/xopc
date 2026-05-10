import {
  CombinedAutocompleteProvider,
  Container,
  Loader,
  ProcessTerminal,
  setKeybindings,
  Text,
  TUI,
} from '@earendil-works/pi-tui';
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import type { ThinkLevel } from '../agent/transcript/thinking-types.js';
import type { TuiBackend, TuiEvent, TuiModelChoice } from './tui-backend.js';
import { EmbeddedBackend } from './backends/embedded-backend.js';
import { GatewaySseBackend } from './backends/gateway-sse-backend.js';
import {
  clearPendingToolCallIds,
  DEFAULT_STREAMING_WATCHDOG_MS,
  dispatchAgentSSE,
} from './tui-agent-events.js';
import { ChatLog } from './components/chat-log.js';
import { CustomEditor } from './components/custom-editor.js';
import { TuiBottomBar } from './components/tui-bottom-bar.js';
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
import { createXopcTuiKeybindingsManager } from './xopc-tui-keybindings.js';

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

  const keybindings = createXopcTuiKeybindingsManager();
  setKeybindings(keybindings);

  let modelChoices: TuiModelChoice[] = [];

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
  const bottomBar = new TuiBottomBar(() => state, () => opts.thinking);
  const chatLog = new ChatLog();
  const editor = new CustomEditor(tui, editorTheme, keybindings);
  const root = new Container();
  root.addChild(header);
  root.addChild(chatLog);
  root.addChild(statusContainer);
  root.addChild(editor);
  root.addChild(bottomBar);
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
      statusContainer.clear();
    }
    lastActivityStatus = state.activityStatus;
    bottomBar.invalidate();
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
    const title = 'xopc tui';
    header.setText(
      theme.header(`${title} — ${client.connectionLabel} — session ${state.currentSessionKey}`),
    );
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

  const resolveModelChoiceIndex = (): number => {
    if (modelChoices.length === 0) return -1;
    const p = state.sessionInfo.modelProvider;
    const m = state.sessionInfo.model;
    if (p && m) {
      const byParts = modelChoices.findIndex((x) => x.provider === p && x.id === m);
      if (byParts >= 0) return byParts;
    }
    if (m?.includes('/')) {
      const [a, b] = m.split('/', 2);
      const bySlash = modelChoices.findIndex((x) => x.provider === a && x.id === b);
      if (bySlash >= 0) return bySlash;
    }
    return 0;
  };

  const cycleModel = (dir: 'forward' | 'backward') => {
    if (modelChoices.length === 0) {
      void refreshModelChoices().then(() => {
        if (modelChoices.length === 0) {
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
    const next = modelChoices[(base + delta + modelChoices.length) % modelChoices.length]!;
    sendMessage(`/switch ${next.provider}/${next.id}`);
  };

  const handleCtrlZ = () => {
    if (process.platform === 'win32') {
      chatLog.addSystem('Suspend (Ctrl+Z) is not supported on Windows.');
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
    keybindings,
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

  const submitBurst = createSubmitBurstCoalescer({
    submit: submitCore,
    enabled: shouldEnableWindowsGitBashPasteFallback(),
  });
  editor.onSubmit = submitBurst;

  const flushFollowUpQueue = () => {
    if (state.exitRequested) return;
    if (state.activeRunId) return;
    const next = state.messageFollowUpQueue.shift();
    if (next === undefined) return;
    sendMessage(next);
  };

  const isAgentBusy = () =>
    state.activeRunId != null || busyStates.has(state.activityStatus);

  const handleFollowUp = () => {
    const text = editor.getText().trim();
    if (!text) return;
    if (isAgentBusy()) {
      editor.addToHistory(text);
      state.messageFollowUpQueue.push(text);
      editor.setText('');
      chatLog.addSystem(
        theme.dim(
          `Queued follow-up (${state.messageFollowUpQueue.length} in queue). Next sends when this reply finishes.`,
        ),
      );
      bottomBar.invalidate();
      tui.requestRender();
      return;
    }
    submitBurst(text);
  };

  const handleDequeue = () => {
    if (state.messageFollowUpQueue.length === 0) {
      chatLog.addSystem(theme.dim('No queued messages to restore.'));
      tui.requestRender();
      return;
    }
    const queued = [...state.messageFollowUpQueue];
    state.messageFollowUpQueue.length = 0;
    const current = editor.getText().trim();
    const combined = [queued.join('\n\n'), current].filter(Boolean).join('\n\n');
    editor.setText(combined);
    chatLog.addSystem(
      theme.dim(
        `Restored ${queued.length} queued message${queued.length > 1 ? 's' : ''} to editor.`,
      ),
    );
    bottomBar.invalidate();
    tui.requestRender();
  };

  const setSessionKey = (key: string) => {
    state.currentSessionKey = key;
  };

  const clearChatForSessionSwitch = () => {
    assembler.clear();
    chatLog.clearAll();
    clearPendingToolCallIds();
    state.historyLoaded = false;
    state.messageFollowUpQueue.length = 0;
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

  const setModelChoices = (models: TuiModelChoice[]) => {
    modelChoices = models;
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
    setModelChoices,
  };

  editor.onEscape = () => void abortActive();
  editor.onCtrlD = () => requestExit();

  editor.onAction('app.clear', handleCtrlC);
  editor.onAction('app.exit', () => requestExit());
  editor.onAction('app.suspend', handleCtrlZ);
  editor.onAction('app.thinking.cycle', () => {
    const cur = state.sessionInfo.thinkingLevel ?? opts.thinking ?? 'medium';
    sendMessage(`/think ${nextThinkLevel(cur)}`);
  });
  editor.onAction('app.model.cycleForward', () => cycleModel('forward'));
  editor.onAction('app.model.cycleBackward', () => cycleModel('backward'));
  editor.onAction('app.model.select', () => void openModelPickerOverlay(pickerSvc));
  editor.onAction('app.session.resume', () => void openSessionPickerOverlay(pickerSvc));
  editor.onAction('app.tools.expand', () => {
    state.toolsExpanded = !state.toolsExpanded;
    chatLog.setToolsExpanded(state.toolsExpanded);
    setActivityStatus(state.toolsExpanded ? 'tools expanded' : 'tools collapsed');
    tui.requestRender();
  });
  editor.onAction('app.thinking.toggle', () => {
    state.showThinking = !state.showThinking;
    updateFooter();
    tui.requestRender();
  });
  editor.onAction('app.editor.external', openExternalEditor);
  editor.onPasteImage = () => {
    chatLog.addSystem(
      theme.dim(
        'Clipboard image paste is not implemented in xopc TUI yet. Paste a file path or use the gateway UI.',
      ),
    );
    tui.requestRender();
  };
  editor.onAction('app.message.followUp', handleFollowUp);
  editor.onAction('app.message.dequeue', handleDequeue);

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
    flushFollowUpQueue();
    tui.requestRender();
  }, 5000);

  client.onEvent = (evt: TuiEvent) => {
    const data = (evt.data ?? {}) as Record<string, unknown>;
    dispatchAgentSSE(
      evt.event,
      data,
      state,
      chatLog,
      assembler,
      tui,
      setActivityStatus,
      touchStreamingActivity,
      flushFollowUpQueue,
    );
  };

  client.onConnected = () => {
    state.isConnected = true;
    setConnectionStatus(isLocalMode ? 'local ready' : 'gateway connected');
    touchStreamingActivity();
    void (async () => {
      await refreshSessionInfo();
      await refreshModelChoices();
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
