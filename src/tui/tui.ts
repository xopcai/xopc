import {
  CombinedAutocompleteProvider,
  Container,
  Key,
  Loader,
  matchesKey,
  ProcessTerminal,
  Text,
  TUI,
} from '@mariozechner/pi-tui';

import type { TuiBackend, TuiEvent } from './tui-backend.js';
import { EmbeddedBackend } from './backends/embedded-backend.js';
import { GatewaySseBackend } from './backends/gateway-sse-backend.js';
import { ChatLog } from './components/chat-log.js';
import { CustomEditor } from './components/custom-editor.js';
import { StreamAssembler } from './stream-assembler.js';
import { editorTheme, theme } from './theme.js';
import { createInitialState, type TuiOptions, type TuiResult, type TuiState } from './tui-types.js';

export type { TuiOptions, TuiResult };

// ── Slash commands ──

interface SlashCommandDef {
  name: string;
  description: string;
}

function getSlashCommands(isLocal: boolean): SlashCommandDef[] {
  return [
    { name: 'help', description: 'Show available commands' },
    { name: 'model', description: 'Set or pick model' },
    { name: 'models', description: 'Open model picker' },
    { name: 'session', description: 'Switch session' },
    { name: 'sessions', description: 'List sessions' },
    { name: 'new', description: 'Start a new session' },
    { name: 'reset', description: 'Reset the session' },
    { name: 'abort', description: 'Abort active run' },
    { name: 'thinking', description: 'Toggle thinking display' },
    { name: 'tools', description: 'Toggle tools expanded/collapsed' },
    ...(isLocal ? [] : [{ name: 'status', description: 'Show connection status' }]),
    { name: 'exit', description: 'Exit the TUI' },
    { name: 'quit', description: 'Exit the TUI' },
  ];
}

function helpText(isLocal: boolean): string {
  return ['Slash commands:', ...getSlashCommands(isLocal).map((c) => `  /${c.name} — ${c.description}`)].join('\n');
}

// ── Ctrl+C handling ──

type CtrlCAction = 'clear' | 'warn' | 'exit';

function resolveCtrlCAction(hasInput: boolean, now: number, lastCtrlCAt: number): { action: CtrlCAction; nextLastCtrlCAt: number } {
  if (hasInput) return { action: 'clear', nextLastCtrlCAt: now };
  if (now - lastCtrlCAt <= 1000) return { action: 'exit', nextLastCtrlCAt: lastCtrlCAt };
  return { action: 'warn', nextLastCtrlCAt: now };
}

// ── SSE event dispatch ──

// Track tool_start → tool_end matching when backend omits toolCallId.
// Uses a per-toolName stack so concurrent tools of the same name still pair correctly.
const pendingToolCallIds = new Map<string, string[]>();

function dispatchAgentSSE(
  event: string,
  data: Record<string, unknown>,
  state: TuiState,
  chatLog: ChatLog,
  assembler: StreamAssembler,
  tui: TUI,
  setActivityStatus: (status: string) => void,
): void {
  const runId = state.activeRunId ?? 'default';

  switch (event) {
    case 'status': {
      const newRunId = typeof data.runId === 'string' ? data.runId : runId;
      state.activeRunId = newRunId;
      setActivityStatus('waiting');
      break;
    }
    case 'token': {
      const content =
        typeof data.content === 'string'
          ? data.content
          : typeof data.delta === 'string'
            ? data.delta
            : typeof data.text === 'string'
              ? data.text
              : '';
      if (!content) break;
      setActivityStatus('streaming');
      const display = assembler.ingestToken(runId, content, state.showThinking);
      if (display !== null) {
        chatLog.updateAssistant(display, runId);
        tui.requestRender();
      }
      break;
    }
    case 'thinking': {
      const thinkContent = String(data.content ?? '');
      const isDelta = Boolean(data.delta);
      if (data.status === 'started') break;
      setActivityStatus('streaming');
      const display = assembler.ingestThinking(runId, thinkContent, isDelta, state.showThinking);
      if (display !== null) {
        chatLog.updateAssistant(display, runId);
        tui.requestRender();
      }
      break;
    }
    case 'thinking_end':
    case 'message_end':
      break;
    case 'tool_start': {
      const toolName = String(data.toolName ?? 'unknown');
      const toolCallId = String(data.toolCallId || crypto.randomUUID());
      // Push onto the pending stack so tool_end can find this id by toolName
      const stack = pendingToolCallIds.get(toolName) ?? [];
      stack.push(toolCallId);
      pendingToolCallIds.set(toolName, stack);
      setActivityStatus('running');
      chatLog.startTool(toolCallId, toolName, data.args);
      tui.requestRender();
      break;
    }
    case 'tool_end': {
      const toolName = String(data.toolName ?? '');
      // Resolve toolCallId: prefer explicit value, then pop from pending stack by toolName
      let toolCallId = typeof data.toolCallId === 'string' && data.toolCallId ? data.toolCallId : '';
      if (!toolCallId && toolName) {
        const stack = pendingToolCallIds.get(toolName);
        if (stack && stack.length > 0) {
          toolCallId = stack.shift()!;
          if (stack.length === 0) pendingToolCallIds.delete(toolName);
        }
      }
      const resultText = String(data.result ?? '');
      const isError = Boolean(data.isError);
      if (toolCallId) {
        chatLog.updateToolResult(toolCallId, resultText, isError);
      }
      setActivityStatus('streaming');
      tui.requestRender();
      break;
    }
    case 'error': {
      const errorContent = String(data.content ?? 'Unknown error');
      const finalText = assembler.finalize(runId, state.showThinking);
      if (finalText) {
        chatLog.finalizeAssistant(finalText, runId);
      }
      chatLog.addSystem(`❌ ${errorContent}`);
      state.activeRunId = null;
      setActivityStatus('idle');
      tui.requestRender();
      break;
    }
    case 'result': {
      const finalText = assembler.finalize(runId, state.showThinking);
      if (finalText) {
        chatLog.finalizeAssistant(finalText, runId);
      }
      state.activeRunId = null;
      setActivityStatus('idle');
      tui.requestRender();
      break;
    }
    case 'progress': {
      setActivityStatus('running');
      break;
    }
    default:
      break;
  }
}

// ── Main entry ──

export async function runTui(opts: TuiOptions): Promise<TuiResult> {
  // Suppress pino JSON logs from polluting the terminal while pi-tui owns the screen.
  // We intercept stdout/stderr writes and swallow anything that looks like a JSON log line.
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let suppressLogs = true;

  const logFilter = (
    original: typeof process.stdout.write,
  ): typeof process.stdout.write => {
    return function filteredWrite(chunk: unknown, ...rest: unknown[]): boolean {
      if (!suppressLogs) return (original as Function)(chunk, ...rest) as boolean;
      const text = typeof chunk === 'string' ? chunk : chunk instanceof Buffer ? chunk.toString() : '';
      if (text.startsWith('{"level":')) return true; // swallow JSON log lines
      return (original as Function)(chunk, ...rest) as boolean;
    } as typeof process.stdout.write;
  };

  process.stdout.write = logFilter(originalStdoutWrite);
  process.stderr.write = logFilter(originalStderrWrite);

  const restoreStdio = () => {
    suppressLogs = false;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  };

  const isLocalMode = opts.local === true;
  const sessionKey = opts.session ?? 'cli:tui';
  const state = createInitialState(sessionKey);
  const assembler = new StreamAssembler();

  // Create backend
  const client: TuiBackend = isLocalMode
    ? new EmbeddedBackend()
    : new GatewaySseBackend({ url: opts.url ?? 'http://localhost:3120', token: opts.token });

  // Build UI tree
  const tui = new TUI(new ProcessTerminal());
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

  // Slash command autocomplete
  const slashCommands = getSlashCommands(isLocalMode);
  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(
      slashCommands.map((c) => ({ name: c.name, description: c.description })),
      process.cwd(),
    ),
  );

  // Status management
  let statusText: Text | null = null;
  let statusLoader: Loader | null = null;
  let statusStartedAt: number | null = null;
  let lastActivityStatus = '';
  let elapsedTimerId: ReturnType<typeof setInterval> | null = null;
  const busyStates = new Set(['sending', 'waiting', 'streaming', 'running']);

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
      // Show loader
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
      // Tick every second to update elapsed time display
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
    const tokens = state.sessionInfo.totalTokens != null
      ? `${state.sessionInfo.totalTokens} tokens`
      : '';
    const thinking = state.showThinking ? 'thinking:on' : '';
    const parts = [
      `session ${state.currentSessionKey}`,
      modelLabel,
      thinking,
      tokens,
    ].filter(Boolean);
    footer.setText(theme.dim(parts.join(' | ')));
  };

  // Load session info from backend
  const refreshSessionInfo = async () => {
    try {
      state.sessionInfo = await client.getSessionInfo(state.currentSessionKey);
      updateFooter();
      tui.requestRender();
    } catch {
      // Ignore errors silently
    }
  };

  // Send message (fire-and-forget so the TUI event loop stays responsive)
  const sendMessage = (text: string) => {
    if (state.activeRunId) {
      chatLog.addSystem('A response is still in progress. Use /abort or press Escape to cancel.');
      tui.requestRender();
      return;
    }

    chatLog.addUser(text);
    setActivityStatus('sending');
    tui.requestRender();

    // Run in background — events arrive via client.onEvent callback
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

  // Abort active run
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

  // Handle slash commands
  const handleCommand = async (input: string) => {
    const trimmed = input.replace(/^\//, '').trim();
    const [commandName, ...rest] = trimmed.split(/\s+/);
    const args = rest.join(' ').trim();
    const normalizedCommand = (commandName ?? '').toLowerCase();

    switch (normalizedCommand) {
      case 'help':
        chatLog.addSystem(helpText(isLocalMode));
        break;
      case 'exit':
      case 'quit':
        requestExit();
        return;
      case 'abort':
        await abortActive();
        chatLog.addSystem('Aborted.');
        break;
      case 'new':
      case 'reset':
        await abortActive();
        assembler.clear();
        chatLog.clearAll();
        await client.resetSession(state.currentSessionKey);
        chatLog.addSystem('Session reset.');
        await refreshSessionInfo();
        break;
      case 'model':
      case 'models':
        if (args) {
          await client.patchSession(state.currentSessionKey, { model: args });
          chatLog.addSystem(`Model set to ${args}`);
          await refreshSessionInfo();
        } else {
          try {
            const models = await client.listModels();
            if (models.length === 0) {
              chatLog.addSystem('No models available.');
            } else {
              const list = models.map((m) => `  ${m.provider}/${m.id}`).join('\n');
              chatLog.addSystem(`Available models:\n${list}\n\nUse /model <provider/id> to set.`);
            }
          } catch {
            chatLog.addSystem('Failed to list models.');
          }
        }
        break;
      case 'session':
      case 'sessions': {
        if (args) {
          state.currentSessionKey = args;
          assembler.clear();
          chatLog.clearAll();
          chatLog.addSystem(`Switched to session: ${args}`);
          updateHeader();
          await refreshSessionInfo();
        } else {
          try {
            const sessions = await client.listSessions();
            if (sessions.length === 0) {
              chatLog.addSystem('No sessions found.');
            } else {
              const list = sessions
                .map((s) => {
                  const label = s.displayName ? ` (${s.displayName})` : '';
                  return `  ${s.key}${label}`;
                })
                .join('\n');
              chatLog.addSystem(`Sessions:\n${list}\n\nUse /session <key> to switch.`);
            }
          } catch {
            chatLog.addSystem('Failed to list sessions.');
          }
        }
        break;
      }
      case 'thinking':
        state.showThinking = !state.showThinking;
        chatLog.addSystem(`Thinking display: ${state.showThinking ? 'on' : 'off'}`);
        updateFooter();
        break;
      case 'tools':
        state.toolsExpanded = !state.toolsExpanded;
        chatLog.setToolsExpanded(state.toolsExpanded);
        chatLog.addSystem(`Tools: ${state.toolsExpanded ? 'expanded' : 'collapsed'}`);
        break;
      case 'status':
        chatLog.addSystem(`Connection: ${state.connectionStatus}\nActivity: ${state.activityStatus}`);
        break;
      default:
        chatLog.addSystem(`Unknown command: /${normalizedCommand}. Use /help for available commands.`);
    }
    tui.requestRender();
  };

  // Editor submit
  editor.onSubmit = (text: string) => {
    const value = text.trim();
    editor.setText('');
    if (!value) return;
    editor.addToHistory(value);
    if (value.startsWith('/')) {
      void handleCommand(value);
    } else {
      void sendMessage(value);
    }
  };

  // Keyboard shortcuts
  editor.onEscape = () => void abortActive();
  editor.onCtrlD = () => requestExit();
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
    const decision = resolveCtrlCAction(
      editor.getText().trim().length > 0,
      now,
      state.lastCtrlCAt,
    );
    state.lastCtrlCAt = decision.nextLastCtrlCAt;
    if (decision.action === 'clear') {
      editor.setText('');
      setActivityStatus('cleared input; press ctrl+c again to exit');
      tui.requestRender();
    } else if (decision.action === 'exit') {
      requestExit();
    } else {
      setActivityStatus('press ctrl+c again to exit');
      tui.requestRender();
    }
  };
  editor.onCtrlC = handleCtrlC;

  // Exit
  let finishTui: (() => void) | null = null;
  let exitResult: TuiResult = { exitReason: 'exit' };

  const requestExit = () => {
    if (state.exitRequested) return;
    state.exitRequested = true;
    if (elapsedTimerId) {
      clearInterval(elapsedTimerId);
      elapsedTimerId = null;
    }
    client.stop();
    try {
      tui.stop();
    } catch {
      // Ignore terminal cleanup errors
    }
    restoreStdio();
    finishTui?.();
  };

  // Wire backend events
  client.onEvent = (evt: TuiEvent) => {
    const data = (evt.data ?? {}) as Record<string, unknown>;
    dispatchAgentSSE(evt.event, data, state, chatLog, assembler, tui, setActivityStatus);
  };

  client.onConnected = () => {
    state.isConnected = true;
    setConnectionStatus(isLocalMode ? 'local ready' : 'gateway connected');
    void (async () => {
      await refreshSessionInfo();
      updateHeader();
      updateFooter();
      tui.requestRender();
      // Auto-send message if provided
      if (!state.autoMessageSent && opts.message) {
        state.autoMessageSent = true;
        sendMessage(opts.message);
      }
    })();
  };

  client.onDisconnected = (reason: string) => {
    const wasConnected = state.isConnected;
    state.isConnected = false;
    if (isLocalMode) {
      setConnectionStatus(`local stopped: ${reason}`);
    } else {
      setConnectionStatus(`disconnected: ${reason}`);
      if (!wasConnected && !state.historyLoaded) {
        const gatewayUrl = opts.url ?? 'http://localhost:3120';
        chatLog.addSystem(
          `Cannot reach gateway at ${gatewayUrl}.\n` +
          'Make sure the gateway is running (xopc gateway), or use --local for embedded mode.',
        );
      }
    }
    tui.requestRender();
  };

  // Signal handlers
  const sigintHandler = () => handleCtrlC();
  const sigtermHandler = () => requestExit();
  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);

  // Boot
  updateHeader();
  setConnectionStatus(isLocalMode ? 'starting local runtime' : 'connecting');
  updateFooter();
  tui.start();
  client.start();

  // Wait for exit
  await new Promise<void>((resolve) => {
    finishTui = () => {
      process.removeListener('SIGINT', sigintHandler);
      process.removeListener('SIGTERM', sigtermHandler);
      finishTui = null;
      resolve();
    };
  });

  return exitResult;
}
