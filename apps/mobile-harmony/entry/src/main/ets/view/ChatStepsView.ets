import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatRow, XopcChatBlock, XopcChatTool, XopcPlanStep } from '../model/chat';
import { chatActivities, chatToolDisplayKind, chatToolReadGroupKey } from '../common/chatRichContent';
import { XopcChatToolGroupView, XopcChatToolView } from './ChatToolView';
import { XopcMarkdownView } from './MarkdownView';
import { XopcChatDisclosure } from '../common/chatDisclosure';
import { XopcMobileRoute } from '../model/home';

@ComponentV2
export struct XopcChatStepsView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param row: XopcChatRow = { id: '', role: 'assistant', text: '' };
  @Param reasoning: string = 'on';
  @Param disclosure: XopcChatDisclosure = new XopcChatDisclosure();
  @Param scope: string = '';
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Computed get steps(): XopcChatBlock[] { return chatActivities(this.row, this.reasoning); }
  @Computed get visibleSteps(): XopcChatBlock[] { return this.steps.filter((step: XopcChatBlock): boolean => step.kind !== 'thinking'); }
  @Computed get expanded(): boolean { return this.disclosure.get(this.scope + ':steps:' + this.row.id) ?? false; }
  @Computed get active(): boolean { return !!this.row.live && this.steps.some((step: XopcChatBlock): boolean => !!step.active || step.call?.status === 'running'); }
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
  private isReadGroupContinuation(index: number): boolean {
    if (index <= 0) return false;
    const current = this.visibleSteps[index].call;
    const previous = this.visibleSteps[index - 1].call;
    if (!current || !previous) return false;
    const key = chatToolReadGroupKey(current);
    return !!key && key === chatToolReadGroupKey(previous);
  }
  private readGroupCalls(index: number): XopcChatTool[] {
    const first = this.visibleSteps[index]?.call;
    if (!first) return [];
    const key = chatToolReadGroupKey(first);
    if (!key) return [first];
    const calls: XopcChatTool[] = [];
    for (let cursor = index; cursor < this.visibleSteps.length; cursor += 1) {
      const call = this.visibleSteps[cursor].call;
      if (!call || chatToolReadGroupKey(call) !== key) break;
      calls.push(call);
    }
    return calls;
  }
  build() {
    Column({ space: 4 }) {
      if (this.visibleSteps.length) {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 6 }) {
            Text(this.active ? this.runningTitle() : $r('app.string.chat_steps')).fontSize(13)
              .fontColor(this.colors.secondary).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
            SymbolGlyph(this.expanded ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down')).fontSize(12).fontColor([this.colors.tertiary])
          }.width('100%')
        }.id('chat-steps-' + this.row.id).width('100%').constraintSize({ minHeight: 36 }).padding({ left: 2, right: 2 })
          .backgroundColor(Color.Transparent).onClick((): void => { this.disclosure.set(this.scope + ':steps:' + this.row.id, !this.expanded); })
        if (this.expanded && this.visibleSteps.length) {
          Scroll() {
          Column({ space: 6 }) {
            ForEach(this.visibleSteps, (step: XopcChatBlock, index: number) => {
              if (step.call && !this.isReadGroupContinuation(index)) {
                if (this.readGroupCalls(index).length > 1) {
                  XopcChatToolGroupView({ calls: this.readGroupCalls(index), disclosure: this.disclosure, scope: this.scope + ':' + this.row.id })
                } else {
                  XopcChatToolView({ call: step.call, live: !!this.row.live, disclosure: this.disclosure, scope: this.scope + ':' + this.row.id })
                }
              } else if (step.kind === 'plan') {
                Column({ space: 8 }) {
                  Text($r('app.string.chat_plan')).fontSize(13).fontColor(this.colors.secondary)
                  if (step.text) { XopcMarkdownView({ content: step.text, conversationId: this.scope, onNavigate: this.onNavigate }) }
                  ForEach(step.plan || [], (planStep: XopcPlanStep, planIndex: number) => {
                    Text((planStep.status === 'completed' ? '✓ ' : planStep.status === 'in_progress' ? '◉ ' : '○ ') + planStep.step)
                      .fontSize(14).fontColor(this.colors.foreground)
                  }, (planStep: XopcPlanStep, planIndex: number): string => planIndex + ':' + planStep.status + ':' + planStep.step)
                }.width('100%').alignItems(HorizontalAlign.Start)
              } else if (step.kind === 'diff') {
                XopcChatToolView({ call: { id: step.id, name: 'apply_patch', result: step.text, status: 'done' }, disclosure: this.disclosure, scope: this.scope + ':' + this.row.id })
              } else if (step.kind === 'text' && step.text) {
                XopcMarkdownView({ content: step.text, conversationId: this.scope, onNavigate: this.onNavigate })
              }
            }, (step: XopcChatBlock): string => step.id)
          }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 8, right: 2, top: 2, bottom: 4 })
          }.id('chat-steps-scroll-' + this.row.id).width('100%').constraintSize({ maxHeight: 240 })
            .scrollable(ScrollDirection.Vertical).scrollBar(BarState.Off)
            .nestedScroll({ scrollForward: NestedScrollMode.SELF_FIRST, scrollBackward: NestedScrollMode.SELF_FIRST })
        }
      } else if (this.active) {
        Row() {
          Text(this.runningTitle()).fontSize(13).fontColor(this.colors.secondary).maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }.width('100%').constraintSize({ minHeight: 36 }).padding({ left: 2, right: 2 })
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
