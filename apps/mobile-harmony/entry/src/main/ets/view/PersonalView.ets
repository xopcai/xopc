import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcMobileRoute } from '../model/home';
import { XopcUserGoal } from '../model/userUnderstanding';
import { XopcPersonalViewModel } from '../viewmodel/homeViewModel';
import { XopcHubRow, XopcListSkeleton, XopcPageHeader, XopcSectionLabel } from './MobileComponents';
import { XopcPersonalAgentRecord } from '../model/personalAgent';
import { connectionModel } from '../viewmodel/connectionViewModel';
import { gatewaySession } from '../service/gatewaySession';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';

@ComponentV2
export struct XopcPersonalView {
  @Param record: XopcPersonalAgentRecord | null = null;
  @Param goalsPage: boolean = false;
  @Local completed: boolean = false;
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
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};

  aboutToAppear(): void { if (this.goalsPage) void this.model.refresh(); }
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
    }.width('100%').padding(0).borderRadius(16).backgroundColor(this.colors.panel).margin({ bottom: 8 })
      .onClick((): void => { this.openGoalEditor(goal); })
  }

  @Builder
  private goalStatusButton(status: string, label: ResourceStr) {
    Button(label).height(38).padding({ left: 14, right: 14 }).fontSize(12)
      .fontColor(this.goalStatus === status ? this.colors.accent : this.colors.secondary)
      .backgroundColor(this.goalStatus === status ? this.colors.accentSoft : this.colors.input)
      .onClick((): void => { this.goalStatus = status; })
  }

  @Builder
  private goalEditor() {
    Scroll() {
      Column({ space: 12 }) {
        Text(this.editingGoalId ? $r('app.string.personal_goal_edit') : $r('app.string.personal_goal_add'))
          .fontSize(21).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).width('100%')
        Text($r('app.string.personal_goal_help')).fontSize(13).lineHeight(19).fontColor(this.colors.secondary).width('100%')
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
          Row({ space: 8 }) {
            this.goalStatusButton('active', $r('app.string.personal_goal_active'))
            this.goalStatusButton('paused', $r('app.string.personal_goal_paused'))
            this.goalStatusButton('achieved', $r('app.string.personal_goal_achieved'))
          }.width('100%')
        }
        Row({ space: 10 }) {
          Button($r('app.string.cancel')).layoutWeight(1).height(48).backgroundColor(this.colors.input).fontColor(this.colors.foreground)
            .onClick((): void => { this.goalEditorOpen = false; })
          Button($r('app.string.save')).layoutWeight(1).height(48).backgroundColor(this.colors.accent).fontColor(Color.White)
            .enabled(!this.model.savingGoal && !!this.goalTitle.trim() && !!this.goalOutcome.trim())
            .onClick((): void => { void this.saveGoal(); })
        }.width('100%')
      }.width('100%').padding({ left: 20, right: 20, top: 12, bottom: 24 }).alignItems(HorizontalAlign.Start)
    }.width('100%').scrollBar(BarState.Off).backgroundColor(this.colors.panel)
  }

  build() {
    Column() {
      XopcPageHeader({ heading: this.goalsPage ? $r('app.string.personal_goals') : $r('app.string.personal'),
        backVisible: true, onBack: this.onExit,
        actionLabel: this.goalsPage ? $r('app.string.personal_goal_add') : $r('app.string.settings'),
        actionIcon: this.goalsPage ? $r('sys.symbol.plus') : $r('sys.symbol.gearshape'),
        onAction: (): void => {
          if (this.goalsPage) this.openGoalEditor();
          else this.onNavigate({ page: 'settings', itemId: '' });
        } })
      Scroll() {
        Column() {
          if (this.goalsPage) {
            Row({ space: 8 }) {
              Button($r('app.string.ongoing')).height(44).fontColor(this.colors.foreground)
                .backgroundColor(!this.completed ? this.colors.input : Color.Transparent)
                .accessibilitySelected(!this.completed).onClick((): void => { this.completed = false; })
              Button($r('app.string.personal_goal_achieved')).height(44).fontColor(this.colors.foreground)
                .backgroundColor(this.completed ? this.colors.input : Color.Transparent)
                .accessibilitySelected(this.completed).onClick((): void => { this.completed = true; })
            }.width('100%').margin({ top: 8, bottom: 16 })
            if (this.model.loading) XopcListSkeleton()
            else if (!this.model.goals.some((goal: XopcUserGoal): boolean => (goal.status === 'achieved') === this.completed)) {
              Text($r('app.string.personal_goal_empty')).fontSize(14).fontColor(this.colors.secondary).width('100%')
            }
            ForEach(this.model.goals.filter((goal: XopcUserGoal): boolean => (goal.status === 'achieved') === this.completed),
              (goal: XopcUserGoal) => { this.goalRow(goal) }, (goal: XopcUserGoal): string => goal.id + ':' + goal.status)
          } else {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 12 }) {
                XopcPersonalAgentAvatar({ agentId: this.record?.agentId ?? '', extent: 54, compact: true,
                  appearance: this.record?.appearance ?? 'loopi', revision: this.record?.revision ?? 0 })
                Column({ space: 5 }) {
                  Text(this.record?.displayName || $r('app.string.chat_personal_agent')).fontSize(20)
                    .fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).width('100%').maxLines(1)
                  Text($r('app.string.personal_agent_summary')).fontSize(13).fontColor(this.colors.secondary).width('100%')
                }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(16).fontColor([this.colors.secondary])
              }.width('100%').padding(16).constraintSize({ minHeight: 100 })
            }.id('me-agent-profile').width('100%').padding(0).borderRadius(20).backgroundColor(this.colors.panel)
              .enabled(!!this.record).onClick((): void => { this.onNavigate({ page: 'personal-agent-profile', itemId: '' }); })
            XopcSectionLabel({ heading: $r('app.string.personalization') })
            XopcHubRow({ heading: $r('app.string.about_you'), summary: $r('app.string.personal_memory_summary'),
              symbol: $r('sys.symbol.person'), onOpen: (): void => { this.onNavigate({ page: 'about-you', itemId: '' }); } })
              .id('me-about-you')
            XopcHubRow({ heading: $r('app.string.personal_goals'), summary: $r('app.string.personal_goal_help'),
              symbol: $r('sys.symbol.flag'), onOpen: (): void => { this.onNavigate({ page: 'personal-goals', itemId: '' }); } })
              .id('me-goals')
            XopcSectionLabel({ heading: $r('app.string.personal_app_section') })
            XopcHubRow({ heading: $r('app.string.personal_work_computer'), summary: gatewaySession.currentProfile()?.name ?? '',
              symbol: $r('sys.symbol.link'), onOpen: (): void => { connectionModel.openGateways(); } })
              .id('me-work-computer')
            XopcHubRow({ heading: $r('app.string.settings'), summary: $r('app.string.personal_settings_hint'),
              symbol: $r('sys.symbol.gearshape'), onOpen: (): void => { this.onNavigate({ page: 'settings', itemId: '' }); } })
              .id('me-settings')
          }
          if (this.model.error) {
            Text($r('app.string.personal_profile_unavailable')).fontSize(12).fontColor(this.colors.tertiary).margin({ top: 12 })
          }
        }.width('100%').padding({ left: 20, right: 20 }).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').align(Alignment.Top).scrollBar(BarState.Off)
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
      .bindSheet($$this.goalEditorOpen, this.goalEditor, {
        height: SheetSize.LARGE, dragBar: true, backgroundColor: this.colors.panel
      })
  }
}
