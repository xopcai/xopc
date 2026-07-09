import type { KeybindingsManager, SelectItem } from '@earendil-works/pi-tui';

import { ScopedModelsSelector } from './components/scoped-models-selector.js';
import { SettingsSelector } from './components/settings-selector.js';
import { SearchableSelectList } from './components/searchable-select-list.js';
import { SessionSelector } from './components/session-selector.js';
import { ThinkingSelector } from './components/thinking-selector.js';
import { formatKeyIds } from './format-tui-hotkeys.js';
import type { TuiAgentInfo, TuiSessionItem } from './tui-backend.js';
import type { PickerServices } from './tui-picker-services.js';
import { formatSessionPickerDescription } from './tui-session-format.js';
import { searchableSelectListTheme, theme } from './theme.js';
import { buildTuiTimelineTurns } from './tui-timeline.js';
import {
  formatTimelineOpenedHint,
  TimelineSelectList,
} from './tui-timeline-picker.js';
import { filterTuiTranscriptTreeEntries } from './tui-transcript-tree.js';
import {
  defaultTranscriptForkKey,
  formatTranscriptTreeFilterHint,
  formatUserMessageForkOpenedHint,
  TranscriptTreeSelectList,
  userMessageForkSelectItems,
} from './tui-transcript-tree-picker.js';
import {
  listThinkingLevels,
  normalizeThinkLevel,
  type ThinkLevel,
} from '../agent/transcript/thinking-types.js';
import { parseAgentSessionKey } from '../routing/agent-session-key.js';
import {
  getProjectTrustOptions,
  hasTrustRequiringProjectResources,
} from '../project-trust/trust-store.js';
import type { ReviewContext } from '../review/review-git.js';

type SearchableSelectItem = SelectItem & { searchText?: string };

function formatSelectNavigationHint(keybindings: KeybindingsManager): string {
  const up = formatKeyIds(keybindings, 'tui.select.up', { capitalize: true });
  const down = formatKeyIds(keybindings, 'tui.select.down', { capitalize: true });
  return `${up}/${down}`;
}

export function formatScopedModelsOpenedHint(keybindings: KeybindingsManager): string {
  const modelCycle = formatKeyIds(keybindings, 'app.model.cycleForward', { capitalize: true });
  return `Scoped models for ${modelCycle}`;
}

export function formatScopedModelsSavedHint(params: {
  refs: string[] | null;
  total: number;
  keybindings: KeybindingsManager;
}): string {
  const modelCycle = formatKeyIds(params.keybindings, 'app.model.cycleForward', {
    capitalize: true,
  });
  if (params.refs === null) {
    return `${modelCycle} cycles all ${params.total} models`;
  }
  const count = params.refs.length;
  return `${modelCycle} cycles ${count} scoped model${count === 1 ? '' : 's'}`;
}

export function formatSettingsOpenedHint(keybindings: KeybindingsManager): string {
  const nav = formatSelectNavigationHint(keybindings);
  const confirm = formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true });
  const cancel = formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true });
  return `Settings (${nav} · ${confirm} toggle · ${cancel} close)`;
}

export function formatThinkingSelectorHint(keybindings: KeybindingsManager): string {
  const nav = formatSelectNavigationHint(keybindings);
  const confirm = formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true });
  const cancel = formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true });
  return `Thinking level (${nav} · ${confirm} select · ${cancel} close)`;
}

export function formatThinkingLevelSavedHint(level: ThinkLevel): string {
  return `Thinking level: ${level}`;
}

export function formatProjectTrustOpenedHint(keybindings: KeybindingsManager): string {
  const nav = formatSelectNavigationHint(keybindings);
  const confirm = formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true });
  const cancel = formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true });
  return `Project trust (${nav} · ${confirm} select · ${cancel} close)`;
}

export function formatReviewPickerOpenedHint(keybindings: KeybindingsManager): string {
  const nav = formatSelectNavigationHint(keybindings);
  const confirm = formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true });
  const cancel = formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true });
  return `Review (${nav} · type to filter · ${confirm} select · ${cancel} close)`;
}

export function formatAgentPickerOpenedHint(keybindings: KeybindingsManager): string {
  const nav = formatSelectNavigationHint(keybindings);
  const confirm = formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true });
  const cancel = formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true });
  return `Switch agent (${nav} · ${confirm} select · ${cancel} close)`;
}

function agentSelectItems(agents: TuiAgentInfo[], currentAgentId?: string): SelectItem[] {
  const current = currentAgentId?.trim().toLowerCase();
  return [...agents]
    .filter((agent) => agent.enabled !== false)
    .sort((a, b) => {
      if (a.id === current && b.id !== current) return -1;
      if (b.id === current && a.id !== current) return 1;
      if (a.id === 'coder' && b.id !== 'coder') return -1;
      if (b.id === 'coder' && a.id !== 'coder') return 1;
      return a.id.localeCompare(b.id);
    })
    .map((agent) => ({
      label: agent.id === current ? `${agent.id} (current)` : agent.id,
      value: agent.id,
      description: agent.displayName,
    }));
}

export function formatSessionTreeOpenedHint(keybindings: KeybindingsManager): string {
  const nav = formatSelectNavigationHint(keybindings);
  const confirm = formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true });
  const cancel = formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true });
  return `Session tree (${nav} · type to filter · ${confirm} resume · ${cancel} close)`;
}

export async function openTimelineOverlay(
  svc: PickerServices,
  initialQuery?: string,
): Promise<void> {
  const items = await svc.client.loadTimeline(svc.state.currentSessionKey);
  const turns = buildTuiTimelineTurns(items);
  if (turns.length === 0) {
    svc.chatLog.addSystem('No timeline turns found.');
    svc.tui.requestRender();
    return;
  }

  const viewState = svc.chatLog.getTimelineViewportState();
  const activeDisplayIndex =
    viewState.mode === 'history'
      ? viewState.displayIndex
      : turns[turns.length - 1]?.displayIndex;
  const list = new TimelineSelectList(turns, {
    keybindings: svc.keybindings,
    ...(activeDisplayIndex !== undefined ? { activeDisplayIndex } : {}),
    ...(initialQuery ? { initialQuery } : {}),
  });
  list.onSelect = (turn) => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    void (async () => {
      if (!svc.chatLog.jumpToDisplayIndex(turn.displayIndex)) {
        const loaded =
          turn.rowNumber !== undefined
            ? await svc.loadHistoryWindow({ rowNumber: turn.rowNumber })
            : false;
        if (!loaded || !svc.chatLog.jumpToDisplayIndex(turn.displayIndex)) {
          svc.chatLog.addSystem(`Turn ${turn.turn} is outside loaded history.`);
        }
      }
      svc.tui.requestRender();
    })();
  };
  list.onCancel = () => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.tui.requestRender();
  };

  svc.openOverlay(list);
  svc.chatLog.addSystem(theme.dim(formatTimelineOpenedHint(svc.keybindings)));
  svc.tui.requestRender();
}

function resumeSession(svc: PickerServices, sessionKey: string): void {
  svc.setSessionKey(sessionKey);
  svc.clearChatForSessionSwitch();
  svc.chatLog.addSystem(`Session: ${sessionKey}`);
  void svc
    .refreshSessionInfo()
    .then(() => svc.loadSessionHistory())
    .then(() => {
      svc.updateHeader();
      svc.tui.requestRender();
    });
  svc.tui.requestRender();
}

function sessionTreeGroup(session: TuiSessionItem): { agentId: string; root: string; leaf: string } {
  const raw = session.key.trim();
  const parts = raw.split(':').filter(Boolean);
  if (parts.length >= 3 && parts[0] === 'agent') {
    const rest = parts.slice(2);
    return {
      agentId: parts[1] ?? 'main',
      root: rest[0] ?? raw,
      leaf: rest.length > 1 ? rest.slice(1).join(':') : rest.join(':') || raw,
    };
  }
  return { agentId: 'legacy', root: raw || 'session', leaf: raw || 'session' };
}

export function sessionTreeSelectItems(
  sessions: TuiSessionItem[],
  currentSessionKey?: string,
): SelectItem[] {
  const byKey = new Map(sessions.map((session) => [session.key, session]));
  return [...sessions]
    .sort((a, b) => {
      const ga = sessionTreeGroup(a);
      const gb = sessionTreeGroup(b);
      const groupCmp = `${ga.agentId}:${ga.root}`.localeCompare(`${gb.agentId}:${gb.root}`);
      if (groupCmp !== 0) return groupCmp;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    })
    .map((session) => {
      const group = sessionTreeGroup(session);
      const current = session.key === currentSessionKey ? '* ' : '  ';
      const label = session.displayName?.trim() || group.leaf;
      const parent = session.forkedFromSessionKey
        ? (byKey.get(session.forkedFromSessionKey)?.displayName?.trim() ?? session.forkedFromSessionKey)
        : null;
      const description = [
        `${group.agentId}/${group.root}`,
        formatSessionPickerDescription(session, { showKey: Boolean(session.displayName) }),
        parent ? `forked from ${parent}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
  return {
    value: session.key,
        label: `${current}${label}`,
        description,
        searchText: `${session.key} ${session.displayName ?? ''} ${session.model ?? ''} ${parent ?? ''}`,
      };
    });
}





export async function openAgentPickerOverlay(svc: PickerServices): Promise<void> {
  const parsed = parseAgentSessionKey(svc.state.currentSessionKey);
  if (!parsed) {
    svc.chatLog.addSystem('Cannot switch agent: current session is not an agent session.');
    svc.tui.requestRender();
    return;
  }
  if (svc.state.activeRunId) {
    svc.chatLog.addSystem('Cannot switch agent while a run is active. Abort first.');
    svc.tui.requestRender();
    return;
  }
  if (!svc.switchAgentSession) {
    svc.chatLog.addSystem('Agent switching is not available in this mode.');
    svc.tui.requestRender();
    return;
  }
  const agents = await svc.client.listAgents();
  const items = agentSelectItems(agents, parsed.agentId);
  if (items.length === 0) {
    svc.chatLog.addSystem('No agents available.');
    svc.tui.requestRender();
    return;
  }
  svc.chatLog.addSystem(theme.dim(formatAgentPickerOpenedHint(svc.keybindings)));
  const list = new SearchableSelectList(items, Math.min(10, items.length), searchableSelectListTheme, {
    searchPromptText: 'agent> ',
  });
  const closeSelector = svc.openEditorSelector(list, list);
  list.onSelect = (item) => {
    closeSelector();
    const targetAgentId = item.value;
    if (targetAgentId === parsed.agentId) {
      svc.chatLog.addSystem(`Already using agent: ${targetAgentId}`);
      svc.tui.requestRender();
      return;
    }
    const targetSessionKey = `agent:${targetAgentId}:${parsed.rest}`;
    void Promise.resolve(svc.switchAgentSession?.(targetSessionKey, targetAgentId))
      .then(() => {
        svc.chatLog.addSystem(`Switched to agent: ${targetAgentId}\nSession: ${targetSessionKey}`);
      })
      .catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        svc.chatLog.addSystem(`Agent switch failed: ${errorMessage}`);
      })
      .finally(() => svc.tui.requestRender());
    svc.tui.requestRender();
  };
  list.onCancel = () => closeSelector();
  svc.tui.requestRender();
}

function quoteReviewArg(value: string): string {
  return /^[A-Za-z0-9._/@:-]+$/.test(value) ? value : JSON.stringify(value);
}

function formatReviewStatus(status: ReviewContext['status']): string {
  if (status.isClean) return 'working tree clean';
  const parts: string[] = [];
  if (status.changedFiles > 0) parts.push(`${status.changedFiles} changed`);
  if (status.untrackedFiles > 0) parts.push(`${status.untrackedFiles} untracked`);
  return parts.join(', ');
}

function reviewPresetItems(context: ReviewContext): SearchableSelectItem[] {
  return [
    {
      value: 'base',
      label: 'Review against a base branch',
      description: context.defaultBaseBranch ? `PR Style · default ${context.defaultBaseBranch}` : 'PR Style',
      searchText: 'pr pull request base branch merge base',
    },
    {
      value: 'uncommitted',
      label: 'Review uncommitted changes',
      description: formatReviewStatus(context.status),
      searchText: 'workspace working tree uncommitted diff status',
    },
    {
      value: 'commit',
      label: 'Review a commit',
      description: context.commits.length > 0 ? `${context.commits.length} recent commits` : 'no commits found',
      searchText: 'commit sha history log',
    },
    {
      value: 'custom',
      label: 'Custom review instructions',
      description: 'edit prompt before sending',
      searchText: 'custom instructions focus prompt',
    },
  ];
}

function branchSelectItems(context: ReviewContext): SelectItem[] {
  return context.branches
    .filter((branch) => !branch.current)
    .map((branch) => ({
      value: branch.name,
      label: branch.name,
      description: [
        branch.name === context.defaultBaseBranch ? 'default' : '',
        branch.remote ? 'remote' : 'local',
      ].filter(Boolean).join(' · '),
      searchText: branch.name,
    }));
}

function commitSelectItems(context: ReviewContext): SelectItem[] {
  return context.commits.map((commit) => ({
    value: commit.sha,
    label: commit.subject,
    description: [commit.shortSha, commit.date?.slice(0, 10)].filter(Boolean).join(' · '),
    searchText: `${commit.sha} ${commit.shortSha} ${commit.subject}`,
  }));
}

function openReviewBranchSelector(svc: PickerServices, context: ReviewContext): void {
  const items = branchSelectItems(context);
  if (items.length === 0) {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.chatLog.addSystem('No base branches available for review.');
    svc.tui.requestRender();
    return;
  }
  const list = new SearchableSelectList(items, Math.min(10, items.length), searchableSelectListTheme, {
    searchPromptText: 'branch> ',
  });
  const defaultIndex = context.defaultBaseBranch
    ? items.findIndex((item) => item.value === context.defaultBaseBranch)
    : -1;
  if (defaultIndex >= 0) list.setSelectedIndex(defaultIndex);
  list.onSelect = (item) => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.sendMessage(`/review --base ${quoteReviewArg(item.value)}`);
  };
  list.onCancel = () => {
    openReviewPresetSelector(svc, context);
  };
  svc.openOverlay(list);
  svc.chatLog.addSystem(theme.dim('Select a base branch to review'));
  svc.tui.requestRender();
}

function openReviewCommitSelector(svc: PickerServices, context: ReviewContext): void {
  const items = commitSelectItems(context);
  if (items.length === 0) {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.chatLog.addSystem('No commits available for review.');
    svc.tui.requestRender();
    return;
  }
  const list = new SearchableSelectList(items, Math.min(12, items.length), searchableSelectListTheme, {
    searchPromptText: 'commit> ',
  });
  list.onSelect = (item) => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.sendMessage(`/review --commit ${item.value}`);
  };
  list.onCancel = () => {
    openReviewPresetSelector(svc, context);
  };
  svc.openOverlay(list);
  svc.chatLog.addSystem(theme.dim('Select a commit to review'));
  svc.tui.requestRender();
}

function openReviewPresetSelector(svc: PickerServices, context: ReviewContext): void {
  const items = reviewPresetItems(context);
  const list = new SearchableSelectList(items, Math.min(8, items.length), searchableSelectListTheme, {
    searchPromptText: 'review> ',
  });
  list.onSelect = (item) => {
    if (item.value === 'uncommitted') {
      svc.closeOverlay();
      svc.tui.setFocus(svc.editor);
      svc.sendMessage('/review --uncommitted');
      return;
    }
    if (item.value === 'custom') {
      svc.closeOverlay();
      svc.tui.setFocus(svc.editor);
      svc.setEditorText('/review --custom ');
      svc.tui.requestRender();
      return;
    }
    if (item.value === 'base') {
      openReviewBranchSelector(svc, context);
      return;
    }
    if (item.value === 'commit') {
      openReviewCommitSelector(svc, context);
    }
  };
  list.onCancel = () => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.tui.requestRender();
  };

  svc.openOverlay(list);
  svc.chatLog.addSystem(theme.dim(formatReviewPickerOpenedHint(svc.keybindings)));
  svc.tui.requestRender();
}

export async function openReviewLauncherOverlay(svc: PickerServices): Promise<void> {
  if (!svc.client.getReviewContext) {
    svc.chatLog.addSystem('Review picker is not available in this mode. Use /review --uncommitted, /review --base <branch>, or /review --commit <sha>.');
    svc.tui.requestRender();
    return;
  }
  let context: ReviewContext;
  try {
    context = await svc.client.getReviewContext(svc.state.currentSessionKey);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    svc.chatLog.addSystem(`Review picker failed: ${errorMessage}`);
    svc.tui.requestRender();
    return;
  }
  openReviewPresetSelector(svc, context);
}

/** Ctrl+Shift+P — session picker with rename/delete. */
export async function openSessionPickerOverlay(svc: PickerServices): Promise<void> {
  const sessions = await svc.client.listSessions();
  if (sessions.length === 0) {
    svc.chatLog.addSystem('No sessions listed.');
    svc.tui.requestRender();
    return;
  }

  const selector = new SessionSelector(
    sessions,
    {
      onResume: (sessionKey) => {
        svc.closeOverlay();
        svc.tui.setFocus(svc.editor);
        resumeSession(svc, sessionKey);
      },
      onRename: async (sessionKey, name) => {
        const result = await svc.client.renameSession(sessionKey, name);
        return result.ok ? { ok: true } : { ok: false, error: 'Rename failed' };
      },
      onDelete: async (sessionKey) => {
        if (sessionKey === svc.state.currentSessionKey) {
          return { ok: false, error: 'Switch away before deleting the active session' };
        }
        const result = await svc.client.deleteSession(sessionKey);
        return result.ok ? { ok: true } : { ok: false, error: 'Delete failed' };
      },
      onCancel: () => {
        svc.closeOverlay();
        svc.tui.setFocus(svc.editor);
        svc.tui.requestRender();
      },
      requestRender: () => svc.tui.requestRender(),
    },
    svc.keybindings,
    sessions.find((s) => s.key === svc.state.currentSessionKey)?.cwd ?? process.cwd(),
    svc.state.currentSessionKey,
  );

  svc.openOverlay(selector);
  svc.chatLog.addSystem(theme.dim('Session picker'));
  svc.tui.requestRender();
}

/** Searchable session tree navigation overlay. */
export async function openSessionTreeOverlay(svc: PickerServices): Promise<void> {
  const sessions = await svc.client.listSessions();
  if (sessions.length === 0) {
    svc.chatLog.addSystem('No sessions listed.');
    svc.tui.requestRender();
    return;
  }

  const items = sessionTreeSelectItems(sessions, svc.state.currentSessionKey);
  const list = new SearchableSelectList(items, Math.min(14, items.length), searchableSelectListTheme);
  list.onSelect = (item) => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    resumeSession(svc, item.value);
  };
  list.onCancel = () => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.tui.requestRender();
  };

  svc.openOverlay(list);
  svc.chatLog.addSystem(theme.dim(formatSessionTreeOpenedHint(svc.keybindings)));
  svc.tui.requestRender();
}

/** Searchable current-transcript tree overlay. */
export async function openTranscriptTreeOverlay(svc: PickerServices): Promise<void> {
  const entries = await svc.client.loadTranscriptTree(svc.state.currentSessionKey);
  const filterMode = svc.getTuiSettings().treeFilterMode;
  const visibleEntries = filterTuiTranscriptTreeEntries(entries, filterMode);
  if (visibleEntries.length === 0) {
    svc.chatLog.addSystem('No transcript entries found.');
    svc.tui.requestRender();
    return;
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const list = new TranscriptTreeSelectList(entries, filterMode, svc.keybindings, Math.min(16, visibleEntries.length));
  list.onSelect = (item) => {
    const entry = byId.get(item.value);
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    if (!entry) {
      svc.tui.requestRender();
      return;
    }
    const targetKey = defaultTranscriptForkKey(svc.state.currentSessionKey, entry.id);
    const sourceSessionKey = svc.state.currentSessionKey;
    svc.chatLog.addSystem(theme.dim(`Forking transcript at ${entry.id}...`));
    void svc.client
      .forkSessionAt(sourceSessionKey, targetKey, entry.id)
      .then((result) => {
        resumeSession(svc, result.sessionKey);
        svc.chatLog.addBranchSummary({
          sourceSessionKey,
          targetSessionKey: result.sessionKey,
          rowCount: result.rowCount,
          entryId: entry.id,
        });
      })
      .catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        svc.chatLog.addSystem(`Fork failed: ${errorMessage}`);
        svc.tui.requestRender();
      });
    svc.tui.requestRender();
  };
  list.onCancel = () => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.tui.requestRender();
  };
  list.onFilterChange = (mode) => {
    svc.chatLog.addSystem(theme.dim(`Transcript tree filter: ${mode}`));
    svc.tui.requestRender();
  };
  list.onLabelSubmit = (entry, label) => {
    void svc.client
      .setTranscriptLabel(svc.state.currentSessionKey, entry.id, label)
      .then(() => {
        list.updateEntryLabel(entry.id, label);
        svc.chatLog.addSystem(
          theme.dim(label?.trim() ? `Labeled ${entry.id}: ${label.trim()}` : `Cleared label for ${entry.id}`),
        );
        svc.tui.requestRender();
      })
      .catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        svc.chatLog.addSystem(`Label failed: ${errorMessage}`);
        svc.tui.requestRender();
      });
  };

  svc.openOverlay(list);
  svc.chatLog.addSystem(theme.dim(formatTranscriptTreeFilterHint(svc.keybindings, filterMode)));
  svc.tui.requestRender();
}

/** Pi-style `/fork` overlay: select a previous user message and branch there. */
export async function openUserMessageForkOverlay(svc: PickerServices): Promise<void> {
  const entries = await svc.client.loadTranscriptTree(svc.state.currentSessionKey);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const items = userMessageForkSelectItems(entries);
  if (items.length === 0) {
    svc.chatLog.addSystem('No messages to fork from.');
    svc.tui.requestRender();
    return;
  }

  const list = new SearchableSelectList(items, Math.min(10, items.length), searchableSelectListTheme, {
    wrapNavigation: true,
  });
  list.setSelectedIndex(items.length - 1);
  list.onSelect = (item) => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    const entry = byId.get(item.value);
    const targetKey = defaultTranscriptForkKey(svc.state.currentSessionKey, item.value);
    const sourceSessionKey = svc.state.currentSessionKey;
    svc.chatLog.addSystem(theme.dim(`Forking from ${item.value}...`));
    void svc.client
      .forkSessionAt(sourceSessionKey, targetKey, item.value)
      .then((result) => {
        resumeSession(svc, result.sessionKey);
        if (entry?.contentText) {
          svc.setEditorText(entry.contentText);
        }
        svc.chatLog.addBranchSummary({
          sourceSessionKey,
          targetSessionKey: result.sessionKey,
          rowCount: result.rowCount,
          entryId: item.value,
          restoredText: entry?.contentText,
        });
      })
      .catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        svc.chatLog.addSystem(`Fork failed: ${errorMessage}`);
        svc.tui.requestRender();
      });
    svc.tui.requestRender();
  };
  list.onCancel = () => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.tui.requestRender();
  };

  svc.openOverlay(list);
  svc.chatLog.addSystem(theme.dim(formatUserMessageForkOpenedHint(svc.keybindings)));
  svc.tui.requestRender();
}

/** `/scoped-models` — limit Ctrl+P model cycle set. */
export async function openScopedModelsOverlay(svc: PickerServices): Promise<void> {
  const catalog = await svc.client.listModels();
  svc.setModelChoices(catalog);
  if (catalog.length === 0) {
    svc.chatLog.addSystem('No models available.');
    svc.tui.requestRender();
    return;
  }

  const selector = new ScopedModelsSelector(
    catalog,
    svc.getScopedModelRefs(),
    {
      onSave: (refs) => {
        svc.setScopedModelRefs(refs);
        svc.refreshCycleModels();
        svc.closeOverlay();
        svc.tui.setFocus(svc.editor);
        svc.chatLog.addSystem(
          theme.dim(formatScopedModelsSavedHint({
            refs,
            total: catalog.length,
            keybindings: svc.keybindings,
          })),
        );
        svc.tui.requestRender();
      },
      onCancel: () => {
        svc.closeOverlay();
        svc.tui.setFocus(svc.editor);
        svc.tui.requestRender();
      },
      requestRender: () => svc.tui.requestRender(),
    },
    svc.keybindings,
  );

  svc.openOverlay(selector);
  svc.chatLog.addSystem(theme.dim(formatScopedModelsOpenedHint(svc.keybindings)));
  svc.tui.requestRender();
}

/** `/settings` — TUI preferences overlay. */
export function openSettingsOverlay(svc: PickerServices): void {
  const selector = new SettingsSelector(svc.getTuiSettings(), {
    onChange: (settings) => svc.applyTuiSettings(settings),
    onThemePreview: (themeId) => svc.previewTheme(themeId),
    onReloadKeybindings: () => svc.reloadKeybindings(),
    onCancel: () => {
      svc.previewTheme(svc.getTuiSettings().theme);
      svc.closeOverlay();
      svc.tui.setFocus(svc.editor);
      svc.tui.requestRender();
    },
  });

  svc.openOverlay(selector);
  svc.chatLog.addSystem(theme.dim(formatSettingsOpenedHint(svc.keybindings)));
  svc.tui.requestRender();
}

/** `/think` — select and persist the current session thinking level. */
export function openThinkingSelectorOverlay(svc: PickerServices): void {
  const current = normalizeThinkLevel(svc.state.sessionInfo.thinkingLevel) ?? 'medium';
  const levels = listThinkingLevels(
    svc.state.sessionInfo.modelProvider,
    svc.state.sessionInfo.model,
  ).map((level) => (level === 'on' ? 'low' : level)) as ThinkLevel[];
  const uniqueLevels = [...new Set(levels)];

  const selector = new ThinkingSelector(current, uniqueLevels, {
    onSelect: (level) => {
      void svc.setThinkingLevel(level).then(() => {
        svc.closeOverlay();
        svc.tui.setFocus(svc.editor);
      });
    },
    onCancel: () => {
      svc.closeOverlay();
      svc.tui.setFocus(svc.editor);
      svc.tui.requestRender();
    },
  }, svc.keybindings);

  svc.openOverlay(selector);
  svc.chatLog.addSystem(theme.dim(formatThinkingSelectorHint(svc.keybindings)));
  svc.tui.requestRender();
}

export function openProjectTrustOverlay(svc: PickerServices): void {
  const cwd = process.cwd();
  const trustStore = svc.getProjectTrustStore();
  const currentStored = trustStore.getEntry(cwd);
  const sessionDecision = svc.getProjectTrustSessionDecision();
  const hasProjectResources = hasTrustRequiringProjectResources(cwd);
  const options = getProjectTrustOptions(cwd, { includeSessionOnly: true });
  const optionsByLabel = new Map(options.map((option) => [option.label, option]));
  const items: SelectItem[] = options.map((option) => ({
    value: option.label,
    label: option.label,
    description: option.savedPath ?? 'Current TUI session only',
  }));
  const list = new SearchableSelectList(items, Math.min(8, items.length), searchableSelectListTheme, {
    searchPromptText: 'trust: ',
  });

  list.onSelect = (item) => {
    const selected = optionsByLabel.get(item.value);
    if (!selected) return;
    if (selected.updates.length > 0) {
      trustStore.setMany(selected.updates);
      svc.setProjectTrustSessionDecision(null);
    } else {
      svc.setProjectTrustSessionDecision(selected.trusted);
    }
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    const scope = selected.savedPath ? `saved for ${selected.savedPath}` : 'this session only';
    svc.chatLog.addSystem(theme.dim(`Project trust: ${selected.trusted ? 'trusted' : 'not trusted'} (${scope})`));
    svc.tui.requestRender();
  };
  list.onCancel = () => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.tui.requestRender();
  };

  svc.openOverlay(list);
  const storedLabel = currentStored
    ? `${currentStored.decision ? 'trusted' : 'not trusted'} from ${currentStored.path}`
    : 'not saved';
  const sessionLabel = sessionDecision === null ? 'none' : sessionDecision ? 'trusted' : 'not trusted';
  svc.chatLog.addSystem(
    theme.dim(
      [
        formatProjectTrustOpenedHint(svc.keybindings),
        `Project resources: ${hasProjectResources ? 'detected' : 'none detected'}`,
        `Stored: ${storedLabel}`,
        `Session: ${sessionLabel}`,
      ].join('\n'),
    ),
  );
  svc.tui.requestRender();
}
