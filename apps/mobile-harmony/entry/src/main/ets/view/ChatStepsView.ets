import { XopcChatRow, XopcChatBlock, XopcChatTool, XopcPlanStep } from '../model/chat';
import { chatActivities, chatAnswerStarted, chatToolDisplayKind, chatToolFailed } from '../common/chatRichContent';
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
  @Computed get visibleSteps(): XopcChatBlock[] { return this.steps.filter((step: XopcChatBlock): boolean => step.kind !== 'thinking'); }
  @Computed get expanded(): boolean { return this.disclosure.get(this.scope + ':steps:' + this.row.id) ?? (this.reasoning === 'stream' && !!this.row.live && !chatAnswerStarted(this.row)); }
  @Computed get active(): boolean { return !!this.row.live && this.steps.some((step: XopcChatBlock): boolean => !!step.active || step.call?.status === 'running'); }
  @Computed get failed(): boolean { return this.steps.some((step: XopcChatBlock): boolean => !!step.call && chatToolFailed(step.call)); }
  @Computed get activeTool(): XopcChatTool | undefined {
    return this.steps.slice().reverse().find((step: XopcChatBlock): boolean => step.call?.status === 'running')?.call;
  }
  private runningTitle(): ResourceStr {
    if (!this.activeTool) return $r('app.string.chat_steps_thinking');
    const kind = chatToolDisplayKind(this.activeTool.name);
    if (kind === 'search') return $r('app.string.chat_steps_searching');
    if (kind === 'read') return $r('app.string.chat_steps_reading');
    if (kind === 'command') return $r('app.string.chat_steps_commanding');
    if (kind === 'write') return $r('app.string.chat_steps_writing');
    if (kind === 'edit') return $r('app.string.chat_steps_editing');
    if (kind === 'fetch') return $r('app.string.chat_steps_fetching');
    return $r('app.string.chat_steps_working');
  }
  build() {
    Column({ space: 4 }) {
      if (this.visibleSteps.length || this.active) {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 6 }) {
            if (this.active) { Text('●').fontSize(8).fontColor($r('app.color.accent')) }
            Text(this.active ? this.runningTitle() : this.failed ? $r('app.string.chat_steps_failed') : $r('app.string.chat_steps')).fontSize(13)
              .fontColor(this.failed ? $r('app.color.danger') : $r('app.color.secondary')).maxLines(2)
            SymbolGlyph(this.expanded ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down')).fontSize(12).fontColor([$r('app.color.tertiary')])
          }
        }.id('chat-steps-' + this.row.id).constraintSize({ minHeight: 36, maxWidth: '100%' }).padding({ left: 2, right: 2 })
          .backgroundColor(Color.Transparent).onClick((): void => { this.disclosure.set(this.scope + ':steps:' + this.row.id, !this.expanded); })
        if (this.expanded && this.visibleSteps.length) {
          Column({ space: 8 }) {
            Repeat<XopcChatBlock>(this.visibleSteps).each((item: RepeatItem<XopcChatBlock>) => {
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
            }).key((step: XopcChatBlock): string => step.id)
          }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 8, bottom: 4 })
            .border({ width: { left: 1 }, color: $r('app.color.border_subtle') })
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
