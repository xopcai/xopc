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

function compactToolAdjacentText(text: string, linkedToolCall: boolean): string {
  if (!linkedToolCall) return text;
  const lines = text.split('\n');
  const kept = lines.filter((line) => !isMechanicalToolSummaryLine(line));
  return kept.join('\n').trim();
}

function isMechanicalToolSummaryLine(line: string): boolean {
  const normalized = line.trim();
  if (!normalized) return false;
  const withoutBullet = normalized.replace(/^[-*•]\s+/, '');
  return (
    /^(Added|Deleted|Edited|Modified|Updated)\s+.+\(\+\d+\s+-\d+\)\.?$/i.test(withoutBullet) ||
    /^Edited\s+\d+\s+files?\s+\(\+\d+\s+-\d+\)\.?$/i.test(withoutBullet) ||
    /^Created\s+.+\(\+\d+\s+-0\)\.?$/i.test(withoutBullet) ||
    /^Removed\s+.+\(\+0\s+-\d+\)\.?$/i.test(withoutBullet)
  );
}

function reviewMarkdown(block: ContentBlock): string {
  const findings = Array.isArray(block.findings) ? block.findings : [];
  const lines: string[] = ['<< Code review finished >>', '', 'Code review', ''];
  const source = typeof block.source === 'string' ? block.source : '';
  const correctness = typeof block.overallCorrectness === 'string' ? block.overallCorrectness : 'unknown';
  const modelReviewIncomplete = source === 'local' && correctness === 'unknown';
  if (findings.length === 0) {
    lines.push(modelReviewIncomplete ? 'No model findings were produced.' : 'No findings.');
  } else {
    lines.push('Findings:');
    for (const item of findings) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const title = typeof rec.title === 'string' ? rec.title : '';
      const body = typeof rec.body === 'string' ? rec.body : '';
      const priority = typeof rec.priority === 'number' ? rec.priority : 2;
      const filePath = typeof rec.filePath === 'string' ? rec.filePath : '';
      const lineStart = typeof rec.lineStart === 'number' ? rec.lineStart : undefined;
      const lineEnd = typeof rec.lineEnd === 'number' ? rec.lineEnd : undefined;
      const loc = filePath
        ? `${filePath}${lineStart ? `:${lineStart}${lineEnd && lineEnd !== lineStart ? `-${lineEnd}` : ''}` : ''}`
        : '';
      const suffix = loc ? ` - ${loc}` : '';
      lines.push(`- [P${priority}] ${title || body.slice(0, 80)}${suffix}`);
      if (body) lines.push(`  ${body.replace(/\n+/g, '\n  ')}`);
    }
  }
  const explanation = typeof block.overallExplanation === 'string' ? block.overallExplanation : '';
  lines.push('');
  lines.push(`Overall correctness: ${correctness}`);
  if (explanation) lines.push(explanation);
  return lines.join('\n');
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
      if (block.type === 'text') {
        return compactToolAdjacentText(blockText(block, 'text'), this.linkedToolCall).trim().length > 0;
      }
      if (block.type === 'thinking') return blockText(block, 'thinking').trim().length > 0;
      if (block.type === 'image' || block.type === 'image_url') return true;
      if (block.type === 'review') return true;
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
        const text = compactToolAdjacentText(blockText(block, 'text'), this.linkedToolCall).trim();
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
      } else if (block.type === 'review') {
        const text = reviewMarkdown(block).trim();
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
