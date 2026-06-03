import type { KeybindingsManager, TUI } from '@earendil-works/pi-tui';

import type { ChatLog } from './components/chat-log.js';
import { formatXopcTuiHotkeys } from './format-tui-hotkeys.js';
import { getTuiKeybindingsPath } from './tui-keybindings-file.js';
import type { StreamAssembler } from './stream-assembler.js';
import type { TuiState } from './tui-types.js';

import { rewriteUnknownSlashAsWorkflow } from './tui-workflow-slash.js';

interface SlashCommandDef {
  name: string;
  description: string;
}

export type TuiExtensionSlashCommandEntry = SlashCommandDef & {
  handler: (args: string) => void | Promise<void>;
};

export function getSlashCommands(_isLocal: boolean): SlashCommandDef[] {
  return [
    { name: 'help', description: 'Show available commands' },
    { name: 'abort', description: 'Abort active run (or press Escape)' },
    { name: 'tools', description: 'Toggle tool output expanded/collapsed (or Ctrl+O)' },
    { name: 'thinking', description: 'Toggle thinking display (or Ctrl+T)' },
    { name: 'exit', description: 'Exit the TUI' },
    { name: 'models', description: 'List available models' },
    { name: 'switch', description: 'Switch model — copy `provider/model` from /models' },
    { name: 'usage', description: 'Show token usage statistics' },
    { name: 'new', description: 'Start a new session' },
    { name: 'clear', description: 'Clear current session' },
    { name: 'list', description: 'List sessions' },
    { name: 'resume', description: 'Open session picker (or Ctrl+Shift+P)' },
    { name: 'scoped-models', description: 'Choose models for Ctrl+P cycling' },
    { name: 'compact', description: 'Compact session history (local API)' },
    { name: 'think', description: 'Set thinking level (e.g. /think high)' },
    { name: 'reasoning', description: 'Set reasoning visibility (e.g. /reasoning stream)' },
    { name: 'verbose', description: 'Toggle verbose mode' },
    { name: 'status', description: 'Show agent status' },
    { name: 'config', description: 'Show or update configuration' },
    { name: 'context', description: 'Show context budget' },
    { name: 'btw', description: 'Side question without saving to session' },
    { name: 'export', description: 'Export session (markdown/html/json)' },
    { name: 'settings', description: 'Open TUI settings overlay' },
    { name: 'reload-keybindings', description: 'Reload ~/.xopc/keybindings.json' },
    { name: 'start', description: 'Show welcome message' },
    { name: 'hotkeys', description: 'Show resolved keyboard shortcuts (pi-style)' },
    { name: 'workflows', description: 'List saved workflows (built-in + ~/.xopc/workflows/)' },
    { name: 'workflow', description: 'Workflow subcommands: list, view <name>, save <name>' },
  ];
}

export function formatTuiHelpText(isLocal: boolean): string {
  const commands = getSlashCommands(isLocal);
  const lines = ['Available commands:'];
  for (const c of commands) {
    lines.push(`  /${c.name} — ${c.description}`);
  }
  lines.push('', 'Keyboard shortcuts (defaults align with pi coding-agent where noted):');
  lines.push('  Escape — Abort active run');
  lines.push('  Shift+Tab — Cycle /think level');
  lines.push('  Ctrl+P / Shift+Ctrl+P — Next / previous model (/switch)');
  lines.push('  Ctrl+L — Model picker');
  lines.push('  Ctrl+Shift+P — Session picker (rename/delete)');
  lines.push('  /scoped-models — Limit Ctrl+P model cycle set');
  lines.push('  Ctrl+O — Toggle tool output');
  lines.push('  Ctrl+T — Toggle thinking block display');
  lines.push('  Ctrl+G — Edit draft in $EDITOR');
  lines.push('  Ctrl+Z — Suspend to shell (Unix)');
  lines.push('  Alt+Enter — Queue follow-up while busy (sends when this reply finishes)');
  lines.push('  Alt+Up — Restore queued follow-up messages to editor');
  lines.push('  Enter (while busy) — Steer: inject at next tool boundary');
  lines.push('  Ctrl+V (mac/Linux) / Alt+V (Win) — Paste image from clipboard');
  lines.push('  /settings — Theme, thinking display, terminal progress, …');
  lines.push('  ~/.xopc/keybindings.json — Custom shortcuts (use /reload-keybindings)');
  lines.push('  Ctrl+C — Clear input; repeat within ~0.5s to exit when empty');
  lines.push('  Ctrl+D — Exit when input empty');
  lines.push('  !cmd — Local shell (gated; runs on this machine)');
  lines.push('', 'Use /hotkeys for the resolved binding list from the active keymap.');
  return lines.join('\n');
}

export type CommandHandlerDeps = {
  state: TuiState;
  chatLog: ChatLog;
  tui: TUI;
  assembler: StreamAssembler;
  isLocalMode: boolean;
  abortActive: () => Promise<void>;
  sendMessage: (text: string) => void;
  requestExit: () => void;
  updateFooter: () => void;
  keybindings: KeybindingsManager;
  uiOverlays?: {
    openSessionPicker: () => void;
    openScopedModels: () => void;
    openSettings: () => void;
    reloadKeybindings: () => void;
  };
  runCompaction?: () => void | Promise<void>;
  extensionSlashCommands?: TuiExtensionSlashCommandEntry[];
};

export function createTuiCommandHandler(deps: CommandHandlerDeps): (input: string) => void {
  const {
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
    uiOverlays,
    extensionSlashCommands = [],
  } = deps;

  return (input: string) => {
    const trimmed = input.replace(/^\//, '').trim();
    const [commandName, ...restParts] = trimmed.split(/\s+/);
    const normalizedCommand = (commandName ?? '').toLowerCase();
    const commandArgs = restParts.join(' ');

    const extensionCmd = extensionSlashCommands.find((c) => c.name === normalizedCommand);
    if (extensionCmd) {
      void Promise.resolve(extensionCmd.handler(commandArgs)).then(() => {
        tui.requestRender();
      });
      return;
    }

    switch (normalizedCommand) {
      case 'help':
        chatLog.addSystem(formatTuiHelpText(isLocalMode));
        tui.requestRender();
        return;
      case 'hotkeys':
      case 'keys':
        chatLog.addSystem(formatXopcTuiHotkeys(keybindings));
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
      case 'resume':
      case 'sessions':
        uiOverlays?.openSessionPicker();
        return;
      case 'scoped-models':
      case 'scopedmodels':
        uiOverlays?.openScopedModels();
        return;
      case 'settings':
        uiOverlays?.openSettings();
        return;
      case 'reload-keybindings':
      case 'reload-keybind':
        uiOverlays?.reloadKeybindings();
        chatLog.addSystem(`Keybindings reloaded from ${getTuiKeybindingsPath()}`);
        tui.requestRender();
        return;
      case 'compact':
        void deps.runCompaction?.();
        return;
      default:
        break;
    }

    switch (normalizedCommand) {
      case 'new':
      case 'reset':
      case 'restart':
      case 'clear': {
        void abortActive().then(() => {
          assembler.clear();
          chatLog.clearAll();
          state.messageFollowUpQueue.length = 0;
          tui.requestRender();
          sendMessage(input);
        });
        return;
      }
      default:
        break;
    }

    // Unknown slash that names a known workflow → rewrite into a natural prompt
    // so the assistant deterministically calls workflow({name}) instead of
    // depending on the model to puzzle out "/audit_repo".
    if (input.trimStart().startsWith('/')) {
      const rewritten = rewriteUnknownSlashAsWorkflow(normalizedCommand, commandArgs);
      if (rewritten) {
        chatLog.addSystem(`▶ Running workflow: ${normalizedCommand}`);
        tui.requestRender();
        sendMessage(rewritten);
        return;
      }
    }

    sendMessage(input);
  };
}
