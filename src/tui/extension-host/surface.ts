/**
 * Shared TUI extension surface state (header/footer widgets, status slots).
 */

import type { Component } from '@earendil-works/pi-tui';

export class TuiExtensionSurface {
  readonly headerWidgets = new Map<string, string[]>();
  readonly footerWidgets = new Map<string, string[]>();
  readonly headerWidgetComponents = new Map<string, Component & { dispose?(): void }>();
  readonly footerWidgetComponents = new Map<string, Component & { dispose?(): void }>();
  readonly statusSlots = new Map<string, string>();
  customHeader: (Component & { dispose?(): void }) | undefined;
  customFooter: (Component & { dispose?(): void }) | undefined;

  getHeaderLines(): string[] {
    const lines: string[] = [];
    for (const [, widgetLines] of sortedEntries(this.headerWidgets)) {
      lines.push(...widgetLines);
    }
    return lines;
  }

  getFooterLines(): string[] {
    const lines: string[] = [];
    for (const [, widgetLines] of sortedEntries(this.footerWidgets)) {
      lines.push(...widgetLines);
    }
    return lines;
  }

  getHeaderComponents(): Array<Component & { dispose?(): void }> {
    return sortedEntries(this.headerWidgetComponents).map(([, component]) => component);
  }

  getFooterComponents(): Array<Component & { dispose?(): void }> {
    return sortedEntries(this.footerWidgetComponents).map(([, component]) => component);
  }

  disposeWidgetComponents(): void {
    for (const component of this.headerWidgetComponents.values()) {
      disposeComponent(component);
    }
    for (const component of this.footerWidgetComponents.values()) {
      disposeComponent(component);
    }
    this.headerWidgetComponents.clear();
    this.footerWidgetComponents.clear();
  }

  getStatusParts(): string[] {
    return sortedEntries(this.statusSlots)
      .map(([, text]) => sanitizeStatusText(text))
      .filter(Boolean);
  }
}

function disposeComponent(component: { dispose?(): void } | undefined): void {
  try {
    component?.dispose?.();
  } catch {
    // Ignore extension component cleanup failures.
  }
}

function sortedEntries<T>(map: Map<string, T>): Array<[string, T]> {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}
