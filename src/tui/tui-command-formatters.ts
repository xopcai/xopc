import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { visibleWidth } from '@earendil-works/pi-tui';

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
import { computeContextUsagePercent, formatContextUsageLabel } from './tui-context-usage.js';
import type { TuiState } from './tui-types.js';
import { formatSessionPickerDescription } from './tui-session-format.js';
import { formatTuiTranscriptTreeEntryDisplayText } from './tui-transcript-tree.js';
import { createWorkflowCatalog, type CatalogEntry } from '../agent/workflow/catalog.js';
import { normalizeVerboseLevel, type VerboseLevel } from '../agent/transcript/thinking-types.js';
import type { AuthProfileEntry } from '../auth/profiles/index.js';
import type { Config } from '../config/schema.js';
import { resolveConfigPath } from '../config/index.js';
import type { ProjectTrustStoreEntry } from '../project-trust/trust-store.js';
import {
  getProviderDisplayName,
  getSortedProviders,
  providerSupportsApiKey,
  providerSupportsOAuth,
} from '../providers/index.js';
import { parseAgentSessionKey } from '../routing/agent-session-key.js';
import { getLogDir, getRuntimeLogStats } from '../utils/logger.js';

export interface TuiExportRequest {
  format: TuiExportFormat;
  outputPath?: string;
}

export interface TuiImportRequest {
  inputPath?: string;
  targetKey?: string;
}

export type TuiDebugDeps = {
  state: TuiState;
  tui: unknown;
};

const SHARE_AUDIENCES = new Set<TuiShareAudience>(['friend', 'colleague', 'public']);
const SHARE_MODES = new Set<TuiShareMode>(['auto', 'force-file', 'force-site', 'force-zip']);

function formatMaybe(value: string | undefined | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : '-';
}

function formatNumber(value: number | undefined | null): string {
  return value == null ? '-' : value.toLocaleString();
}

export function formatModelLabel(state: TuiState): string {
  const provider = state.sessionInfo.modelProvider?.trim();
  const model = state.sessionInfo.model?.trim();
  if (provider && model) {
    return `${provider}/${model}`;
  }
  return formatMaybe(model ?? provider);
}

export function nextVerboseLevel(current: string | undefined | null): VerboseLevel {
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
      lines.push(`OAuth: /login ${trimmedProvider} (or xopc auth login ${trimmedProvider})`);
    }
    if (providerSupportsApiKey(trimmedProvider)) {
      lines.push(`API key: xopc auth set ${trimmedProvider} <key>`);
    }
    if (!providerSupportsOAuth(trimmedProvider) && !providerSupportsApiKey(trimmedProvider)) {
      lines.push('No direct xopc auth setup command is advertised for this provider.');
    }
    lines.push('', 'In the TUI, /login <provider> runs OAuth directly when supported.');
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
    'Use /login <provider> to start OAuth directly when supported.',
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

export function loadTuiChangelogInfo(): string {
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

export function writeTuiDebugInfo(deps: TuiDebugDeps): string {
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
  const agentId = parsed?.agentId ?? 'unknown';
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
  const lines = [
    `Workflow: ${loaded.name}`,
    '',
    `Source: ${loaded.metadata.source}`,
    `Description: ${loaded.description}`,
    `Revision: ${loaded.revision}`,
  ];
  if (loaded.metadata.whenToUse) {
    lines.push(`When to use: ${loaded.metadata.whenToUse}`);
  }
  if (loaded.metadata.tags.length) {
    lines.push(`Tags: ${loaded.metadata.tags.join(', ')}`);
  }
  if (loaded.metadata.estimatedAgents) {
    lines.push(`Agents: ${loaded.metadata.estimatedAgents.min}-${loaded.metadata.estimatedAgents.max}`);
  }
  lines.push('', 'Flow:', loaded.graph.nodes.map((node) => `- ${node.title} (${node.kind})`).join('\n'));
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
    `Pending Inputs: ${state.pendingInputCount}`,
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
    `Workspace: ${formatMaybe(state.sessionInfo.effectiveWorkspacePath)}`,
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
    cwd?: string;
    projectTrustStorePath?: string;
    projectTrustEntry?: ProjectTrustStoreEntry | null;
    projectTrustSessionDecision?: boolean | null;
    hasProjectResources?: boolean;
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
  const projectTrustEntry = options.projectTrustEntry ?? null;
  const projectTrustStatus =
    options.projectTrustSessionDecision !== null && options.projectTrustSessionDecision !== undefined
      ? `${options.projectTrustSessionDecision ? 'trusted' : 'not trusted'} (this session)`
      : projectTrustEntry
        ? `${projectTrustEntry.decision ? 'trusted' : 'not trusted'} from ${projectTrustEntry.path}`
        : 'not saved';
  const lines = [
    'Extension Trust',
    '',
    'Project trust gates project-local xopc resources and extension UI context.',
    '',
    `Project: ${options.cwd ?? 'unknown'}`,
    `Project Resources: ${options.hasProjectResources === undefined ? 'unknown' : options.hasProjectResources ? 'detected' : 'none detected'}`,
    `Project Trust: ${projectTrustStatus}`,
    `Trust Store: ${options.projectTrustStorePath ?? '(default)'}`,
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
    'Use /trust to change project trust for this folder or its parent.',
    'To trust specific extensions, add their ids to extensions.security.allow and run /reload.',
    'To audit installed extensions, run: xopc extensions audit',
  );
  return lines.join('\n');
}
