import { Editor, getKeybindings, Key, matchesKey, parseKey } from '@mariozechner/pi-tui';

/**
 * Extended editor with additional key bindings for the TUI.
 */
export class CustomEditor extends Editor {
  onEscape?: () => void;
  onCtrlC?: () => void;
  onCtrlD?: () => void;
  onCtrlL?: () => void;
  onCtrlP?: () => void;
  onCtrlO?: () => void;
  onCtrlT?: () => void;

  handleInput(data: string): void {
    const kb = getKeybindings();
    if (matchesKey(data, Key.ctrl('l')) && this.onCtrlL) {
      this.onCtrlL();
      return;
    }
    if (matchesKey(data, Key.ctrl('p')) && this.onCtrlP) {
      this.onCtrlP();
      return;
    }
    if (matchesKey(data, Key.ctrl('o')) && this.onCtrlO) {
      this.onCtrlO();
      return;
    }
    if (matchesKey(data, Key.ctrl('t')) && this.onCtrlT) {
      this.onCtrlT();
      return;
    }
    if (matchesKey(data, Key.escape) && this.onEscape && !this.isShowingAutocomplete()) {
      this.onEscape();
      return;
    }
    // Match all encodings pi-tui uses for Ctrl+C (incl. Kitty / modifyOtherKeys on macOS).
    // Base Editor treats "tui.input.copy" as a no-op — falling through swallows the key.
    if (
      this.onCtrlC &&
      (data === '\x03' ||
        parseKey(data) === 'ctrl+c' ||
        matchesKey(data, Key.ctrl('c')) ||
        kb.matches(data, 'tui.input.copy'))
    ) {
      this.onCtrlC();
      return;
    }
    if (matchesKey(data, Key.ctrl('d'))) {
      if (this.getText().length === 0 && this.onCtrlD) {
        this.onCtrlD();
      }
      return;
    }
    super.handleInput(data);
  }
}
