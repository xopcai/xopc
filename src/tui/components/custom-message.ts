import { Container, Markdown, Spacer, Text, type Component } from '@earendil-works/pi-tui';

import type { TuiMessageRenderer } from '../../extensions/types/tui.js';
import { markdownTheme, theme } from '../theme.js';

export interface CustomMessageSummary {
  customType: string;
  content: string;
  rawContent?: string | unknown[];
  details?: unknown;
  display?: boolean;
}

/** Fallback renderer for extension-injected custom messages replayed from history. */
export class CustomMessageComponent extends Container {
  private readonly body = new Container();
  private customComponent: Component | undefined;
  private expanded = false;

  constructor(
    private readonly message: CustomMessageSummary,
    private customRenderer?: TuiMessageRenderer,
  ) {
    super();
    this.addChild(new Spacer(1));
    this.addChild(this.body);
    this.refresh();
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.refresh();
  }

  matchesCustomType(customType: string): boolean {
    return this.message.customType === customType;
  }

  setRenderer(renderer: TuiMessageRenderer | undefined): void {
    this.customRenderer = renderer;
    this.refresh();
  }

  override invalidate(): void {
    super.invalidate();
    this.refresh();
  }

  private refresh(): void {
    if (this.customComponent) {
      this.removeChild(this.customComponent);
      this.customComponent = undefined;
    }
    this.body.clear();
    if (this.customRenderer) {
      try {
        const rendered = this.customRenderer(
          {
            customType: this.message.customType,
            content: this.message.rawContent ?? this.message.content,
            display: this.message.display,
            details: this.message.details,
          },
          { expanded: this.expanded },
          theme,
        );
        if (rendered) {
          this.customComponent = rendered as Component;
          this.addChild(this.customComponent);
          return;
        }
      } catch {
        // Fall back to default rendering when an extension renderer fails.
      }
    }

    const label = `${theme.bold(`[${this.message.customType}]`)}`;
    this.body.addChild(new Text(label, 1, 1, (text) => theme.toolPendingBg(theme.accent(text))));

    const content = this.message.content.trim();
    if (!content) {
      this.body.addChild(new Text(theme.dim('(no visible content)'), 1, 0));
      return;
    }

    this.body.addChild(
      new Markdown(
        content,
        1,
        0,
        markdownTheme,
        { color: (line) => theme.assistantText(line) },
        { preserveOrderedListMarkers: true },
      ),
    );
  }
}
