import { XopcChatRow, XopcChatBlock, XopcHistoryMedia, XopcReviewFinding, XopcContextRef } from '../model/chat';
import { XopcMobileRoute } from '../model/home';
import { XopcMarkdownView } from './MarkdownView';
import { XopcChatStepsView } from './ChatStepsView';
import { XopcChatMediaView } from './ChatMediaView';
import { XopcChatDeliverablesView } from './ChatDeliverablesView';
import { chatActivities } from '../common/chatRichContent';
import { XopcChatDisclosure } from '../common/chatDisclosure';

@ComponentV2
export struct XopcChatMessageContent {
  @Param row: XopcChatRow = { id: '', role: 'assistant', text: '' };
  @Param conversationId: string = '';
  @Param reasoning: string = 'on';
  @Param disclosure: XopcChatDisclosure = new XopcChatDisclosure();
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Event onFillDraft: (text: string) => void = (_text: string): void => {};
  @Computed get visibleMedia(): XopcHistoryMedia[] {
    const artifacts = this.row.outcome?.deliverables || [];
    return (this.row.media || []).filter((file: XopcHistoryMedia): boolean => !artifacts.some((artifact): boolean => artifact.availability === 'available' && !!artifact.uri && artifact.uri === file.uri));
  }
  @Computed get body(): XopcChatBlock[] {
    const body: XopcChatBlock[] = []; let inserted = false;
    const hasSteps = chatActivities(this.row, this.reasoning).length > 0;
    for (const block of this.row.blocks || []) {
      if (block.kind === 'text' || block.kind === 'review') body.push(block);
      else if (!inserted && hasSteps && ['thinking', 'tool', 'plan', 'diff'].includes(block.kind)) {
        inserted = true; body.push({ id: 'steps:' + this.row.id, kind: 'steps', text: '' });
      }
    }
    return body;
  }
  build() {
    Column({ space: 10 }) {
      ForEach(this.row.refs || [], (ref: XopcContextRef) => {
        Button(ref.title || ref.sourceId).fontSize(13).constraintSize({ minHeight: 44 }).fontColor($r('app.color.accent'))
          .backgroundColor($r('app.color.accent_soft')).onClick((): void => {
            this.onNavigate({ page: ref.kind === 'task' ? 'tasks' : 'notes', itemId: ref.sourceId });
          })
      }, (ref: XopcContextRef): string => ref.kind + ':' + ref.sourceId)
      if (this.row.role === 'assistant') {
        Repeat<XopcChatBlock>(this.body).each((item: RepeatItem<XopcChatBlock>) => {
          if (item.item.kind === 'steps') { XopcChatStepsView({ row: this.row, reasoning: this.reasoning, disclosure: this.disclosure, scope: this.conversationId }) }
          else if (item.item.kind === 'text' && item.item.text) {
            XopcMarkdownView({ content: item.item.text, conversationId: this.conversationId })
          } else if (item.item.review) {
            Column({ space: 10 }) {
              Text($r('app.string.chat_review')).fontSize(16).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground'))
              Text(item.item.review.overallCorrectness === 'patch is incorrect' ? $r('app.string.chat_review_incorrect')
                : item.item.review.overallCorrectness === 'patch is correct' ? $r('app.string.chat_review_correct') : $r('app.string.chat_review_unknown'))
                .fontSize(12).fontColor($r('app.color.secondary'))
              if (item.item.review.summary) { XopcMarkdownView({ content: item.item.review.summary }) }
              ForEach(item.item.review.findings || [], (finding: XopcReviewFinding, index: number) => {
                Column({ space: 6 }) {
                  Text('P' + finding.priority + ' · ' + finding.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground'))
                  if (finding.filePath) { Text(finding.filePath + (finding.lineStart ? ':' + finding.lineStart : '')).fontSize(12).fontFamily('monospace').fontColor($r('app.color.secondary')).copyOption(CopyOptions.InApp) }
                  XopcMarkdownView({ content: finding.body })
                }.width('100%').padding(10).borderRadius(8).backgroundColor($r('app.color.grouped')).alignItems(HorizontalAlign.Start)
              }, (finding: XopcReviewFinding, index: number): string => index + ':' + finding.title)
              if (item.item.review.overallExplanation) { XopcMarkdownView({ content: item.item.review.overallExplanation }) }
            }.id('chat-review-' + item.item.id).width('100%').padding(12).borderRadius(12).alignItems(HorizontalAlign.Start)
              .border({ width: 1, color: $r('app.color.border_subtle') })
          }
        }).key((block: XopcChatBlock): string => block.id)
        if (!this.body.length && !this.row.blocks && this.row.text) { XopcMarkdownView({ content: this.row.text, conversationId: this.conversationId }) }
        if (this.row.live && !this.row.text && !this.row.blocks?.length) { Text(this.row.progress || $r('app.string.chat_thinking')).fontSize(13).fontColor($r('app.color.secondary')) }
      } else if (this.row.role === 'user') {
        if (this.row.text) { Text(this.row.text).fontSize(16).lineHeight(25).fontColor($r('app.color.foreground')).copyOption(CopyOptions.InApp) }
      } else {
        Text(this.row.text).fontSize(13).fontColor($r('app.color.secondary')).copyOption(CopyOptions.InApp)
      }
      Repeat<XopcHistoryMedia>(this.visibleMedia).each((item: RepeatItem<XopcHistoryMedia>) => {
        XopcChatMediaView({ file: item.item, conversationId: this.conversationId })
      }).key((file: XopcHistoryMedia): string => file.id || file.uri)
      if (this.row.role === 'assistant') { XopcChatDeliverablesView({ row: this.row, conversationId: this.conversationId, onNavigate: this.onNavigate, onFillDraft: this.onFillDraft }) }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
