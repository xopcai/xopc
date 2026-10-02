import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatRow, XopcChatBlock, XopcHistoryMedia, XopcReviewFinding, XopcContextRef } from '../model/chat';
import { XopcMobileRoute } from '../model/home';
import { XopcMarkdownView } from './MarkdownView';
import { XopcChatStepsView } from './ChatStepsView';
import { XopcChatMediaView } from './ChatMediaView';
import { XopcChatResultTail } from './ChatResultTail';
import { chatAnswerText } from '../common/chatRichContent';
import { XopcChatDisclosure } from '../common/chatDisclosure';
import { filePreviewKind } from '../common/filePreview';
import { chatMessageNeedsPreview, chatMessagePreviewLines, chatMessagePreviewText } from '../common/chatMessagePreview';

@ComponentV2
export struct XopcChatMessageContent {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param row: XopcChatRow = { id: '', role: 'assistant', text: '' };
  @Param conversationId: string = '';
  @Param reasoning: string = 'on';
  @Param runStartedAtMs: number = 0;
  @Param connection: string = 'connected';
  @Param previewEligible: boolean = false;
  @Param disclosure: XopcChatDisclosure = new XopcChatDisclosure();
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Event onFillDraft: (text: string) => void = (_text: string): void => {};
  @Event onShowMore: (row: XopcChatRow) => void = (_row: XopcChatRow): void => {};
  @Event onShowExecution: (row: XopcChatRow) => void = (_row: XopcChatRow): void => {};
  @Computed get showPreview(): boolean { return this.previewEligible && chatMessageNeedsPreview(this.row); }
  @Computed get previewText(): string { return chatMessagePreviewText(this.row); }
  @Computed get previewMarkdown(): string { return chatAnswerText(this.row); }
  @Computed get previewLines(): number { return chatMessagePreviewLines(this.row); }
  @Computed get visibleMedia(): XopcHistoryMedia[] {
    const artifacts = this.row.outcome?.deliverables || [];
    return (this.row.media || []).filter((file: XopcHistoryMedia): boolean => !artifacts.some((artifact): boolean => artifact.availability === 'available' && !!artifact.uri && artifact.uri === file.uri));
  }
  @Local mediaExpanded: boolean = false;
  @Computed get audioMedia(): XopcHistoryMedia[] {
    return this.visibleMedia.filter((file: XopcHistoryMedia): boolean => filePreviewKind(file.name, file.mimeType) === 'audio');
  }
  @Computed get fileMedia(): XopcHistoryMedia[] {
    return this.visibleMedia.filter((file: XopcHistoryMedia): boolean => filePreviewKind(file.name, file.mimeType) !== 'audio');
  }
  @Computed get imageMedia(): XopcHistoryMedia[] {
    return this.fileMedia.filter((file: XopcHistoryMedia): boolean => filePreviewKind(file.name, file.mimeType) === 'image');
  }
  @Computed get userImageThumbnailSize(): number { return this.imageMedia.length === 1 ? 168 : 112; }
  @Computed get attachmentMedia(): XopcHistoryMedia[] {
    return this.row.role === 'user'
      ? this.fileMedia.filter((file: XopcHistoryMedia): boolean => filePreviewKind(file.name, file.mimeType) !== 'image')
      : this.fileMedia;
  }
  @Computed get displayedMedia(): XopcHistoryMedia[] { return this.mediaExpanded ? this.attachmentMedia : this.attachmentMedia.slice(0, 3); }
  @Computed get body(): XopcChatBlock[] {
    return (this.row.blocks || []).filter((block: XopcChatBlock): boolean =>
      block.kind === 'review' || (block.kind === 'text' && block.presentation !== 'narration'));
  }
  @Computed get hasProgress(): boolean {
    return !!this.row.live || !!this.row.executionActivity
      || (this.row.blocks || []).some((block: XopcChatBlock): boolean =>
        (block.kind === 'text' && block.presentation === 'narration') || block.kind === 'thinking'
          || block.kind === 'tool' || block.kind === 'plan' || block.kind === 'diff')
      || (this.row.toolCalls || []).length > 0 || (this.row.activityTools || []).length > 0;
  }

  @Builder
  reference(ref: XopcContextRef) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 8 }) {
        SymbolGlyph(ref.kind === 'task' ? $r('sys.symbol.checkmark_circle') : $r('sys.symbol.doc_text'))
          .fontSize(15).fontColor([this.colors.secondary])
        Text(ref.title || ref.sourceId).fontSize(13).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.secondary).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(12).fontColor([this.colors.tertiary])
      }.width('100%').height('100%').alignItems(VerticalAlign.Center)
    }.id('chat-reference-' + ref.kind + '-' + ref.sourceId).width('100%').height(40)
      .padding({ left: 10, right: 8 }).borderRadius(10).backgroundColor(this.colors.panel)
      .onClick((): void => {
        this.onNavigate({ page: ref.kind === 'task' ? 'tasks' : ref.kind === 'user_assertion' ? 'about-you' : 'notes', itemId: ref.sourceId });
      })
  }

  build() {
    Column({ space: this.showPreview ? 2 : 8 }) {
      if (this.row.role === 'assistant' && this.hasProgress) {
        XopcChatStepsView({ row: this.row, runStartedAtMs: this.runStartedAtMs,
          connection: this.connection, onShowDetail: this.onShowExecution })
      }
      if (this.row.outcome?.status === 'failed') {
        Text($r('app.string.chat_response_failed')).fontSize(13).fontColor(this.colors.danger)
      }
      if (this.showPreview) {
        if (this.row.role === 'assistant') {
          XopcMarkdownView({ content: this.previewMarkdown, conversationId: this.conversationId, compactReading: true,
            previewLineLimit: this.previewLines, onNavigate: this.onNavigate })
        } else {
        Text(this.previewText).fontSize(16).lineHeight(this.row.role === 'assistant' ? 23 : 25)
          .fontColor(this.colors.foreground).width('100%').textAlign(TextAlign.Start)
          .maxLines(this.previewLines).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        Button() {
          Text($r('app.string.chat_view_more')).fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.accent'))
        }.id('chat-message-more-' + this.row.id).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.chat_view_more'))
          .onClick((): void => { this.onShowMore(this.row); })
      } else {
        if (this.row.role !== 'user') {
          ForEach(this.row.refs || [], (ref: XopcContextRef) => {
            this.reference(ref)
          }, (ref: XopcContextRef): string => ref.kind + ':' + ref.sourceId)
        }
        if (this.row.role === 'assistant') {
          Repeat<XopcChatBlock>(this.body).each((item: RepeatItem<XopcChatBlock>) => {
            if (item.item.kind === 'text' && item.item.text) {
              XopcMarkdownView({ content: item.item.text, conversationId: this.conversationId, compactReading: true,
                onNavigate: this.onNavigate })
            } else if (item.item.review) {
              Column({ space: 10 }) {
                Text($r('app.string.chat_review')).fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
                Text(item.item.review.overallCorrectness === 'patch is incorrect' ? $r('app.string.chat_review_incorrect')
                  : item.item.review.overallCorrectness === 'patch is correct' ? $r('app.string.chat_review_correct') : $r('app.string.chat_review_unknown'))
                  .fontSize(12).fontColor(this.colors.secondary)
                if (item.item.review.summary) { XopcMarkdownView({ content: item.item.review.summary, conversationId: this.conversationId,
                  compactReading: true, onNavigate: this.onNavigate }) }
                ForEach(item.item.review.findings || [], (finding: XopcReviewFinding, index: number) => {
                  Column({ space: 6 }) {
                    Text('P' + finding.priority + ' · ' + finding.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
                    if (finding.filePath) { Text(finding.filePath + (finding.lineStart ? ':' + finding.lineStart : '')).fontSize(12).fontFamily('monospace').fontColor(this.colors.secondary).copyOption(CopyOptions.InApp) }
                    XopcMarkdownView({ content: finding.body, conversationId: this.conversationId, compactReading: true,
                      onNavigate: this.onNavigate })
                  }.width('100%').padding(10).borderRadius(8).backgroundColor(this.colors.grouped).alignItems(HorizontalAlign.Start)
                }, (finding: XopcReviewFinding, index: number): string => index + ':' + finding.title)
                if (item.item.review.overallExplanation) { XopcMarkdownView({ content: item.item.review.overallExplanation,
                  conversationId: this.conversationId, compactReading: true, onNavigate: this.onNavigate }) }
              }.id('chat-review-' + item.item.id).width('100%').padding(12).borderRadius(12)
                .backgroundColor(this.colors.grouped).alignItems(HorizontalAlign.Start)
            }
          }).key((block: XopcChatBlock): string => block.id)
          if (!this.body.length && !this.row.blocks && this.row.text) { XopcMarkdownView({ content: this.row.text,
            conversationId: this.conversationId, compactReading: true, onNavigate: this.onNavigate }) }
        } else if (this.row.role === 'user') {
          if (this.row.text) {
            Text(this.row.text).fontSize(16).lineHeight(25).fontColor(this.colors.foreground)
              .width('100%').textAlign(TextAlign.Start)
          }
          ForEach(this.row.refs || [], (ref: XopcContextRef) => {
            this.reference(ref)
          }, (ref: XopcContextRef): string => ref.kind + ':' + ref.sourceId)
        } else {
          Text(this.row.text).fontSize(13).fontColor(this.colors.secondary).copyOption(CopyOptions.InApp)
        }
        Repeat<XopcHistoryMedia>(this.audioMedia).each((item: RepeatItem<XopcHistoryMedia>) => {
          if (this.row.role === 'user') {
            XopcChatMediaView({ file: item.item, conversationId: this.conversationId, inlineVoice: true })
          } else {
            XopcChatMediaView({ file: item.item, conversationId: this.conversationId })
          }
        }).key((file: XopcHistoryMedia): string => file.id || file.uri)
        if (this.row.role === 'user' && this.imageMedia.length) {
          Scroll() {
            Row({ space: 8 }) {
              Repeat<XopcHistoryMedia>(this.imageMedia).each((item: RepeatItem<XopcHistoryMedia>) => {
                Column() {
                  XopcChatMediaView({ file: item.item, conversationId: this.conversationId, compact: true,
                    embedded: true, compactThumbnail: true, compactThumbnailWidth: this.userImageThumbnailSize,
                    compactThumbnailHeight: this.userImageThumbnailSize,
                    compactThumbnailContain: true, compactMetadata: false, compactDisclosure: false,
                    imageGallery: this.imageMedia })
                }.width(this.userImageThumbnailSize + 8).height(this.userImageThumbnailSize + 8)
                  .borderRadius(12).clip(true).backgroundColor(this.colors.grouped)
              }).key((file: XopcHistoryMedia): string => file.id || file.uri)
            }.width('100%').justifyContent(this.imageMedia.length === 1 ? FlexAlign.End : FlexAlign.Start)
          }.id('chat-user-image-strip-' + this.row.id).scrollable(ScrollDirection.Horizontal)
            .scrollBar(BarState.Off).width('100%').height(this.userImageThumbnailSize + 8)
        }
        if (this.attachmentMedia.length) {
          if (this.row.role !== 'user') {
            Text($r('app.string.chat_attachments_heading')).fontSize(12).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.secondary)
          }
          Repeat<XopcHistoryMedia>(this.displayedMedia).each((item: RepeatItem<XopcHistoryMedia>) => {
            XopcChatMediaView({ file: item.item, conversationId: this.conversationId, compact: true, imageGallery: this.imageMedia })
          }).key((file: XopcHistoryMedia): string => file.id || file.uri)
          if (this.attachmentMedia.length > 3) {
            Button(this.mediaExpanded ? $r('app.string.chat_fewer_attachments')
              : $r('app.string.chat_more_attachments', this.attachmentMedia.length - 3)).height(44).fontSize(13)
              .backgroundColor(Color.Transparent).fontColor(this.colors.accent)
              .onClick((): void => { this.mediaExpanded = !this.mediaExpanded; })
          }
        }
        if (this.row.role === 'assistant') { XopcChatResultTail({ row: this.row, conversationId: this.conversationId, onNavigate: this.onNavigate, onFillDraft: this.onFillDraft }) }
      }
    }.width('100%').alignItems(this.row.role === 'user' ? HorizontalAlign.End : HorizontalAlign.Start)
  }
}
