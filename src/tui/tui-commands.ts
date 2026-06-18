import { randomUUID } from 'node:crypto';

import type { KeybindingsManager, TUI } from '@earendil-works/pi-tui';

import type {
  TuiCompactionResult,
  TuiModelChoice,
  TuiShareRequest,
  TuiSessionStats,
  TuiSessionItem,
  TuiTranscriptTreeEntry,
} from './tui-backend.js';
import type { ChatLog } from './components/chat-log.js';
import {
  formatKeyIds,
  formatXopcTuiHotkeys,
  type TuiHotkeyExtensionShortcut,
} from './format-tui-hotkeys.js';
import { getTuiKeybindingsPath } from './tui-keybindings-file.js';
import type { StreamAssembler } from './stream-assembler.js';
import type { TuiState } from './tui-types.js';
import { createWorkflowCatalog } from '../agent/workflow/catalog.js';
import {
  normalizeReasoningLevel,
  normalizeThinkLevel,
  normalizeVerboseLevel,
  type ReasoningLevel,
  type ThinkLevel,
  type VerboseLevel,
} from '../agent/transcript/thinking-types.js';
import {
  getAuthStorePath,
  listAllProfiles as listAllAuthProfiles,
  listProfilesForProvider,
  removeAuthProfile,
  type AuthProfileEntry,
} from '../auth/profiles/index.js';
import { loadConfig, resolveConfigPath } from '../config/index.js';
import type { TuiSlashCommandContext, TuiSlashCommandHandler } from '../extensions/types/tui.js';
import { provenanceTracker } from '../extensions/security.js';
import type { ProjectTrustStoreEntry } from '../project-trust/trust-store.js';
import { providerSupportsOAuth } from '../providers/index.js';

import { rewriteUnknownSlashAsWorkflow } from './tui-workflow-slash.js';

interface SlashCommandDef {
  name: string;
  originalName?: string;
  description: string;
}

export type TuiExtensionSlashCommandEntry = SlashCommandDef & {
  handler: TuiSlashCommandHandler;
  getContext?: () => TuiSlashCommandContext;
};

function keyLabel(
  keybindings: KeybindingsManager | undefined,
  id: Parameters<KeybindingsManager['getKeys']>[0],
  fallback: string,
): string {
  return keybindings ? formatKeyIds(keybindings, id, { capitalize: true }) : fallback;
}

export function getSlashCommands(
  _isLocal: boolean,
  keybindings?: KeybindingsManager,
): SlashCommandDef[] {
  const abortKey = keyLabel(keybindings, 'app.interrupt', 'Escape');
  const toolsKey = keyLabel(keybindings, 'app.tools.expand', 'Ctrl+O');
  const thinkingKey = keyLabel(keybindings, 'app.thinking.toggle', 'Ctrl+T');
  const sessionKey = keyLabel(keybindings, 'app.session.resume', 'Ctrl+Shift+P');
  const modelCycleKey = keyLabel(keybindings, 'app.model.cycleForward', 'Ctrl+P');
  return [
    { name: 'help', description: 'Show available commands' },
    { name: 'abort', description: `Abort active run (or press ${abortKey})` },
    { name: 'recover', description: 'Reload history and reattach to a stalled run' },
    { name: 'retry', description: 'Abort current run if needed and resend the last user message' },
    { name: 'tools', description: `Toggle tool output expanded/collapsed (or ${toolsKey})` },
    { name: 'thinking', description: `Toggle thinking display (or ${thinkingKey})` },
    { name: 'copy', description: 'Copy last assistant message to clipboard' },
    { name: 'exit', description: 'Exit the TUI' },
    { name: 'quit', description: 'Quit the TUI' },
    { name: 'model', description: 'Open model picker (optional search text)' },
    { name: 'models', description: 'List available models' },
    { name: 'switch', description: 'Switch model — copy `provider/model` from /models' },
    { name: 'login', description: 'Login to an OAuth provider' },
    { name: 'logout', description: 'Remove stored provider auth profiles' },
    { name: 'usage', description: 'Show token usage statistics' },
    { name: 'session', description: 'Show current session info' },
    { name: 'new', description: 'Start a new isolated TUI session (tui-{uuid})' },
    { name: 'fork', description: 'Fork current session transcript into a new session' },
    { name: 'clone', description: 'Duplicate current session transcript into a new session' },
    { name: 'trust', description: 'Manage project trust and show extension security policy' },
    { name: 'name', description: 'Show or set current session display name' },
    { name: 'reset', description: 'Reset current session transcript and reload history' },
    { name: 'clear', description: 'Alias for /reset' },
    { name: 'list', description: 'List sessions' },
    { name: 'resume', description: `Open session picker (or ${sessionKey})` },
    { name: 'tree', description: 'Show grouped session tree' },
    { name: 'scoped-models', description: `Choose models for ${modelCycleKey} cycling` },
    { name: 'compact', description: 'Compact session history (local API)' },
    { name: 'think', description: 'Set thinking level (e.g. /think high)' },
    { name: 'reasoning', description: 'Set reasoning visibility (e.g. /reasoning stream)' },
    { name: 'verbose', description: 'Toggle verbose mode' },
    { name: 'status', description: 'Show agent status' },
    { name: 'config', description: 'Show or update configuration' },
    { name: 'context', description: 'Show context budget' },
    { name: 'btw', description: 'Side question without saving to session' },
    { name: 'export', description: 'Export session (markdown/html/json)' },
    { name: 'import', description: 'Import an xopc JSON session export' },
    { name: 'share', description: 'Create a share link for a workspace file/folder/site' },
    { name: 'settings', description: 'Open TUI settings overlay' },
    { name: 'reload', description: 'Reload keybindings, TUI settings, theme, and extension UI' },
    { name: 'reload-keybindings', description: `Reload ${getTuiKeybindingsPath()}` },
    { name: 'start', description: 'Show welcome message' },
    { name: 'hotkeys', description: 'Show resolved keyboard shortcuts (pi-style)' },
    { name: 'changelog', description: 'Show version history' },
    { name: 'workflows', description: 'List saved workflows (built-in + ~/.xopc/workflows/)' },
    { name: 'workflow', description: 'Workflow subcommands: list, view <name>, save <name>' },
  ];
}

function formatExtraSlashCommands(commands: SlashCommandDef[]): string[] {
  const seen = new Set(getSlashCommands(true).map((command) => command.name));
  const lines: string[] = [];
  for (const command of commands) {
    const name = command.name.replace(/^\//, '').trim().toLowerCase();
    const originalName = command.originalName?.replace(/^\//, '').trim().toLowerCase();
    if (!name || seen.has(name) || (originalName && seen.has(originalName))) continue;
    seen.add(name);
    lines.push(`  /${name} — ${command.description}`);
  }
  return lines;
}

export function formatTuiHelpText(
  isLocal: boolean,
  keybindings?: KeybindingsManager,
  extraSlashCommands: SlashCommandDef[] = [],
): string {
  const commands = getSlashCommands(isLocal, keybindings);
  const interrupt = keyLabel(keybindings, 'app.interrupt', 'Escape');
  const thinkCycle = keyLabel(keybindings, 'app.thinking.cycle', 'Shift+Tab');
  const modelNext = keyLabel(keybindings, 'app.model.cycleForward', 'Ctrl+P');
  const modelPrev = keyLabel(keybindings, 'app.model.cycleBackward', 'Shift+Ctrl+P');
  const modelPicker = keyLabel(keybindings, 'app.model.select', 'Ctrl+L');
  const sessionPicker = keyLabel(keybindings, 'app.session.resume', 'Ctrl+Shift+P');
  const sessionTree = keyLabel(keybindings, 'app.session.tree', '(not bound)');
  const sessionFork = keyLabel(keybindings, 'app.session.fork', '(not bound)');
  const toolExpand = keyLabel(keybindings, 'app.tools.expand', 'Ctrl+O');
  const thinkingToggle = keyLabel(keybindings, 'app.thinking.toggle', 'Ctrl+T');
  const editorExternal = keyLabel(keybindings, 'app.editor.external', 'Ctrl+G');
  const suspend = keyLabel(keybindings, 'app.suspend', 'Ctrl+Z');
  const followUp = keyLabel(keybindings, 'app.message.followUp', 'Alt+Enter');
  const dequeue = keyLabel(keybindings, 'app.message.dequeue', 'Alt+Up');
  const pasteImage = keyLabel(keybindings, 'app.clipboard.pasteImage', 'Ctrl+V / Alt+V');
  const clearInput = keyLabel(keybindings, 'app.clear', 'Ctrl+C');
  const exit = keyLabel(keybindings, 'app.exit', 'Ctrl+D');
  const lines = ['Available commands:'];
  for (const c of commands) {
    lines.push(`  /${c.name} — ${c.description}`);
  }
  const extraCommandLines = formatExtraSlashCommands(extraSlashCommands);
  if (extraCommandLines.length > 0) {
    lines.push('', 'Extension commands:');
    lines.push(...extraCommandLines);
  }
  lines.push('', 'Keyboard shortcuts (defaults align with pi coding-agent where noted):');
  lines.push(`  ${interrupt} — Abort active run`);
  lines.push(`  ${thinkCycle} — Cycle /think level`);
  lines.push(`  ${modelNext} / ${modelPrev} — Next / previous model (/switch)`);
  lines.push(`  ${modelPicker} — Model picker`);
  lines.push(`  ${sessionPicker} — Session picker (rename/delete)`);
  lines.push(`  ${sessionTree} — Session tree`);
  lines.push(`  ${sessionFork} — Fork current session`);
  lines.push(`  /scoped-models — Limit ${modelNext} model cycle set`);
  lines.push(`  ${toolExpand} — Toggle tool output`);
  lines.push(`  ${thinkingToggle} — Toggle thinking block display`);
  lines.push(`  ${editorExternal} — Edit draft in $EDITOR`);
  lines.push(`  ${suspend} — Suspend to shell (Unix)`);
  lines.push(`  ${followUp} — Queue follow-up while busy (sends when this reply finishes)`);
  lines.push(`  ${dequeue} — Restore queued messages to editor`);
  lines.push('  Enter (while busy) — Steer: inject at next tool boundary');
  lines.push(`  ${pasteImage} — Paste image from clipboard`);
  lines.push('  /settings — Theme, thinking display, terminal progress, …');
  lines.push(`  ${getTuiKeybindingsPath()} — Custom shortcuts (use /reload)`);
  lines.push(`  ${clearInput} — Clear input; repeat within ~0.5s to exit when empty`);
  lines.push(`  ${exit} — Exit when input empty`);
  lines.push('  !cmd — Local shell (gated; runs on this machine)');
  lines.push('', 'Use /hotkeys for the resolved binding list from the active keymap.');
  return lines.join('\n');
}

export function formatTuiStartText(
  state: TuiState,
  isLocal: boolean,
  keybindings?: KeybindingsManager,
): string {
  const lines = [
    'xopc TUI',
    '',
    `Session: ${state.currentSessionKey}`,
    `Mode: ${isLocal ? 'local embedded' : 'gateway'}`,
    `Model: ${formatModelLabel(state)}`,
    '',
    'Useful commands:',
    '  /help — Show all commands and shortcuts',
    '  /resume — Open session picker',
    '  /models — List available models',
    '  /settings — Open TUI settings',
    '  /export — Export current session',
    '',
    'Shortcuts:',
    `  ${keyLabel(keybindings, 'app.interrupt', 'Escape')} — Abort active run`,
    `  ${keyLabel(keybindings, 'app.model.cycleForward', 'Ctrl+P')} — Next model`,
    `  ${keyLabel(keybindings, 'app.session.resume', 'Ctrl+Shift+P')} — Session picker`,
  ];
  return lines.join('\n');
}

import {
  formatModelLabel,
  formatTuiConfigInfo,
  formatTuiContextInfo,
  formatTuiLoginInfo,
  formatTuiModelsInfo,
  formatTuiSessionInfo,
  formatTuiSessionListInfo,
  formatTuiSessionTreeInfo,
  formatTuiStoredAuthProfilesInfo,
  formatTuiTranscriptTreeInfo,
  formatTuiTrustInfo,
  formatTuiUsageInfo,
  formatTuiWorkflowDetail,
  formatTuiWorkflowsInfo,
  loadTuiChangelogInfo,
  nextVerboseLevel,
  parseTuiExportRequest,
  parseTuiImportRequest,
  parseTuiShareRequest,
  writeTuiDebugInfo,
  type TuiExportRequest,
  type TuiImportRequest,
} from './tui-command-formatters.js';

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
    openModelPicker: (initialSearch?: string) => void;
    openSessionPicker: () => void;
    openSessionTree: () => void;
    openTranscriptTree: () => void;
    openUserMessageFork: () => void;
    openScopedModels: () => void;
    openThinkingSelector: () => void;
    openSettings: () => void;
    openProjectTrust: () => void;
    reloadKeybindings: () => void | Promise<void>;
  };
  setThinkingLevel?: (level: ThinkLevel) => void | Promise<void>;
  setReasoningLevel?: (level: ReasoningLevel) => void | Promise<void>;
  setVerboseLevel?: (level: VerboseLevel) => void | Promise<void>;
  copyLastAssistant?: () => void | Promise<void>;
  renameCurrentSession?: (name: string) => void | Promise<void>;
  runCompaction?: (instructions?: string) => void | Promise<void | TuiCompactionResult>;
  listModels?: () => TuiModelChoice[] | Promise<TuiModelChoice[]>;
  switchModel?: (modelRef: string) => void | Promise<void>;
  listSessions?: () => TuiSessionItem[] | Promise<TuiSessionItem[]>;
  getSessionStats?: () => TuiSessionStats | Promise<TuiSessionStats>;
  loadTranscriptTree?: () => TuiTranscriptTreeEntry[] | Promise<TuiTranscriptTreeEntry[]>;
  exportSession?: (request: TuiExportRequest) => void | Promise<void>;
  importSession?: (request: TuiImportRequest) => void | Promise<void>;
  createShare?: (request: TuiShareRequest) => void | Promise<void>;
  authProfiles?: {
    listAll: () => AuthProfileEntry[] | Promise<AuthProfileEntry[]>;
    listProvider: (provider: string) => AuthProfileEntry[] | Promise<AuthProfileEntry[]>;
    remove: (profileId: string) => boolean | Promise<boolean>;
    getStorePath: () => string;
  };
  projectTrust?: {
    cwd: string;
    hasProjectResources: () => boolean;
    getStorePath: () => string;
    getEntry: () => ProjectTrustStoreEntry | null;
    getSessionDecision: () => boolean | null;
  };
  runLogin?: (provider?: string) => void | Promise<void>;
  runBtwQuery?: (question: string) => void | Promise<void>;
  forkSession?: (rawKey?: string) => void | Promise<void>;
  extensionSlashCommands?: TuiExtensionSlashCommandEntry[];
  extensionShortcuts?: TuiHotkeyExtensionShortcut[];
  currentAgentId?: string;
  setSession?: (rawKey: string) => Promise<void>;
  resetSession?: () => Promise<void>;
  recoverStream?: () => void | Promise<void>;
  retryLastMessage?: () => void | Promise<void>;
};

function defaultAuthProfiles(): NonNullable<CommandHandlerDeps['authProfiles']> {
  return {
    listAll: () => listAllAuthProfiles(),
    listProvider: (provider) => listProfilesForProvider(provider),
    remove: (profileId) => removeAuthProfile(profileId),
    getStorePath: () => getAuthStorePath(),
  };
}

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
    extensionShortcuts = [],
    setSession,
    resetSession,
  } = deps;

  const runReset = async () => {
    await abortActive();
    if (resetSession) {
      await resetSession();
      chatLog.addSystem(`session ${state.currentSessionKey} reset`);
    } else {
      assembler.clear();
      chatLog.clearAll();
      state.messageFollowUpQueue.length = 0;
      state.steeringQueue.length = 0;
      chatLog.addSystem('Session cleared (reset not available in this mode).');
    }
    tui.requestRender();
  };

  return (input: string) => {
    const trimmed = input.replace(/^\//, '').trim();
    const [commandName, ...restParts] = trimmed.split(/\s+/);
    const normalizedCommand = (commandName ?? '').toLowerCase();
    const commandArgs = restParts.join(' ');

    switch (normalizedCommand) {
      case 'help':
        chatLog.addSystem(formatTuiHelpText(isLocalMode, keybindings, extensionSlashCommands));
        tui.requestRender();
        return;
      case 'start':
        chatLog.addSystem(formatTuiStartText(state, isLocalMode, keybindings));
        tui.requestRender();
        return;
      case 'hotkeys':
      case 'keys':
        chatLog.addSystem(formatXopcTuiHotkeys(keybindings, extensionShortcuts));
        tui.requestRender();
        return;
      case 'changelog':
        chatLog.addSystem(loadTuiChangelogInfo());
        tui.requestRender();
        return;
      case 'debug':
        try {
          const debugPath = writeTuiDebugInfo({ state, tui });
          chatLog.addSystem(`Debug log written\n${debugPath}`);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          chatLog.addSystem(`Debug log failed: ${errorMessage}`);
        }
        tui.requestRender();
        return;
      case 'session':
      case 'status':
        void Promise.resolve(deps.getSessionStats?.())
          .catch(() => undefined)
          .then((stats) => {
            chatLog.addSystem(formatTuiSessionInfo(state, stats));
            tui.requestRender();
          });
        return;
      case 'usage':
        void Promise.resolve(deps.getSessionStats?.())
          .catch(() => undefined)
          .then((stats) => {
            chatLog.addSystem(formatTuiUsageInfo(state, stats));
            tui.requestRender();
          });
        return;
      case 'context':
        chatLog.addSystem(formatTuiContextInfo(state));
        tui.requestRender();
        return;
      case 'config':
        chatLog.addSystem(formatTuiConfigInfo(state));
        tui.requestRender();
        return;
      case 'trust':
        if (uiOverlays?.openProjectTrust) {
          uiOverlays.openProjectTrust();
          return;
        }
        chatLog.addSystem(
          formatTuiTrustInfo(loadConfig(), {
            configPath: resolveConfigPath(),
            provenance: provenanceTracker.getAll(),
            cwd: deps.projectTrust?.cwd,
            hasProjectResources: deps.projectTrust?.hasProjectResources(),
            projectTrustStorePath: deps.projectTrust?.getStorePath(),
            projectTrustEntry: deps.projectTrust?.getEntry(),
            projectTrustSessionDecision: deps.projectTrust?.getSessionDecision(),
          }),
        );
        tui.requestRender();
        return;
      case 'export':
        if (!deps.exportSession) {
          chatLog.addSystem('Export is not available in this mode.');
          tui.requestRender();
          return;
        }
        void Promise.resolve(deps.exportSession(parseTuiExportRequest(commandArgs))).then(() => {
          tui.requestRender();
        });
        return;
      case 'import':
        if (!deps.importSession) {
          chatLog.addSystem('Import is not available in this mode.');
          tui.requestRender();
          return;
        }
        void Promise.resolve(deps.importSession(parseTuiImportRequest(commandArgs))).then(() => {
          tui.requestRender();
        });
        return;
      case 'share': {
        if (!deps.createShare) {
          chatLog.addSystem('Share is not available in this mode.');
          tui.requestRender();
          return;
        }
        const request = parseTuiShareRequest(commandArgs);
        if (!request) {
          chatLog.addSystem(
            [
              'Usage: /share <workspace-path> [friend|colleague|public] [--site|--zip|--file]',
              'Optional: --title "Title" --description "Description"',
            ].join('\n'),
          );
          tui.requestRender();
          return;
        }
        void Promise.resolve(deps.createShare(request)).then(() => {
          tui.requestRender();
        });
        return;
      }
      case 'btw':
      case 'aside': {
        const question = commandArgs.trim();
        if (!question) {
          chatLog.addSystem(
            'Usage: /btw <question>\nAnswers use the current session as read-only background and are not saved.',
          );
          tui.requestRender();
          return;
        }
        if (!deps.runBtwQuery) {
          chatLog.addSystem('/btw is not available in this mode.');
          tui.requestRender();
          return;
        }
        void Promise.resolve(deps.runBtwQuery(question)).then(() => {
          tui.requestRender();
        });
        return;
      }
      case 'workflows':
        try {
          chatLog.addSystem(formatTuiWorkflowsInfo(createWorkflowCatalog().list()));
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          chatLog.addSystem(`Workflow list failed: ${errorMessage}`);
        }
        tui.requestRender();
        return;
      case 'workflow': {
        const [subcommandRaw, ...workflowRest] = commandArgs.trim().split(/\s+/);
        const subcommand = (subcommandRaw || 'list').toLowerCase();
        if (subcommand === 'list' || subcommand === 'ls') {
          try {
            chatLog.addSystem(formatTuiWorkflowsInfo(createWorkflowCatalog().list()));
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            chatLog.addSystem(`Workflow list failed: ${errorMessage}`);
          }
          tui.requestRender();
          return;
        }
        if (subcommand === 'view' || subcommand === 'show') {
          const name = workflowRest[0]?.trim();
          if (!name) {
            chatLog.addSystem('Usage: /workflow view <name>');
            tui.requestRender();
            return;
          }
          try {
            chatLog.addSystem(formatTuiWorkflowDetail(name));
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            chatLog.addSystem(`Workflow view failed: ${errorMessage}`);
          }
          tui.requestRender();
          return;
        }
        if (subcommand === 'save') {
          chatLog.addSystem('/workflow save is available through the workflow tool after a generated workflow run.');
          tui.requestRender();
          return;
        }
        chatLog.addSystem('Usage: /workflow list | /workflow view <name> | /workflow save <name>');
        tui.requestRender();
        return;
      }
      case 'models':
        void Promise.resolve(deps.listModels?.() ?? []).then((models) => {
          chatLog.addSystem(formatTuiModelsInfo(models));
          tui.requestRender();
        });
        return;
      case 'model':
        if (uiOverlays) {
          uiOverlays.openModelPicker(commandArgs.trim() || undefined);
          return;
        }
        chatLog.addSystem('Model picker is not available in this mode. Use /models and /switch <provider/model>.');
        tui.requestRender();
        return;
      case 'list':
        void Promise.resolve(deps.listSessions?.() ?? []).then((sessions) => {
          chatLog.addSystem(
            formatTuiSessionListInfo(sessions, { currentSessionKey: state.currentSessionKey }),
          );
          tui.requestRender();
        });
        return;
      case 'tree':
        if (uiOverlays) {
          uiOverlays.openTranscriptTree();
          return;
        }
        if (deps.loadTranscriptTree) {
          void Promise.resolve(deps.loadTranscriptTree()).then((entries) => {
            chatLog.addSystem(formatTuiTranscriptTreeInfo(entries));
            tui.requestRender();
          });
          return;
        }
        uiOverlays?.openSessionTree();
        if (uiOverlays) return;
        void Promise.resolve(deps.listSessions?.() ?? []).then((sessions) => {
          chatLog.addSystem(
            formatTuiSessionTreeInfo(sessions, { currentSessionKey: state.currentSessionKey }),
          );
          tui.requestRender();
        });
        return;
      case 'switch': {
        const modelRef = commandArgs.trim();
        if (!modelRef) {
          chatLog.addSystem('Usage: /switch <provider/model>');
          tui.requestRender();
          return;
        }
        void Promise.resolve(deps.switchModel?.(modelRef)).then(() => {
          tui.requestRender();
        });
        return;
      }
      case 'login':
        if (deps.runLogin && (!commandArgs.trim() || providerSupportsOAuth(commandArgs.trim()))) {
          void Promise.resolve(deps.runLogin(commandArgs.trim() || undefined))
            .catch((err) => {
              const errorMessage = err instanceof Error ? err.message : String(err);
              chatLog.addSystem(`Login failed: ${errorMessage}`);
            })
            .finally(() => tui.requestRender());
          return;
        }
        chatLog.addSystem(formatTuiLoginInfo(commandArgs));
        tui.requestRender();
        return;
      case 'logout': {
        const provider = commandArgs.trim();
        const authProfiles = deps.authProfiles ?? defaultAuthProfiles();
        void (async () => {
          try {
            if (!provider) {
              const profiles = await authProfiles.listAll();
              chatLog.addSystem(
                formatTuiStoredAuthProfilesInfo(profiles, { authStorePath: authProfiles.getStorePath() }),
              );
              tui.requestRender();
              return;
            }

            const profiles = await authProfiles.listProvider(provider);
            if (profiles.length === 0) {
              chatLog.addSystem(
                [
                  `No stored auth profiles found for provider: ${provider}`,
                  'Environment variables and config credentials are unchanged.',
                ].join('\n'),
              );
              tui.requestRender();
              return;
            }

            let removed = 0;
            for (const profile of profiles) {
              if (await authProfiles.remove(profile.profileId)) {
                removed += 1;
              }
            }
            chatLog.addSystem(
              [
                `Logged out from ${provider}: removed ${removed} stored auth profile${removed === 1 ? '' : 's'}.`,
                'Environment variables and config credentials are unchanged.',
              ].join('\n'),
            );
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            chatLog.addSystem(`Logout failed: ${errorMessage}`);
          }
          tui.requestRender();
        })();
        return;
      }
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
      case 'recover':
        void Promise.resolve(deps.recoverStream?.())
          .catch((err: unknown) => {
            const errorMessage = err instanceof Error ? err.message : String(err);
            chatLog.addSystem(`Recover failed: ${errorMessage}`);
          })
          .finally(() => tui.requestRender());
        return;
      case 'retry':
        void Promise.resolve(deps.retryLastMessage?.())
          .catch((err: unknown) => {
            const errorMessage = err instanceof Error ? err.message : String(err);
            chatLog.addSystem(`Retry failed: ${errorMessage}`);
          })
          .finally(() => tui.requestRender());
        return;
      case 'tools':
        state.toolsExpanded = !state.toolsExpanded;
        chatLog.setToolsExpanded(state.toolsExpanded);
        chatLog.addSystem(`Tools: ${state.toolsExpanded ? 'expanded' : 'collapsed'}`);
        tui.requestRender();
        return;
      case 'thinking':
        state.showThinking = !state.showThinking;
        chatLog.setShowThinking(state.showThinking);
        chatLog.addSystem(`Thinking display: ${state.showThinking ? 'on' : 'off'}`);
        updateFooter();
        tui.requestRender();
        return;
      case 'copy':
        void Promise.resolve(deps.copyLastAssistant?.()).then(() => {
          tui.requestRender();
        });
        return;
      case 'name': {
        const name = commandArgs.trim();
        if (!name) {
          const currentName = state.sessionInfo.displayName?.trim();
          chatLog.addSystem(currentName ? `Session name: ${currentName}` : 'Usage: /name <name>');
          tui.requestRender();
          return;
        }
        void Promise.resolve(deps.renameCurrentSession?.(name)).then(() => {
          tui.requestRender();
        });
        return;
      }
      case 'resume':
      case 'sessions':
        uiOverlays?.openSessionPicker();
        return;
      case 'scoped-models':
      case 'scopedmodels':
        uiOverlays?.openScopedModels();
        return;
      case 'think': {
        const level = normalizeThinkLevel(commandArgs);
        if (!commandArgs.trim()) {
          uiOverlays?.openThinkingSelector();
          return;
        }
        if (!level) {
          chatLog.addSystem(`Invalid thinking level: ${commandArgs}`);
          tui.requestRender();
          return;
        }
        void Promise.resolve(deps.setThinkingLevel?.(level)).then(() => {
          tui.requestRender();
        });
        return;
      }
      case 'reasoning': {
        const level = normalizeReasoningLevel(commandArgs);
        if (!commandArgs.trim()) {
          const current = state.sessionInfo.reasoningLevel?.trim();
          chatLog.addSystem(
            current
              ? `Reasoning visibility: ${current}`
              : 'Usage: /reasoning <off|on|stream>',
          );
          tui.requestRender();
          return;
        }
        if (!level) {
          chatLog.addSystem(`Invalid reasoning visibility: ${commandArgs}`);
          tui.requestRender();
          return;
        }
        void Promise.resolve(deps.setReasoningLevel?.(level)).then(() => {
          tui.requestRender();
        });
        return;
      }
      case 'verbose': {
        const raw = commandArgs.trim();
        const level = raw ? normalizeVerboseLevel(raw) : nextVerboseLevel(state.sessionInfo.verboseLevel);
        if (raw && !level) {
          chatLog.addSystem(`Invalid verbose level: ${commandArgs}`);
          tui.requestRender();
          return;
        }
        void Promise.resolve(deps.setVerboseLevel?.(level)).then(() => {
          tui.requestRender();
        });
        return;
      }
      case 'settings':
        uiOverlays?.openSettings();
        return;
      case 'reload':
      case 'reload-keybindings':
      case 'reload-keybind':
        void Promise.resolve(uiOverlays?.reloadKeybindings())
          .then(() => {
            chatLog.addSystem('Reloaded keybindings, TUI settings, theme, and extension UI.');
            tui.requestRender();
          })
          .catch((err: unknown) => {
            const errorMessage = err instanceof Error ? err.message : String(err);
            chatLog.addSystem(`Reload failed: ${errorMessage}`);
            tui.requestRender();
          });
        return;
      case 'compact':
        void deps.runCompaction?.(commandArgs.trim() || undefined);
        return;
      default:
        break;
    }

    switch (normalizedCommand) {
      case 'new': {
        void (async () => {
          try {
            await abortActive();
            const uniqueKey = `tui-${randomUUID()}`;
            if (setSession) {
              await setSession(uniqueKey);
              chatLog.addSystem(`new session: ${state.currentSessionKey}`);
            } else {
              assembler.clear();
              chatLog.clearAll();
              state.messageFollowUpQueue.length = 0;
              state.steeringQueue.length = 0;
              chatLog.addSystem('New session requires gateway or local session support.');
            }
            tui.requestRender();
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            chatLog.addSystem(`new session failed: ${errorMessage}`);
            tui.requestRender();
          }
        })();
        return;
      }
      case 'fork': {
        if (!commandArgs.trim() && uiOverlays) {
          uiOverlays.openUserMessageFork();
          return;
        }
        void Promise.resolve(deps.forkSession?.(commandArgs.trim() || undefined)).then(() => {
          tui.requestRender();
        });
        return;
      }
      case 'clone':
        void Promise.resolve(deps.forkSession?.(commandArgs.trim() || undefined)).then(() => {
          tui.requestRender();
        });
        return;
      case 'reset':
      case 'restart':
        void runReset();
        return;
      case 'clear':
        void runReset();
        return;
      default:
        break;
    }

    const extensionCmd = extensionSlashCommands.find((c) => c.name === normalizedCommand);
    if (extensionCmd) {
      void Promise.resolve(
        extensionCmd.handler(commandArgs, extensionCmd.getContext?.()),
      ).then(() => {
        tui.requestRender();
      });
      return;
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
