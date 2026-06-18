import {
  Container,
  Editor,
  Input,
  SelectList,
  Spacer,
  Text,
  getKeybindings,
  type Component,
  type Focusable,
  type KeybindingsManager,
  type SelectItem,
  type SelectListLayoutOptions,
  type TUI,
} from '@earendil-works/pi-tui';

import { formatKeyIds } from '../format-tui-hotkeys.js';
import { editorTheme, selectListTheme, theme } from '../theme.js';

const EXTENSION_DIALOG_LAYOUT: SelectListLayoutOptions = {
  minPrimaryColumnWidth: 12,
  maxPrimaryColumnWidth: 48,
};

function formatDialogTitle(title: string, countdownSeconds?: number): string {
  return countdownSeconds == null ? title : `${title} (${countdownSeconds}s)`;
}

function addTitle(container: Container, title: string): Text {
  const lines = title.split(/\r?\n/);
  let titleText: Text | undefined;
  lines.forEach((line, index) => {
    const text = new Text(index === 0 ? theme.bold(theme.accent(line)) : theme.fgText(line), 0, 0);
    if (index === 0) titleText = text;
    container.addChild(text);
  });
  return titleText ?? new Text('', 0, 0);
}

function formatDialogHint(
  keybindings: KeybindingsManager | undefined,
  confirmLabel: string,
): string {
  const confirm = keybindings
    ? formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true })
    : 'Enter';
  const cancel = keybindings
    ? formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true })
    : 'Esc';
  return `  ${confirm} ${confirmLabel} · ${cancel} cancel`;
}

export class ExtensionSelectDialog extends Container implements Component {
  private readonly selectList: SelectList;
  private readonly titleText: Text;
  private readonly baseTitle: string;

  constructor(
    title: string,
    options: string[],
    callbacks: { onSelect: (value: string) => void; onCancel: () => void },
    private readonly keybindings?: KeybindingsManager,
  ) {
    super();
    this.baseTitle = title.split(/\r?\n/)[0] ?? title;
    this.titleText = addTitle(this, title);
    this.addChild(new Spacer(1));

    const items: SelectItem[] = options.map((value) => ({ value, label: value }));
    this.selectList = new SelectList(
      items,
      Math.min(Math.max(items.length, 1), 8),
      selectListTheme,
      EXTENSION_DIALOG_LAYOUT,
    );
    this.selectList.onSelect = (item) => callbacks.onSelect(item.value);
    this.selectList.onCancel = callbacks.onCancel;
    this.addChild(this.selectList);
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.dim(formatDialogHint(keybindings, 'select')), 0, 0));
  }

  setCountdownSeconds(seconds: number | undefined): void {
    this.titleText.setText(theme.bold(theme.accent(formatDialogTitle(this.baseTitle, seconds))));
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data);
  }
}

export class ExtensionInputDialog extends Container implements Component, Focusable {
  private readonly input = new Input();
  private readonly titleText: Text;
  private readonly baseTitle: string;
  private _focused = false;

  constructor(
    title: string,
    placeholder: string | undefined,
    private readonly callbacks: { onSubmit: (value: string) => void; onCancel: () => void },
    private readonly keybindings?: KeybindingsManager,
  ) {
    super();
    this.baseTitle = title.split(/\r?\n/)[0] ?? title;
    this.titleText = addTitle(this, title);
    if (placeholder) {
      this.addChild(new Text(theme.dim(placeholder), 0, 0));
    }
    this.addChild(new Spacer(1));
    this.addChild(this.input);
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.dim(formatDialogHint(keybindings, 'submit')), 0, 0));
  }

  setCountdownSeconds(seconds: number | undefined): void {
    this.titleText.setText(theme.bold(theme.accent(formatDialogTitle(this.baseTitle, seconds))));
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  handleInput(data: string): void {
    const keybindings = this.keybindings ?? getKeybindings();
    if (keybindings.matches(data, 'tui.select.confirm') || data === '\n' || data === '\r') {
      this.callbacks.onSubmit(this.input.getValue());
      return;
    }
    if (keybindings.matches(data, 'tui.select.cancel')) {
      this.callbacks.onCancel();
      return;
    }
    this.input.handleInput(data);
  }
}

export class ExtensionEditorDialog extends Container implements Component, Focusable {
  private readonly editor: Editor;
  private _focused = false;

  constructor(
    tui: TUI,
    title: string,
    prefill: string | undefined,
    private readonly callbacks: { onSubmit: (value: string) => void; onCancel: () => void },
    private readonly keybindings?: KeybindingsManager,
  ) {
    super();
    addTitle(this, title);
    this.addChild(new Spacer(1));
    this.editor = new Editor(tui, editorTheme);
    if (prefill) this.editor.setText(prefill);
    this.editor.onSubmit = (value) => this.callbacks.onSubmit(value);
    this.addChild(this.editor);
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.dim(formatDialogHint(keybindings, 'submit')), 0, 0));
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.editor.focused = value;
  }

  handleInput(data: string): void {
    const keybindings = this.keybindings ?? getKeybindings();
    if (keybindings.matches(data, 'tui.select.cancel')) {
      this.callbacks.onCancel();
      return;
    }
    this.editor.handleInput(data);
  }
}
