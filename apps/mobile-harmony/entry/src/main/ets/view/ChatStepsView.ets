import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatRow } from '../model/chat';
import { chatLiveElapsedSeconds, chatLiveNarration } from '../common/chatLiveActivity';

@ComponentV2
export struct XopcChatStepsView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param row: XopcChatRow = { id: '', role: 'assistant', text: '' };
  @Param runStartedAtMs: number = 0;
  @Param connection: string = 'connected';
  @Param animateDots: boolean = true;
  @Event onShowDetail: (row: XopcChatRow) => void = (_row: XopcChatRow): void => {};
  @Local nowMs: number = Date.now();
  private appearedAtMs: number = Date.now();
  private clockTimer: number = -1;
  aboutToAppear(): void {
    this.appearedAtMs = Date.now();
    this.clockTimer = setInterval((): void => {
      this.nowMs = Date.now();
    }, 1000);
  }
  aboutToDisappear(): void { clearInterval(this.clockTimer); this.clockTimer = -1; }
  @Computed get elapsedSeconds(): number {
    return chatLiveElapsedSeconds(this.runStartedAtMs || this.appearedAtMs, this.nowMs);
  }
  @Computed get narration(): string {
    return this.elapsedSeconds >= 10 ? chatLiveNarration(this.row) : '';
  }
  build() {
    Column({ space: 8 }) {
      if (this.connection !== 'connected') {
        Text($r('app.string.chat_activity_reconnecting')).fontSize(13).fontColor(this.colors.secondary)
          .width('100%').textAlign(TextAlign.Start)
      } else {
        Row({ space: 6 }) {
          ForEach([0, 1, 2], (index: number) => {
            XopcWaitingDot({ dotIndex: index, animate: this.animateDots })
          }, (index: number): string => index.toString())
        }.id('chat-waiting-dots-' + this.row.id).width(104).height(64).justifyContent(FlexAlign.Center)
          .borderRadius(32).backgroundColor(this.colors.input)
          .accessibilityText($r('app.string.chat_steps_working'))
        if (this.narration) {
          Text(this.narration).fontSize(13).fontColor(this.colors.secondary).maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%').textAlign(TextAlign.Start)
        }
      }
    }.id('chat-waiting-' + this.row.id).width('100%').alignItems(HorizontalAlign.Start)
  }
}

@ComponentV2
struct XopcWaitingDot {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param dotIndex: number = 0;
  @Param animate: boolean = true;
  @Local lifted: boolean = false;
  @Monitor('animate') onAnimationChange(): void { this.lifted = this.animate; }
  build() {
    Circle().width(7).height(7).fill(this.colors.secondary)
      .opacity(this.animate && this.lifted ? 0.85 : 0.4)
      .translate({ y: this.animate && this.lifted ? -3 : 0 })
      .scale({ x: this.animate && this.lifted ? 1.08 : 0.92, y: this.animate && this.lifted ? 1.08 : 0.92 })
      .animation({ duration: this.animate ? 600 : 0, curve: Curve.EaseInOut,
        delay: this.animate ? this.dotIndex * 150 : 0, iterations: this.animate ? -1 : 1, playMode: PlayMode.Alternate })
      .onAppear((): void => { this.lifted = this.animate; })
      .accessibilityLevel('no')
  }
}
