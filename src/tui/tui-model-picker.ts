import {
  Container,
  getKeybindings,
  type Component,
  type Focusable,
  type KeybindingsManager,
  matchesKey,
  Spacer,
  type SelectItem,
  Text,
} from '@earendil-works/pi-tui';

import { SearchableSelectList } from './components/searchable-select-list.js';
import { DynamicBorder } from './components/dynamic-border.js';
import { formatKeyIds } from './format-tui-hotkeys.js';
import type { TuiModelChoice } from './tui-backend.js';
import type { PickerServices } from './tui-picker-services.js';
import { modelRef } from './tui-scoped-models.js';
import type { TuiState } from './tui-types.js';
import { searchableSelectListTheme, theme } from './theme.js';

function formatSelectNavigationHint(keybindings: KeybindingsManager): string {
  const up = formatKeyIds(keybindings, 'tui.select.up', { capitalize: true });
  const down = formatKeyIds(keybindings, 'tui.select.down', { capitalize: true });
  return up + '/' + down;
}

export function formatModelPickerHint(keybindings: KeybindingsManager): string {
  const nav = formatSelectNavigationHint(keybindings);
  const confirm = formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true });
  const cancel = formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true });
  return `Select model (${nav} · type to filter · ${confirm} select · ${cancel} close)`;
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

class ModelPickerPanel extends Container implements Focusable {
  constructor(private readonly picker: Component & Focusable, keybindings: KeybindingsManager) {
    super();
    this.addChild(new DynamicBorder(theme.border));
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.dim(formatModelPickerHint(keybindings)), 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(picker);
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder(theme.border));
  }

  get focused(): boolean {
    return this.picker.focused;
  }

  set focused(value: boolean) {
    this.picker.focused = value;
  }

  handleInput(keyData: string): void {
    this.picker.handleInput(keyData);
  }
}

/** Ctrl+L or `/model` — pick model and apply it to the current session. */
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
  const panel = new ModelPickerPanel(list, svc.keybindings);
  const closeSelector = svc.openEditorSelector(panel, panel);
  list.onSelect = (item) => {
    closeSelector();
    void Promise.resolve(svc.switchModel(item.value));
    svc.tui.requestRender();
  };
  list.onCancel = () => {
    closeSelector();
  };
  svc.tui.requestRender();
}
