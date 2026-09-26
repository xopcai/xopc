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
    expect(userLayout).toContain('bottomRight: 6');
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
    expect(assistantLayout).toContain('.borderRadius(18).backgroundColor(this.colors.panel)');
    expect(assistantLayout).not.toContain('.border(');
    expect(chat).toContain("|| (row.toolCalls?.length || 0) > 0 || !!row.outcome) return '90%'");
    expect(chat).toContain(".id('chat-assistant-live-card')");
    expect(chat).toContain('.width(this.assistantBubbleWidth(this.chat.liveRow))');
    expect(chat).toContain(".id('chat-assistant-running-card')");
    expect(chat).toContain(".width('132vp').constraintSize({ maxWidth: '90%' })");
    expect(chat).toContain("List({ space: 20, scroller: this.messagesScroller })");
    expect(chat).toContain(".padding({ left: 20, right: 20 }).cachedCount(3)");
  });

  it('aligns the action row with the message role without shrinking its touch targets', () => {
    expect(chat).toContain("justifyContent(row.role === 'user' ? FlexAlign.End : FlexAlign.Start)");
    expect(chat).toContain(".width(44).height(44).padding(0).backgroundColor(Color.Transparent)");
  });
});
