import {
  Input,
  type Component,
  type Focusable,
  type Keybinding,
  type KeybindingsManager,
  type SelectItem,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui';
import { randomUUID } from 'node:crypto';

import { SearchableSelectList } from './components/searchable-select-list.js';
import { formatKeyIds, formatKeyText } from './format-tui-hotkeys.js';
import type { TuiTranscriptTreeEntry } from './tui-backend.js';
import { searchableSelectListTheme, theme } from './theme.js';
import type { TuiSettings, TreeFilterMode } from './tui-settings.js';
import {
  filterTuiTranscriptTreeEntries,
  formatTuiTranscriptTreeEntryDisplayText,
} from './tui-transcript-tree.js';

function formatSelectNavigationHint(keybindings: KeybindingsManager): string {
  const up = formatKeyIds(keybindings, 'tui.select.up', { capitalize: true });
  const down = formatKeyIds(keybindings, 'tui.select.down', { capitalize: true });
  return `${up}/${down}`;
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

export function defaultTranscriptForkKey(currentSessionKey: string, entryId: string): string {
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
