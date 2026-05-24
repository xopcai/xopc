import {
  isKeyRelease,
  matchesKey,
  type Component,
  type SelectItem,
  Text,
} from '@earendil-works/pi-tui';

import type { TuiModelChoice } from '../tui-backend.js';
import { modelRef } from '../tui-scoped-models.js';
import { searchableSelectListTheme, theme } from '../theme.js';
import { SearchableSelectList } from './searchable-select-list.js';

export type ScopedModelsSelectorCallbacks = {
  /** `null` = all models enabled for Ctrl+P. */
  onSave: (refs: string[] | null) => void;
  onCancel: () => void;
  requestRender: () => void;
};

function buildItems(catalog: TuiModelChoice[], enabledRefs: Set<string> | null): SelectItem[] {
  return catalog.map((m) => {
    const ref = modelRef(m);
    const checked =
      enabledRefs === null || enabledRefs.size === 0 ? true : enabledRefs.has(ref);
    return {
      value: ref,
      label: `${checked ? '☑' : '☐'} ${m.name || m.id}`,
      description: m.provider,
      searchText: `${m.provider} ${m.id} ${m.name ?? ''}`,
    };
  });
}

/** Toggle models included in Ctrl+P cycling (pi `/scoped-models` subset). */
export class ScopedModelsSelector implements Component {
  private readonly catalog: TuiModelChoice[];
  private enabledRefs: Set<string> | null;
  private readonly list: SearchableSelectList;
  private readonly footer = new Text('', 1, 0);

  constructor(
    catalog: TuiModelChoice[],
    initialRefs: string[] | null,
    private readonly callbacks: ScopedModelsSelectorCallbacks,
  ) {
    this.catalog = catalog;
    this.enabledRefs =
      initialRefs === null ? null : initialRefs.length === 0 ? new Set() : new Set(initialRefs);

    this.list = new SearchableSelectList(
      buildItems(catalog, this.enabledRefs),
      12,
      searchableSelectListTheme,
    );
    this.list.onCancel = () => this.callbacks.onCancel();
    this.list.onSelect = () => this.saveAndClose();
    this.footer.setText(
      theme.dim('Space toggle · A all · C clear · Enter save · Esc cancel'),
    );
  }

  private refreshItems(): void {
    const selected = this.list.getSelectedItem()?.value;
    const items = buildItems(this.catalog, this.enabledRefs);
    (this.list as unknown as { items: SelectItem[]; filteredItems: SelectItem[] }).items = items;
    (this.list as unknown as { filteredItems: SelectItem[] }).filteredItems = items;
    if (selected) {
      const idx = items.findIndex((i) => i.value === selected);
      if (idx >= 0) this.list.setSelectedIndex(idx);
    }
  }

  private saveAndClose(): void {
    if (this.enabledRefs === null) {
      this.callbacks.onSave(null);
      return;
    }
    const refs = [...this.enabledRefs];
    this.callbacks.onSave(refs.length === 0 || refs.length === this.catalog.length ? null : refs);
  }

  invalidate(): void {
    this.list.invalidate();
  }

  render(width: number): string[] {
    return [
      theme.bold('Scoped models (Ctrl+P cycle)'),
      '',
      ...this.list.render(width),
      '',
      ...this.footer.render(width),
    ];
  }

  handleInput(keyData: string): void {
    if (isKeyRelease(keyData)) return;

    if (matchesKey(keyData, 'enter')) {
      this.saveAndClose();
      return;
    }

    if (matchesKey(keyData, ' ')) {
      const item = this.list.getSelectedItem();
      if (!item) return;
      if (this.enabledRefs === null) {
        this.enabledRefs = new Set(this.catalog.map(modelRef));
      }
      if (this.enabledRefs.has(item.value)) {
        this.enabledRefs.delete(item.value);
      } else {
        this.enabledRefs.add(item.value);
      }
      this.refreshItems();
      this.callbacks.requestRender();
      return;
    }

    if (keyData === 'a' || keyData === 'A') {
      this.enabledRefs = null;
      this.refreshItems();
      this.callbacks.requestRender();
      return;
    }

    if (keyData === 'c' || keyData === 'C') {
      this.enabledRefs = new Set();
      this.refreshItems();
      this.callbacks.requestRender();
      return;
    }

    this.list.handleInput(keyData);
    this.callbacks.requestRender();
  }
}
