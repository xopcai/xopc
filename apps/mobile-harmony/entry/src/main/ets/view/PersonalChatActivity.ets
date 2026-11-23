import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { personalPromptNeedsAttention, XopcPersonalWorkItem } from '../model/personalOverview';
import { XopcPersonalChatActivityViewModel } from '../viewmodel/personalChatActivityViewModel';

interface XopcPersonalChatWorkSlide {
  task: XopcPersonalWorkItem;
}

const PERSONAL_WORK_TOUCH_HEIGHT: number = 44;
const PERSONAL_WORK_PILL_HEIGHT: number = 32;
const PERSONAL_WORK_TOUCH_INSET: number = (PERSONAL_WORK_TOUCH_HEIGHT - PERSONAL_WORK_PILL_HEIGHT) / 2;
const PERSONAL_WORK_PILL_MAX_WIDTH: number = 156;

@ComponentV2
struct XopcPersonalWorkPillFill {
  @Param animate: boolean = false;
  @Local colors: XopcThemeColors = appThemeColors;
  @Local highlighted: boolean = false;

  @Monitor('animate')
  onAnimationChange(): void { this.highlighted = this.animate; }

  build() {
    Stack() {
      Column().width('100%').height('100%').backgroundColor(this.colors.accentSoft)
        .opacity(this.highlighted ? 0.9 : 0)
        .animation({ duration: this.animate ? 1400 : 0, curve: Curve.EaseInOut,
          iterations: this.animate ? -1 : 1, playMode: PlayMode.Alternate })
    }.width('100%').height(PERSONAL_WORK_PILL_HEIGHT).backgroundColor(this.colors.chat.card)
      .borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16))
      .hitTestBehavior(HitTestMode.None).accessibilityLevel('no-hide-descendants')
      .onAppear((): void => { this.highlighted = this.animate; })
  }
}

@ComponentV2
export struct XopcPersonalChatActivity {
  @Param conversationId: string = '';
  @Param displayName: string = '';
  @Param activePage: boolean = false;
  @Param reduceMotion: boolean = false;
  @Param promptId: string = '';
  @Param runId: string = '';
  @Param refreshRevision: number = 0;
  @Event onOpenAttention: () => void = (): void => {};
  @Event onOpenTask: (taskId: string) => void = (_taskId: string): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local model: XopcPersonalChatActivityViewModel = new XopcPersonalChatActivityViewModel();
  @Local visibleTaskId: string = '';

  @Computed get attentionCount(): number {
    return this.model.attention.length + (personalPromptNeedsAttention(this.promptId, this.model.attention) ? 1 : 0);
  }

  @Computed get taskIndex(): number {
    return Math.max(0, this.model.working.findIndex((item: XopcPersonalWorkItem): boolean => item.id === this.visibleTaskId));
  }

  aboutToAppear(): void { this.observe(); }
  aboutToDisappear(): void { this.model.stop(); }

  @Monitor('conversationId', 'activePage')
  observe(): void { this.model.observe(this.conversationId, this.activePage); }

  @Monitor('runId', 'refreshRevision', 'promptId')
  refresh(): void { void this.model.refresh(); }

  @Builder taskRow($$: XopcPersonalChatWorkSlide) {
    Button({ type: ButtonType.Normal }) {
      Text($$.task.title).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).textAlign(TextAlign.Center)
        .width('100%').padding({ left: 10, right: 10 })
    }.id('chat-personal-work-' + $$.task.id).width('100%').height(PERSONAL_WORK_PILL_HEIGHT).padding(0)
      .backgroundColor(Color.Transparent)
      .borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16))
      .responseRegion({ x: 0, y: -PERSONAL_WORK_TOUCH_INSET, width: '100%', height: PERSONAL_WORK_TOUCH_HEIGHT })
      .accessibilityText($$.task.title)
      .onClick((): void => { this.onOpenTask($$.task.id); })
  }

  @Builder workingPill() {
    Stack() {
      XopcPersonalWorkPillFill({ animate: this.activePage && !this.reduceMotion })
      if (this.model.working.length === 1) {
        this.taskRow({ task: this.model.working[0] })
      } else {
        Swiper() {
          ForEach(this.model.working, (item: XopcPersonalWorkItem) => {
            this.taskRow({ task: item })
          }, (item: XopcPersonalWorkItem): string => item.id + ':' + item.title)
        }.id('chat-personal-work-carousel').width('100%').height(PERSONAL_WORK_PILL_HEIGHT)
          .borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16))
          .responseRegion({ x: 0, y: -PERSONAL_WORK_TOUCH_INSET, width: '100%', height: PERSONAL_WORK_TOUCH_HEIGHT })
          .index(this.taskIndex).indicator(false).loop(true).cachedCount(1).interval(5000)
          .duration(this.reduceMotion ? 0 : 240).autoPlay(this.activePage && !this.reduceMotion)
          .nestedScroll(SwiperNestedScrollMode.SELF_ONLY)
          .onChange((index: number): void => { this.visibleTaskId = this.model.working[index]?.id ?? ''; })
      }
    }.width('52%').constraintSize({ maxWidth: PERSONAL_WORK_PILL_MAX_WIDTH }).height(PERSONAL_WORK_TOUCH_HEIGHT)
  }

  build() {
    Row({ space: 4 }) {
      if (this.model.working.length > 0) {
        this.workingPill()
        if (this.attentionCount > 0) {
          Button({ type: ButtonType.Normal }) {
            Text(this.attentionCount > 99 ? '99+' : this.attentionCount.toString())
              .fontSize(12).fontWeight(FontWeight.Medium).fontColor(this.colors.attentionForeground)
              .padding({ left: 6, right: 6 }).textAlign(TextAlign.Center)
          }.id('chat-personal-attention-compact')
            .constraintSize({ minWidth: PERSONAL_WORK_PILL_HEIGHT }).height(PERSONAL_WORK_PILL_HEIGHT).padding(0)
            .backgroundColor(this.colors.attentionFill)
            .borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16))
            .responseRegion([
              { x: -PERSONAL_WORK_TOUCH_INSET, y: -PERSONAL_WORK_TOUCH_INSET,
                width: PERSONAL_WORK_TOUCH_HEIGHT, height: PERSONAL_WORK_TOUCH_HEIGHT },
              { x: 0, y: -PERSONAL_WORK_TOUCH_INSET, width: '100%', height: PERSONAL_WORK_TOUCH_HEIGHT },
            ])
            .margin({ left: 2 })
            .accessibilityText($r('app.string.chat_attention_count', this.attentionCount))
            .onClick((): void => { this.onOpenAttention(); })
        }
      } else if (this.attentionCount > 0) {
        Button({ type: ButtonType.Normal }) {
          Column({ space: 3 }) {
            Text(this.displayName).id('chat-personal-name-with-attention').fontSize(17).fontWeight(FontWeight.Bold)
              .fontColor(this.colors.foreground).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            Row({ space: 6 }) {
              Blank().width(6).height(6).borderRadius(3).backgroundColor(this.colors.attentionForeground)
              Text($r('app.string.chat_attention_count', this.attentionCount)).fontSize(12)
                .fontColor(this.colors.attentionForeground).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            }
          }.constraintSize({ minHeight: 48, maxWidth: 240 }).padding({ left: 14, right: 14, top: 4, bottom: 4 })
        }.id('chat-personal-attention').padding(0).backgroundColor(this.colors.attentionFill)
          .borderRadius(this.colors.corner(17)).clipShape(this.colors.cornerClip(17)).onClick((): void => { this.onOpenAttention(); })
      } else {
        Text(this.displayName).id('chat-personal-name').fontSize(17).fontWeight(FontWeight.Bold)
          .fontColor(this.colors.foreground).constraintSize({ maxWidth: 240 })
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).padding({ left: 14, right: 14, top: 4, bottom: 4 })
          .backgroundColor(this.colors.chat.card).borderRadius(this.colors.corner(14))
      }
    }.width('100%').justifyContent(FlexAlign.Center).hitTestBehavior(HitTestMode.None)
  }
}
