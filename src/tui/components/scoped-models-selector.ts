import {
  isKeyRelease,
  matchesKey,
  type Component,
  type Keybinding,
  type KeybindingsManager,
  type SelectItem,
  Text,
} from '@earendil-works/pi-tui';

import type { TuiModelChoice } from '../tui-backend.js';
import { modelRef } from '../tui-scoped-models.js';
import { searchableSelectListTheme, theme } from '../theme.js';
import { formatKeyIds } from '../format-tui-hotkeys.js';
import { SearchableSelectList } from './searchable-select-list.js';

export type ScopedModelsSelectorCallbacks = {
  /** `null` = all models enabled for Ctrl+P. */
  onSave: (refs: string[] | null) => void;
  onCancel: () => void;
  requestRender: () => void;
};

function getOrderedCatalog(catalog: TuiModelChoice[], enabledRefs: Set<string> | null): TuiModelChoice[] {
  if (enabledRefs === null) return catalog;

  const byRef = new Map(catalog.map((model) => [modelRef(model), model]));
  const ordered: TuiModelChoice[] = [];
  const seen = new Set<string>();
  for (const ref of enabledRefs) {
    const model = byRef.get(ref);
    if (!model) continue;
    ordered.push(model);
    seen.add(ref);
  }
  for (const model of catalog) {
    const ref = modelRef(model);
    if (!seen.has(ref)) ordered.push(model);
  }
  return ordered;
}

function buildItems(catalog: TuiModelChoice[], enabledRefs: Set<string> | null): SelectItem[] {
  return getOrderedCatalog(catalog, enabledRefs).map((m) => {
    const ref = modelRef(m);
    const checked = enabledRefs === null ? true : enabledRefs.has(ref);
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
    private readonly keybindings?: KeybindingsManager,
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
    this.footer.setText(theme.dim(this.buildFooterText()));
  }

  private buildFooterText(): string {
    if (!this.keybindings) {
      return 'Space toggle · P provider · A all · C clear · [/] reorder · Enter save · Esc cancel';
    }
    const provider = formatKeyIds(this.keybindings, 'app.models.toggleProvider', {
      capitalize: true,
    });
    const all = formatKeyIds(this.keybindings, 'app.models.enableAll', { capitalize: true });
    const clear = formatKeyIds(this.keybindings, 'app.models.clearAll', { capitalize: true });
    const up = formatKeyIds(this.keybindings, 'app.models.reorderUp', { capitalize: true });
    const down = formatKeyIds(this.keybindings, 'app.models.reorderDown', { capitalize: true });
    const save = formatKeyIds(this.keybindings, 'app.models.save', { capitalize: true });
    const confirm = formatKeyIds(this.keybindings, 'tui.select.confirm', { capitalize: true });
    const cancel = formatKeyIds(this.keybindings, 'tui.select.cancel', { capitalize: true });
    return `Space toggle · ${provider} provider · ${all} all · ${clear} clear · ${up}/${down} reorder · ${confirm}/${save} save · ${cancel} cancel`;
  }

  private matchesAction(keyData: string, action: Keybinding, aliases: string[] = []): boolean {
    if (this.keybindings?.matches(keyData, action)) return true;
    return aliases.some((key) => keyData === key || matchesKey(keyData, key as never));
  }

  private refreshItems(): void {
    const selected = this.list.getSelectedItem()?.value;
    const items = buildItems(this.catalog, this.enabledRefs);
    this.list.setItems(items);
    if (selected) {
      this.list.setSelectedValue(selected);
    }
  }

  private saveAndClose(): void {
    if (this.enabledRefs === null) {
      this.callbacks.onSave(null);
      return;
    }
    const refs = [...this.enabledRefs];
    this.callbacks.onSave(refs.length === this.catalog.length ? null : refs);
  }

  private toggleSelectedProvider(): void {
    const item = this.list.getSelectedItem();
    if (!item) return;
    const provider = item.value.split('/')[0];
    if (!provider) return;

    const allRefs = this.catalog.map(modelRef);
    const providerRefs = this.catalog
      .filter((model) => model.provider === provider)
      .map(modelRef);
    const next = this.enabledRefs === null ? new Set(allRefs) : new Set(this.enabledRefs);
    const providerEnabled = providerRefs.every((ref) => next.has(ref));

    for (const ref of providerRefs) {
      if (providerEnabled) {
        next.delete(ref);
      } else {
        next.add(ref);
      }
    }

    this.enabledRefs = next.size === allRefs.length ? null : next;
    this.refreshItems();
    this.callbacks.requestRender();
  }

  private moveSelected(delta: number): void {
    const item = this.list.getSelectedItem();
    if (!item) return;

    if (this.enabledRefs === null) {
      this.enabledRefs = new Set(this.catalog.map(modelRef));
    }
    if (!this.enabledRefs.has(item.value)) return;

    const refs = [...this.enabledRefs];
    const index = refs.indexOf(item.value);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= refs.length) return;

    const [moved] = refs.splice(index, 1);
    if (!moved) return;
    refs.splice(nextIndex, 0, moved);
    this.enabledRefs = new Set(refs);
    this.refreshItems();
    this.callbacks.requestRender();
  }

  invalidate(): void {
    this.list.invalidate();
  }

  render(width: number): string[] {
    const cycleKey = this.keybindings
      ? formatKeyIds(this.keybindings, 'app.model.cycleForward', { capitalize: true })
      : 'Ctrl+P';
    return [
      theme.bold(`Scoped models (${cycleKey} cycle)`),
      '',
      ...this.list.render(width),
      '',
      ...this.footer.render(width),
    ];
  }

  handleInput(keyData: string): void {
    if (isKeyRelease(keyData)) return;

    if (matchesKey(keyData, 'enter') || this.matchesAction(keyData, 'app.models.save')) {
      this.saveAndClose();
      return;
    }

    if (keyData === ' ') {
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

    if (this.matchesAction(keyData, 'app.models.enableAll', ['a', 'A'])) {
      this.enabledRefs = null;
      this.refreshItems();
      this.callbacks.requestRender();
      return;
    }

    if (this.matchesAction(keyData, 'app.models.toggleProvider', ['p', 'P'])) {
      this.toggleSelectedProvider();
      return;
    }

    if (this.matchesAction(keyData, 'app.models.clearAll', ['c', 'C'])) {
      this.enabledRefs = new Set();
      this.refreshItems();
      this.callbacks.requestRender();
      return;
    }

    if (this.matchesAction(keyData, 'app.models.reorderUp', ['['])) {
      this.moveSelected(-1);
      return;
    }

    if (this.matchesAction(keyData, 'app.models.reorderDown', [']'])) {
      this.moveSelected(1);
      return;
    }

    this.list.handleInput(keyData);
    this.callbacks.requestRender();
  }
}
