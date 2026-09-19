import { Container, type Focusable, type KeybindingsManager } from '@earendil-works/pi-tui';

import { appendHistoryToChatLog } from '../chat-history.js';
import type { HistoryMessage, TuiHistoryWindow } from '../tui-backend.js';
import { theme } from '../theme.js';
import { ChatLog } from './chat-log.js';
import type { CellRenderMode } from './cell-render-mode.js';

export interface TranscriptOverlayOptions {
  keybindings: KeybindingsManager;
  loadWindow: (rowNumber: number) => Promise<TuiHistoryWindow>;
  onClose: () => void;
  onRender: () => void;
  viewportRows: () => number;
  initialMode?: Exclude<CellRenderMode, 'compact'>;
}

export class TranscriptOverlay extends Container implements Focusable {
  private readonly log: ChatLog;
  private messages: HistoryMessage[] = [];
  private startRowNumber = 0;
  private totalRows = 0;
  private scrollOffset = 0;
  private loading = false;
  private mode: Exclude<CellRenderMode, 'compact'>;
  private _focused = false;

  constructor(private readonly options: TranscriptOverlayOptions) {
    super();
    this.mode = options.initialMode ?? 'transcript';
    this.log = new ChatLog(options.keybindings);
    this.log.setRenderMode(this.mode);
  }

  get focused(): boolean { return this._focused; }
  set focused(value: boolean) { this._focused = value; }

  async initialize(): Promise<void> {
    await this.loadPage(Number.MAX_SAFE_INTEGER, false);
  }

  handleInput(data: string): void {
    if (this.options.keybindings.matches(data, 'tui.select.cancel') || data === '\x1b') {
      this.options.onClose();
      return;
    }
    if (this.options.keybindings.matches(data, 'app.transcript.open')) {
      this.options.onClose();
      return;
    }
    if (this.options.keybindings.matches(data, 'app.transcript.raw')) {
      this.mode = this.mode === 'raw' ? 'transcript' : 'raw';
      this.log.setRenderMode(this.mode);
      this.options.onRender();
      return;
    }
    const page = Math.max(4, this.options.viewportRows() - 5);
    if (data === '\x1b[5~') {
      this.scrollOffset += page;
      if (this.startRowNumber > 1) void this.loadPage(this.startRowNumber - 1, true);
      this.options.onRender();
      return;
    }
    if (data === '\x1b[6~') {
      this.scrollOffset = Math.max(0, this.scrollOffset - page);
      this.options.onRender();
      return;
    }
    if (this.options.keybindings.matches(data, 'tui.select.up')) {
      this.scrollOffset++;
      this.options.onRender();
      return;
    }
    if (this.options.keybindings.matches(data, 'tui.select.down')) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.options.onRender();
    }
  }

  override render(width: number): string[] {
    const viewportRows = Math.max(6, this.options.viewportRows() - 3);
    const content = this.log.render(width);
    this.scrollOffset = Math.min(this.scrollOffset, Math.max(0, content.length - viewportRows));
    const end = Math.max(0, content.length - this.scrollOffset);
    const start = Math.max(0, end - viewportRows);
    const position = this.totalRows > 0 ? `${this.startRowNumber}-${this.totalRows}` : 'empty';
    return [
      theme.bold(theme.accent(`Transcript · ${this.mode} · rows ${position}`)),
      theme.dim('↑/↓ scroll · PgUp/PgDn page · Alt+R raw · Ctrl+T/Esc close'),
      ...(this.loading ? [theme.dim('Loading SQLite transcript…')] : []),
      ...content.slice(start, end),
    ];
  }

  private async loadPage(rowNumber: number, prepend: boolean): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.options.onRender();
    try {
      const page = await this.options.loadWindow(rowNumber);
      const merged = prepend ? [...page.messages, ...this.messages] : page.messages;
      const seen = new Set<string>();
      this.messages = merged.filter((message) => {
        const key = message.id
          ? `id:${message.id}`
          : JSON.stringify([message.kind, message.role, message.timestamp, message.content]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      this.startRowNumber = page.startRowNumber;
      this.totalRows = page.totalRows;
      this.log.clearAll();
      appendHistoryToChatLog(this.log, this.messages, true, true);
      this.log.setRenderMode(this.mode);
      if (prepend) this.scrollOffset = Number.MAX_SAFE_INTEGER;
    } finally {
      this.loading = false;
      this.options.onRender();
    }
  }
}
