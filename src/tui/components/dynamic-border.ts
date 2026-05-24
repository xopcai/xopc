import type { Component } from '@earendil-works/pi-tui';

/** Horizontal rule that spans the current viewport width. */
export class DynamicBorder implements Component {
  constructor(private readonly color: (str: string) => string) {}

  invalidate(): void {}

  render(width: number): string[] {
    return [this.color('─'.repeat(Math.max(1, width)))];
  }
}
