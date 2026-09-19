import { Container, Spacer, Text } from '@earendil-works/pi-tui';

import { theme } from '../theme.js';
import type { CellRenderMode, ModeAwareCell } from './cell-render-mode.js';

export type SemanticCellKind = 'plan' | 'web' | 'approval' | 'question' | 'mcp';

export interface SemanticCellData {
  kind: SemanticCellKind;
  title: string;
  lines?: string[];
  raw?: unknown;
}

export class SemanticCellComponent extends Container implements ModeAwareCell {
  private renderMode: CellRenderMode = 'compact';

  constructor(private data: SemanticCellData) {
    super();
  }

  update(data: SemanticCellData): void {
    this.data = data;
  }

  setRenderMode(mode: CellRenderMode): void {
    this.renderMode = mode;
  }

  override render(width: number): string[] {
    if (this.renderMode === 'raw') {
      return new Text(JSON.stringify(this.data.raw ?? this.data, null, 2), 0, 0).render(width);
    }
    const body = new Container();
    body.addChild(new Spacer(1));
    body.addChild(new Text(theme.bold(theme.accent(`${this.data.kind.toUpperCase()} · ${this.data.title}`)), 1, 0));
    const lines = this.data.lines ?? [];
    const visible = this.renderMode === 'compact' ? lines.slice(0, 4) : lines;
    for (const line of visible) body.addChild(new Text(theme.dim(line), 3, 0));
    if (visible.length < lines.length) body.addChild(new Text(theme.dim(`… ${lines.length - visible.length} more`), 3, 0));
    return body.render(width);
  }
}
