import { Container, Markdown, Spacer, Text } from '@earendil-works/pi-tui';

import { markdownTheme, theme } from '../theme.js';

const OSC133_ZONE_START = '\x1b]133;A\x07';
const OSC133_ZONE_END = '\x1b]133;B\x07';
const OSC133_ZONE_FINAL = '\x1b]133;C\x07';

export type AssistantRenderState = {
  stopReason?: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' | string;
  errorMessage?: string;
};

export type AssistantMessageOptions = {
  hideThinkingBlock?: boolean;
  hiddenThinkingLabel?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function contentHasToolCall(content: string | unknown[]): boolean {
  if (typeof content === 'string') {
    return false;
  }
  return content.some(
    (block) =>
      isRecord(block) &&
      (block.type === 'toolCall' || block.type === 'tool_use'),
  );
}

export function normalizeAssistantContent(content: string | unknown[]): string {
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
    if (type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (type === 'thinking' && typeof block.thinking === 'string') {
      parts.push(`<thinking>\n${block.thinking}\n</thinking>`);
    } else if (type === 'image' || type === 'image_url') {
      parts.push('[image]');
    }
  }
  return parts.filter(Boolean).join('\n\n');
}

function splitThinkingBlock(text: string): { thinking?: string; content: string } {
  const match = text.match(/^<thinking>\n?([\s\S]*?)\n?<\/thinking>\n*/);
  if (!match) return { content: text };
  return {
    thinking: match[1]?.trim(),
    content: text.slice(match[0].length),
  };
}

type AssistantContentSegment = { type: 'text' | 'thinking'; text: string };

function splitAssistantContentSegments(text: string): AssistantContentSegment[] {
  const segments: AssistantContentSegment[] = [];
  const thinkingRegex = /<thinking>\n?([\s\S]*?)\n?<\/thinking>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = thinkingRegex.exec(text)) !== null) {
    const before = text.slice(cursor, match.index).trim();
    if (before) {
      segments.push({ type: 'text', text: before });
    }
    const thinking = (match[1] ?? '').trim();
    if (thinking) {
      segments.push({ type: 'thinking', text: thinking });
    }
    cursor = match.index + match[0].length;
  }

  const after = text.slice(cursor).trim();
  if (after) {
    segments.push({ type: 'text', text: after });
  }
  return segments;
}

export class AssistantMessageComponent extends Container {
  private readonly contentContainer = new Container();
  private text = '';
  private contentIncludesToolCall = false;
  private linkedToolCall = false;
  private renderState: AssistantRenderState = {};
  private hideThinkingBlock = false;
  private hiddenThinkingLabel = 'Thinking...';

  constructor(text: string | unknown[], options: AssistantMessageOptions = {}) {
    super();
    this.hideThinkingBlock = options.hideThinkingBlock ?? false;
    this.hiddenThinkingLabel = options.hiddenThinkingLabel ?? 'Thinking...';
    this.addChild(this.contentContainer);
    this.setText(text);
  }

  setText(text: string | unknown[]): void {
    this.contentIncludesToolCall = contentHasToolCall(text);
    this.text = normalizeAssistantContent(text);
    this.refresh();
  }

  setHasToolCalls(hasToolCalls: boolean): void {
    this.linkedToolCall = hasToolCalls;
    this.refresh();
  }

  setRenderState(state: AssistantRenderState): void {
    this.renderState = state;
    this.refresh();
  }

  setHideThinkingBlock(hide: boolean): void {
    if (this.hideThinkingBlock === hide) return;
    this.hideThinkingBlock = hide;
    this.refresh();
  }

  setHiddenThinkingLabel(label: string): void {
    if (this.hiddenThinkingLabel === label) return;
    this.hiddenThinkingLabel = label;
    this.refresh();
  }

  override invalidate(): void {
    super.invalidate();
    this.refresh();
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (this.contentIncludesToolCall || this.linkedToolCall || lines.length === 0) return lines;
    lines[0] = OSC133_ZONE_START + lines[0];
    lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
    return lines;
  }

  private refresh(): void {
    this.contentContainer.clear();
    const segments = splitAssistantContentSegments(this.text);
    const hasVisibleContent = segments.length > 0;
    const hasToolCalls = this.contentIncludesToolCall || this.linkedToolCall;
    const hasErrorState =
      !hasToolCalls &&
      (this.renderState.stopReason === 'aborted' || this.renderState.stopReason === 'error');
    if (!hasVisibleContent && !hasErrorState) return;

    this.contentContainer.addChild(new Spacer(1));
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      if (i > 0) {
        this.contentContainer.addChild(new Spacer(1));
      }
      if (segment.type === 'thinking') {
        const thinkingText = this.hideThinkingBlock ? this.hiddenThinkingLabel : segment.text;
        this.contentContainer.addChild(
          new Markdown(
            thinkingText,
            1,
            0,
            markdownTheme,
            {
              color: (line) => theme.dim(theme.italic(line)),
            },
            { preserveOrderedListMarkers: true },
          ),
        );
      } else {
        this.contentContainer.addChild(
          new Markdown(
            segment.text,
            1,
            0,
            markdownTheme,
            {
              color: (line) => theme.assistantText(line),
            },
            { preserveOrderedListMarkers: true },
          ),
        );
      }
    }
    if (hasErrorState) {
      if (hasVisibleContent) {
        this.contentContainer.addChild(new Spacer(1));
      }
      const text =
        this.renderState.stopReason === 'aborted'
          ? this.renderState.errorMessage && this.renderState.errorMessage !== 'Request was aborted'
            ? this.renderState.errorMessage
            : 'Operation aborted'
          : `Error: ${this.renderState.errorMessage || 'Unknown error'}`;
      this.contentContainer.addChild(new Text(theme.error(text), 1, 0));
    }
  }
}

export const __testing = { splitThinkingBlock, splitAssistantContentSegments };
