import {
  Input,
  type Focusable,
  isKeyRelease,
  matchesKey,
  type Component,
  type Keybinding,
  type KeybindingsManager,
  type SelectItem,
  Text,
} from '@earendil-works/pi-tui';
import { resolve } from 'node:path';

import type { TuiSessionItem } from '../tui-backend.js';
import { formatSessionPickerDescription } from '../tui-session-format.js';
import { searchableSelectListTheme, theme } from '../theme.js';
import { formatKeyIds } from '../format-tui-hotkeys.js';
import { SearchableSelectList } from './searchable-select-list.js';
import { fuzzyMatchLower, normalizeLowercaseStringOrEmpty } from './fuzzy-filter.js';

export type SessionSelectorCallbacks = {
  onResume: (sessionKey: string) => void;
  onRename: (sessionKey: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (sessionKey: string) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
  requestRender: () => void;
};

type Mode = 'browse' | 'rename';
type SessionScope = 'current' | 'all';

function normalizePathForScope(path: string): string {
  return resolve(path).replace(/[\\/]+$/, '');
}

function sortSessions(
  sessions: TuiSessionItem[],
  sortByName: boolean,
  namedOnly: boolean,
  scope: SessionScope,
  currentCwd?: string,
): TuiSessionItem[] {
  let rows = [...sessions];
  if (scope === 'current' && currentCwd) {
    const current = normalizePathForScope(currentCwd);
    rows = rows.filter((s) => !s.cwd || normalizePathForScope(s.cwd) === current);
  }
  if (namedOnly) {
    rows = rows.filter((s) => (s.displayName?.trim().length ?? 0) > 0);
  }
  rows.sort((a, b) => {
    if (sortByName) {
      const an = (a.displayName || a.key).toLowerCase();
      const bn = (b.displayName || b.key).toLowerCase();
      return an.localeCompare(bn);
    }
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
  return rows;
}

function toSelectItems(
  sessions: TuiSessionItem[],
  sortByName: boolean,
  namedOnly: boolean,
  showKey: boolean,
  scope: SessionScope,
  currentCwd?: string,
): SelectItem[] {
  return sortSessions(sessions, sortByName, namedOnly, scope, currentCwd).map((s) => ({
    value: s.key,
    label: s.displayName?.trim() || s.key,
    description: formatSessionPickerDescription(s, { showKey }),
    searchText: `${s.key} ${s.displayName ?? ''} ${s.model ?? ''} ${s.cwd ?? ''}`,
  }));
}

function getSearchText(item: SelectItem): string {
  const extra = (item as { searchText?: string }).searchText ?? '';
  return [item.label, item.description ?? '', extra].filter(Boolean).join(' ');
}

function normalizeSearchText(text: string): string {
  return normalizeLowercaseStringOrEmpty(text);
}

type SessionSearchToken = { kind: 'fuzzy' | 'phrase'; value: string };

function parseSessionSearchTokens(query: string): SessionSearchToken[] {
  const trimmed = query.trim();
  const tokens: SessionSearchToken[] = [];
  let buffer = '';
  let inQuote = false;
  let hadUnclosedQuote = false;

  const flush = (kind: SessionSearchToken['kind']) => {
    const value = buffer.trim();
    buffer = '';
    if (value) tokens.push({ kind, value });
  };

  for (const ch of trimmed) {
    if (ch === '"') {
      if (inQuote) {
        flush('phrase');
        inQuote = false;
      } else {
        flush('fuzzy');
        inQuote = true;
      }
      continue;
    }

    if (!inQuote && /\s/.test(ch)) {
      flush('fuzzy');
      continue;
    }

    buffer += ch;
  }

  if (inQuote) hadUnclosedQuote = true;
  if (hadUnclosedQuote) {
    return normalizeSearchText(trimmed)
      .split(/\s+/)
      .filter(Boolean)
      .map((value) => ({ kind: 'fuzzy' as const, value }));
  }

  flush('fuzzy');
  return tokens;
}

export function filterSessionSelectItems(items: SelectItem[], query: string): SelectItem[] {
  const trimmed = query.trim();
  if (!trimmed) return items;

  const regexPattern = trimmed.match(/^re:(.*)$/i)?.[1];
  if (regexPattern !== undefined) {
    try {
      const regex = new RegExp(regexPattern, 'i');
      return items.filter((item) => regex.test(getSearchText(item)));
    } catch {
      return [];
    }
  }

  const tokens = parseSessionSearchTokens(trimmed);
  if (tokens.length === 0) return items;
  return items.filter((item) => {
    const text = normalizeSearchText(getSearchText(item));
    return tokens.every((token) => {
      const value = normalizeSearchText(token.value);
      if (!value) return true;
      if (token.kind === 'phrase') return text.includes(value);
      return fuzzyMatchLower(value, text) !== null;
    });
  });
}

/** Session picker with search, rename (Ctrl+R), delete (Ctrl+D x2). */
export class SessionSelector implements Component, Focusable {
  private sessions: TuiSessionItem[];
  private readonly list: SearchableSelectList;
  private readonly footer = new Text('', 1, 0);
  private readonly renameInput = new Input();
  private mode: Mode = 'browse';
  private pendingDeleteKey: string | null = null;
  private sortByName = false;
  private namedOnly = false;
  private showKey = false;
  private scope: SessionScope = 'current';
  private _focused = false;

  constructor(
    sessions: TuiSessionItem[],
    private readonly callbacks: SessionSelectorCallbacks,
    private readonly keybindings?: KeybindingsManager,
    private readonly currentCwd?: string,
    private readonly currentSessionKey?: string,
  ) {
    this.sessions = sessions;
    this.list = new SearchableSelectList(
      toSelectItems(
        sessions,
        this.sortByName,
        this.namedOnly,
        this.showKey,
        this.scope,
        this.currentCwd,
      ),
      12,
      searchableSelectListTheme,
      { filterItems: filterSessionSelectItems },
    );
    this.list.onSelect = (item) => {
      this.callbacks.onResume(item.value);
    };
    this.list.onCancel = () => this.callbacks.onCancel();
    this.setFooterHint();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.syncChildFocus();
  }

  setSessions(sessions: TuiSessionItem[]): void {
    this.sessions = sessions;
    if (this.pendingDeleteKey && !sessions.some((session) => session.key === this.pendingDeleteKey)) {
      this.pendingDeleteKey = null;
      this.setFooterHint();
    }
    this.refreshList();
  }

  private refreshList(): void {
    const selected = this.list.getSelectedItem()?.value;
    const items = toSelectItems(
      this.sessions,
      this.sortByName,
      this.namedOnly,
      this.showKey,
      this.scope,
      this.currentCwd,
    );
    this.list.setItems(items);
    if (selected) {
      this.list.setSelectedValue(selected);
    }
  }

  private setFooterHint(extra?: string): void {
    if (extra) {
      this.footer.setText(theme.dim(extra));
      return;
    }
    const sort = this.sortByName ? 'name' : 'recent';
    const nameFilter = this.namedOnly ? 'named' : 'all';
    const keyState = this.showKey ? 'on' : 'off';
    const scope = this.scope === 'current' ? 'current' : 'all';
    if (this.keybindings) {
      const rename = formatKeyIds(this.keybindings, 'app.session.rename', { capitalize: true });
      const del = formatKeyIds(this.keybindings, 'app.session.delete', { capitalize: true });
      const sortKey = formatKeyIds(this.keybindings, 'app.session.toggleSort', {
        capitalize: true,
      });
      const filter = formatKeyIds(this.keybindings, 'app.session.toggleNamedFilter', {
        capitalize: true,
      });
      const path = formatKeyIds(this.keybindings, 'app.session.togglePath', { capitalize: true });
      const tab = formatKeyIds(this.keybindings, 'tui.input.tab', { capitalize: true });
      const confirm = formatKeyIds(this.keybindings, 'tui.select.confirm', { capitalize: true });
      const cancel = formatKeyIds(this.keybindings, 'tui.select.cancel', { capitalize: true });
      this.footer.setText(
        theme.dim(
          `${confirm} resume · ${tab} scope (${scope}) · ${rename} rename · ${del} delete · ${sortKey} sort (${sort}) · ${filter} filter (${nameFilter}) · ${path} path (${keyState}) · ${cancel} cancel`,
        ),
      );
      return;
    }
    this.footer.setText(
      theme.dim(
        `Enter resume · Tab scope (${scope}) · Ctrl+R rename · Ctrl+D delete · Ctrl+S sort (${sort}) · Ctrl+N filter (${nameFilter}) · Ctrl+P path (${keyState}) · Esc cancel`,
      ),
    );
  }

  private matchesAction(keyData: string, action: Keybinding, aliases: string[] = []): boolean {
    if (this.keybindings?.matches(keyData, action)) return true;
    return aliases.some((key) => keyData === key || matchesKey(keyData, key as never));
  }

  private renameConfirmKeyHint(): string {
    return this.keybindings
      ? formatKeyIds(this.keybindings, 'tui.select.confirm', { capitalize: true })
      : 'Enter';
  }

  private renameCancelKeyHint(): string {
    return this.keybindings
      ? formatKeyIds(this.keybindings, 'tui.select.cancel', { capitalize: true })
      : 'Esc';
  }

  private triggerDeleteForSelectedSession(): void {
    const item = this.list.getSelectedItem();
    if (!item) return;
    if (item.value === this.currentSessionKey) {
      this.pendingDeleteKey = null;
      this.setFooterHint('Cannot delete the active session');
      this.callbacks.requestRender();
      return;
    }
    this.pendingDeleteKey = item.value;
    const confirm = this.renameConfirmKeyHint();
    const cancel = this.renameCancelKeyHint();
    this.setFooterHint(`Delete session? ${confirm} confirm · ${cancel} cancel · ${item.value}`);
    this.callbacks.requestRender();
  }

  private syncChildFocus(): void {
    this.list.focused = this._focused && this.mode === 'browse';
    this.renameInput.focused = this._focused && this.mode === 'rename';
  }

  invalidate(): void {
    this.list.invalidate();
    this.renameInput.invalidate();
  }

  render(width: number): string[] {
    if (this.mode === 'rename') {
      const prompt = theme.dim('Rename session: ');
      const inputLines = this.renameInput.render(Math.max(1, width - 16));
      return [
        prompt + (inputLines[0] ?? ''),
        '',
        theme.dim(`${this.renameConfirmKeyHint()} save · ${this.renameCancelKeyHint()} cancel`),
      ];
    }
    return [...this.list.render(width), '', ...this.footer.render(width)];
  }

  handleInput(keyData: string): void {
    if (isKeyRelease(keyData)) return;

    if (this.mode === 'rename') {
      if (this.matchesAction(keyData, 'tui.select.cancel', ['escape'])) {
        this.mode = 'browse';
        this.syncChildFocus();
        this.setFooterHint();
        this.callbacks.requestRender();
        return;
      }
      if (this.matchesAction(keyData, 'tui.select.confirm', ['enter'])) {
        const item = this.list.getSelectedItem();
        const name = this.renameInput.getValue().trim();
        if (!item || !name) {
          this.mode = 'browse';
          this.setFooterHint('Rename cancelled');
          this.callbacks.requestRender();
          return;
        }
        void this.callbacks.onRename(item.value, name).then((result) => {
          this.mode = 'browse';
          this.pendingDeleteKey = null;
          this.syncChildFocus();
          if (result.ok) {
            const idx = this.sessions.findIndex((s) => s.key === item.value);
            if (idx >= 0) this.sessions[idx] = { ...this.sessions[idx]!, displayName: name };
            this.refreshList();
          }
          this.setFooterHint(result.ok ? `Renamed to "${name}"` : (result.error ?? 'Rename failed'));
          this.callbacks.requestRender();
        });
        return;
      }
      this.renameInput.handleInput(keyData);
      this.callbacks.requestRender();
      return;
    }

    if (this.pendingDeleteKey) {
      if (this.matchesAction(keyData, 'tui.select.confirm', ['enter'])) {
        const sessionKey = this.pendingDeleteKey;
        this.pendingDeleteKey = null;
        void this.callbacks.onDelete(sessionKey).then((result) => {
          if (result.ok) {
            this.sessions = this.sessions.filter((s) => s.key !== sessionKey);
            this.refreshList();
          }
          this.setFooterHint(result.ok ? `Deleted ${sessionKey}` : (result.error ?? 'Delete failed'));
          this.callbacks.requestRender();
        });
        return;
      }
      if (this.matchesAction(keyData, 'tui.select.cancel', ['escape'])) {
        this.pendingDeleteKey = null;
        this.setFooterHint('Delete cancelled');
        this.callbacks.requestRender();
        return;
      }
      return;
    }

    if (this.matchesAction(keyData, 'tui.input.tab', ['tab'])) {
      this.scope = this.scope === 'current' ? 'all' : 'current';
      this.pendingDeleteKey = null;
      this.refreshList();
      this.setFooterHint();
      this.callbacks.requestRender();
      return;
    }

    if (this.matchesAction(keyData, 'app.session.toggleSort', ['ctrl+s'])) {
      this.sortByName = !this.sortByName;
      this.refreshList();
      this.setFooterHint();
      this.callbacks.requestRender();
      return;
    }

    if (this.matchesAction(keyData, 'app.session.toggleNamedFilter', ['ctrl+n'])) {
      this.namedOnly = !this.namedOnly;
      this.refreshList();
      this.setFooterHint();
      this.callbacks.requestRender();
      return;
    }

    if (this.matchesAction(keyData, 'app.session.togglePath', ['ctrl+p'])) {
      this.showKey = !this.showKey;
      this.refreshList();
      this.setFooterHint();
      this.callbacks.requestRender();
      return;
    }

    if (this.matchesAction(keyData, 'app.session.rename', ['ctrl+r'])) {
      const item = this.list.getSelectedItem();
      if (!item) return;
      this.mode = 'rename';
      this.renameInput.setValue(item.label);
      this.syncChildFocus();
      this.callbacks.requestRender();
      return;
    }

    if (this.matchesAction(keyData, 'app.session.deleteNoninvasive', ['ctrl+backspace'])) {
      if (this.list.getSearchQuery().length > 0) {
        this.pendingDeleteKey = null;
        this.list.handleInput(keyData);
        this.callbacks.requestRender();
        return;
      }
      this.triggerDeleteForSelectedSession();
      return;
    }

    if (this.matchesAction(keyData, 'app.session.delete', ['ctrl+d'])) {
      this.triggerDeleteForSelectedSession();
      return;
    }

    this.pendingDeleteKey = null;
    this.list.handleInput(keyData);
    this.callbacks.requestRender();
  }
}
