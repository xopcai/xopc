import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { visibleWidth, type KeybindingsManager, type TUI } from '@earendil-works/pi-tui';

import type {
  TuiCompactionResult,
  TuiExportFormat,
  TuiModelChoice,
  TuiShareAudience,
  TuiShareMode,
  TuiShareRequest,
  TuiShareResult,
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
import { computeContextUsagePercent, formatContextUsageLabel } from './tui-context-usage.js';
import { getTuiKeybindingsPath } from './tui-keybindings-file.js';
import type { StreamAssembler } from './stream-assembler.js';
import type { TuiState } from './tui-types.js';
import { formatSessionPickerDescription } from './tui-session-format.js';
import { formatTuiTranscriptTreeEntryDisplayText } from './tui-transcript-tree.js';
import { createWorkflowCatalog, type CatalogEntry } from '../agent/workflow/catalog.js';
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
import type { Config } from '../config/schema.js';
import { loadConfig, resolveConfigPath } from '../config/index.js';
import type { TuiSlashCommandContext, TuiSlashCommandHandler } from '../extensions/types/tui.js';
import { provenanceTracker } from '../extensions/security.js';
import {
  getProviderDisplayName,
  getSortedProviders,
  providerSupportsApiKey,
  providerSupportsOAuth,
} from '../providers/index.js';
import { parseAgentSessionKey } from '../routing/agent-session-key.js';
import { getLogDir, getRuntimeLogStats } from '../utils/logger.js';

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

export interface TuiExportRequest {
  format: TuiExportFormat;
  outputPath?: string;
}

export interface TuiImportRequest {
  inputPath?: string;
  targetKey?: string;
}

const SHARE_AUDIENCES = new Set<TuiShareAudience>(['friend', 'colleague', 'public']);
const SHARE_MODES = new Set<TuiShareMode>(['auto', 'force-file', 'force-site', 'force-zip']);

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
    { name: 'tools', description: `Toggle tool output expanded/collapsed (or ${toolsKey})` },
    { name: 'thinking', description: `Toggle thinking display (or ${thinkingKey})` },
    { name: 'copy', description: 'Copy last assistant message to clipboard' },
    { name: 'exit', description: 'Exit the TUI' },
    { name: 'quit', description: 'Quit the TUI' },
    { name: 'model', description: 'Open model picker (optional search text)' },
    { name: 'models', description: 'List available models' },
    { name: 'switch', description: 'Switch model — copy `provider/model` from /models' },
    { name: 'login', description: 'Show provider credential setup commands' },
    { name: 'logout', description: 'Remove stored provider auth profiles' },
    { name: 'usage', description: 'Show token usage statistics' },
    { name: 'session', description: 'Show current session info' },
    { name: 'new', description: 'Start a new isolated TUI session (tui-{uuid})' },
    { name: 'fork', description: 'Fork current session transcript into a new session' },
    { name: 'clone', description: 'Duplicate current session transcript into a new session' },
    { name: 'trust', description: 'Show extension trust/security policy' },
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

function formatMaybe(value: string | undefined | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : '-';
}

function formatNumber(value: number | undefined | null): string {
  return value == null ? '-' : value.toLocaleString();
}

function formatModelLabel(state: TuiState): string {
  const provider = state.sessionInfo.modelProvider?.trim();
  const model = state.sessionInfo.model?.trim();
  if (provider && model) {
    return `${provider}/${model}`;
  }
  return formatMaybe(model ?? provider);
}

function nextVerboseLevel(current: string | undefined | null): VerboseLevel {
  const normalized = normalizeVerboseLevel(current);
  if (normalized === 'off') return 'on';
  if (normalized === 'on') return 'full';
  return 'off';
}

function splitCommandArgs(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of input.matchAll(re)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return tokens;
}

function normalizeExportFormat(raw: string | undefined): TuiExportFormat | undefined {
  const value = raw?.trim().toLowerCase();
  if (value === 'json' || value === 'markdown' || value === 'md' || value === 'html') {
    return value === 'md' ? 'markdown' : value;
  }
  return undefined;
}

function inferExportFormatFromPath(path: string | undefined): TuiExportFormat | undefined {
  const lower = path?.trim().toLowerCase();
  if (!lower) return undefined;
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  return undefined;
}

export function parseTuiExportRequest(args: string): TuiExportRequest {
  const tokens = splitCommandArgs(args.trim());
  const first = tokens[0];
  const explicitFormat = normalizeExportFormat(first);
  if (explicitFormat) {
    const outputPath = tokens[1];
    return { format: explicitFormat, outputPath };
  }
  const outputPath = first;
  return {
    format: inferExportFormatFromPath(outputPath) ?? 'html',
    outputPath,
  };
}

export function parseTuiImportRequest(args: string): TuiImportRequest {
  const tokens = splitCommandArgs(args.trim());
  return {
    inputPath: tokens[0],
    targetKey: tokens[1],
  };
}

export function parseTuiShareRequest(args: string): TuiShareRequest | null {
  const tokens = splitCommandArgs(args.trim());
  const path = tokens.shift();
  if (!path) return null;

  const request: TuiShareRequest = { path };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const lower = token.toLowerCase();
    const next = tokens[i + 1];

    if (lower === '--friend' || lower === '--colleague' || lower === '--public') {
      request.audience = lower.slice(2) as TuiShareAudience;
      continue;
    }
    if (SHARE_AUDIENCES.has(lower as TuiShareAudience)) {
      request.audience = lower as TuiShareAudience;
      continue;
    }
    if (lower === '--file') {
      request.mode = 'force-file';
      continue;
    }
    if (lower === '--site') {
      request.mode = 'force-site';
      continue;
    }
    if (lower === '--zip') {
      request.mode = 'force-zip';
      continue;
    }
    if (SHARE_MODES.has(lower as TuiShareMode)) {
      request.mode = lower as TuiShareMode;
      continue;
    }
    if ((lower === '--title' || lower === '-t') && next) {
      request.title = next;
      i += 1;
      continue;
    }
    if ((lower === '--description' || lower === '--desc' || lower === '-d') && next) {
      request.description = next;
      i += 1;
      continue;
    }
  }
  return request;
}

export function formatTuiShareResult(result: TuiShareResult): string {
  const lines = [
    'Share',
    '',
    `Kind: ${result.kind}`,
    `URL: ${result.shareUrl}`,
  ];
  if (result.title?.trim()) lines.push(`Title: ${result.title.trim()}`);
  if (result.expiresAt?.trim()) lines.push(`Expires: ${result.expiresAt.trim()}`);
  if (result.maxViews != null) lines.push(`Max Views: ${formatNumber(result.maxViews)}`);
  if (result.reachability?.trim()) {
    lines.push(`Reachability: ${result.reachability.trim()}`);
  }
  if (result.reachabilityHint?.trim()) {
    lines.push(`Hint: ${result.reachabilityHint.trim()}`);
  }
  if (result.thumbnailUrl?.trim()) {
    lines.push(`Thumbnail: ${result.thumbnailUrl.trim()}`);
  }
  if (result.routingReason?.trim()) {
    lines.push(`Routing: ${result.routingReason.trim()}`);
  }
  if (result.routingHint?.trim()) {
    lines.push(`Routing Hint: ${result.routingHint.trim()}`);
  }
  return lines.join('\n');
}

function formatModelChoice(choice: TuiModelChoice): string {
  const ref = `${choice.provider}/${choice.id}`;
  const name = choice.name?.trim();
  const suffix = name && name !== choice.id ? ` — ${name}` : '';
  return `${ref}${suffix}`;
}

function formatAuthProfileExpires(expires: number | undefined): string {
  if (!expires) return '';
  const date = new Date(expires);
  if (Number.isNaN(date.getTime())) return '';
  return `, expires ${date.toISOString()}`;
}

function formatAuthProfileLine(profile: AuthProfileEntry): string {
  const email = profile.email?.trim() ? `, ${profile.email.trim()}` : '';
  const key = profile.hasKey ? 'has credential' : 'empty credential';
  return `  ${profile.provider} — ${profile.profileId} (${profile.type}, ${key}${email}${formatAuthProfileExpires(profile.expires)})`;
}

export function formatTuiStoredAuthProfilesInfo(
  profiles: AuthProfileEntry[],
  options: { authStorePath?: string } = {},
): string {
  if (profiles.length === 0) {
    return [
      'Auth Profiles',
      '',
      'No stored auth profiles found.',
      'Environment variables and config credentials are unchanged by /logout.',
    ].join('\n');
  }

  const sorted = [...profiles].sort((a, b) => {
    const byProvider = a.provider.localeCompare(b.provider);
    return byProvider || a.profileId.localeCompare(b.profileId);
  });
  const lines = ['Auth Profiles', '', ...sorted.map(formatAuthProfileLine)];
  lines.push('', 'Use /logout <provider> to remove stored profiles for one provider.');
  lines.push('Environment variables and config credentials are unchanged.');
  if (options.authStorePath) {
    lines.push(`Store: ${options.authStorePath}`);
  }
  return lines.join('\n');
}

export function formatTuiLoginInfo(provider?: string): string {
  const trimmedProvider = provider?.trim();
  if (trimmedProvider) {
    const displayName = getProviderDisplayName(trimmedProvider);
    const lines = ['Login', '', `${trimmedProvider} — ${displayName}`, ''];
    if (providerSupportsOAuth(trimmedProvider)) {
      lines.push(`OAuth: xopc auth login ${trimmedProvider}`);
    }
    if (providerSupportsApiKey(trimmedProvider)) {
      lines.push(`API key: xopc auth set ${trimmedProvider} <key>`);
    }
    if (!providerSupportsOAuth(trimmedProvider) && !providerSupportsApiKey(trimmedProvider)) {
      lines.push('No direct xopc auth setup command is advertised for this provider.');
    }
    lines.push('', 'Run the command in a shell, then restart or reload the agent session if needed.');
    lines.push('Stored credentials can be inspected with /logout and removed with /logout <provider>.');
    return lines.join('\n');
  }

  const oauthProviders = getSortedProviders().filter(providerSupportsOAuth);
  const lines = ['Login', '', 'OAuth providers:'];
  if (oauthProviders.length === 0) {
    lines.push('  none detected');
  } else {
    for (const nextProvider of oauthProviders) {
      lines.push(`  ${nextProvider} — ${getProviderDisplayName(nextProvider)}`);
    }
  }
  lines.push(
    '',
    'Use /login <provider> for exact setup commands.',
    'API keys: xopc auth set <provider> <key>',
    'Stored credentials: /logout',
  );
  return lines.join('\n');
}

export function formatTuiChangelogInfo(markdown: string, sourcePath?: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return 'What\'s New\n\nNo changelog entries found.';
  }

  const lines = trimmed.split(/\r?\n/);
  const firstVersionIndex = lines.findIndex((line) => /^##\s+/.test(line));
  const body = firstVersionIndex >= 0 ? lines.slice(firstVersionIndex).join('\n').trim() : trimmed;
  const suffix = sourcePath ? `\n\nSource: ${sourcePath}` : '';
  return `What's New\n\n${body}${suffix}`;
}

function loadTuiChangelogInfo(): string {
  const candidates = [
    join(process.cwd(), 'CHANGELOG.md'),
    join(process.cwd(), 'CHANGELOG'),
    join(process.cwd(), 'docs', 'changelog.md'),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    return formatTuiChangelogInfo('');
  }
  try {
    return formatTuiChangelogInfo(readFileSync(path, 'utf8'), path);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return `What's New\n\nFailed to read changelog: ${errorMessage}`;
  }
}

export function formatTuiDebugInfo(params: {
  state: TuiState;
  terminal: { columns?: number; rows?: number };
  renderedLines: string[];
  logStats: unknown;
}): string {
  const width = params.terminal.columns ?? 0;
  const height = params.terminal.rows ?? 0;
  return [
    `Debug output at ${new Date().toISOString()}`,
    `Terminal: ${width}x${height}`,
    `Total rendered lines: ${params.renderedLines.length}`,
    '',
    '=== TUI State ===',
    JSON.stringify(params.state, null, 2),
    '',
    '=== Runtime Log Stats ===',
    JSON.stringify(params.logStats, null, 2),
    '',
    '=== Rendered lines with visible widths ===',
    ...params.renderedLines.map((line, index) => `[${index}] (w=${visibleWidth(line)}) ${JSON.stringify(line)}`),
    '',
  ].join('\n');
}

function writeTuiDebugInfo(deps: Pick<CommandHandlerDeps, 'state' | 'tui'>): string {
  const debugPath = join(getLogDir(), 'xopc-tui-debug.log');
  const terminal = (deps.tui as unknown as { terminal?: { columns?: number; rows?: number } }).terminal ?? {};
  const width = terminal.columns ?? 100;
  const renderedLines =
    typeof (deps.tui as unknown as { render?: (width: number) => string[] }).render === 'function'
      ? (deps.tui as unknown as { render: (width: number) => string[] }).render(width)
      : [];
  const content = formatTuiDebugInfo({
    state: deps.state,
    terminal,
    renderedLines,
    logStats: getRuntimeLogStats(),
  });
  mkdirSync(dirname(debugPath), { recursive: true });
  writeFileSync(debugPath, content, 'utf8');
  return debugPath;
}

export function formatTuiModelsInfo(models: TuiModelChoice[]): string {
  if (models.length === 0) {
    return 'Models\n\nNo models available.';
  }
  const lines = ['Models', '', ...models.map((model) => `  ${formatModelChoice(model)}`)];
  return lines.join('\n');
}

export function formatTuiSessionListInfo(
  sessions: TuiSessionItem[],
  options: { currentSessionKey?: string; limit?: number } = {},
): string {
  if (sessions.length === 0) {
    return 'Sessions\n\nNo sessions found.';
  }
  const limit = options.limit ?? 20;
  const visible = sessions.slice(0, limit);
  const lines = ['Sessions', ''];
  for (const session of visible) {
    const current = session.key === options.currentSessionKey ? '* ' : '  ';
    const label = session.displayName?.trim() || session.key;
    const description = formatSessionPickerDescription(session, { showKey: Boolean(session.displayName) });
    lines.push(`${current}${label}${description ? ` — ${description}` : ''}`);
  }
  if (sessions.length > visible.length) {
    lines.push('', `Showing ${visible.length} of ${sessions.length} sessions. Use /resume to search.`);
  }
  return lines.join('\n');
}

function sessionTreeGroup(session: TuiSessionItem): { agentId: string; root: string; leaf: string } {
  const parsed = parseAgentSessionKey(session.key);
  const agentId = parsed?.agentId ?? 'legacy';
  const rest = parsed?.rest ?? session.key;
  const parts = rest.split(':').filter(Boolean);
  const root = parts[0] ?? rest;
  const leaf = parts.length > 1 ? parts.slice(1).join(':') : rest;
  return { agentId, root, leaf };
}

export function formatTuiSessionTreeInfo(
  sessions: TuiSessionItem[],
  options: { currentSessionKey?: string; limitPerGroup?: number } = {},
): string {
  if (sessions.length === 0) {
    return 'Session Tree\n\nNo sessions found.';
  }
  const limitPerGroup = options.limitPerGroup ?? 8;
  const byKey = new Map(sessions.map((session) => [session.key, session]));
  const groups = new Map<string, TuiSessionItem[]>();
  for (const session of sessions) {
    const group = sessionTreeGroup(session);
    const key = `${group.agentId}:${group.root}`;
    const list = groups.get(key) ?? [];
    list.push(session);
    groups.set(key, list);
  }

  const lines = ['Session Tree', ''];
  const sortedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [groupKey, groupSessions] of sortedGroups) {
    const [agentId, ...rootParts] = groupKey.split(':');
    lines.push(`${agentId}/${rootParts.join(':')}`);
    const sorted = [...groupSessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    const visible = sorted.slice(0, limitPerGroup);
    for (const session of visible) {
      const current = session.key === options.currentSessionKey ? '*' : ' ';
      const group = sessionTreeGroup(session);
      const label = session.displayName?.trim() || group.leaf;
      const description = formatSessionPickerDescription(session, {
        showKey: Boolean(session.displayName),
      });
      lines.push(`  ${current} ${label}${description ? ` — ${description}` : ''}`);
      if (session.forkedFromSessionKey) {
        const source = byKey.get(session.forkedFromSessionKey);
        const sourceLabel = source?.displayName?.trim() || session.forkedFromSessionKey;
        lines.push(`      forked from ${sourceLabel}`);
      }
    }
    if (sorted.length > visible.length) {
      lines.push(`    ... ${sorted.length - visible.length} more`);
    }
  }
  lines.push('', 'Use /resume to search and open a session.');
  return lines.join('\n');
}

export function formatTuiTranscriptTreeInfo(
  entries: TuiTranscriptTreeEntry[],
  options: { limit?: number; allEntries?: TuiTranscriptTreeEntry[] } = {},
): string {
  if (entries.length === 0) {
    return 'Transcript Tree\n\nNo transcript entries found.';
  }
  const limit = options.limit ?? 80;
  const visible = entries.slice(0, limit);
  const prefixes = transcriptTreeInfoPrefixes(visible, options.allEntries ?? entries);
  const lines = ['Transcript Tree', ''];
  for (const entry of visible) {
    const prefix = prefixes.get(entry.id) ?? (entry.depth === 0 ? '-' : '  └─');
    const activeMarker = entry.isOnActivePath || entry.isCurrentLeaf ? '• ' : '';
    const turn = entry.turn > 0 ? `#${entry.turn} ` : '';
    const userLabel = entry.userLabel ? `[${entry.userLabel}] ` : '';
    lines.push(`${prefix} ${activeMarker}${turn}${userLabel}${formatTuiTranscriptTreeEntryDisplayText(entry)}`);
  }
  if (entries.length > visible.length) {
    lines.push('', `Showing ${visible.length} of ${entries.length} entries.`);
  }
  lines.push('', 'Interactive /tree supports search, filters, folds, labels, and fork selection.');
  return lines.join('\n');
}

function transcriptTreeInfoPrefixes(
  entries: TuiTranscriptTreeEntry[],
  allEntries: TuiTranscriptTreeEntry[] = entries,
): Map<string, string> {
  const byId = new Map(allEntries.map((entry) => [entry.id, entry]));
  const visibleIds = new Set(entries.map((entry) => entry.id));
  const parentByEntryId = new Map<string, string | null>();
  const childrenByParentId = new Map<string | null, string[]>();

  const nearestVisibleParent = (entry: TuiTranscriptTreeEntry, index: number): string | null => {
    let parentId = entry.parentId;
    while (parentId) {
      if (visibleIds.has(parentId)) return parentId;
      parentId = byId.get(parentId)?.parentId;
    }
    if (entry.depth > 0) {
      for (let i = index - 1; i >= 0; i -= 1) {
        const candidate = entries[i];
        if (candidate && candidate.depth < entry.depth) return candidate.id;
      }
    }
    return null;
  };

  for (const [index, entry] of entries.entries()) {
    const parentId = nearestVisibleParent(entry, index);
    parentByEntryId.set(entry.id, parentId);
    const children = childrenByParentId.get(parentId) ?? [];
    children.push(entry.id);
    childrenByParentId.set(parentId, children);
  }

  const prefixes = new Map<string, string>();
  for (const entry of entries) {
    const visibleParentId = parentByEntryId.get(entry.id) ?? null;
    if (visibleParentId === null) {
      prefixes.set(entry.id, '-');
      continue;
    }

    const ancestors: string[] = [];
    let parentId: string | null | undefined = visibleParentId;
    while (parentId) {
      ancestors.unshift(parentId);
      parentId = parentByEntryId.get(parentId) ?? null;
    }

    let prefix = '  ';
    for (const ancestor of ancestors.slice(1)) {
      prefix += hasTranscriptTreeInfoFollowingSibling(
        ancestor,
        parentByEntryId.get(ancestor) ?? null,
        childrenByParentId,
      )
        ? '│  '
        : '   ';
    }
    prefix += hasTranscriptTreeInfoFollowingSibling(entry.id, visibleParentId, childrenByParentId)
      ? '├─'
      : '└─';
    prefixes.set(entry.id, prefix);
  }
  return prefixes;
}

function hasTranscriptTreeInfoFollowingSibling(
  entryId: string,
  parentId: string | null,
  childrenByParentId: Map<string | null, string[]>,
): boolean {
  const siblings = childrenByParentId.get(parentId) ?? [];
  return siblings.indexOf(entryId) < siblings.length - 1;
}

export function formatTuiWorkflowsInfo(entries: CatalogEntry[]): string {
  if (entries.length === 0) {
    return 'Workflows\n\nNo workflows found.';
  }
  const lines = ['Workflows', ''];
  for (const entry of entries) {
    const tags = entry.tags?.length ? ` [${entry.tags.join(', ')}]` : '';
    lines.push(`  ${entry.name} (${entry.source})${tags}`);
    if (entry.description) {
      lines.push(`    ${entry.description}`);
    }
  }
  lines.push('', 'Run a workflow with /<name>, or inspect one with /workflow view <name>.');
  return lines.join('\n');
}

export function formatTuiWorkflowDetail(name: string): string {
  const catalog = createWorkflowCatalog();
  const loaded = catalog.load(name);
  const meta = loaded.meta;
  const lines = [
    `Workflow: ${loaded.name}`,
    '',
    `Source: ${loaded.source}${loaded.path ? ` (${loaded.path})` : ''}`,
    `Description: ${meta.description}`,
  ];
  if (meta.whenToUse) {
    lines.push(`When to use: ${meta.whenToUse}`);
  }
  if (meta.tags?.length) {
    lines.push(`Tags: ${meta.tags.join(', ')}`);
  }
  if (meta.estimatedAgents) {
    lines.push(`Agents: ${meta.estimatedAgents.min}-${meta.estimatedAgents.max}`);
  }
  lines.push('', 'Script:', loaded.script.trim());
  return lines.join('\n');
}

function formatTuiSessionStatsBlock(stats?: TuiSessionStats): string[] {
  if (!stats) return [];
  return [
    '',
    'Messages',
    `User: ${formatNumber(stats.userMessages)}`,
    `Assistant: ${formatNumber(stats.assistantMessages)}`,
    `Tool Calls: ${formatNumber(stats.toolCalls)}`,
    `Tool Results: ${formatNumber(stats.toolResults)}`,
    `Context Rows: ${formatNumber(stats.contextRows)}`,
    `Total Rows: ${formatNumber(stats.totalMessages)}`,
    '',
    'Token Usage',
    `Input: ${formatNumber(stats.tokens.input)}`,
    `Output: ${formatNumber(stats.tokens.output)}`,
    `Cache Read: ${formatNumber(stats.tokens.cacheRead)}`,
    `Cache Write: ${formatNumber(stats.tokens.cacheWrite)}`,
    `Total: ${formatNumber(stats.tokens.total)}`,
  ];
}

export function formatTuiSessionInfo(state: TuiState, stats?: TuiSessionStats): string {
  const parsedKey = parseAgentSessionKey(state.currentSessionKey);
  const tokenEstimate = state.sessionInfo.totalTokens ?? state.sessionInfo.contextTokens;
  const contextPercent =
    state.sessionInfo.contextUsagePercent ??
    computeContextUsagePercent(tokenEstimate, state.sessionInfo.contextWindow);
  const contextLabel =
    formatContextUsageLabel(contextPercent, state.sessionInfo.contextWindow) ?? '-';
  const connectionLabel = state.isConnected ? 'connected' : 'disconnected';

  return [
    'Session Info',
    '',
    `Name: ${formatMaybe(state.sessionInfo.displayName)}`,
    `Key: ${state.currentSessionKey}`,
    `Agent: ${formatMaybe(parsedKey?.agentId)}`,
    `Connection: ${connectionLabel} (${formatMaybe(state.connectionStatus)})`,
    `Activity: ${formatMaybe(state.activityStatus)}`,
    `Model: ${formatModelLabel(state)}`,
    `Thinking: ${formatMaybe(state.sessionInfo.thinkingLevel)}`,
    `Reasoning: ${formatMaybe(state.sessionInfo.reasoningLevel)}`,
    `Verbose: ${formatMaybe(state.sessionInfo.verboseLevel)}`,
    `Tokens: ${formatNumber(tokenEstimate)}`,
    `Context: ${contextLabel}`,
    `Tools: ${state.toolsExpanded ? 'expanded' : 'collapsed'}`,
    `Thinking Display: ${state.showThinking ? 'on' : 'off'}`,
    `Queue: ${state.messageFollowUpQueue.length}`,
    `Steering Queue: ${state.steeringQueue.length}`,
    ...formatTuiSessionStatsBlock(stats),
  ].join('\n');
}

export function formatTuiUsageInfo(state: TuiState, stats?: TuiSessionStats): string {
  const tokenEstimate = state.sessionInfo.totalTokens ?? state.sessionInfo.contextTokens;
  const contextPercent =
    state.sessionInfo.contextUsagePercent ??
    computeContextUsagePercent(tokenEstimate, state.sessionInfo.contextWindow);
  const contextLabel =
    formatContextUsageLabel(contextPercent, state.sessionInfo.contextWindow) ?? '-';

  return [
    'Usage',
    '',
    `Estimated Tokens: ${formatNumber(tokenEstimate)}`,
    `Context Window: ${formatNumber(state.sessionInfo.contextWindow)}`,
    `Context Usage: ${contextLabel}`,
    `Model: ${formatModelLabel(state)}`,
    ...(stats
      ? [
          '',
          'Transcript Tokens',
          `Input: ${formatNumber(stats.tokens.input)}`,
          `Output: ${formatNumber(stats.tokens.output)}`,
          `Cache Read: ${formatNumber(stats.tokens.cacheRead)}`,
          `Cache Write: ${formatNumber(stats.tokens.cacheWrite)}`,
          `Total: ${formatNumber(stats.tokens.total)}`,
          '',
          'Transcript Rows',
          `User: ${formatNumber(stats.userMessages)}`,
          `Assistant: ${formatNumber(stats.assistantMessages)}`,
          `Tool Calls: ${formatNumber(stats.toolCalls)}`,
          `Tool Results: ${formatNumber(stats.toolResults)}`,
          `Context Rows: ${formatNumber(stats.contextRows)}`,
          `Total Rows: ${formatNumber(stats.totalMessages)}`,
        ]
      : []),
  ].join('\n');
}

export function formatTuiCompactionResult(result: TuiCompactionResult): string {
  if (!result.compacted) {
    return result.summary ?? 'Nothing to compact';
  }
  const before = formatNumber(result.tokensBefore);
  const after = formatNumber(result.tokensAfter);
  const summary = result.transcriptSummary?.trim();
  const lines = [
    '[compaction]',
    '',
    `Tokens: ${before} -> ${after}`,
  ];
  if (summary) {
    lines.push('', summary);
  } else if (result.summary) {
    lines.push('', result.summary);
  }
  return lines.join('\n');
}

export function formatTuiContextInfo(state: TuiState): string {
  const tokenEstimate = state.sessionInfo.totalTokens ?? state.sessionInfo.contextTokens;
  const contextPercent =
    state.sessionInfo.contextUsagePercent ??
    computeContextUsagePercent(tokenEstimate, state.sessionInfo.contextWindow);
  const contextLabel =
    formatContextUsageLabel(contextPercent, state.sessionInfo.contextWindow) ?? '-';
  const remaining =
    tokenEstimate != null && state.sessionInfo.contextWindow != null
      ? Math.max(0, state.sessionInfo.contextWindow - tokenEstimate)
      : null;

  return [
    'Context',
    '',
    `Used: ${formatNumber(tokenEstimate)}`,
    `Window: ${formatNumber(state.sessionInfo.contextWindow)}`,
    `Remaining: ${formatNumber(remaining)}`,
    `Usage: ${contextLabel}`,
  ].join('\n');
}

export function formatTuiConfigInfo(state: TuiState): string {
  const scopedModels =
    state.scopedModelRefs == null
      ? 'all'
      : state.scopedModelRefs.length === 0
        ? 'none'
        : state.scopedModelRefs.join(', ');
  return [
    'Config',
    '',
    `Session: ${state.currentSessionKey}`,
    `Model: ${formatModelLabel(state)}`,
    `Thinking: ${formatMaybe(state.sessionInfo.thinkingLevel)}`,
    `Reasoning: ${formatMaybe(state.sessionInfo.reasoningLevel)}`,
    `Verbose: ${formatMaybe(state.sessionInfo.verboseLevel)}`,
    `Tools: ${state.toolsExpanded ? 'expanded' : 'collapsed'}`,
    `Thinking Display: ${state.showThinking ? 'on' : 'off'}`,
    `Scoped Models: ${scopedModels}`,
  ].join('\n');
}

type TuiTrustProvenance = {
  extensionId: string;
  source: string;
  installMethod?: string;
};

function extensionSecurityConfig(config: Config): {
  checkPermissions: boolean;
  allowUntrusted: boolean;
  allow: string[];
  trackProvenance: boolean;
  allowPromptInjection: boolean;
} {
  const raw = (config.extensions as Record<string, unknown> | undefined)?.security;
  const sec = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    checkPermissions: sec.checkPermissions !== false,
    allowUntrusted: sec.allowUntrusted === true,
    allow: Array.isArray(sec.allow) ? sec.allow.filter((id): id is string => typeof id === 'string') : [],
    trackProvenance: sec.trackProvenance !== false,
    allowPromptInjection: sec.allowPromptInjection === true,
  };
}

export function formatTuiTrustInfo(
  config: Config,
  options: {
    configPath?: string;
    provenance?: TuiTrustProvenance[];
  } = {},
): string {
  const security = extensionSecurityConfig(config);
  const enabled = Array.isArray((config.extensions as Record<string, unknown> | undefined)?.enabled)
    ? ((config.extensions as Record<string, unknown>).enabled as unknown[])
      .filter((id): id is string => typeof id === 'string')
    : [];
  const disabled = Array.isArray((config.extensions as Record<string, unknown> | undefined)?.disabled)
    ? ((config.extensions as Record<string, unknown>).disabled as unknown[])
      .filter((id): id is string => typeof id === 'string')
    : [];
  const provenance = options.provenance ?? [];
  const lines = [
    'Extension Trust',
    '',
    'xopc uses extension allowlists and path-safety checks instead of pi project trust.',
    '',
    `Config: ${options.configPath ?? resolveConfigPath()}`,
    `Permission Checks: ${security.checkPermissions ? 'on' : 'off'}`,
    `Allow Untrusted: ${security.allowUntrusted ? 'yes' : 'no'}`,
    `Prompt Injection Hooks: ${security.allowPromptInjection ? 'allowed' : 'blocked'}`,
    `Track Provenance: ${security.trackProvenance ? 'on' : 'off'}`,
    `Allowlist: ${security.allow.length ? security.allow.join(', ') : '(empty)'}`,
    `Enabled: ${enabled.length ? enabled.join(', ') : '(activation rules/defaults)'}`,
    `Disabled: ${disabled.length ? disabled.join(', ') : '(none)'}`,
  ];

  if (provenance.length > 0) {
    lines.push('', 'Loaded Extensions:');
    for (const item of provenance.slice(0, 20)) {
      const method = item.installMethod ? `, ${item.installMethod}` : '';
      lines.push(`  ${item.extensionId} — ${item.source}${method}`);
    }
    if (provenance.length > 20) {
      lines.push(`  ... ${provenance.length - 20} more`);
    }
  }

  lines.push(
    '',
    'To trust specific extensions, add their ids to extensions.security.allow and run /reload.',
    'To audit installed extensions, run: xopc extensions audit',
  );
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
    openModelPicker: (initialSearch?: string) => void;
    openSessionPicker: () => void;
    openSessionTree: () => void;
    openTranscriptTree: () => void;
    openUserMessageFork: () => void;
    openScopedModels: () => void;
    openThinkingSelector: () => void;
    openSettings: () => void;
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
  runBtwQuery?: (question: string) => void | Promise<void>;
  forkSession?: (rawKey?: string) => void | Promise<void>;
  extensionSlashCommands?: TuiExtensionSlashCommandEntry[];
  extensionShortcuts?: TuiHotkeyExtensionShortcut[];
  currentAgentId?: string;
  setSession?: (rawKey: string) => Promise<void>;
  resetSession?: () => Promise<void>;
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
        chatLog.addSystem(
          formatTuiTrustInfo(loadConfig(), {
            configPath: resolveConfigPath(),
            provenance: provenanceTracker.getAll(),
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
