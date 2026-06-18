import { Box, Container, Markdown } from '@earendil-works/pi-tui';

import { markdownTheme, theme } from '../theme.js';

const OSC133_ZONE_START = '\x1b]133;A\x07';
const OSC133_ZONE_END = '\x1b]133;B\x07';
const OSC133_ZONE_FINAL = '\x1b]133;C\x07';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeUserContent(content: string | unknown[]): string {
  if (typeof content === 'string') {
    return content;
  }
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }
    if (!isRecord(block)) continue;
    const type = typeof block.type === 'string' ? block.type : '';
    if ((type === 'text' || type === 'input_text') && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (type === 'image' || type === 'image_url' || type === 'input_image') {
      const name = typeof block.name === 'string' && block.name.trim() ? `:${block.name}` : '';
      parts.push(`[image${name}]`);
    } else if (type === 'file') {
      const name = typeof block.name === 'string' && block.name.trim() ? `:${block.name}` : '';
      parts.push(`[file${name}]`);
    } else if (typeof block.text === 'string') {
      parts.push(block.text);
    } else if (type) {
      parts.push(`[${type}]`);
    }
  }
  return parts.filter(Boolean).join('\n\n');
}

export class UserMessageComponent extends Container {
  private body: Markdown;

  constructor(text: string | unknown[]) {
    super();
    this.body = new Markdown(
      normalizeUserContent(text),
      1,
      0,
      markdownTheme,
      {
        color: (line) => theme.userText(line),
      },
      { preserveOrderedListMarkers: true },
    );
    const box = new Box(1, 1, (line) => theme.userBg(line));
    box.addChild(this.body);
    this.addChild(box);
  }

  setText(text: string | unknown[]): void {
    this.body.setText(normalizeUserContent(text));
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length === 0) return lines;
    lines[0] = OSC133_ZONE_START + lines[0];
    lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
    return lines;
  }
}
