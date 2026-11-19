import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { personalPromptNeedsAttention, personalWorkStatus, XopcPersonalWorkItem } from '../model/personalOverview';
import { XopcPersonalChatActivityViewModel } from '../viewmodel/personalChatActivityViewModel';

interface XopcPersonalChatWorkSlide {
  task: XopcPersonalWorkItem;
  index: number;
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

  private statusLabel(item: XopcPersonalWorkItem): Resource {
    switch (personalWorkStatus(item)) {
      case 'allocating': return $r('app.string.chat_personal_task_allocating');
      case 'queued': return $r('app.string.chat_personal_task_queued');
      case 'waiting': return $r('app.string.task_execution_waiting');
      case 'verifying': return $r('app.string.task_execution_verifying');
      default: return $r('app.string.task_phase_in_progress');
    }
  }

  @Builder taskRow($$: XopcPersonalChatWorkSlide) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 8 }) {
        SymbolGlyph($r('sys.symbol.clock')).fontSize(17).fontColor([this.colors.chat.action]).accessibilityLevel('no')
        Column({ space: 2 }) {
          Text($$.task.title).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            .width('100%').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.statusLabel($$.task)).fontSize(12).fontColor(this.colors.chat.secondary).maxLines(1)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        if (this.model.working.length > 1) {
          Text(`${$$.index + 1} / ${this.model.working.length}`).fontSize(11).fontColor(this.colors.chat.secondary)
            .maxLines(1).flexShrink(0)
        }
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(10).fontColor([this.colors.tertiary]).accessibilityLevel('no')
      }.width('100%').padding({ left: 12, right: 12 })
    }.id('chat-personal-work-' + $$.task.id).width('100%').height('100%').padding(0)
      .backgroundColor(this.colors.chat.card).borderRadius(this.colors.corner(14)).clipShape(this.colors.cornerClip(14))
      .onClick((): void => { this.onOpenTask($$.task.id); })
  }

  build() {
    Column({ space: 6 }) {
      if (this.attentionCount > 0) {
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
      if (this.model.working.length > 0) {
        if (this.model.working.length === 1) {
          Column() { this.taskRow({ task: this.model.working[0], index: 0 }) }
            .height(52).width('88%').constraintSize({ maxWidth: 320 })
        } else {
          Swiper() {
            ForEach(this.model.working, (item: XopcPersonalWorkItem, index: number) => {
              this.taskRow({ task: item, index })
            }, (item: XopcPersonalWorkItem, index: number): string =>
              item.id + ':' + index + ':' + personalWorkStatus(item) + ':' + item.title)
          }.id('chat-personal-work-carousel').width('88%').constraintSize({ maxWidth: 320 }).height(52)
            .index(this.taskIndex).indicator(false).loop(true).cachedCount(1).interval(5000)
            .duration(this.reduceMotion ? 0 : 240).autoPlay(this.activePage && !this.reduceMotion)
            .nestedScroll(SwiperNestedScrollMode.SELF_ONLY)
            .onChange((index: number): void => { this.visibleTaskId = this.model.working[index]?.id ?? ''; })
        }
      }
    }.width('100%').hitTestBehavior(HitTestMode.None)
  }
}
