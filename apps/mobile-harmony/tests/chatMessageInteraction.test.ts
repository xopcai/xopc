import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const content = readFileSync(new URL('../entry/src/main/ets/view/ChatMessageContent.ets', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const selection = readFileSync(new URL('../entry/src/main/ets/view/ChatSelectableText.ets', import.meta.url), 'utf8');
const markdown = readFileSync(new URL('../entry/src/main/ets/view/MarkdownView.ets', import.meta.url), 'utf8');

describe('chat message interactions', () => {
  it('anchors message details to the top of the scroll viewport, including short responses', () => {
    const sheet = chat.slice(chat.indexOf('  messageDetailSheet()'), chat.indexOf('  imageEditorSheet()'));
    expect(sheet).toContain(".id('chat-message-detail-scroll').layoutWeight(1).width('100%').scrollBar(BarState.Auto)\n        .align(Alignment.TopStart)");
    expect(sheet).not.toContain('FlexAlign.Center');
    expect(sheet).not.toContain('Alignment.Center');
  });
  it('opens the full message from the preview and the visible view-more action', () => {
    expect(content).toContain("Button($r('app.string.chat_view_more'))");
    expect(content).toContain(".id('chat-message-preview-' + this.row.id)");
    expect(content).toContain(".accessibilityText($r('app.string.chat_message_detail'))");
    expect(content).toContain('.onClick((): void => { this.onShowMore(this.row); })');
  });

  it('opens anchored long-press menus with haptics and selects assistant text inline', () => {
    expect(chat).not.toContain('assistantMessageActions(');
    expect(chat).toContain('this.assistantMessageMenu(item.item) : undefined, ResponseType.LongPress');
    expect(chat).toContain('this.userMessageMenu(item.item) : undefined, ResponseType.LongPress');
    expect(chat.match(/hapticFeedbackMode: HapticFeedbackMode.ENABLED/g)).toHaveLength(2);
    for (const id of ['copy', 'select', 'save', 'read', 'detail', 'execution', 'regenerate', 'copy-code']) {
      expect(chat).toContain(`id: '${id}'`);
    }
    expect(chat).toContain(".id('chat-assistant-menu-' + action.id)");
    expect(chat).toMatch(/if \(action === 'select'\) \{[\s\S]*?this.selectingMessageId = row.id;/);
    expect(chat).toContain("else if (action === 'detail') this.openMessageDetail(row);");
    expect(content).toContain('XopcChatSelectableText({ source: this.previewMarkdown, rowId: this.row.id,');
    expect(selection).toContain('this.controller.setTextSelection(start, start + initial.length, { menuPolicy: MenuPolicy.SHOW })');
    expect(selection).toContain('TextMenuItemId.SELECT_ALL');
    expect(selection).toContain('shareSelectedChatText');
    expect(chat).toContain('textSelectable: true');
    expect(content).toContain('@Param textSelectable: boolean = false;');
    expect(markdown).toContain('.copyOption(this.textSelectable ? CopyOptions.InApp : CopyOptions.None)');
  });

  it('uses compact line and block spacing only for assistant chat content', () => {
    expect(content).toContain("lineHeight(this.row.role === 'assistant' ? 23 : 25)");
    expect(content).toContain('compactReading: true');
    expect(markdown).toContain('@Param compactReading: boolean = false;');
    expect(markdown).toContain('markdownBlockGap(this.blocks[index], this.blocks[index - 1])');
    expect(content).toContain('previewLineLimit: this.previewLines');
    expect(markdown).toContain('if (!this.headingLevel) return this.compactReading ? 23 : 25;');
  });

  it('compresses AI markdown headings into a calm three-level mobile hierarchy', () => {
    expect(markdown).toContain('if (this.headingLevel === 1) return 20;');
    expect(markdown).toContain('if (this.headingLevel === 2) return 18;');
    expect(markdown).toContain("if (kind === 'bold' || this.strong) return this.compactReading ? FontWeight.Medium : FontWeight.Bold;");
    expect(markdown).toContain('return this.compactReading ? FontWeight.Medium : FontWeight.Bold;');
    expect(markdown).toContain('.fontWeight(this.spanWeight(span.kind))');
    expect(markdown).not.toContain('Math.max(17, 28 - this.headingLevel * 2)');
    expect(markdown).not.toContain("span.kind === 'bold' || this.headingLevel > 0 || this.strong");
  });
});
