import {
  Editor,
  type EditorOptions,
  type EditorTheme,
  type KeybindingsManager,
  type TUI,
} from '@earendil-works/pi-tui';

import type { XopcTuiAppKeybinding } from '../xopc-tui-keybindings.js';

/**
 * Editor with pi coding-agent–style app keybindings (KeybindingsManager + onAction).
 */
export class CustomEditor extends Editor {
  private readonly keybindings: KeybindingsManager;
  readonly actionHandlers = new Map<XopcTuiAppKeybinding, () => void>();

  onEscape?: () => void;
  onCtrlD?: () => void;
  onCtrlC?: () => void;
  onPasteImage?: () => void;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options?: EditorOptions) {
    super(tui, theme, options);
    this.keybindings = keybindings;
  }

  onAction(action: XopcTuiAppKeybinding, handler: () => void): void {
    this.actionHandlers.set(action, handler);
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, 'app.clipboard.pasteImage')) {
      this.onPasteImage?.();
      return;
    }

    if (this.keybindings.matches(data, 'app.interrupt')) {
      if (!this.isShowingAutocomplete()) {
        const handler = this.onEscape ?? this.actionHandlers.get('app.interrupt');
        if (handler) {
          handler();
          return;
        }
      }
      super.handleInput(data);
      return;
    }

    if (this.keybindings.matches(data, 'app.exit')) {
      if (this.getText().length === 0) {
        const handler = this.onCtrlD ?? this.actionHandlers.get('app.exit');
        if (handler) handler();
        return;
      }
    }

    for (const [action, handler] of this.actionHandlers) {
      if (action === 'app.interrupt' || action === 'app.exit') continue;
      if (this.keybindings.matches(data, action)) {
        const wrapped =
          action === 'app.clear' ? (this.onCtrlC ?? handler) : handler;
        wrapped();
        return;
      }
    }

    super.handleInput(data);
  }
}
