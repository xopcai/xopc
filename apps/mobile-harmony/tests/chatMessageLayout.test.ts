import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chat = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const content = readFileSync(new URL('../entry/src/main/ets/view/ChatMessageContent.ets', import.meta.url), 'utf8');

describe('chat message layout parity', () => {
  it('renders user messages as compact right-aligned bubbles', () => {
    const start = chat.indexOf("if (item.item.role === 'user')");
    const end = chat.indexOf("} else {", start);
    const userLayout = chat.slice(start, end);

    expect(userLayout).toContain(".id('chat-user-bubble-' + item.item.id)");
    expect(userLayout).toContain(".width(this.userBubbleWidth(item.item))");
    expect(userLayout).toContain("maxWidth: item.item.sendState === 'sending' || item.item.sendState === 'failed' ? '84%' : '90%'");
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
    expect(chat).toContain('if (chatNeedsWideBubble(row)) return \'90%\'');
    expect(chat).toContain('Repeat<XopcChatRow>(this.presentationRows)');
    expect(chat).not.toContain(".id('chat-assistant-live-card')");
    expect(chat).not.toContain(".id('chat-assistant-running-card')");
    expect(chat).toContain("List({ space: 20, scroller: this.messagesScroller })");
    expect(chat).toContain(".padding({ left: 12, right: 12 }).cachedCount(3)");
  });

  it('groups references with message text using a compact neutral inset row', () => {
    const reference = content.slice(content.indexOf('  reference(ref: XopcContextRef)'), content.indexOf('\n  build()', content.indexOf('  reference(ref: XopcContextRef)')));
    const composerReference = chat.slice(chat.indexOf("if (this.refs.length)"), chat.indexOf("if (this.attachments.length)", chat.indexOf("if (this.refs.length)")));

    expect(content).toContain('Column({ space: this.showPreview ? 2 : 8 })');
    expect(reference).toContain(".id('chat-reference-' + ref.kind + '-' + ref.sourceId)");
    expect(reference).toContain('.width(\'100%\').height(40)');
    expect(reference).toContain('.fontColor(this.colors.secondary)');
    expect(reference).toContain('.backgroundColor(this.colors.panel)');
    expect(reference).not.toContain('.border(');
    expect(reference).not.toContain('.backgroundColor(this.colors.accentSoft)');
    expect(composerReference).toContain(".id('chat-composer-reference-' + ref.kind + '-' + ref.sourceId)");
    expect(composerReference).toContain('.height(36)');
    expect(composerReference).toContain("$r('app.string.chat_remove_reference')");
    expect(composerReference).toContain('.responseRegion({ x: 0, y: -4, width: \'100%\', height: 44 })');
  });

  it('places user references below text and renders images as previewable thumbnails', () => {
    const userStart = content.indexOf("} else if (this.row.role === 'user') {");
    const userEnd = content.indexOf('} else {', userStart);
    const userContent = content.slice(userStart, userEnd);
    const imageStart = content.indexOf("if (this.row.role === 'user' && this.imageMedia.length)");
    const imageEnd = content.indexOf('if (this.attachmentMedia.length)', imageStart);
    const imageStrip = content.slice(imageStart, imageEnd);

    expect(userContent.indexOf('if (this.row.text)')).toBeLessThan(userContent.indexOf('ForEach(this.row.refs || []'));
    expect(content).toContain("if (this.row.role !== 'user')");
    expect(imageStrip).toContain(".id('chat-user-image-strip-' + this.row.id)");
    expect(imageStrip).toContain('compactThumbnail: true, compactThumbnailWidth: 136, compactThumbnailHeight: 96');
    expect(imageStrip).toContain('compactThumbnailContain: true, compactMetadata: false, compactDisclosure: false');
    expect(imageStrip).toContain('imageGallery: this.imageMedia');
    expect(imageStrip).toContain('.width(144).height(104)');
    expect(content).toContain("return this.row.role === 'user'");
    expect(content).toContain("filePreviewKind(file.name, file.mimeType) !== 'image'");
  });

  it('stages attachments as compact WebUI-style chips inside the composer shell', () => {
    const attachmentStart = chat.indexOf("if (this.attachments.length)", chat.indexOf("if (this.palette.range"));
    const shellEnd = chat.indexOf(".id('chat-composer-shell')", attachmentStart);
    const composer = chat.slice(attachmentStart, shellEnd);

    expect(composer).toContain(".id('chat-composer-attachments')");
    expect(composer).toContain('scrollable(ScrollDirection.Horizontal)');
    expect(composer).toContain('compact: true, embedded: true, compactThumbnail: true');
    expect(composer).toContain('compactAvailable: true, compactDisclosure: false');
    expect(composer).toContain('compactThumbnailWidth: 96, compactThumbnailHeight: 64, compactThumbnailContain: true');
    expect(composer).toContain('compactAvailable: true, compactDisclosure: false, compactMetadata: false');
    expect(composer).not.toContain(".id('chat-composer-attachment-edit-' + index.toString())");
    expect(composer).toContain(".id('chat-composer-attachment-remove-' + index.toString())");
    expect(composer).toContain(".id('chat-composer-attachment-' + index.toString()).width(104).height(72)");
    expect(composer).toContain(".margin({ top: 4, right: 4 }).backgroundColor(Color.Black)");
    expect(composer).toContain(".responseRegion({ x: -8, y: -8, width: 44, height: 44 })");
    expect(composer).toContain(".width('100%').height(this.attachments.some((file: XopcChatAttachment): boolean => file.mimeType.startsWith('image/')) ? 90 : 74)");
    expect(composer).toContain('.align(Alignment.TopStart)');
    expect(attachmentStart).toBeGreaterThan(0);
    expect(shellEnd).toBeGreaterThan(attachmentStart);
    expect(chat.slice(0, attachmentStart)).not.toContain(".id('chat-composer-attachments')");
  });

  it('limits historical messages while keeping the latest visible message expanded', () => {
    const assistantStart = chat.indexOf("} else if (item.item.role === 'assistant') {");
    const assistantEnd = chat.indexOf('} else {', assistantStart);
    const assistantLayout = chat.slice(assistantStart, assistantEnd);

    expect(chat).toContain('@Computed get latestMessageId(): string');
    expect(chat).toContain('return latestChatMessageId(this.presentationRows)');
    expect(chat.match(/previewEligible: item\.item\.id !== this\.latestMessageId/g)).toHaveLength(2);
    expect(chat).not.toContain('previewEligible: true');
    expect(chat).toContain('.bindSheet($$this.messageDetailOpen, this.messageDetailSheet');
    expect(chat).toContain(".id('chat-message-detail-scroll')");
  });

  it('keeps common assistant actions visible and puts secondary actions in a menu', () => {
    expect(chat).toContain('assistantMessageActions(row: XopcChatRow)');
    expect(chat).toContain('if (!item.item.live && chatAnswerText(item.item)) { this.assistantMessageActions(item.item) }');
    expect(chat).toContain('assistantMessageMoreMenu(row: XopcChatRow)');
    expect(chat).toContain(".id('chat-assistant-more-' + row.id)");
    expect(chat).toContain('.bindMenu(this.assistantMessageMoreMenu(row))');
    expect(chat).not.toContain('assistantMessageMenu(row: XopcChatRow)');
    expect(chat).not.toContain('.bindContextMenu(chatAnswerText(item.item)');
  });

});
