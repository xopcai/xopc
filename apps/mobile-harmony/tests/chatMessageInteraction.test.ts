import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHAT_MESSAGE_TAP_SLOP_VP, CHAT_SIDEBAR_PAN_DISTANCE_VP } from '../entry/src/main/ets/common/chatSidebarGesture.ets';

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
  it('opens full user and assistant messages from the faded previews and bubbles', () => {
    const preview = content.slice(content.indexOf('} else if (this.showPreview)'), content.indexOf("if (this.row.role !== 'user')"));
    expect(preview).toContain('direction: GradientDirection.Bottom');
    expect(preview).toContain(".id('chat-message-preview-' + this.row.id)");
    expect(preview).toContain(".accessibilityText($r('app.string.chat_message_detail'))");
    expect(preview).toContain('.onClick((): void => { this.onShowMore(this.row); }, CHAT_MESSAGE_TAP_SLOP_VP)');
    expect(preview).not.toContain("$r('app.string.chat_view_more')");
    for (const bubble of ['chat-user-bubble-', 'chat-assistant-card-']) {
      const card = chat.slice(chat.indexOf(`.id('${bubble}'`), chat.indexOf('.bindContextMenu', chat.indexOf(`.id('${bubble}'`)));
      expect(card).toContain('item.item.id !== this.latestMessageId && chatMessageNeedsPreview(item.item)) this.openMessageDetail(item.item);');
      expect(card).toContain('}, CHAT_MESSAGE_TAP_SLOP_VP)');
    }
  });

  it('rejects taps on preview text and bubbles before the parallel sidebar pan starts', () => {
    expect(CHAT_MESSAGE_TAP_SLOP_VP).toBeLessThan(CHAT_SIDEBAR_PAN_DISTANCE_VP);
    expect(chat).toContain('direction: PanDirection.Right, distance: CHAT_SIDEBAR_PAN_DISTANCE_VP');
    expect(markdown).toContain('.onClick((): void => { this.onPreviewTap(); }, Number.isFinite(this.lineLimit) ? CHAT_MESSAGE_TAP_SLOP_VP : -1)');
  });

  it('keeps the inline expand controls for long code blocks and tables', () => {
    const expand = /Button\(this\.expandedBlocks\.has\(item\.item\.id\) \? \$r\('app.string.chat_collapse_content'\) : \$r\('app.string.chat_view_more'\)\)/g;
    expect(markdown.match(expand)).toHaveLength(2);
    expect(markdown).toContain('if (markdownCodePreview(item.item.text).length < item.item.text.length)');
    expect(markdown).toContain('if ((item.item.rows || []).length > 40)');
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

  it('uses shared compact Markdown line and block spacing in chat', () => {
    expect(markdown).toContain('.lineHeight(this.textLineHeight)');
    expect(markdown).toContain('this.compactReading ? markdownBlockGap(');
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

  it('defers user message menu actions until context menu dismissal so editing raises the keyboard', () => {
    const userMenu = chat.slice(chat.indexOf('  userMessageMenu(row: XopcChatRow)'), chat.indexOf('  private beginMessageMenu()'));
    expect(userMenu).toContain("this.pendingUserMenuAction = 'copy'");
    expect(userMenu).toContain("this.pendingUserMenuAction = 'edit'");
    expect(userMenu).not.toContain('this.messageAction(');
    const userBubbleBind = chat.slice(
      chat.indexOf('this.userMessageMenu(item.item)'),
      chat.indexOf('if (this.reactionFor(item.item))'),
    );
    expect(userBubbleBind).toContain('onDisappear: (): void => { this.finishUserMenu(item.item); }');
    const fill = chat.slice(chat.indexOf('  private fillMessageDraft('), chat.indexOf('  private isLatestUser('));
    expect(fill).toContain('this.editor.stopEditing();');
    expect(fill).toContain('this.getUIContext().getFocusController().clearFocus();');
    expect(fill).toContain('this.focusComposerOnMount = true; this.focusMountedComposer();');
    const composer = chat.slice(chat.indexOf(".id('chat-composer')"), chat.indexOf('if (this.nextTurnPrompt)'));
    expect(composer).toContain('.enableKeyboardOnFocus(true)');
  });

  it('renders the latest-message editing banner inside the opaque composer shell', () => {
    const shellStart = chat.indexOf(".id('chat-editing-banner')");
    const shellEnd = chat.indexOf(".id('chat-composer-shell')");
    const composerStart = chat.indexOf(".id('chat-composer')");
    const taskTip = chat.indexOf(".id('task-chat-details-tip')");
    expect(shellStart).toBeGreaterThan(taskTip);
    expect(shellStart).toBeLessThan(composerStart);
    expect(composerStart).toBeLessThan(shellEnd);
    const banner = chat.slice(chat.indexOf('if (this.editingTurnId)', taskTip), chat.indexOf('if (this.attachments.length)', taskTip));
    expect(banner).toContain("$r('app.string.chat_editing_latest')");
    expect(banner).toContain(".id('chat-edit-cancel')");
    expect(banner).toContain('this.cancelEditing()');
  });
});
