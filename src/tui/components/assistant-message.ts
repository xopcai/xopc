import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { Container, Markdown, Spacer, Text } from '@earendil-works/pi-tui';

import { markdownTheme, theme } from '../theme.js';

const OSC133_ZONE_START = '\x1b]133;A\x07';
const OSC133_ZONE_END = '\x1b]133;B\x07';
const OSC133_ZONE_FINAL = '\x1b]133;C\x07';

export type AssistantMessageOptions = {
  hideThinkingBlock?: boolean;
  hiddenThinkingLabel?: string;
};

type ContentBlock = Record<string, unknown> & { type?: string };

function contentBlocks(message: AgentMessage | undefined): ContentBlock[] {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === 'string') {
    return content.trim() ? [{ type: 'text', text: content }] : [];
  }
  return Array.isArray(content)
    ? content.filter((block): block is ContentBlock => !!block && typeof block === 'object')
    : [];
}

function blockText(block: ContentBlock, key: 'text' | 'thinking'): string {
  const value = block[key];
  return typeof value === 'string' ? value : '';
}

function hasToolCalls(message: AgentMessage | undefined): boolean {
  return contentBlocks(message).some((block) => block.type === 'toolCall' || block.type === 'tool_use');
}

function stopReason(message: AgentMessage | undefined): string | undefined {
  return (message as { stopReason?: string } | undefined)?.stopReason;
}

function errorMessage(message: AgentMessage | undefined): string | undefined {
  return (message as { errorMessage?: string } | undefined)?.errorMessage;
}

export function createAssistantMessageFromText(text: string): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

export class AssistantMessageComponent extends Container {
  private readonly contentContainer = new Container();
  private message: AgentMessage | undefined;
  private linkedToolCall = false;
  private hideThinkingBlock = false;
  private hiddenThinkingLabel = 'Thinking...';

  constructor(message?: AgentMessage, options: AssistantMessageOptions = {}) {
    super();
    this.hideThinkingBlock = options.hideThinkingBlock ?? false;
    this.hiddenThinkingLabel = options.hiddenThinkingLabel ?? 'Thinking...';
    this.addChild(this.contentContainer);
    if (message) {
      this.updateContent(message);
    }
  }

  updateContent(message: AgentMessage): void {
    this.message = message;
    this.refresh();
  }

  setHasToolCalls(hasTools: boolean): void {
    this.linkedToolCall = hasTools;
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
    if (hasToolCalls(this.message) || this.linkedToolCall || lines.length === 0) return lines;
    lines[0] = OSC133_ZONE_START + lines[0];
    lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
    return lines;
  }

  private refresh(): void {
    this.contentContainer.clear();
    const blocks = contentBlocks(this.message);
    const visibleBlocks = blocks.filter((block) => {
      if (block.type === 'text') return blockText(block, 'text').trim().length > 0;
      if (block.type === 'thinking') return blockText(block, 'thinking').trim().length > 0;
      if (block.type === 'image' || block.type === 'image_url') return true;
      return false;
    });
    const reason = stopReason(this.message);
    const hasErrorState =
      !hasToolCalls(this.message) && !this.linkedToolCall && (reason === 'aborted' || reason === 'error');
    if (visibleBlocks.length === 0 && !hasErrorState) return;

    this.contentContainer.addChild(new Spacer(1));
    let renderedVisible = 0;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      if (block.type === 'text') {
        const text = blockText(block, 'text').trim();
        if (!text) continue;
        if (renderedVisible > 0) this.contentContainer.addChild(new Spacer(1));
        this.contentContainer.addChild(
          new Markdown(
            text,
            1,
            0,
            markdownTheme,
            { color: (line) => theme.assistantText(line) },
            { preserveOrderedListMarkers: true },
          ),
        );
        renderedVisible++;
      } else if (block.type === 'thinking') {
        const thinking = blockText(block, 'thinking').trim();
        if (!thinking) continue;
        if (renderedVisible > 0) this.contentContainer.addChild(new Spacer(1));
        const text = this.hideThinkingBlock ? this.hiddenThinkingLabel : thinking;
        this.contentContainer.addChild(
          new Markdown(
            text,
            1,
            0,
            markdownTheme,
            { color: (line) => theme.dim(theme.italic(line)) },
            { preserveOrderedListMarkers: true },
          ),
        );
        renderedVisible++;
      } else if (block.type === 'image' || block.type === 'image_url') {
        if (renderedVisible > 0) this.contentContainer.addChild(new Spacer(1));
        this.contentContainer.addChild(new Text(theme.dim('[image]'), 1, 0));
        renderedVisible++;
      }
    }

    if (hasErrorState) {
      if (renderedVisible > 0) this.contentContainer.addChild(new Spacer(1));
      const text =
        reason === 'aborted'
          ? errorMessage(this.message) && errorMessage(this.message) !== 'Request was aborted'
            ? errorMessage(this.message)!
            : 'Operation aborted'
          : `Error: ${errorMessage(this.message) || 'Unknown error'}`;
      this.contentContainer.addChild(new Text(theme.error(text), 1, 0));
    }
  }
}
