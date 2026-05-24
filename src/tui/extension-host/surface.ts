/**
 * Shared TUI extension surface state (header/footer widgets, status slots).
 */

export class TuiExtensionSurface {
  readonly headerWidgets = new Map<string, string[]>();
  readonly footerWidgets = new Map<string, string[]>();
  readonly statusSlots = new Map<string, string>();

  getHeaderLines(): string[] {
    const lines: string[] = [];
    for (const widgetLines of this.headerWidgets.values()) {
      lines.push(...widgetLines);
    }
    return lines;
  }

  getFooterLines(): string[] {
    const lines: string[] = [];
    for (const widgetLines of this.footerWidgets.values()) {
      lines.push(...widgetLines);
    }
    return lines;
  }

  getStatusParts(): string[] {
    return [...this.statusSlots.values()].filter(Boolean);
  }
}
