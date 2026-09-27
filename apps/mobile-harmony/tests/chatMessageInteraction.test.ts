import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const content = readFileSync(new URL('../entry/src/main/ets/view/ChatMessageContent.ets', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const markdown = readFileSync(new URL('../entry/src/main/ets/view/MarkdownView.ets', import.meta.url), 'utf8');

describe('chat message interactions', () => {
  it('renders view more as a distinct accessible action without an underline', () => {
    expect(content).toContain(".fontColor($r('app.color.accent'))");
    expect(content).not.toContain('TextDecorationType.Underline');
    expect(content).toContain(".id('chat-message-more-' + this.row.id).height(44)");
    expect(content).toContain(".accessibilityText($r('app.string.chat_view_more'))");
  });

  it('shows common assistant actions and reserves the more menu for secondary actions', () => {
    const actionsStart = chat.indexOf('assistantMessageActions(row: XopcChatRow)');
    const actionsEnd = chat.indexOf('@Builder\n  conversation()', actionsStart);
    const actions = chat.slice(actionsStart, actionsEnd);
    for (const label of ['chat_copy', 'chat_save_note', 'chat_read_aloud']) {
      expect(actions).toContain(`app.string.${label}`);
    }
    const menuStart = chat.indexOf('assistantMessageMoreMenu(row: XopcChatRow)');
    const menuEnd = chat.indexOf('@Builder\n  assistantMessageActions', menuStart);
    const menu = chat.slice(menuStart, menuEnd);
    expect(menu).toContain('app.string.chat_regenerate');
    expect(menu).toContain('app.string.chat_copy_code');
    expect(menu).not.toContain('app.string.chat_copy)');
    expect(menu).not.toContain('app.string.chat_save_note');
    expect(chat).not.toContain('.bindContextMenu(chatAnswerText(item.item)');
  });

  it('uses compact line and block spacing only for assistant chat content', () => {
    expect(content).toContain("lineHeight(this.row.role === 'assistant' ? 23 : 25)");
    expect(content).toContain('compactReading: true');
    expect(markdown).toContain('@Param compactReading: boolean = false;');
    expect(markdown).toContain('Column({ space: this.compactReading ? 8 : 12 })');
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
