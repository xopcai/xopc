import { randomUUID } from 'node:crypto';

import type { KeybindingsManager, TUI } from '@earendil-works/pi-tui';

import type {
  TuiCompactionResult,
  TuiModelChoice,
  TuiShareRequest,
  TuiSessionStats,
  TuiSessionItem,
  TuiStartupResources,
  TuiTranscriptTreeEntry,
  TuiAgentInfo,
} from './tui-backend.js';
import type { ChatLog } from './components/chat-log.js';
import type { SessionTimelineItem } from '../session/transcript-outline.js';
import {
  buildTuiTimelineTurns,
  findNearestTimelineTurnByDisplayIndex,
  findTimelineTurnByNumber,
  type TuiTimelineTurn,
} from './tui-timeline.js';
import {
  formatKeyIds,
  formatXopcTuiHotkeys,
  type TuiHotkeyExtensionShortcut,
} from './format-tui-hotkeys.js';
import { getTuiKeybindingsPath } from './tui-keybindings-file.js';
import type { TuiState } from './tui-types.js';
import { createWorkflowCatalog } from '../agent/workflow/catalog.js';
import {
  isValidAgentId,
  normalizeAgentId,
  parseAgentSessionKey,
} from '../routing/agent-session-key.js';
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
import { TaskRepository } from '../tasks/index.js';
import {
  inferSuggestedProjectDefaultAgentId,
  isValidProjectAgentId,
  normalizeProjectAgentId,
  ProjectService,
  type Project,
  type ProjectStatus,
} from '../projects/index.js';
import {
  closeXopcDatabase,
  getSessionMetadata,
  isXopcDatabaseOpen,
  openXopcDatabase,
} from '../storage/sqlite/index.js';

import { rewriteUnknownSlashAsWorkflow } from './tui-workflow-slash.js';
import { formatTuiStartupText } from './tui-startup-text.js';
import { theme } from './theme.js';

export interface SlashCommandDef {
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
    { name: 'review', description: 'Review current workspace changes for correctness issues' },
    { name: 'session', description: 'Show current session info' },
    { name: 'project', description: 'Manage current project context' },
    { name: 'agent', description: 'Show or switch agent for this TUI session' },
    { name: 'agents', description: 'List available agents' },
    { name: 'tui-default-agent', description: 'Set default agent for new TUI sessions' },
    { name: 'new', description: 'Start a new isolated TUI session (tui-{uuid})' },
    { name: 'fork', description: 'Fork current session transcript into a new session' },
    { name: 'clone', description: 'Duplicate current session transcript into a new session' },
    { name: 'trust', description: 'Manage project trust and show extension security policy' },
    { name: 'name', description: 'Show or set current session display name' },
    { name: 'reset', description: 'Reset current session transcript and reload history' },
    { name: 'clear', description: 'Clear the TUI view without resetting the session' },
    { name: 'list', description: 'List sessions' },
    { name: 'resume', description: `Open session picker (or ${sessionKey})` },
    { name: 'tree', description: 'Show grouped session tree' },
    { name: 'timeline', description: 'Jump to a previous turn in the current session' },
    { name: 'scoped-models', description: `Choose models for ${modelCycleKey} cycling` },
    { name: 'compact', description: 'Compact session history (local API)' },
    { name: 'think', description: 'Set thinking level (e.g. /think high)' },
    { name: 'reasoning', description: 'Set reasoning visibility (e.g. /reasoning stream)' },
    { name: 'verbose', description: 'Toggle verbose mode' },
    { name: 'status', description: 'Show agent status' },
    { name: 'config', description: 'Show current configuration' },
    { name: 'context', description: 'Show context budget' },
    { name: 'btw', description: 'Side question without saving to session' },
    { name: 'aside', description: 'Alias for /btw' },
    { name: 'export', description: 'Export session (markdown/html/json)' },
    { name: 'import', description: 'Import an xopc JSON session export' },
    { name: 'share', description: 'Create a share link for a workspace file/folder/site' },
    { name: 'settings', description: 'Open TUI settings overlay' },
    { name: 'reload', description: 'Reload keybindings, TUI settings, theme, and extension UI' },
    { name: 'reload-keybindings', description: `Reload ${getTuiKeybindingsPath()}` },
    { name: 'start', description: 'Show welcome message' },
    { name: 'hotkeys', description: 'Show resolved keyboard shortcuts (pi-style)' },
    { name: 'changelog', description: 'Show version history' },
    { name: 'workflow', description: 'Workflow subcommands: list, view <name>' },
  ];
}

function formatExtraSlashCommands(commands: SlashCommandDef[], seen: Set<string>): string[] {
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
  skillSlashCommands: SlashCommandDef[] = [],
  workflowSlashCommands: SlashCommandDef[] = [],
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
  const pasteImage = keyLabel(keybindings, 'app.clipboard.pasteImage', 'Ctrl+V / Alt+V');
  const clearInput = keyLabel(keybindings, 'app.clear', 'Ctrl+C');
  const exit = keyLabel(keybindings, 'app.exit', 'Ctrl+D');
  const lines = ['Available commands:'];
  for (const c of commands) {
    lines.push(`  /${c.name} — ${c.description}`);
  }
  const seenCommands = new Set(commands.map((command) => command.name));
  const skillCommandLines = formatExtraSlashCommands(skillSlashCommands, seenCommands);
  if (skillCommandLines.length > 0) {
    lines.push('', 'Skill commands:');
    lines.push(...skillCommandLines);
  }
  const workflowCommandLines = formatExtraSlashCommands(workflowSlashCommands, seenCommands);
  if (workflowCommandLines.length > 0) {
    lines.push('', 'Workflow commands:');
    lines.push(...workflowCommandLines);
  }
  const extraCommandLines = formatExtraSlashCommands(extraSlashCommands, seenCommands);
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
  resources?: TuiStartupResources,
): string {
  return formatTuiStartupText({
    state,
    isLocal,
    keybindings,
    resources,
    expanded: true,
  });
}

import {
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
  isLocalMode: boolean;
  abortActive: () => Promise<void>;
  sendMessage: (text: string) => void;
  requestExit: () => void;
  updateFooter: () => void;
  keybindings: KeybindingsManager;
  uiOverlays?: {
    openModelPicker: (initialSearch?: string) => void;
    openAgentPicker?: () => void;
    openReviewLauncher?: () => void;
    openSessionPicker: () => void;
    openSessionTree: () => void;
    openTranscriptTree: () => void;
    openTimeline: (initialSearch?: string) => void;
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
  listAgents?: () => TuiAgentInfo[] | Promise<TuiAgentInfo[]>;
  setTuiDefaultAgent?: (agentId: string) => { agentId: string } | Promise<{ agentId: string }>;
  switchAgentSession?: (sessionKey: string, agentId: string) => void | Promise<void>;
  getSessionStats?: () => TuiSessionStats | Promise<TuiSessionStats>;
  getStartupResources?: () => TuiStartupResources | undefined;
  loadTranscriptTree?: () => TuiTranscriptTreeEntry[] | Promise<TuiTranscriptTreeEntry[]>;
  loadTimeline?: () => SessionTimelineItem[] | Promise<SessionTimelineItem[]>;
  loadHistoryWindow?: (opts: {
    rowNumber: number;
    before?: number;
    after?: number;
  }) => boolean | Promise<boolean>;
  loadSessionHistory?: () => void | Promise<void>;
  exportSession?: (request: TuiExportRequest) => void | Promise<void>;
  importSession?: (request: TuiImportRequest) => void | Promise<void>;
  createShare?: (request: TuiShareRequest) => void | Promise<void>;
  startWorkflowRun?: (request: { definitionId: string; goal?: string }) => {
    runId: string;
    sessionKey: string;
    definitionId: string;
  } | Promise<{
    runId: string;
    sessionKey: string;
    definitionId: string;
  }>;
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
  skillSlashCommands?: SlashCommandDef[];
  workflowSlashCommands?: SlashCommandDef[];
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

function timelineUsage(): string {
  return [
    'Usage: /timeline [turn|latest|prev|next|search <text>]',
    'Examples: /timeline, /timeline 12, /timeline prev, /timeline search deploy',
  ].join('\n');
}

function currentTimelineTurnIndex(turns: readonly TuiTimelineTurn[], chatLog: ChatLog): number {
  const viewState = chatLog.getTimelineViewportState();
  if (viewState.mode === 'history') {
    const current = findNearestTimelineTurnByDisplayIndex(turns, viewState.displayIndex);
    const index = current ? turns.findIndex((turn) => turn.id === current.id) : -1;
    return index >= 0 ? index : turns.length - 1;
  }
  return turns.length - 1;
}

async function runTimelineCommand(
  commandArgs: string,
  deps: Pick<
    CommandHandlerDeps,
    'chatLog' | 'tui' | 'uiOverlays' | 'loadTimeline' | 'loadHistoryWindow' | 'loadSessionHistory'
  >,
): Promise<void> {
  const raw = commandArgs.trim();
  if (!raw) {
    if (deps.uiOverlays?.openTimeline) {
      deps.uiOverlays.openTimeline();
    } else {
      deps.chatLog.addSystem('Timeline picker is not available in this mode.');
      deps.tui.requestRender();
    }
    return;
  }

  const [subcommandRaw, ...rest] = raw.split(/\s+/);
  const subcommand = (subcommandRaw ?? '').toLowerCase();

  if (subcommand === 'search' || subcommand === 'find') {
    if (deps.uiOverlays?.openTimeline) {
      deps.uiOverlays.openTimeline(rest.join(' ').trim());
    } else {
      deps.chatLog.addSystem('Timeline picker is not available in this mode.');
      deps.tui.requestRender();
    }
    return;
  }

  if (subcommand === 'latest' || subcommand === 'live' || subcommand === 'end') {
    await deps.loadSessionHistory?.();
    deps.chatLog.jumpToLatest();
    deps.chatLog.addSystem(theme.dim('Returned to latest transcript view.'));
    deps.tui.requestRender();
    return;
  }

  if (!deps.loadTimeline) {
    deps.chatLog.addSystem('Timeline is not available in this mode.');
    deps.tui.requestRender();
    return;
  }

  const turns = buildTuiTimelineTurns(await Promise.resolve(deps.loadTimeline()));
  if (turns.length === 0) {
    deps.chatLog.addSystem('No timeline turns found.');
    deps.tui.requestRender();
    return;
  }

  let target: TuiTimelineTurn | undefined;
  if (subcommand === 'prev' || subcommand === 'previous') {
    target = turns[Math.max(0, currentTimelineTurnIndex(turns, deps.chatLog) - 1)];
  } else if (subcommand === 'next') {
    target = turns[Math.min(turns.length - 1, currentTimelineTurnIndex(turns, deps.chatLog) + 1)];
  } else {
    const turnNumber = Number.parseInt(subcommand, 10);
    if (!Number.isFinite(turnNumber) || String(turnNumber) !== subcommand) {
      deps.chatLog.addSystem(timelineUsage());
      deps.tui.requestRender();
      return;
    }
    target = findTimelineTurnByNumber(turns, turnNumber);
  }

  if (!target) {
    deps.chatLog.addSystem(`Timeline turn not found: ${raw}`);
    deps.tui.requestRender();
    return;
  }

  if (!deps.chatLog.jumpToDisplayIndex(target.displayIndex)) {
    const loaded =
      target.rowNumber !== undefined && deps.loadHistoryWindow
        ? await deps.loadHistoryWindow({ rowNumber: target.rowNumber })
        : false;
    if (loaded && deps.chatLog.jumpToDisplayIndex(target.displayIndex)) {
      deps.tui.requestRender();
      return;
    }
    deps.chatLog.addSystem(`Turn ${target.turn} is outside loaded history.`);
  }
  deps.tui.requestRender();
}

function formatAgentsList(agents: TuiAgentInfo[], currentAgentId?: string): string {
  if (agents.length === 0) {
    return 'No agents available.';
  }
  const current = currentAgentId?.trim().toLowerCase();
  const sorted = [...agents].sort((a, b) => {
    if (a.id === current && b.id !== current) return -1;
    if (b.id === current && a.id !== current) return 1;
    if (a.id === 'coder' && b.id !== 'coder') return -1;
    if (b.id === 'coder' && a.id !== 'coder') return 1;
    return a.id.localeCompare(b.id);
  });
  return [
    'Available agents:',
    ...sorted.map((agent) => {
      const marker = agent.id === current ? '*' : ' ';
      const label = agent.displayName ? ` — ${agent.displayName}` : '';
      return `${marker} ${agent.id}${label}`;
    }),
    '',
    'Switch with: /agent <id>',
  ].join('\n');
}

function formatCurrentAgent(state: TuiState): string {
  const parsed = parseAgentSessionKey(state.currentSessionKey);
  if (!parsed) {
    return `Current session is not an agent session.\nSession: ${state.currentSessionKey}`;
  }
  const lines = [
    `Current agent: ${parsed.agentId}`,
    `Session: ${state.currentSessionKey}`,
  ];
  const workspace = state.sessionInfo.effectiveWorkspacePath?.trim();
  if (workspace) lines.push(`Workspace: ${workspace}`);
  const provider = state.sessionInfo.modelProvider?.trim();
  const model = state.sessionInfo.model?.trim();
  if (model) lines.push(`Model: ${provider ? `${provider}/${model}` : model}`);
  return lines.join('\n');
}

function withTuiProjects<T>(fn: (projects: ProjectService) => T): T {
  const wasOpen = isXopcDatabaseOpen();
  if (!wasOpen) openXopcDatabase();
  try {
    return fn(new ProjectService());
  } finally {
    if (!wasOpen) closeXopcDatabase();
  }
}

function resolveTuiProject(projects: ProjectService, ref: string): Project | null {
  return projects.get(ref) ?? projects.getBySlug(ref);
}

function parseTuiProjectStatus(raw: string | undefined): ProjectStatus | undefined {
  return raw === 'active' || raw === 'paused' || raw === 'archived' ? raw : undefined;
}

function parseProjectNewArgs(parts: string[]): {
  name: string;
  workspaceRoot?: string;
  projectKind?: string;
  agentId?: string;
  error?: string;
} {
  const nameParts: string[] = [];
  let workspaceRoot: string | undefined;
  let projectKind: string | undefined;
  let agentId: string | undefined;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === '--path' || part === '-p') {
      workspaceRoot = parts[index + 1]?.trim();
      index += 1;
      if (!workspaceRoot) return { name: '', error: 'Missing value for --path' };
      continue;
    }
    if (part.startsWith('--path=') || part.startsWith('-p=')) {
      workspaceRoot = part.slice(part.indexOf('=') + 1).trim();
      if (!workspaceRoot) return { name: '', error: 'Missing value for --path' };
      continue;
    }
    if (part === '--type' || part === '-t') {
      projectKind = parts[index + 1]?.trim();
      index += 1;
      if (!['auto', 'coding', 'general'].includes(projectKind ?? '')) return { name: '', error: 'Project type must be auto, coding, or general' };
      continue;
    }
    if (part.startsWith('--type=') || part.startsWith('-t=')) {
      projectKind = part.slice(part.indexOf('=') + 1).trim();
      if (!['auto', 'coding', 'general'].includes(projectKind)) return { name: '', error: 'Project type must be auto, coding, or general' };
      continue;
    }
    if (part === '--agent' || part === '-a') {
      agentId = parts[index + 1]?.trim();
      index += 1;
      if (!agentId) return { name: '', error: 'Missing value for --agent' };
      continue;
    }
    if (part.startsWith('--agent=') || part.startsWith('-a=')) {
      agentId = part.slice(part.indexOf('=') + 1).trim();
      if (!agentId) return { name: '', error: 'Missing value for --agent' };
      continue;
    }
    nameParts.push(part);
  }
  return { name: nameParts.join(' ').trim(), workspaceRoot, projectKind, agentId };
}

function formatTuiProject(project: Project & { sessionCount?: number; taskCount?: number; activeTaskCount?: number }): string {
  const lines = [
    `${project.name} [${project.status}]`,
    `ID: ${project.id}`,
    `Slug: ${project.slug}`,
    `Default agent: ${project.defaultAgentId ?? 'global default'}`,
    project.workspaceRoot ? `Workspace: ${project.workspaceRoot}` : undefined,
    project.sessionCount != null ? `Sessions: ${project.sessionCount}` : undefined,
    project.taskCount != null ? `Tasks: ${project.taskCount} (${project.activeTaskCount ?? 0} active)` : undefined,
    project.brief ? `Brief: ${project.brief}` : undefined,
  ];
  return lines.filter(Boolean).join('\n');
}

function runTuiProjectCommand(state: TuiState, args: string): string {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const subcommand = parts[0]?.toLowerCase();
  return withTuiProjects((projects) => {
    if (!subcommand || subcommand === 'status') {
      const projectId = getSessionMetadata(state.currentSessionKey)?.projectId;
      if (!projectId) return `No project selected.\nSession: ${state.currentSessionKey}`;
      const project = projects.getWithDetails(projectId);
      return project ? formatTuiProject(project) : `Current project not found: ${projectId}`;
    }

    if (subcommand === 'list') {
      const status = parseTuiProjectStatus(parts[1]);
      const result = projects.list({ ...(status ? { status } : {}), limit: 20 });
      if (!result.items.length) return 'No projects.';
      return ['Projects:', ...result.items.map((project) => `- ${project.slug} [${project.status}] ${project.name}`)].join('\n');
    }

    if (subcommand === 'new') {
      const parsed = parseProjectNewArgs(parts.slice(1));
      if (parsed.error) return parsed.error;
      if (!parsed.name && !parsed.workspaceRoot) return 'Usage: /project new <name> [--path <workspace>] [--type auto|coding|general] [--agent <agent-id>]';
      const cfg = loadConfig(resolveConfigPath());
      const explicitAgentId = normalizeProjectAgentId(parsed.agentId);
      if (parsed.agentId && !isValidProjectAgentId(cfg, explicitAgentId)) return `Agent not found: ${parsed.agentId}`;
      const defaultAgentId = explicitAgentId ?? inferSuggestedProjectDefaultAgentId({
        config: cfg,
        name: parsed.name,
        workspaceRoot: parsed.workspaceRoot,
        projectKind: parsed.projectKind,
      });
      const project = projects.create({
        ...(parsed.name ? { name: parsed.name } : {}),
        ...(parsed.workspaceRoot ? { workspaceRoot: parsed.workspaceRoot } : {}),
        ...(defaultAgentId ? { defaultAgentId } : {}),
        ...(parsed.projectKind ? { projectKind: parsed.projectKind } : {}),
      });
      projects.attachSession(state.currentSessionKey, project.id);
      return `Created and attached project:\n${formatTuiProject(project)}`;
    }

    if (subcommand === 'switch' || subcommand === 'attach') {
      const ref = parts[1];
      if (!ref) return `Usage: /project ${subcommand} <id-or-slug>`;
      const project = resolveTuiProject(projects, ref);
      if (!project) return `Project not found: ${ref}`;
      projects.attachSession(state.currentSessionKey, project.id);
      return `Attached current session to project: ${project.name}`;
    }

    if (subcommand === 'detach') {
      projects.detachSession(state.currentSessionKey);
      return 'Detached current session from project.';
    }

    if (subcommand === 'archive') {
      const ref = parts[1];
      if (!ref) return 'Usage: /project archive <id-or-slug>';
      const project = resolveTuiProject(projects, ref);
      if (!project) return `Project not found: ${ref}`;
      projects.update(project.id, { status: 'archived' });
      return `Archived project: ${project.name}`;
    }

    if (subcommand === 'set-agent') {
      const agentId = normalizeProjectAgentId(parts[1]);
      if (!agentId) return 'Usage: /project set-agent <agent-id>';
      const currentProjectId = getSessionMetadata(state.currentSessionKey)?.projectId;
      if (!currentProjectId) return 'No current project.';
      const cfg = loadConfig(resolveConfigPath());
      if (!isValidProjectAgentId(cfg, agentId)) return `Agent not found: ${parts[1]}`;
      const project = projects.update(currentProjectId, { defaultAgentId: agentId });
      return `Project default agent set to ${project.defaultAgentId}.`;
    }

    if (subcommand === 'clear-agent') {
      const currentProjectId = getSessionMetadata(state.currentSessionKey)?.projectId;
      if (!currentProjectId) return 'No current project.';
      projects.update(currentProjectId, { defaultAgentId: null });
      return 'Project default agent cleared.';
    }

    if (subcommand === 'sessions') {
      const ref = parts[1];
      const currentProjectId = getSessionMetadata(state.currentSessionKey)?.projectId;
      const project = ref ? resolveTuiProject(projects, ref) : currentProjectId ? projects.get(currentProjectId) : null;
      if (!project) return ref ? `Project not found: ${ref}` : 'No current project.';
      const keys = projects.listSessionKeys(project.id, 20);
      if (!keys.length) return `No sessions in ${project.name}.`;
      return [`Sessions in ${project.name}:`, ...keys.map((key) => `- ${key}`)].join('\n');
    }

    if (subcommand === 'tasks') {
      const ref = parts[1];
      const currentProjectId = getSessionMetadata(state.currentSessionKey)?.projectId;
      const project = ref ? resolveTuiProject(projects, ref) : currentProjectId ? projects.get(currentProjectId) : null;
      if (!project) return ref ? `Project not found: ${ref}` : 'No current project.';
      const tasks = new TaskRepository().listByProject(project.id, 20);
      if (!tasks.length) return `No tasks in ${project.name}.`;
      return [`Tasks in ${project.name}:`, ...tasks.map((task) => `- ${task.id} [${task.phase}] ${task.title}`)].join('\n');
    }

    return [
      'Usage:',
      '  /project',
      '  /project list [active|paused|archived]',
      '  /project new <name> [--path <workspace>] [--type auto|coding|general] [--agent <agent-id>]',
      '  /project switch <id-or-slug>',
      '  /project attach <id-or-slug>',
      '  /project detach',
      '  /project set-agent <agent-id>',
      '  /project clear-agent',
      '  /project sessions [id-or-slug]',
      '  /project tasks [id-or-slug]',
      '  /project archive <id-or-slug>',
    ].join('\n');
  });
}

export function createTuiCommandHandler(deps: CommandHandlerDeps): (input: string) => void {
  const {
    state,
    chatLog,
    tui,
    isLocalMode,
    abortActive,
    sendMessage,
    requestExit,
    updateFooter,
    keybindings,
    uiOverlays,
    skillSlashCommands = [],
    workflowSlashCommands = [],
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
      chatLog.clearAll();
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
        chatLog.addSystem(formatTuiHelpText(
          isLocalMode,
          keybindings,
          extensionSlashCommands,
          skillSlashCommands,
          workflowSlashCommands,
        ));
        tui.requestRender();
        return;
      case 'start':
        chatLog.addSystem(formatTuiStartText(state, isLocalMode, keybindings, deps.getStartupResources?.()));
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
      case 'project':
        try {
          chatLog.addSystem(runTuiProjectCommand(state, commandArgs));
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          chatLog.addSystem(`Project command failed: ${errorMessage}`);
        }
        tui.requestRender();
        return;
      case 'agents':
        if (uiOverlays?.openAgentPicker) {
          uiOverlays.openAgentPicker();
          return;
        }
        void Promise.resolve(deps.listAgents?.() ?? [])
          .then((agents) => {
            const current = parseAgentSessionKey(state.currentSessionKey)?.agentId;
            chatLog.addSystem(formatAgentsList(agents, current));
            tui.requestRender();
          })
          .catch((err: unknown) => {
            const errorMessage = err instanceof Error ? err.message : String(err);
            chatLog.addSystem(`Agents list failed: ${errorMessage}`);
            tui.requestRender();
          });
        return;
      case 'agent': {
        const targetRaw = commandArgs.trim();
        if (!targetRaw) {
          chatLog.addSystem(formatCurrentAgent(state));
          tui.requestRender();
          return;
        }
        void (async () => {
          const parsedCurrent = parseAgentSessionKey(state.currentSessionKey);
          if (!parsedCurrent) {
            chatLog.addSystem('Cannot switch agent: current session is not an agent session.');
            tui.requestRender();
            return;
          }
          if (state.activeRunId) {
            chatLog.addSystem('Cannot switch agent while a run is active. Abort first.');
            tui.requestRender();
            return;
          }
          if (!isValidAgentId(targetRaw)) {
            chatLog.addSystem(`Invalid agent id: ${targetRaw}`);
            tui.requestRender();
            return;
          }
          const targetAgentId = normalizeAgentId(targetRaw);
          const agents = await Promise.resolve(deps.listAgents?.() ?? []);
          if (!agents.some((agent) => agent.enabled !== false && agent.id === targetAgentId)) {
            chatLog.addSystem(`Unknown agent: ${targetAgentId}`);
            tui.requestRender();
            return;
          }
          const targetSessionKey = `agent:${targetAgentId}:${parsedCurrent.rest}`;
          if (targetSessionKey === state.currentSessionKey) {
            chatLog.addSystem(`Already using agent: ${targetAgentId}`);
            tui.requestRender();
            return;
          }
          if (!deps.switchAgentSession) {
            chatLog.addSystem('Agent switching is not available in this mode.');
            tui.requestRender();
            return;
          }
          await deps.switchAgentSession(targetSessionKey, targetAgentId);
          chatLog.addSystem(`Switched to agent: ${targetAgentId}\nSession: ${targetSessionKey}`);
          tui.requestRender();
        })().catch((err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          chatLog.addSystem(`Agent switch failed: ${errorMessage}`);
          tui.requestRender();
        });
        return;
      }
      case 'tui-default-agent': {
        const targetRaw = commandArgs.trim();
        if (!targetRaw) {
          void Promise.resolve(deps.listAgents?.() ?? [])
            .then((agents) => {
              chatLog.addSystem([
                'Usage: /tui-default-agent <agent-id>',
                'This changes new TUI sessions only; the current session is unchanged.',
                '',
                formatAgentsList(agents, parseAgentSessionKey(state.currentSessionKey)?.agentId),
              ].join('\n'));
              tui.requestRender();
            })
            .catch((err: unknown) => {
              const errorMessage = err instanceof Error ? err.message : String(err);
              chatLog.addSystem(`TUI default agent help failed: ${errorMessage}`);
              tui.requestRender();
            });
          return;
        }
        void (async () => {
          if (!isValidAgentId(targetRaw)) {
            chatLog.addSystem(`Invalid agent id: ${targetRaw}`);
            tui.requestRender();
            return;
          }
          if (!deps.setTuiDefaultAgent) {
            chatLog.addSystem('TUI default agent updates are not available in this mode.');
            tui.requestRender();
            return;
          }
          const result = await deps.setTuiDefaultAgent(normalizeAgentId(targetRaw));
          chatLog.addSystem(
            `TUI default agent set to ${result.agentId}. New TUI sessions will use it.`,
          );
          tui.requestRender();
        })().catch((err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          chatLog.addSystem(`TUI default agent update failed: ${errorMessage}`);
          tui.requestRender();
        });
        return;
      }
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
          chatLog.addSystem('/workflow save is not a TUI command. Save generated workflows through the workflow tool.');
          tui.requestRender();
          return;
        }
        chatLog.addSystem('Usage: /workflow list | /workflow view <name>');
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
      case 'timeline':
        void runTimelineCommand(commandArgs, deps).catch((err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          chatLog.addSystem(`Timeline failed: ${errorMessage}`);
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
        if (!deps.switchModel) {
          chatLog.addSystem('Model switching is not available in this mode.');
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
        if (!deps.recoverStream) {
          chatLog.addSystem('Stream recovery is not available in this mode.');
          tui.requestRender();
          return;
        }
        void Promise.resolve(deps.recoverStream?.())
          .catch((err: unknown) => {
            const errorMessage = err instanceof Error ? err.message : String(err);
            chatLog.addSystem(`Recover failed: ${errorMessage}`);
          })
          .finally(() => tui.requestRender());
        return;
      case 'retry':
        if (!deps.retryLastMessage) {
          chatLog.addSystem('Retry is not available in this mode.');
          tui.requestRender();
          return;
        }
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
        if (!deps.copyLastAssistant) {
          chatLog.addSystem('Copy is not available in this mode.');
          tui.requestRender();
          return;
        }
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
        if (!deps.renameCurrentSession) {
          chatLog.addSystem('Session rename is not available in this mode.');
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
        if (!uiOverlays) {
          chatLog.addSystem('Session picker is not available in this mode. Use /list to show sessions.');
          tui.requestRender();
          return;
        }
        uiOverlays?.openSessionPicker();
        return;
      case 'scoped-models':
      case 'scopedmodels':
        if (!uiOverlays) {
          chatLog.addSystem('Scoped model picker is not available in this mode.');
          tui.requestRender();
          return;
        }
        uiOverlays?.openScopedModels();
        return;
      case 'think': {
        const level = normalizeThinkLevel(commandArgs);
        if (!commandArgs.trim()) {
          if (!uiOverlays) {
            const current = state.sessionInfo.thinkingLevel?.trim();
            chatLog.addSystem(
              current ? `Thinking level: ${current}` : 'Usage: /think <off|low|medium|high>',
            );
            tui.requestRender();
            return;
          }
          uiOverlays?.openThinkingSelector();
          return;
        }
        if (!level) {
          chatLog.addSystem(`Invalid thinking level: ${commandArgs}`);
          tui.requestRender();
          return;
        }
        if (!deps.setThinkingLevel) {
          chatLog.addSystem('Thinking level changes are not available in this mode.');
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
        if (!deps.setReasoningLevel) {
          chatLog.addSystem('Reasoning visibility changes are not available in this mode.');
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
        if (!deps.setVerboseLevel) {
          chatLog.addSystem('Verbose mode changes are not available in this mode.');
          tui.requestRender();
          return;
        }
        void Promise.resolve(deps.setVerboseLevel?.(level)).then(() => {
          tui.requestRender();
        });
        return;
      }
      case 'settings':
        if (!uiOverlays) {
          chatLog.addSystem('Settings are not available in this mode.');
          tui.requestRender();
          return;
        }
        uiOverlays?.openSettings();
        return;
      case 'reload':
      case 'reload-keybindings':
      case 'reload-keybind':
        if (!uiOverlays) {
          chatLog.addSystem('Reload is not available in this mode.');
          tui.requestRender();
          return;
        }
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
        if (!deps.runCompaction) {
          chatLog.addSystem('Compaction is not available in this mode.');
          tui.requestRender();
          return;
        }
        void deps.runCompaction?.(commandArgs.trim() || undefined);
        return;
      case 'review':
        if (!commandArgs.trim()) {
          if (uiOverlays?.openReviewLauncher) {
            uiOverlays.openReviewLauncher();
          } else {
            chatLog.addSystem('Usage: /review --uncommitted | /review --base <branch> | /review --commit <sha> | /review --custom <instructions>');
            tui.requestRender();
          }
          return;
        }
        sendMessage(input);
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
              chatLog.clearAll();
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
        chatLog.clearAll();
        chatLog.addSystem('TUI view cleared. Session transcript was not reset.');
        tui.requestRender();
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

    if (normalizedCommand.startsWith('skill:')) {
      sendMessage(input);
      return;
    }

    if (normalizedCommand.startsWith('workflow:')) {
      const workflowName = normalizedCommand.slice('workflow:'.length).trim();
      if (!workflowName) {
        chatLog.addSystem('Usage: /workflow:<name> [goal]');
        tui.requestRender();
        return;
      }
      if (!deps.startWorkflowRun) {
        chatLog.addSystem('Workflow runs are not available in this mode.');
        tui.requestRender();
        return;
      }
      chatLog.addSystem(`▶ Starting workflow: ${workflowName}`);
      tui.requestRender();
      void Promise.resolve(deps.startWorkflowRun({
        definitionId: workflowName,
        goal: commandArgs.trim() || undefined,
      })).then((result) => {
        chatLog.addSystem(
          `Workflow started: ${result.definitionId}\nrunId: ${result.runId}\nsessionKey: ${result.sessionKey}`,
        );
        tui.requestRender();
      }).catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        chatLog.addSystem(`Workflow start failed: ${errorMessage}`);
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
