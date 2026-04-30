import {
  CombinedAutocompleteProvider,
  Container,
  getKeybindings,
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

function getSlashCommands(_isLocal: boolean): SlashCommandDef[] {
  return [
    // TUI-local commands
    { name: 'help', description: 'Show available commands' },
    { name: 'abort', description: 'Abort active run (or press Escape)' },
    { name: 'tools', description: 'Toggle tool output expanded/collapsed (or Ctrl+O)' },
    { name: 'thinking', description: 'Toggle thinking display (or Ctrl+T)' },
    { name: 'exit', description: 'Exit the TUI' },
    // Backend-delegated commands (handled by chat-command system)
    { name: 'models', description: 'List available models' },
    { name: 'switch', description: 'Switch model (e.g. /switch openai/gpt-4o)' },
    { name: 'usage', description: 'Show token usage statistics' },
    { name: 'new', description: 'Start a new session' },
    { name: 'clear', description: 'Clear current session' },
    { name: 'list', description: 'List sessions' },
    { name: 'compact', description: 'Compact session history' },
    { name: 'think', description: 'Set thinking level (e.g. /think high)' },
    { name: 'reasoning', description: 'Set reasoning visibility (e.g. /reasoning stream)' },
    { name: 'verbose', description: 'Toggle verbose mode' },
    { name: 'status', description: 'Show agent status' },
    { name: 'config', description: 'Show or update configuration' },
    { name: 'context', description: 'Show context budget' },
    { name: 'btw', description: 'Side question without saving to session' },
    { name: 'export', description: 'Export session (markdown/html/json)' },
    { name: 'settings', description: 'Show current settings' },
    { name: 'start', description: 'Show welcome message' },
  ];
}

function helpText(isLocal: boolean): string {
  const commands = getSlashCommands(isLocal);
  const lines = ['Available commands:'];
  for (const c of commands) {
    lines.push(`  /${c.name} — ${c.description}`);
  }
  lines.push('', 'Keyboard shortcuts:');
  lines.push('  Escape — Abort active run');
  lines.push('  Ctrl+O — Toggle tool output');
  lines.push('  Ctrl+T — Toggle thinking display');
  lines.push('  Ctrl+C — Clear line, abort ongoing reply when line empty, or exit when idle');
  lines.push('  Ctrl+D — Exit');
  return lines.join('\n');
}

function matchesCtrlCSequence(data: string): boolean {
  const kb = getKeybindings();
  return matchesKey(data, Key.ctrl('c')) || kb.matches(data, 'tui.input.copy');
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
      chatLog.startTool(toolCallId, toolName, data.args, runId);
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

function isLikelyPinoJsonLogLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(t) as { level?: unknown };
    return typeof parsed.level === 'number';
  } catch {
    return false;
  }
}

// ── Main entry ──

export async function runTui(opts: TuiOptions): Promise<TuiResult> {
  // Suppress pino JSON logs from polluting the terminal while pi-tui owns the screen.
  // Buffer by newline so key order differs from '{"level":' or writes are chunked.
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let suppressLogs = true;

  /** Shared mutable buffers so incomplete log lines survive across write() chunks. */
  const stdoutBuf = { s: '' };
  const stderrBuf = { s: '' };

  const installBufferedLogFilter = (
    original: typeof process.stdout.write,
    buf: { s: string },
  ): typeof process.stdout.write =>
    function filteredWrite(chunk: unknown, ...rest: unknown[]): boolean {
      if (!suppressLogs) {
        const extra = typeof chunk === 'string' ? chunk : chunk instanceof Buffer ? chunk.toString() : '';
        const combined = buf.s ? buf.s + extra : extra;
        buf.s = '';
        return combined.length > 0
          ? ((original as Function)(combined, ...rest) as boolean)
          : true;
      }
      const text = typeof chunk === 'string' ? chunk : chunk instanceof Buffer ? chunk.toString() : '';
      buf.s += text;
      let emit = '';
      while (true) {
        const idx = buf.s.indexOf('\n');
        if (idx === -1) break;
        const line = buf.s.slice(0, idx);
        buf.s = buf.s.slice(idx + 1);
        if (!isLikelyPinoJsonLogLine(line)) {
          emit += `${line}\n`;
        }
      }
      return emit.length > 0 ? ((original as Function)(emit, ...rest) as boolean) : true;
    } as typeof process.stdout.write;

  process.stdout.write = installBufferedLogFilter(originalStdoutWrite, stdoutBuf);
  process.stderr.write = installBufferedLogFilter(originalStderrWrite, stderrBuf);

  const restoreStdio = () => {
    suppressLogs = false;
    const flushRemainder = (buf: { s: string }, orig: typeof process.stdout.write): void => {
      const rest = buf.s.trimEnd();
      buf.s = '';
      if (!rest.length) return;
      if (!isLikelyPinoJsonLogLine(rest)) {
        orig(`${rest}\n`);
      }
    };
    flushRemainder(stdoutBuf, originalStdoutWrite);
    flushRemainder(stderrBuf, originalStderrWrite);
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

  // Handle slash commands.
  // TUI-local commands are processed here; everything else is delegated to the
  // backend's chat-command system via sendMessage (processDirectStreaming handles
  // the commandRegistry lookup and returns results as SSE token events).
  const handleCommand = (input: string) => {
    const trimmed = input.replace(/^\//, '').trim();
    const [commandName] = trimmed.split(/\s+/);
    const normalizedCommand = (commandName ?? '').toLowerCase();

    // TUI-local commands (never sent to backend)
    switch (normalizedCommand) {
      case 'help':
        chatLog.addSystem(helpText(isLocalMode));
        tui.requestRender();
        return;
      case 'exit':
      case 'quit':
        requestExit();
        return;
      case 'abort':
      case 'stop':
      case 'cancel':
        void abortActive().then(() => {
          chatLog.addSystem('Aborted.');
          tui.requestRender();
        });
        return;
      case 'tools':
        state.toolsExpanded = !state.toolsExpanded;
        chatLog.setToolsExpanded(state.toolsExpanded);
        chatLog.addSystem(`Tools: ${state.toolsExpanded ? 'expanded' : 'collapsed'}`);
        tui.requestRender();
        return;
      case 'thinking':
        state.showThinking = !state.showThinking;
        chatLog.addSystem(`Thinking display: ${state.showThinking ? 'on' : 'off'}`);
        updateFooter();
        tui.requestRender();
        return;
      default:
        break;
    }

    // Commands that need TUI-side state cleanup before delegating to backend
    switch (normalizedCommand) {
      case 'new':
      case 'reset':
      case 'restart':
      case 'clear': {
        void abortActive().then(() => {
          assembler.clear();
          chatLog.clearAll();
          tui.requestRender();
          // Delegate to backend so session store is actually cleared/reset
          sendMessage(input);
        });
        return;
      }
      default:
        break;
    }

    // Everything else is delegated to the backend chat-command system — send the
    // raw slash command so processDirectStreaming's commandRegistry handles it.
    sendMessage(input);
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
    if (editor.getText().trim().length > 0) {
      editor.setText('');
      setActivityStatus('cleared input');
      tui.requestRender();
      return;
    }
    if (state.activeRunId) {
      void abortActive().then(() => {
        chatLog.addSystem('Aborted.');
        tui.requestRender();
      });
      return;
    }
    requestExit();
  };
  editor.onCtrlC = handleCtrlC;

  // Raw TTY often does not deliver SIGINT for Ctrl+C; pi-tui README recommends a global listener
  // so exit works even when focus or key encoding would otherwise drop the keystroke.
  tui.addInputListener((data) => {
    if (!matchesCtrlCSequence(data)) return undefined;
    handleCtrlC();
    return { consume: true };
  });

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
