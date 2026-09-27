import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatRow, XopcChatBlock } from '../model/chat';
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
  @Local visibleCount: number = 20;
  @Computed get steps(): XopcChatBlock[] {
    return (this.row.blocks || []).filter((block: XopcChatBlock): boolean =>
      block.kind === 'text' && block.presentation === 'narration' && !!block.text.trim());
  }
  @Computed get expanded(): boolean { return this.disclosure.get(this.scope + ':steps:' + this.row.id) ?? false; }
  @Computed get visibleSteps(): XopcChatBlock[] { return this.expanded ? this.steps.slice(-this.visibleCount) : this.row.live ? this.steps.slice(-2) : []; }
  build() {
    Column({ space: 6 }) {
      if (this.steps.length) {
        if (!this.row.live || this.steps.length > 2) {
          Button($r('app.string.chat_steps')).height(36).fontSize(13).fontColor(this.colors.secondary)
            .backgroundColor(Color.Transparent).id('chat-steps-' + this.row.id)
            .onClick((): void => { this.disclosure.set(this.scope + ':steps:' + this.row.id, !this.expanded); })
        }
        if (this.expanded && this.steps.length > this.visibleCount) {
          Button($r('app.string.chat_view_more')).height(36).fontSize(13).fontColor(this.colors.accent)
            .backgroundColor(Color.Transparent).onClick((): void => { this.visibleCount += 20; })
        }
        Repeat<XopcChatBlock>(this.visibleSteps).each((item: RepeatItem<XopcChatBlock>) => {
          Text(item.item.text).fontSize(13).lineHeight(19).fontColor(this.colors.secondary)
            .width('100%').padding(10).backgroundColor(this.colors.grouped).borderRadius(10)
        }).key((step: XopcChatBlock): string => step.id)
      } else if (this.row.live) {
        Text(this.row.progress || $r('app.string.chat_steps_working')).fontSize(13).fontColor(this.colors.secondary)
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
