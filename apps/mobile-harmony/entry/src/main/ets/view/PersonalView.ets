import { SEGMENTED_PAGE_TAP_SLOP_VP, XopcPagerProgress, XopcSegmentedTabs, XopcSegmentOption } from './SegmentedTabs';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { XopcUserGoal } from '../model/userUnderstanding';
import { XopcPersonalViewModel } from '../viewmodel/homeViewModel';
import { XopcListSkeleton, XopcPageHeader } from './MobileComponents';

@ComponentV2
export struct XopcPersonalGoalsView {
  @Local selectedGoalTab: string = 'ongoing';
  private goalTabs: XopcSegmentOption[] = [
    { key: 'ongoing', label: $r('app.string.ongoing'), testId: 'personal-goals-ongoing' },
    { key: 'achieved', label: $r('app.string.personal_goal_achieved'), testId: 'personal-goals-achieved' }
  ];

  private pager: SwiperController = new SwiperController();
  private pagerProgress: XopcPagerProgress = new XopcPagerProgress();
  @Local layout: XopcLayoutState = layoutState;

  private visibleGoals(key: string): XopcUserGoal[] {
    return this.model.goals.filter((goal: XopcUserGoal): boolean =>
      (goal.status === 'achieved') === (key === 'achieved'));
  }

  private selectGoalTab(key: string): void {
    if (key !== this.selectedGoalTab && !this.goalEditorOpen) {
      this.pager.changeIndex(key === 'achieved' ? 1 : 0, !this.layout.reduceMotion);
    }
  }

  @Local colors: XopcThemeColors = appThemeColors;
  @Local model: XopcPersonalViewModel = new XopcPersonalViewModel();
  @Local goalEditorOpen: boolean = false;
  @Local editingGoalId: string = '';
  @Local goalTitle: string = '';
  @Local goalOutcome: string = '';
  @Local goalTargetDate: string = '';
  @Local goalStatus: string = 'active';
  @Local goalDateError: boolean = false;
  @Event onExit: () => void = (): void => {};

  aboutToAppear(): void { void this.model.refresh(); }
  aboutToDisappear(): void { this.model.dispose(); }

  private dateText(timestamp?: number): string {
    if (timestamp === undefined) return '';
    const date = new Date(timestamp);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return date.getFullYear().toString() + '-' + (month < 10 ? '0' : '') + month.toString() +
      '-' + (day < 10 ? '0' : '') + day.toString();
  }

  private targetTimestamp(): number | undefined {
    const text = this.goalTargetDate.trim();
    if (!text) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
    const timestamp = Date.parse(text + 'T23:59:59');
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }

  private openGoalEditor(goal?: XopcUserGoal): void {
    this.editingGoalId = goal?.id ?? '';
    this.goalTitle = goal?.title ?? '';
    this.goalOutcome = goal?.desiredOutcome ?? '';
    this.goalTargetDate = this.dateText(goal?.targetAt);
    this.goalStatus = goal?.status ?? 'active';
    this.goalDateError = false;
    this.goalEditorOpen = true;
  }

  private async saveGoal(): Promise<void> {
    const title = this.goalTitle.trim();
    const outcome = this.goalOutcome.trim();
    const targetAt = this.targetTimestamp();
    this.goalDateError = !!this.goalTargetDate.trim() && targetAt === undefined;
    if (!title || !outcome || this.goalDateError) return;
    const saved = await this.model.saveGoal(this.editingGoalId, title, outcome, this.goalStatus, targetAt);
    if (saved) this.goalEditorOpen = false;
  }

  private goalStatusLabel(goal: XopcUserGoal): ResourceStr {
    if (goal.status === 'achieved') return $r('app.string.personal_goal_achieved');
    if (goal.isPrimary) return $r('app.string.personal_goal_primary');
    if (goal.status === 'paused') return $r('app.string.personal_goal_paused');
    if (goal.status === 'proposed') return $r('app.string.personal_goal_proposed');
    return $r('app.string.personal_goal_active');
  }

  @Builder
  private goalRow(goal: XopcUserGoal) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        Column().width(5).height(72).borderRadius(3)
          .backgroundColor(goal.isPrimary ? this.colors.accent : this.colors.accentSoft)
        Column({ space: 5 }) {
          Text(goal.title).fontSize(16).lineHeight(23).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground).width('100%').maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(goal.desiredOutcome).fontSize(13).lineHeight(19).fontColor(this.colors.secondary)
            .width('100%').maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          Row({ space: 5 }) {
            Text(this.goalStatusLabel(goal)).fontSize(11).fontWeight(FontWeight.Medium)
              .fontColor(goal.isPrimary ? this.colors.accent : this.colors.tertiary)
            if (goal.targetAt !== undefined) {
              Text('·').fontSize(11).fontColor(this.colors.tertiary)
              Text($r('app.string.personal_goal_due', this.dateText(goal.targetAt))).fontSize(11).fontColor(this.colors.tertiary)
            }
          }.width('100%')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        SymbolGlyph($r('sys.symbol.pencil_line')).fontSize(17).fontColor([this.colors.tertiary])
      }.width('100%').padding(16).alignItems(VerticalAlign.Center)
    }.width('100%').padding(0).borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16)).backgroundColor(this.colors.panel).margin({ bottom: 8 })
      .onClick((): void => { this.openGoalEditor(goal); }, SEGMENTED_PAGE_TAP_SLOP_VP)
  }

  @Builder
  private goalEditor() {
    Scroll() {
      Column({ space: 12 }) {
        Text(this.editingGoalId ? $r('app.string.personal_goal_edit') : $r('app.string.personal_goal_add'))
          .fontSize(21).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).width('100%')
        TextInput({ text: this.goalTitle, placeholder: $r('app.string.personal_goal_title') })
          .maxLength(120).fontColor(this.colors.foreground).backgroundColor(this.colors.input)
          .onChange((text: string): void => { this.goalTitle = text; })
        TextArea({ text: this.goalOutcome, placeholder: $r('app.string.personal_goal_outcome') })
          .height(140).maxLength(600).fontColor(this.colors.foreground).backgroundColor(this.colors.input)
          .onChange((text: string): void => { this.goalOutcome = text; })
        TextInput({ text: this.goalTargetDate, placeholder: $r('app.string.personal_goal_date') })
          .fontColor(this.colors.foreground).backgroundColor(this.colors.input)
          .onChange((text: string): void => { this.goalTargetDate = text; this.goalDateError = false; })
        if (this.goalDateError) {
          Text($r('app.string.personal_goal_date_error')).fontSize(12).fontColor(this.colors.danger).width('100%')
        }
        if (this.editingGoalId) {
          XopcSegmentedTabs({ options: [
            { key: 'active', label: $r('app.string.personal_goal_active') },
            { key: 'paused', label: $r('app.string.personal_goal_paused') },
            { key: 'achieved', label: $r('app.string.personal_goal_achieved') }
          ], selectedKey: this.goalStatus,
            onSelect: (key: string): void => { this.goalStatus = key; } })
        }
        Row({ space: 10 }) {
          Button($r('app.string.cancel')).layoutWeight(1).height(48).backgroundColor(this.colors.input).fontColor(this.colors.foreground)
            .onClick((): void => { this.goalEditorOpen = false; })
          Button($r('app.string.save')).layoutWeight(1).height(48).backgroundColor(this.colors.accent).fontColor(this.colors.onAccent)
            .enabled(!this.model.savingGoal && !!this.goalTitle.trim() && !!this.goalOutcome.trim())
            .onClick((): void => { void this.saveGoal(); })
        }.width('100%')
      }.width('100%').padding({ left: 20, right: 20, top: 12, bottom: 24 }).alignItems(HorizontalAlign.Start)
    }.width('100%').scrollBar(BarState.Off).backgroundColor(this.colors.panel)
  }

  @Builder
  private goalsPage(key: string) {
    Scroll() {
      Column() {
        if (this.model.loading) XopcListSkeleton()
        else if (!this.visibleGoals(key).length) {
          Text($r('app.string.personal_goal_empty')).fontSize(14).fontColor(this.colors.secondary).width('100%')
        }
        ForEach(this.visibleGoals(key), (goal: XopcUserGoal) => { this.goalRow(goal) },
          (goal: XopcUserGoal): string => goal.id)
        if (this.model.error) {
          Text($r('app.string.personal_profile_unavailable')).fontSize(12).fontColor(this.colors.tertiary).margin({ top: 12 })
        }
      }.width('100%').padding({ left: 20, right: 20 }).alignItems(HorizontalAlign.Start)
    }.id('personal-goals-list').height('100%').width('100%').align(Alignment.Top).scrollBar(BarState.Off)
      .accessibilityLevel(this.selectedGoalTab === key ? 'auto' : 'no-hide-descendants')
  }

  build() {
    Column() {
      XopcPageHeader({ heading: $r('app.string.personal_goals'), showStaticTitle: true, backVisible: true,
        onBack: this.onExit, actionLabel: $r('app.string.personal_goal_add'),
        actionIcon: $r('sys.symbol.plus'), onAction: (): void => { this.openGoalEditor(); } })
      Column() {
        XopcSegmentedTabs({ options: this.goalTabs, selectedKey: this.selectedGoalTab, pagerProgress: this.pagerProgress,
          swipeToSelect: !this.goalEditorOpen,
          onSelect: (key: string): void => { this.selectGoalTab(key); } })
      }.width('100%').padding({ left: 20, right: 20 }).margin({ top: 8, bottom: 16 })
      Swiper(this.pager) {
        this.goalsPage('ongoing')
        this.goalsPage('achieved')
      }.id('personal-goals-pager').index(this.selectedGoalTab === 'achieved' ? 1 : 0)
        .loop(false).indicator(false).cachedCount(1).disableSwipe(this.goalEditorOpen)
        .duration(this.layout.reduceMotion ? 0 : 230)
        .onContentDidScroll((_selected: number, index: number, position: number, length: number): void => {
          this.pagerProgress.update(index, position, length);
        })
        .onAnimationEnd((): void => { this.pagerProgress.reset(); })
        .onChange((index: number): void => { this.selectedGoalTab = this.goalTabs[index].key; })
        .width('100%').layoutWeight(1)
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
      .bindSheet($$this.goalEditorOpen, this.goalEditor, {
        height: SheetSize.LARGE, dragBar: true, backgroundColor: this.colors.panel
      })
  }
}
