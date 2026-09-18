import { XopcChatRow, XopcChatBlock, XopcPlanStep } from '../model/chat';
import { chatActivities, chatAnswerStarted } from '../common/chatRichContent';
import { XopcChatToolView } from './ChatToolView';
import { XopcMarkdownView } from './MarkdownView';
import { XopcChatDisclosure } from '../common/chatDisclosure';

@ComponentV2
export struct XopcChatStepsView {
  @Param row: XopcChatRow = { id: '', role: 'assistant', text: '' };
  @Param reasoning: string = 'on';
  @Param disclosure: XopcChatDisclosure = new XopcChatDisclosure();
  @Param scope: string = '';
  @Computed get steps(): XopcChatBlock[] { return chatActivities(this.row, this.reasoning); }
  @Computed get expanded(): boolean { return this.disclosure.get(this.scope + ':steps:' + this.row.id) ?? (this.reasoning === 'stream' && !!this.row.live && !chatAnswerStarted(this.row)); }
  @Computed get active(): boolean { return !!this.row.live && this.steps.some((step: XopcChatBlock): boolean => !!step.active || step.call?.status === 'running'); }
  build() {
    Column({ space: 4 }) {
      if (this.steps.length) {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 8 }) {
            Text(this.active ? '···' : '✓').fontSize(14).fontColor($r('app.color.secondary'))
            Text(this.active ? $r('app.string.chat_running') : $r('app.string.chat_steps')).fontSize(13)
              .fontColor($r('app.color.secondary')).layoutWeight(1)
            Text(this.steps.length.toString()).fontSize(12).fontColor($r('app.color.tertiary'))
            SymbolGlyph(this.expanded ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down')).fontSize(12).fontColor([$r('app.color.tertiary')])
          }.width('100%')
        }.id('chat-steps-' + this.row.id).width('100%').constraintSize({ minHeight: 44 }).padding({ left: 4, right: 4 })
          .backgroundColor(Color.Transparent).onClick((): void => { this.disclosure.set(this.scope + ':steps:' + this.row.id, !this.expanded); })
        if (this.expanded) {
          Column({ space: 12 }) {
            Repeat<XopcChatBlock>(this.steps).each((item: RepeatItem<XopcChatBlock>) => {
              if (item.item.call) { XopcChatToolView({ call: item.item.call, live: !!this.row.live, disclosure: this.disclosure, scope: this.scope + ':' + this.row.id }) }
              else if (item.item.kind === 'plan') {
                Column({ space: 8 }) {
                  Text($r('app.string.chat_plan')).fontSize(13).fontColor($r('app.color.secondary'))
                  if (item.item.text) { XopcMarkdownView({ content: item.item.text }) }
                  ForEach(item.item.plan || [], (step: XopcPlanStep, index: number) => {
                    Text((step.status === 'completed' ? '✓ ' : step.status === 'in_progress' ? '◉ ' : '○ ') + step.step)
                      .fontSize(14).fontColor($r('app.color.foreground'))
                  }, (step: XopcPlanStep, index: number): string => index + ':' + step.status + ':' + step.step)
                }.width('100%').alignItems(HorizontalAlign.Start)
              } else if (item.item.kind === 'diff') {
                XopcChatToolView({ call: { id: item.item.id, name: 'apply_patch', result: item.item.text, status: 'done' }, disclosure: this.disclosure, scope: this.scope + ':' + this.row.id })
              }
              else {
                Column({ space: 6 }) {
                  Text($r('app.string.chat_thinking')).fontSize(12).fontColor($r('app.color.secondary'))
                  XopcMarkdownView({ content: item.item.text })
                }.width('100%').alignItems(HorizontalAlign.Start)
              }
            }).key((step: XopcChatBlock): string => step.id)
          }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 12, bottom: 8 })
            .border({ width: { left: 1 }, color: $r('app.color.border_subtle') })
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
