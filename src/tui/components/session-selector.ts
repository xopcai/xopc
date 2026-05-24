import {
  Input,
  isKeyRelease,
  matchesKey,
  type Component,
  type SelectItem,
  Text,
} from '@earendil-works/pi-tui';

import type { TuiSessionItem } from '../tui-backend.js';
import { formatSessionPickerDescription } from '../tui-session-format.js';
import { searchableSelectListTheme, theme } from '../theme.js';
import { SearchableSelectList } from './searchable-select-list.js';

export type SessionSelectorCallbacks = {
  onResume: (sessionKey: string) => void;
  onRename: (sessionKey: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (sessionKey: string) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
  requestRender: () => void;
};

type Mode = 'browse' | 'rename';

function sortSessions(
  sessions: TuiSessionItem[],
  sortByName: boolean,
  namedOnly: boolean,
): TuiSessionItem[] {
  let rows = [...sessions];
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
): SelectItem[] {
  return sortSessions(sessions, sortByName, namedOnly).map((s) => ({
    value: s.key,
    label: s.displayName?.trim() || s.key,
    description: formatSessionPickerDescription(s),
    searchText: `${s.key} ${s.displayName ?? ''} ${s.model ?? ''}`,
  }));
}

/** Session picker with search, rename (Ctrl+R), delete (Ctrl+D ×2). */
export class SessionSelector implements Component {
  private sessions: TuiSessionItem[];
  private readonly list: SearchableSelectList;
  private readonly footer = new Text('', 1, 0);
  private readonly renameInput = new Input();
  private mode: Mode = 'browse';
  private pendingDeleteKey: string | null = null;
  private sortByName = false;
  private namedOnly = false;

  constructor(
    sessions: TuiSessionItem[],
    private readonly callbacks: SessionSelectorCallbacks,
  ) {
    this.sessions = sessions;
    this.list = new SearchableSelectList(
      toSelectItems(sessions, this.sortByName, this.namedOnly),
      12,
      searchableSelectListTheme,
    );
    this.list.onSelect = (item) => {
      this.callbacks.onResume(item.value);
    };
    this.list.onCancel = () => this.callbacks.onCancel();
    this.setFooterHint();
  }

  setSessions(sessions: TuiSessionItem[]): void {
    this.sessions = sessions;
    this.refreshList();
  }

  private refreshList(): void {
    const selected = this.list.getSelectedItem()?.value;
    const items = toSelectItems(this.sessions, this.sortByName, this.namedOnly);
    (this.list as unknown as { items: SelectItem[]; filteredItems: SelectItem[] }).items = items;
    (this.list as unknown as { filteredItems: SelectItem[] }).filteredItems = items;
    if (selected) {
      const idx = items.findIndex((i) => i.value === selected);
      if (idx >= 0) this.list.setSelectedIndex(idx);
    }
  }

  private setFooterHint(extra?: string): void {
    if (extra) {
      this.footer.setText(theme.dim(extra));
      return;
    }
    const sort = this.sortByName ? 'name' : 'recent';
    const nameFilter = this.namedOnly ? 'named' : 'all';
    this.footer.setText(
      theme.dim(
        `Enter resume · Ctrl+R rename · Ctrl+D delete · Ctrl+S sort (${sort}) · Ctrl+N filter (${nameFilter}) · Esc cancel`,
      ),
    );
  }

  invalidate(): void {
    this.list.invalidate();
    this.renameInput.invalidate();
  }

  render(width: number): string[] {
    if (this.mode === 'rename') {
      const prompt = theme.dim('Rename session: ');
      const inputLines = this.renameInput.render(Math.max(1, width - 16));
      return [prompt + (inputLines[0] ?? ''), '', theme.dim('Enter save · Esc cancel')];
    }
    return [...this.list.render(width), '', ...this.footer.render(width)];
  }

  handleInput(keyData: string): void {
    if (isKeyRelease(keyData)) return;

    if (this.mode === 'rename') {
      if (matchesKey(keyData, 'escape')) {
        this.mode = 'browse';
        this.setFooterHint();
        this.callbacks.requestRender();
        return;
      }
      if (matchesKey(keyData, 'enter')) {
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

    if (matchesKey(keyData, 'escape') && this.pendingDeleteKey) {
      this.pendingDeleteKey = null;
      this.setFooterHint('Delete cancelled');
      this.callbacks.requestRender();
      return;
    }

    if (matchesKey(keyData, 'ctrl+s')) {
      this.sortByName = !this.sortByName;
      this.refreshList();
      this.setFooterHint();
      this.callbacks.requestRender();
      return;
    }

    if (matchesKey(keyData, 'ctrl+n')) {
      this.namedOnly = !this.namedOnly;
      this.refreshList();
      this.setFooterHint();
      this.callbacks.requestRender();
      return;
    }

    if (matchesKey(keyData, 'ctrl+r')) {
      const item = this.list.getSelectedItem();
      if (!item) return;
      this.mode = 'rename';
      this.renameInput.setValue(item.label);
      this.callbacks.requestRender();
      return;
    }

    if (matchesKey(keyData, 'ctrl+d')) {
      const item = this.list.getSelectedItem();
      if (!item) return;
      if (this.pendingDeleteKey === item.value) {
        void this.callbacks.onDelete(item.value).then((result) => {
          this.pendingDeleteKey = null;
          if (result.ok) {
            this.sessions = this.sessions.filter((s) => s.key !== item.value);
            this.refreshList();
          }
          this.setFooterHint(result.ok ? `Deleted ${item.value}` : (result.error ?? 'Delete failed'));
          this.callbacks.requestRender();
        });
      } else {
        this.pendingDeleteKey = item.value;
        this.setFooterHint(`Press Ctrl+D again to delete ${item.value}`);
        this.callbacks.requestRender();
      }
      return;
    }

    this.pendingDeleteKey = null;
    this.list.handleInput(keyData);
    this.callbacks.requestRender();
  }
}
