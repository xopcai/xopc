import { stripVTControlCharacters } from 'node:util';

import { Text, truncateToWidth, type Component, type Focusable, type KeybindingsManager } from '@earendil-works/pi-tui';

import { theme } from '../theme.js';

/** Bounded, keyboard-scrollable output; content never becomes a model prompt. */
export class TextViewer implements Component, Focusable {
  focused = false;
  private offset = 0;
  private readonly text: Text;
  private timer?: ReturnType<typeof setInterval>;
  private loading = false;
  private disposed = false;
  private prompt: 'search' | 'line' | undefined;
  private input = '';
  private query = '';
  private rendered: string[] = [];

  constructor(
    private readonly title: string,
    content: string,
    private readonly options: { rows: () => number; close: () => void; render: () => void; keybindings: KeybindingsManager; load?: () => Promise<string>; reply?: () => void; onDispose?: () => void; intervalMs?: number },
  ) {
    this.text = new Text(this.preview(content), 0, 0);
    if (options.load) {
      this.timer = setInterval(() => { void this.reload(); }, options.intervalMs ?? 1000);
      this.timer.unref();
    }
  }

  private preview(content: string): string {
    const bounded = content.length > 1_000_000 ? `${content.slice(0, 1_000_000)}\n[Preview truncated at 1,000,000 characters. Export the transcript for the full content.]` : content;
    return stripVTControlCharacters(bounded);
  }

  private async reload(): Promise<void> {
    if (this.loading || this.disposed || !this.options.load) return;
    this.loading = true;
    try {
      const content = await this.options.load();
      if (this.disposed) return;
      this.text.setText(this.preview(content));
    } catch (error) {
      if (!this.disposed) this.text.setText(`Live output unavailable: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.loading = false;
      if (!this.disposed) this.options.render();
    }
  }

  dispose(): void { if (this.disposed) return; this.disposed = true; this.options.onDispose?.(); clearInterval(this.timer); }

  invalidate(): void { this.text.invalidate(); }

  render(width: number): string[] {
    const lines = this.text.render(width);
    this.rendered = lines;
    const rows = Math.max(3, this.options.rows() - 5);
    this.offset = Math.min(this.offset, Math.max(0, lines.length - rows));
    return [truncateToWidth(theme.bold(theme.accent(this.title)), width), ...lines.slice(this.offset, this.offset + rows),
      ...(this.prompt ? [truncateToWidth(theme.accent(`${this.prompt === 'search' ? '/' : 'Go to line: '}${this.input}`), width)] : []),
      truncateToWidth(theme.dim(`↑/↓ scroll · PgUp/PgDn page · / search · n/N next/previous · g line · [/] diff file · Home/End · ${this.options.reply ? 'Enter follow-up · ' : ''}Esc close · ${this.offset + 1}/${lines.length}`), width)];
  }

  handleInput(data: string): void {
    const keys = this.options.keybindings;
    const clean = () => this.rendered.map(line => stripVTControlCharacters(line));
    const find = (direction: number) => {
      const lines = clean();
      for (let step = 1; step <= lines.length; step++) {
        const index = (this.offset + direction * step + lines.length) % lines.length;
        if (lines[index]?.toLowerCase().includes(this.query.toLowerCase())) { this.offset = index; break; }
      }
    };
    if (this.prompt) {
      if (keys.matches(data, 'tui.select.cancel')) this.prompt = undefined;
      else if (keys.matches(data, 'tui.select.confirm')) {
        if (this.prompt === 'search') { this.query = this.input; if (this.query) find(1); }
        else if (/^\d+$/.test(this.input)) this.offset = Math.max(0, Number(this.input) - 1);
        this.prompt = undefined;
      } else if (data === '\x7f' || data === '\b') this.input = [...this.input].slice(0, -1).join('');
      else if (!/[\x00-\x1f\x7f]/.test(data) && this.input.length < 1000) this.input += data;
      this.options.render(); return;
    }
    if (data === '/' || data === 'g') { this.prompt = data === '/' ? 'search' : 'line'; this.input = ''; this.options.render(); return; }
    if ((data === 'n' || data === 'N') && this.query) { find(data === 'n' ? 1 : -1); this.options.render(); return; }
    if (data === '[' || data === ']') {
      const lines = clean(), direction = data === ']' ? 1 : -1;
      for (let index = this.offset + direction; index >= 0 && index < lines.length; index += direction) if (lines[index]?.startsWith('diff --git ')) { this.offset = index; break; }
      this.options.render(); return;
    }
    const page = Math.max(3, this.options.rows() - 5);
    if (keys.matches(data, 'tui.select.confirm') && this.options.reply) { this.options.close(); this.options.reply(); return; }
    if (keys.matches(data, 'tui.select.cancel') || data === 'q') { this.options.close(); return; }
    if (keys.matches(data, 'tui.select.up')) this.offset = Math.max(0, this.offset - 1);
    if (keys.matches(data, 'tui.select.down')) this.offset++;
    if (data === '\x1b[5~') this.offset = Math.max(0, this.offset - page);
    if (data === '\x1b[6~') this.offset += page;
    if (data === '\x1b[H' || data === '\x1b[1~') this.offset = 0;
    if (data === '\x1b[F' || data === '\x1b[4~') this.offset = Number.MAX_SAFE_INTEGER;
    this.options.render();
  }
}
