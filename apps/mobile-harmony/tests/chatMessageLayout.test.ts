import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chat = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');

describe('chat message layout parity', () => {
  it('renders user messages as compact right-aligned bubbles', () => {
    const start = chat.indexOf("if (item.item.role === 'user')");
    const end = chat.indexOf("} else {", start);
    const userLayout = chat.slice(start, end);

    expect(userLayout).toContain(".id('chat-user-bubble-' + item.item.id)");
    expect(userLayout).toContain(".width(this.userBubbleWidth(item.item))");
    expect(userLayout).toContain("constraintSize({ minWidth: 44, maxWidth: '90%' })");
    expect(userLayout).toContain(".justifyContent(FlexAlign.End)");
    expect(userLayout).toContain(".alignItems(HorizontalAlign.End)");
    expect(userLayout).toContain('.backgroundColor(this.colors.accentSoft)');
    expect(userLayout).toContain('.borderRadius(18)');
    expect(chat).toContain("if ((row.media?.length || 0) > 0 || (row.refs?.length || 0) > 0) return '90%'");
    expect(chat).toContain("if (this.userVoiceOnly(row)) return '92vp'");
    expect(chat).toContain("this.userVoiceOnly(item.item) ? { left: 4, right: 4, top: 0, bottom: 0 }");
    expect(chat).toContain("return width >= maximum ? '90%' : width + 'vp'");
  });

  it('renders assistant messages as compact left-aligned response bubbles', () => {
    const start = chat.indexOf("} else if (item.item.role === 'assistant') {");
    const end = chat.indexOf("} else {", start);
    const assistantLayout = chat.slice(start, end);

    expect(assistantLayout).toContain(".id('chat-assistant-card-' + item.item.id)");
    expect(assistantLayout).toContain('.width(this.assistantBubbleWidth(item.item))');
    expect(assistantLayout).toContain("constraintSize({ minWidth: 64, maxWidth: '90%' })");
    expect(assistantLayout).toContain(".padding({ left: 16, right: 16, top: 14, bottom: 14 })");
    expect(assistantLayout).toContain('.borderRadius(18)');
    expect(assistantLayout).not.toContain('.border(');
    expect(chat).toContain("|| (row.toolCalls?.length || 0) > 0 || !!row.outcome) return '90%'");
    expect(chat).toContain(".id('chat-assistant-live-card')");
    expect(chat).toContain('.width(this.assistantBubbleWidth(this.chat.liveRow))');
    expect(chat).toContain(".id('chat-assistant-running-card')");
    expect(chat).toContain(".id('chat-assistant-running-card').width('132vp')");
    expect(chat).toContain(".constraintSize({ maxWidth: '90%' })");
    expect(chat).toContain("List({ space: 20, scroller: this.messagesScroller })");
    expect(chat).toContain(".padding({ left: 12, right: 12 }).cachedCount(3)");
  });

  it('limits historical messages while keeping the latest visible message expanded', () => {
    const assistantStart = chat.indexOf("} else if (item.item.role === 'assistant') {");
    const assistantEnd = chat.indexOf('} else {', assistantStart);
    const assistantLayout = chat.slice(assistantStart, assistantEnd);

    expect(chat).toContain('@Computed get latestMessageId(): string');
    expect(chat).toContain('return this.chat.liveRow?.id || latestChatMessageId(this.chat.rows)');
    expect(chat.match(/previewEligible: item\.item\.id !== this\.latestMessageId/g)).toHaveLength(2);
    expect(chat).not.toContain('previewEligible: true');
    expect(chat).toContain('.bindSheet($$this.messageDetailOpen, this.messageDetailSheet');
    expect(chat).toContain(".id('chat-message-detail-scroll')");
  });

  it('keeps common assistant actions visible and puts secondary actions in a menu', () => {
    expect(chat).toContain('assistantMessageActions(row: XopcChatRow)');
    expect(chat).toContain('if (chatAnswerText(item.item)) { this.assistantMessageActions(item.item) }');
    expect(chat).toContain('assistantMessageMoreMenu(row: XopcChatRow)');
    expect(chat).toContain(".id('chat-assistant-more-' + row.id)");
    expect(chat).toContain('.bindMenu(this.assistantMessageMoreMenu(row))');
    expect(chat).not.toContain('assistantMessageMenu(row: XopcChatRow)');
    expect(chat).not.toContain('.bindContextMenu(chatAnswerText(item.item)');
  });

});
