import {
  getKeybindings,
  Input,
  type Component,
  type Focusable,
  type Keybinding,
  type KeybindingsManager,
  matchesKey,
  type SelectItem,
  truncateToWidth,
  type TUI,
  visibleWidth,
} from '@earendil-works/pi-tui';
import { randomUUID } from 'node:crypto';

import { ScopedModelsSelector } from './components/scoped-models-selector.js';
import { SettingsSelector } from './components/settings-selector.js';
import { SearchableSelectList } from './components/searchable-select-list.js';
import { SessionSelector } from './components/session-selector.js';
import { ThinkingSelector } from './components/thinking-selector.js';
import { formatKeyIds, formatKeyText } from './format-tui-hotkeys.js';
import type {
  TuiBackend,
  TuiBranchSummary,
  TuiModelChoice,
  TuiSessionItem,
  TuiTranscriptTreeEntry,
} from './tui-backend.js';
import { formatSessionPickerDescription } from './tui-session-format.js';
import { searchableSelectListTheme, theme } from './theme.js';
import type { TuiSettings } from './tui-settings.js';
import type { TreeFilterMode } from './tui-settings.js';
import type { TuiState } from './tui-types.js';
import { modelRef } from './tui-scoped-models.js';
import {
  filterTuiTranscriptTreeEntries,
  formatTuiTranscriptTreeEntryDisplayText,
} from './tui-transcript-tree.js';
import {
  listThinkingLevels,
  normalizeThinkLevel,
  type ThinkLevel,
} from '../agent/transcript/thinking-types.js';

export type PickerServices = {
  tui: TUI;
  editor: Component;
  openOverlay: (c: Component) => void;
  closeOverlay: () => void;
  chatLog: {
    addSystem: (t: string) => void;
    addBranchSummary: (summary: TuiBranchSummary) => void;
  };
  client: TuiBackend;
  sendMessage: (text: string) => void;
  refreshSessionInfo: () => Promise<void>;
  updateHeader: () => void;
  state: Pick<TuiState, 'currentSessionKey' | 'sessionInfo'>;
  setSessionKey: (key: string) => void;
  clearChatForSessionSwitch: () => void;
  loadSessionHistory: () => Promise<void>;
  setEditorText: (text: string) => void;
  setModelChoices: (models: TuiModelChoice[]) => void;
  getScopedModelRefs: () => string[] | null;
  setScopedModelRefs: (refs: string[] | null) => void;
  refreshCycleModels: () => void;
  getTuiSettings: () => TuiSettings;
  applyTuiSettings: (settings: TuiSettings) => void;
  previewTheme: (themeId: string) => void;
  reloadKeybindings: () => void;
  setThinkingLevel: (level: ThinkLevel) => Promise<void>;
  keybindings: KeybindingsManager;
};

export function formatModelPickerHint(keybindings: KeybindingsManager): string {
  const nav = formatSelectNavigationHint(keybindings);
  const confirm = formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true });
  const cancel = formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true });
  return `Select model (${nav} · type to filter · ${confirm} select · ${cancel} close)`;
}

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

export function formatSessionTreeOpenedHint(keybindings: KeybindingsManager): string {
  const nav = formatSelectNavigationHint(keybindings);
  const confirm = formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true });
  const cancel = formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true });
  return `Session tree (${nav} · type to filter · ${confirm} resume · ${cancel} close)`;
}

export function formatTranscriptTreeOpenedHint(keybindings: KeybindingsManager): string {
  const nav = formatSelectNavigationHint(keybindings);
  const confirm = formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true });
  const cancel = formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true });
  return `Transcript tree (${nav} · type to filter · ${confirm} inspect · ${cancel} close)`;
}

export function formatTranscriptTreeFilterHint(
  keybindings: KeybindingsManager,
  filterMode: TuiSettings['treeFilterMode'],
): string {
  const base = formatTranscriptTreeOpenedHint(keybindings);
  const fold = formatKeyIds(keybindings, 'app.tree.foldOrUp', { capitalize: true });
  const unfold = formatKeyIds(keybindings, 'app.tree.unfoldOrDown', { capitalize: true });
  const editLabel = formatKeyIds(keybindings, 'app.tree.editLabel', { capitalize: true });
  const cycle = formatKeyIds(keybindings, 'app.tree.filter.cycleForward', { capitalize: true });
  const filter = filterMode === 'default' ? '' : ` [${filterMode}]`;
  return `${base}${filter} · ${fold}/${unfold} fold · ${editLabel} label · ${cycle} filter`;
}

const TRANSCRIPT_TREE_HELP_ITEMS: Array<{
  keys: Keybinding[];
  label: string;
  labelFirst?: boolean;
}> = [
  { keys: ['tui.select.up', 'tui.select.down'], label: 'move' },
  { keys: ['tui.editor.cursorLeft', 'tui.editor.cursorRight'], label: 'page' },
  { keys: ['app.tree.foldOrUp', 'app.tree.unfoldOrDown'], label: 'branch' },
  { keys: ['app.tree.editLabel'], label: 'label' },
  { keys: ['app.tree.toggleLabelTimestamp'], label: 'label time' },
  {
    keys: [
      'app.tree.filter.default',
      'app.tree.filter.noTools',
      'app.tree.filter.userOnly',
      'app.tree.filter.labeledOnly',
      'app.tree.filter.all',
    ],
    label: 'filters',
    labelFirst: true,
  },
  {
    keys: ['app.tree.filter.cycleForward', 'app.tree.filter.cycleBackward'],
    label: 'cycle',
    labelFirst: true,
  },
];

export function formatTranscriptTreeHelpLines(
  keybindings: KeybindingsManager,
  width: number,
): string[] {
  const availableWidth = Math.max(1, width);
  const items = TRANSCRIPT_TREE_HELP_ITEMS.map(({ keys, label, labelFirst }) => {
    const keyText = formatTranscriptTreeHelpKeys(keybindings, keys);
    if (!keyText) return label;
    return labelFirst ? `${label} ${keyText}` : `${keyText} ${label}`;
  });
  const indent = '  ';
  const separator = ' · ';
  const lines: string[] = [];
  let current = '';

  for (const item of items) {
    const indentedItem = `${indent}${item}`;
    const candidate = current ? `${current}${separator}${item}` : indentedItem;
    if (!current || visibleWidth(candidate) <= availableWidth) {
      current = candidate;
      continue;
    }
    lines.push(truncateToWidth(current, availableWidth, ''));
    current = visibleWidth(indentedItem) <= availableWidth ? indentedItem : item;
  }

  if (current) {
    lines.push(truncateToWidth(current, availableWidth, ''));
  }
  return lines;
}

function formatTranscriptTreeHelpKeys(
  keybindings: KeybindingsManager,
  ids: Keybinding[],
): string {
  const keys = ids.map((id) => keybindings.getKeys(id)[0]).filter((key) => key !== undefined);
  if (keys.length === 0) return '';
  return formatTranscriptTreeHelpKeyText(compactTranscriptTreeHelpKeys(keys.map(String)));
}

function compactTranscriptTreeHelpKeys(keys: string[]): string {
  if (keys.length === 1) return keys[0] ?? '';
  const parts = keys.map((key) => {
    const separatorIndex = key.lastIndexOf('+');
    return separatorIndex === -1
      ? { prefix: '', suffix: key }
      : { prefix: key.slice(0, separatorIndex + 1), suffix: key.slice(separatorIndex + 1) };
  });
  const prefix = parts[0]?.prefix ?? '';
  return prefix && parts.every((part) => part.prefix === prefix)
    ? `${prefix}${parts.map((part) => part.suffix).join('/')}`
    : keys.join('/');
}

function formatTranscriptTreeHelpKeyText(key: string): string {
  return formatKeyText(key, { capitalize: true })
    .replace(/\bpageUp\b/gi, 'pgup')
    .replace(/\bpageDown\b/gi, 'pgdn')
    .replace(/\bup\b/gi, '↑')
    .replace(/\bdown\b/gi, '↓')
    .replace(/\bleft\b/gi, '←')
    .replace(/\bright\b/gi, '→');
}

export function formatUserMessageForkOpenedHint(keybindings: KeybindingsManager): string {
  const nav = formatSelectNavigationHint(keybindings);
  const confirm = formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true });
  const cancel = formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true });
  return `Fork from message (${nav} · type to filter · ${confirm} fork · ${cancel} close)`;
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

function defaultTranscriptForkKey(currentSessionKey: string, entryId: string): string {
  const suffix = randomUUID().slice(0, 8);
  const cleanEntry = entryId.replace(/[^a-z0-9_.-]+/gi, '-');
  return `${currentSessionKey}:fork:${cleanEntry}-${suffix}`;
}

function formatLabelTimestamp(timestamp: string, now = new Date()): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const time = `${hours}:${minutes}`;
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return time;
  }
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (date.getFullYear() === now.getFullYear()) {
    return `${month}/${day} ${time}`;
  }
  const year = date.getFullYear().toString().slice(-2);
  return `${year}/${month}/${day} ${time}`;
}

function transcriptTreeLabel(
  entry: TuiTranscriptTreeEntry,
  options: { showLabelTimestamps?: boolean; prefix?: string } = {},
): string {
  const marker = options.prefix ?? (entry.depth === 0 ? '- ' : '  └─ ');
  const activeMarker = entry.isOnActivePath || entry.isCurrentLeaf ? '• ' : '';
  const turn = entry.turn > 0 ? `#${entry.turn} ` : '';
  const labelTime =
    options.showLabelTimestamps && entry.labelTimestamp
      ? `${formatLabelTimestamp(entry.labelTimestamp)} `
      : '';
  const userLabel = entry.userLabel ? `[${entry.userLabel}] ${labelTime}` : '';
  return `${marker}${activeMarker}${turn}${userLabel}${formatTuiTranscriptTreeEntryDisplayText(entry)}`;
}

export function transcriptTreeSelectItems(
  entries: TuiTranscriptTreeEntry[],
  options: {
    showLabelTimestamps?: boolean;
    foldedIds?: ReadonlySet<string>;
    foldableIds?: ReadonlySet<string>;
    allEntries?: TuiTranscriptTreeEntry[];
  } = {},
): SelectItem[] {
  const prefixes = transcriptTreePrefixes(entries, options.allEntries ?? entries);
  return entries.map((entry) => {
    const displayText = formatTuiTranscriptTreeEntryDisplayText(entry);
    return {
      value: entry.id,
      label: `${formatTranscriptFoldMarker(entry.id, options)}${transcriptTreeLabel(entry, {
        ...options,
        prefix: prefixes.get(entry.id),
      })}`,
      description: entry.createdAt ?? entry.id,
      searchText: [
        entry.id,
        entry.parentId ?? '',
        entry.label,
        displayText,
        entry.userLabel ?? '',
        entry.labelTimestamp ?? '',
        entry.isOnActivePath || entry.isCurrentLeaf ? 'active current' : '',
        entry.role ?? '',
        entry.preview ?? '',
        entry.createdAt ?? '',
      ].join(' '),
    };
  });
}

function transcriptTreePrefixes(
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
      prefixes.set(entry.id, '- ');
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
      prefix += hasFollowingSibling(ancestor, parentByEntryId.get(ancestor) ?? null, childrenByParentId)
        ? '│  '
        : '   ';
    }
    prefix += hasFollowingSibling(entry.id, visibleParentId, childrenByParentId) ? '├─ ' : '└─ ';
    prefixes.set(entry.id, prefix);
  }
  return prefixes;
}

function hasFollowingSibling(
  entryId: string,
  parentId: string | null,
  childrenByParentId: Map<string | null, string[]>,
): boolean {
  const siblings = childrenByParentId.get(parentId) ?? [];
  return siblings.indexOf(entryId) < siblings.length - 1;
}

function formatTranscriptFoldMarker(
  entryId: string,
  options: { foldedIds?: ReadonlySet<string>; foldableIds?: ReadonlySet<string> },
): string {
  if (options.foldedIds?.has(entryId)) return '⊞ ';
  if (options.foldableIds?.has(entryId)) return '⊟ ';
  return '';
}

const TREE_FILTER_MODES: TreeFilterMode[] = ['default', 'no-tools', 'user-only', 'labeled-only', 'all'];

function transcriptTreeStatusLabels(mode: TreeFilterMode, showLabelTimestamps: boolean): string {
  const labels: string[] = [];
  if (mode === 'no-tools') labels.push('[no-tools]');
  if (mode === 'user-only') labels.push('[user]');
  if (mode === 'labeled-only') labels.push('[labeled]');
  if (mode === 'all') labels.push('[all]');
  if (showLabelTimestamps) labels.push('[+label time]');
  return labels.length > 0 ? ` ${labels.join(' ')}` : '';
}

function filterTranscriptTreeSelectItems(items: SelectItem[], query: string): SelectItem[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return items;
  return items.filter((item) => {
    const searchText = (item as SelectItem & { searchText?: string }).searchText ?? '';
    const text = [item.label, item.description ?? '', searchText].join(' ').toLowerCase();
    return tokens.every((token) => text.includes(token));
  });
}

export class TranscriptTreeSelectList implements Component, Focusable {
  private readonly list: SearchableSelectList;
  private filterMode: TreeFilterMode;
  private labelInput: Input | null = null;
  private labelEntry: TuiTranscriptTreeEntry | null = null;
  private showLabelTimestamps = false;
  private readonly foldedEntryIds = new Set<string>();
  private lastSelectedEntryId: string | undefined;

  onSelect?: (item: SelectItem) => void;
  onCancel?: () => void;
  onFilterChange?: (mode: TreeFilterMode) => void;
  onLabelSubmit?: (entry: TuiTranscriptTreeEntry, label: string | undefined) => void;

  constructor(
    private readonly entries: TuiTranscriptTreeEntry[],
    initialFilterMode: TreeFilterMode,
    private readonly keybindings: KeybindingsManager,
    private readonly maxVisible: number,
  ) {
    this.filterMode = initialFilterMode;
    this.list = new SearchableSelectList(
      transcriptTreeSelectItems(filterTuiTranscriptTreeEntries(entries, this.filterMode), {
        showLabelTimestamps: this.showLabelTimestamps,
      }),
      maxVisible,
      searchableSelectListTheme,
      {
        searchPromptText: 'Type to search: ',
        filterItems: filterTranscriptTreeSelectItems,
      },
    );
    this.list.onSelect = (item) => this.onSelect?.(item);
    this.list.onCancel = () => this.onCancel?.();
    this.refreshItems({ selectedId: this.initialSelectedEntryId() });
  }

  get focused(): boolean {
    return this.labelInput?.focused ?? this.list.focused;
  }

  set focused(value: boolean) {
    if (this.labelInput) {
      this.labelInput.focused = value;
      return;
    }
    this.list.focused = value;
  }

  getFilterMode(): TreeFilterMode {
    return this.filterMode;
  }

  private initialSelectedEntryId(): string | undefined {
    return (
      this.entries.find((entry) => entry.isCurrentLeaf)?.id ??
      [...this.entries].reverse().find((entry) => entry.isOnActivePath)?.id
    );
  }

  private filteredEntries(mode: TreeFilterMode): TuiTranscriptTreeEntry[] {
    const baseEntries = filterTuiTranscriptTreeEntries(this.entries, mode);
    if (this.foldedEntryIds.size === 0) return baseEntries;
    const byId = new Map(this.entries.map((entry) => [entry.id, entry]));
    return baseEntries.filter((entry) => {
      let parentId = entry.parentId;
      while (parentId) {
        if (this.foldedEntryIds.has(parentId)) return false;
        parentId = byId.get(parentId)?.parentId;
      }
      return true;
    });
  }

  private visibleUnfoldedEntries(mode = this.filterMode): TuiTranscriptTreeEntry[] {
    return filterTuiTranscriptTreeEntries(this.entries, mode);
  }

  private hasVisibleChild(entryId: string): boolean {
    const maps = this.visibleTreeMaps(this.visibleUnfoldedEntries());
    return this.isFoldableEntryId(entryId, maps);
  }

  private isFoldableEntryId(
    entryId: string,
    maps: {
      childrenByParentId: Map<string | null, string[]>;
      parentByEntryId: Map<string, string | null>;
    },
  ): boolean {
    const children = maps.childrenByParentId.get(entryId);
    if (!children || children.length === 0) return false;
    const parentId = maps.parentByEntryId.get(entryId);
    if (!parentId) return true;
    return (maps.childrenByParentId.get(parentId)?.length ?? 0) > 1;
  }

  private nearestVisibleEntryId(
    entryId: string | undefined,
    visibleEntries: TuiTranscriptTreeEntry[],
  ): string | undefined {
    if (!entryId) return undefined;
    const visibleIds = new Set(visibleEntries.map((entry) => entry.id));
    const byId = new Map(this.entries.map((entry) => [entry.id, entry]));
    let currentId: string | undefined = entryId;
    while (currentId) {
      if (visibleIds.has(currentId)) return currentId;
      currentId = byId.get(currentId)?.parentId;
    }
    return undefined;
  }

  private visibleTreeMaps(visibleEntries: TuiTranscriptTreeEntry[]): {
    childrenByParentId: Map<string | null, string[]>;
    parentByEntryId: Map<string, string | null>;
    indexByEntryId: Map<string, number>;
  } {
    const visibleIds = new Set(visibleEntries.map((entry) => entry.id));
    const byId = new Map(this.entries.map((entry) => [entry.id, entry]));
    const childrenByParentId = new Map<string | null, string[]>();
    const parentByEntryId = new Map<string, string | null>();
    const indexByEntryId = new Map<string, number>();

    childrenByParentId.set(null, []);
    const nearestVisibleParent = (entry: TuiTranscriptTreeEntry): string | null => {
      let parentId = entry.parentId;
      while (parentId) {
        if (visibleIds.has(parentId)) return parentId;
        parentId = byId.get(parentId)?.parentId;
      }
      return null;
    };

    visibleEntries.forEach((entry, index) => {
      const parentId = nearestVisibleParent(entry);
      parentByEntryId.set(entry.id, parentId);
      indexByEntryId.set(entry.id, index);
      const siblings = childrenByParentId.get(parentId) ?? [];
      siblings.push(entry.id);
      childrenByParentId.set(parentId, siblings);
    });

    return { childrenByParentId, parentByEntryId, indexByEntryId };
  }

  private moveToBranchSegment(direction: 'up' | 'down'): void {
    const selectedId = this.list.getSelectedItem()?.value;
    if (!selectedId) return;
    const visibleEntries = this.filteredEntries(this.filterMode);
    const maps = this.visibleTreeMaps(visibleEntries);
    let currentId = selectedId;

    if (direction === 'down') {
      while (true) {
        const children = maps.childrenByParentId.get(currentId) ?? [];
        if (children.length === 0) {
          this.list.setSelectedValue(currentId);
          return;
        }
        if (children.length > 1) {
          this.list.setSelectedValue(children[0]!);
          return;
        }
        currentId = children[0]!;
      }
    }

    while (true) {
      const parentId = maps.parentByEntryId.get(currentId) ?? null;
      if (parentId === null) {
        this.list.setSelectedValue(currentId);
        return;
      }
      const children = maps.childrenByParentId.get(parentId) ?? [];
      if (children.length > 1) {
        const segmentIndex = maps.indexByEntryId.get(currentId);
        const selectedIndex = maps.indexByEntryId.get(selectedId);
        if (segmentIndex !== undefined && selectedIndex !== undefined && segmentIndex < selectedIndex) {
          this.list.setSelectedValue(currentId);
          return;
        }
      }
      currentId = parentId;
    }
  }

  private refreshItems(options: { mode?: TreeFilterMode; selectedId?: string } = {}): void {
    const mode = options.mode ?? this.filterMode;
    const selectedId = options.selectedId ?? this.list.getSelectedItem()?.value ?? this.lastSelectedEntryId;
    const visibleEntries = this.filteredEntries(mode);
    const unfoldedVisibleEntries = this.visibleUnfoldedEntries(mode);
    const unfoldedMaps = this.visibleTreeMaps(unfoldedVisibleEntries);
    const foldableIds = new Set(
      unfoldedVisibleEntries
        .filter((entry) => this.isFoldableEntryId(entry.id, unfoldedMaps))
        .map((entry) => entry.id),
    );
    this.list.setItems(
      transcriptTreeSelectItems(visibleEntries, {
        showLabelTimestamps: this.showLabelTimestamps,
        foldedIds: this.foldedEntryIds,
        foldableIds,
        allEntries: this.entries,
      }),
    );
    const targetId = this.nearestVisibleEntryId(selectedId, visibleEntries);
    if (targetId) {
      this.list.setSelectedValue(targetId);
    }
    this.rememberSelectedEntry();
  }

  private setFilterMode(mode: TreeFilterMode): void {
    const selectedId = this.list.getSelectedItem()?.value;
    this.filterMode = mode;
    this.foldedEntryIds.clear();
    this.refreshItems({ mode, selectedId });
    this.onFilterChange?.(mode);
  }

  private foldSelectedEntry(): boolean {
    const selectedId = this.list.getSelectedItem()?.value;
    if (!selectedId || !this.hasVisibleChild(selectedId) || this.foldedEntryIds.has(selectedId)) {
      return false;
    }
    this.foldedEntryIds.add(selectedId);
    this.refreshItems({ selectedId });
    return true;
  }

  private unfoldSelectedEntry(): boolean {
    const selectedId = this.list.getSelectedItem()?.value;
    if (!selectedId || !this.foldedEntryIds.delete(selectedId)) {
      return false;
    }
    this.refreshItems({ selectedId });
    return true;
  }

  private clearSearchAndFolds(): boolean {
    if (this.list.getSearchQuery().length === 0) return false;
    const selectedId = this.list.getSelectedItem()?.value ?? this.lastSelectedEntryId;
    this.foldedEntryIds.clear();
    this.refreshItems({ selectedId });
    this.list.clearSearch({ selectedValue: selectedId });
    this.rememberSelectedEntry();
    return true;
  }

  private pageSelection(direction: 'up' | 'down'): void {
    const visibleEntries = this.filteredEntries(this.filterMode);
    const selectedId = this.list.getSelectedItem()?.value;
    const selectedIndex = selectedId
      ? visibleEntries.findIndex((entry) => entry.id === selectedId)
      : 0;
    const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const delta = direction === 'up' ? -this.maxVisible : this.maxVisible;
    const nextIndex = Math.max(0, Math.min(visibleEntries.length - 1, currentIndex + delta));
    const nextEntry = visibleEntries[nextIndex];
    if (nextEntry) {
      this.list.setSelectedValue(nextEntry.id);
    }
  }

  updateEntryLabel(entryId: string, label: string | undefined): void {
    const entry = this.entries.find((candidate) => candidate.id === entryId);
    if (!entry) return;
    if (label?.trim()) {
      entry.userLabel = label.trim();
      entry.labelTimestamp = new Date().toISOString();
    } else {
      delete entry.userLabel;
      delete entry.labelTimestamp;
    }
    this.refreshItems();
  }

  private toggleFilterMode(mode: TreeFilterMode): void {
    this.setFilterMode(this.filterMode === mode ? 'default' : mode);
  }

  private cycleFilter(delta: 1 | -1): void {
    const idx = TREE_FILTER_MODES.indexOf(this.filterMode);
    const next = TREE_FILTER_MODES[(idx + delta + TREE_FILTER_MODES.length) % TREE_FILTER_MODES.length]!;
    this.setFilterMode(next);
  }

  private rememberSelectedEntry(): void {
    const selectedId = this.list.getSelectedItem()?.value;
    if (selectedId) {
      this.lastSelectedEntryId = selectedId;
    }
  }

  handleInput(keyData: string): void {
    if (this.labelInput) {
      if (this.keybindings.matches(keyData, 'tui.select.confirm')) {
        const value = this.labelInput.getValue().trim();
        const entry = this.labelEntry;
        this.labelInput = null;
        this.labelEntry = null;
        if (entry) {
          this.onLabelSubmit?.(entry, value || undefined);
        }
        return;
      }
      if (this.keybindings.matches(keyData, 'tui.select.cancel')) {
        this.labelInput = null;
        this.labelEntry = null;
        return;
      }
      this.labelInput.handleInput(keyData);
      return;
    }

    if (this.keybindings.matches(keyData, 'app.tree.filter.default')) {
      this.setFilterMode('default');
      return;
    }
    if (this.keybindings.matches(keyData, 'app.tree.filter.noTools')) {
      this.toggleFilterMode('no-tools');
      return;
    }
    if (this.keybindings.matches(keyData, 'app.tree.filter.userOnly')) {
      this.toggleFilterMode('user-only');
      return;
    }
    if (this.keybindings.matches(keyData, 'app.tree.filter.labeledOnly')) {
      this.toggleFilterMode('labeled-only');
      return;
    }
    if (this.keybindings.matches(keyData, 'app.tree.filter.all')) {
      this.toggleFilterMode('all');
      return;
    }
    if (this.keybindings.matches(keyData, 'app.tree.filter.cycleForward')) {
      this.cycleFilter(1);
      return;
    }
    if (this.keybindings.matches(keyData, 'app.tree.filter.cycleBackward')) {
      this.cycleFilter(-1);
      return;
    }
    if (this.keybindings.matches(keyData, 'app.tree.foldOrUp')) {
      if (!this.foldSelectedEntry()) {
        this.moveToBranchSegment('up');
      }
      return;
    }
    if (this.keybindings.matches(keyData, 'app.tree.unfoldOrDown')) {
      if (!this.unfoldSelectedEntry()) {
        this.moveToBranchSegment('down');
      }
      return;
    }
    if (
      this.keybindings.matches(keyData, 'tui.editor.cursorLeft') ||
      this.keybindings.matches(keyData, 'tui.select.pageUp')
    ) {
      this.pageSelection('up');
      return;
    }
    if (
      this.keybindings.matches(keyData, 'tui.editor.cursorRight') ||
      this.keybindings.matches(keyData, 'tui.select.pageDown')
    ) {
      this.pageSelection('down');
      return;
    }
    if (this.keybindings.matches(keyData, 'tui.select.cancel')) {
      if (this.clearSearchAndFolds()) return;
      this.onCancel?.();
      return;
    }
    if (this.keybindings.matches(keyData, 'app.tree.editLabel')) {
      const item = this.list.getSelectedItem();
      const entry = item ? this.entries.find((candidate) => candidate.id === item.value) : undefined;
      if (entry) {
        this.labelEntry = entry;
        this.labelInput = new Input();
        if (entry.userLabel) {
          this.labelInput.setValue(entry.userLabel);
        }
        this.labelInput.focused = this.list.focused;
      }
      return;
    }
    if (this.keybindings.matches(keyData, 'app.tree.toggleLabelTimestamp')) {
      this.showLabelTimestamps = !this.showLabelTimestamps;
      this.refreshItems();
      return;
    }
    const queryBefore = this.list.getSearchQuery();
    const selectedId = this.list.getSelectedItem()?.value ?? this.lastSelectedEntryId;
    if (this.list.getSelectedItem()?.value) {
      this.lastSelectedEntryId = this.list.getSelectedItem()?.value;
    }
    this.list.handleInput(keyData);
    if (this.list.getSearchQuery() !== queryBefore) {
      if (this.foldedEntryIds.size > 0) {
        this.foldedEntryIds.clear();
        this.refreshItems({ selectedId });
        return;
      }
      if (selectedId) {
        this.list.setSelectedValue(selectedId);
      }
      this.rememberSelectedEntry();
    }
  }

  render(width: number): string[] {
    const stats = this.list.getSelectionStats();
    const statusText = theme.dim(
      `(${stats.selected}/${stats.total})${transcriptTreeStatusLabels(this.filterMode, this.showLabelTimestamps)}`,
    );
    if (this.labelInput) {
      const target = this.labelEntry?.userLabel ?? this.labelEntry?.label ?? this.labelEntry?.id ?? 'entry';
      const confirm = formatKeyIds(this.keybindings, 'tui.select.confirm', { capitalize: true });
      const cancel = formatKeyIds(this.keybindings, 'tui.select.cancel', { capitalize: true });
      return [
        statusText,
        theme.dim(`label ${target} (empty to clear)`),
        ...this.labelInput.render(Math.max(1, width)),
        theme.dim(`${confirm} save · ${cancel} cancel`),
      ];
    }
    const listLines = this.list.render(width);
    const renderedListLines =
      stats.total === 0
        ? listLines.map((line) =>
            line.includes('No matches') ? searchableSelectListTheme.noMatch('  No entries found') : line,
          )
        : listLines;
    return [
      statusText,
      ...renderedListLines,
      '',
      ...formatTranscriptTreeHelpLines(this.keybindings, width).map((line) => theme.dim(line)),
    ];
  }

  invalidate(): void {
    this.list.invalidate();
  }

  getSelectedItem(): SelectItem | null {
    return this.list.getSelectedItem();
  }
}

export function userMessageForkSelectItems(entries: TuiTranscriptTreeEntry[]): SelectItem[] {
  return entries
    .filter((entry) => entry.role === 'user')
    .map((entry, index, all) => ({
      value: entry.id,
      label: entry.preview?.trim() || `User message ${index + 1}`,
      description: `Message ${index + 1} of ${all.length}`,
      searchText: [entry.id, entry.preview ?? '', entry.contentText ?? '', entry.createdAt ?? ''].join(' '),
    }));
}

function currentModelRef(state: Pick<TuiState, 'sessionInfo'>): string | null {
  const provider = state.sessionInfo.modelProvider?.trim();
  const model = state.sessionInfo.model?.trim();
  if (provider && model) return `${provider}/${model}`;
  return model && model.includes('/') ? model : null;
}

export function modelPickerSelectItems(
  models: TuiModelChoice[],
  state: Pick<TuiState, 'sessionInfo'>,
): SelectItem[] {
  const currentRef = currentModelRef(state);
  return models
    .map((m) => {
      const ref = `${m.provider}/${m.id}`;
      const isCurrent = ref === currentRef;
      const name = m.name && m.name !== m.id ? m.name : '';
      return {
        value: ref,
        label: `${isCurrent ? '✓ ' : ''}${m.id}`,
        description: [m.provider, name, isCurrent ? 'current' : ''].filter(Boolean).join(' · '),
        searchText: `${m.provider} ${m.id} ${m.name ?? ''} ${ref}`,
        isCurrent,
      };
    })
    .sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      return a.value.localeCompare(b.value);
    })
    .map(({ isCurrent: _isCurrent, ...item }) => item);
}

type ModelPickerScope = 'scoped' | 'all';

function scopedModelChoices(models: TuiModelChoice[], refs: string[]): TuiModelChoice[] {
  const byRef = new Map(models.map((model) => [modelRef(model), model]));
  return refs.map((ref) => byRef.get(ref)).filter((model): model is TuiModelChoice => Boolean(model));
}

export class ModelPickerSelectList implements Component, Focusable {
  private scope: ModelPickerScope;
  private readonly list: SearchableSelectList;
  private readonly allItems: SelectItem[];
  private readonly scopedItems: SelectItem[];

  onSelect?: (item: SelectItem) => void;
  onCancel?: () => void;

  constructor(
    models: TuiModelChoice[],
    state: Pick<TuiState, 'sessionInfo'>,
    scopedRefs: string[],
    initialQuery?: string,
    private readonly keybindings?: KeybindingsManager,
  ) {
    this.allItems = modelPickerSelectItems(models, state);
    this.scopedItems = modelPickerSelectItems(scopedModelChoices(models, scopedRefs), state);
    this.scope = this.scopedItems.length > 0 ? 'scoped' : 'all';
    this.list = new SearchableSelectList(
      this.itemsForScope(),
      Math.min(10, Math.max(1, this.allItems.length)),
      searchableSelectListTheme,
      { initialQuery },
    );
    this.list.onSelect = (item) => this.onSelect?.(item);
    this.list.onCancel = () => this.onCancel?.();
  }

  get focused(): boolean {
    return this.list.focused;
  }

  set focused(value: boolean) {
    this.list.focused = value;
  }

  private itemsForScope(): SelectItem[] {
    return this.scope === 'scoped' ? this.scopedItems : this.allItems;
  }

  private toggleScope(): void {
    if (this.scopedItems.length === 0) return;
    this.scope = this.scope === 'scoped' ? 'all' : 'scoped';
    this.list.setItems(this.itemsForScope());
  }

  getSelectedItem(): SelectItem | null {
    return this.list.getSelectedItem();
  }

  invalidate(): void {
    this.list.invalidate();
  }

  render(width: number): string[] {
    if (this.scopedItems.length === 0) {
      return this.list.render(width);
    }
    const scoped = this.scope === 'scoped' ? theme.accent('scoped') : theme.dim('scoped');
    const all = this.scope === 'all' ? theme.accent('all') : theme.dim('all');
    const tab = this.keybindings
      ? formatKeyIds(this.keybindings, 'tui.input.tab', { capitalize: true })
      : 'Tab';
    return [theme.dim(`Scope: ${scoped} | ${all} · ${tab} scope`), '', ...this.list.render(width)];
  }

  handleInput(keyData: string): void {
    const keybindings = this.keybindings ?? getKeybindings();
    if (keybindings.matches(keyData, 'tui.input.tab') || matchesKey(keyData, 'tab')) {
      this.toggleScope();
      return;
    }
    this.list.handleInput(keyData);
  }
}

/** Ctrl+L or `/model` — pick model, sends `/switch provider/id`. */
export async function openModelPickerOverlay(
  svc: PickerServices,
  initialSearch?: string,
): Promise<void> {
  const models = await svc.client.listModels();
  svc.setModelChoices(models);
  if (models.length === 0) {
    svc.chatLog.addSystem('No models available from gateway.');
    svc.tui.requestRender();
    return;
  }
  const items = modelPickerSelectItems(models, svc.state);
  const scopedRefs = svc.getScopedModelRefs();
  const list =
    scopedRefs && scopedRefs.length > 0
      ? new ModelPickerSelectList(models, svc.state, scopedRefs, initialSearch, svc.keybindings)
      : new SearchableSelectList(items, Math.min(10, items.length), searchableSelectListTheme, {
          initialQuery: initialSearch,
        });
  list.onSelect = (item) => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.sendMessage(`/switch ${item.value}`);
    svc.tui.requestRender();
  };
  list.onCancel = () => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.tui.requestRender();
  };
  svc.openOverlay(list);
  svc.chatLog.addSystem(theme.dim(formatModelPickerHint(svc.keybindings)));
  svc.tui.requestRender();
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
