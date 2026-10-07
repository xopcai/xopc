import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcMobileRoute } from '../model/home';
import { XopcUnderstandingItem, XopcUnderstandingRule, XopcUserGoal } from '../model/userUnderstanding';
import { XopcPersonalViewModel } from '../viewmodel/homeViewModel';
import { XopcListSkeleton, XopcPageHeader, XopcSectionLabel } from './MobileComponents';
import { XopcLoopi } from './Loopi';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { XopcPersonalAgentRecord } from '../model/personalAgent';

@ComponentV2
export struct XopcPersonalView {
  @Param activePage: boolean = true;
  @Param bottomInset: number = 0;
  @Param personalAgent: XopcPersonalAgentRecord | null = null;
  @Param personalBusy: boolean = false;
  @Local colors: XopcThemeColors = appThemeColors;
  @Local model: XopcPersonalViewModel = new XopcPersonalViewModel();
  @Local goalEditorOpen: boolean = false;
  @Local editingGoalId: string = '';
  @Local goalTitle: string = '';
  @Local goalOutcome: string = '';
  @Local goalTargetDate: string = '';
  @Local goalStatus: string = 'active';
  @Local goalDateError: boolean = false;
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Event onOpenPersonal: () => void = (): void => {};

  aboutToAppear(): void { this.model.refresh(); }
  aboutToDisappear(): void { this.model.dispose(); }

  private initials(): string {
    const name = this.model.name.trim();
    return name ? Array.from(name).slice(0, 2).join('').toUpperCase() : 'X';
  }

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
  private sectionHeading(title: ResourceStr) {
    Row() {
      Text(title).fontSize(13).lineHeight(18).fontWeight(FontWeight.Medium)
        .fontColor(this.colors.secondary).layoutWeight(1)
      Button($r('app.string.personal_view_all')).height(40).padding({ left: 8, right: 8 })
        .fontSize(13).fontColor(this.colors.accent).backgroundColor(Color.Transparent)
        .onClick((): void => { this.onNavigate({ page: 'about-you', itemId: '' }); })
    }.width('100%').margin({ top: 24, bottom: 8 }).alignItems(VerticalAlign.Center)
  }

  @Builder
  private countCell(value: number, label: ResourceStr, accent: boolean = false) {
    Column({ space: 4 }) {
      Text(value.toString()).fontSize(24).fontWeight(FontWeight.Bold)
        .fontColor(accent && value > 0 ? this.colors.accent : this.colors.foreground)
      Text(label).fontSize(11).fontColor(this.colors.secondary).maxLines(2).textAlign(TextAlign.Center)
    }.layoutWeight(1).alignItems(HorizontalAlign.Center)
  }

  @Builder
  private understandingRow(item: XopcUnderstandingItem) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 10 }) {
        Column({ space: 4 }) {
          Text(item.statement).fontSize(15).lineHeight(21).fontColor(this.colors.foreground)
            .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Text(item.authority === 'user_explicit' ? $r('app.string.about_you_explicit') : $r('app.string.about_you_learned'))
            .fontSize(12).fontColor(this.colors.secondary).width('100%')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([this.colors.tertiary])
      }.width('100%').constraintSize({ minHeight: 68 }).padding({ left: 16, right: 14, top: 10, bottom: 10 })
    }.width('100%').padding(0).borderRadius(14).backgroundColor(this.colors.panel).margin({ bottom: 8 })
      .onClick((): void => { this.onNavigate({ page: 'about-you', itemId: item.id }); })
  }

  @Builder
  private ruleRow(rule: XopcUnderstandingRule) {
    Row({ space: 10 }) {
      SymbolGlyph($r('sys.symbol.info_circle')).fontSize(18).fontColor([this.colors.secondary])
      Text(rule.statement).fontSize(14).lineHeight(20).fontColor(this.colors.foreground)
        .layoutWeight(1).maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis })
    }.width('100%').padding({ left: 16, right: 16, top: 12, bottom: 12 })
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
      XopcPageHeader({ heading: $r('app.string.personal'), actionLabel: $r('app.string.settings'),
        actionIcon: $r('sys.symbol.gearshape'), onAction: (): void => { this.onNavigate({ page: 'settings', itemId: '' }); } })
      Scroll() {
        Column() {
          Row({ space: 16 }) {
            Text(this.initials()).fontSize(22).fontWeight(FontWeight.Bold).fontColor(this.colors.accent)
              .width(64).height(64).textAlign(TextAlign.Center).borderRadius(32).backgroundColor(this.colors.accentSoft)
            Column({ space: 5 }) {
              Text(this.model.name || $r('app.string.personal_default_name')).fontSize(21).fontWeight(FontWeight.Bold)
                .fontColor(this.colors.foreground).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(this.model.role || $r('app.string.personal_profile_hint')).fontSize(13).lineHeight(19)
                .fontColor(this.colors.secondary).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
              Row({ space: 7 }) {
                Column().width(7).height(7).borderRadius(4).backgroundColor(this.colors.accent)
                Text($r('app.string.workspace_connected')).fontSize(12).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
              }.constraintSize({ minHeight: 28 }).padding({ left: 10, right: 10 }).borderRadius(14).backgroundColor(this.colors.accentSoft)
              Row({ space: 6 }) {
                Text($r('app.string.about_you_count', this.model.understandingCount)).fontSize(12).fontColor(this.colors.secondary)
                if (this.model.reviewCount > 0) {
                  Text('·').fontSize(12).fontColor(this.colors.tertiary)
                  Text($r('app.string.about_you_review_count', this.model.reviewCount)).fontSize(12).fontColor(this.colors.accent)
                }
              }
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
            Column({ space: 4 }) {
              XopcLoopi({ extent: 44, activePage: this.activePage && !this.goalEditorOpen }).id('personal-loopi')
              SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(12).fontColor([this.colors.tertiary])
            }.width(44)
          }.width('100%').padding(20).borderRadius(22).backgroundColor(this.colors.panel)
            .onClick((): void => { this.onNavigate({ page: 'about-you', itemId: '' }); })

          Button({ type: ButtonType.Normal }) {
            Row({ space: 14 }) {
              XopcPersonalAgentAvatar({ extent: 54, activePage: this.activePage && !this.goalEditorOpen,
                agentId: this.personalAgent?.agentId ?? '', appearance: this.personalAgent?.appearance ?? 'loopi' })
              Column({ space: 5 }) {
                Text(this.personalAgent?.state === 'ready'
                  ? $r('app.string.personal_chat_resume_title', this.personalAgent.displayName)
                  : $r('app.string.personal_chat_entry_title')).fontSize(16).fontWeight(FontWeight.Medium)
                  .fontColor(this.colors.foreground).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(this.personalAgent?.state === 'ready' ? $r('app.string.personal_chat_resume_subtitle')
                  : $r('app.string.personal_chat_entry_subtitle')).fontSize(12).lineHeight(18)
                  .fontColor(this.colors.secondary).maxLines(2)
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(17).fontColor([this.colors.accent])
            }.width('100%').padding({ left: 18, right: 16, top: 14, bottom: 14 })
          }.id('personal-ai-chat-entry').width('100%').padding(0).borderRadius(22)
            .backgroundColor(this.colors.accentSoft).margin({ top: 16 })
            .accessibilityText(this.personalAgent?.state === 'ready'
              ? $r('app.string.personal_chat_resume_title', this.personalAgent.displayName)
              : $r('app.string.personal_chat_entry_title'))
            .enabled(!this.personalBusy).onClick((): void => { this.onOpenPersonal(); })

          if (this.model.loading) {
            Column() { XopcListSkeleton() }.width('100%').padding({ top: 24 })
          } else {
            Row() {
              Text($r('app.string.personal_goals')).fontSize(13).lineHeight(18).fontWeight(FontWeight.Medium)
                .fontColor(this.colors.secondary).layoutWeight(1)
              Button($r('app.string.personal_goal_add')).height(40).padding({ left: 8, right: 8 })
                .fontSize(13).fontColor(this.colors.accent).backgroundColor(Color.Transparent)
                .onClick((): void => { this.openGoalEditor(); })
            }.width('100%').margin({ top: 24, bottom: 8 }).alignItems(VerticalAlign.Center)
            if (this.model.goals.length > 0) {
              ForEach(this.model.goals, (goal: XopcUserGoal) => { this.goalRow(goal) },
                (goal: XopcUserGoal): string => goal.id)
            } else if (this.model.focusTitle) {
              XopcSectionLabel({ heading: $r('app.string.about_you_focus') })
              Button({ type: ButtonType.Normal }) {
                Row({ space: 12 }) {
                  SymbolGlyph($r('sys.symbol.flag')).fontSize(22).fontColor([this.colors.accent])
                  Column({ space: 4 }) {
                    Text(this.model.focusTitle).fontSize(16).lineHeight(23).fontWeight(FontWeight.Medium)
                      .fontColor(this.colors.foreground).width('100%').maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                    if (this.model.focusOutcome) {
                      Text(this.model.focusOutcome).fontSize(13).lineHeight(19).fontColor(this.colors.secondary)
                        .width('100%').maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                    }
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                  SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([this.colors.tertiary])
                }.width('100%').padding(16)
              }.width('100%').padding(0).borderRadius(16).backgroundColor(this.colors.accentSoft)
                .onClick((): void => { this.onNavigate({ page: 'about-you', itemId: '' }); })
            } else {
              Button({ type: ButtonType.Normal }) {
                Row({ space: 12 }) {
                  SymbolGlyph($r('sys.symbol.flag')).fontSize(22).fontColor([this.colors.accent])
                  Column({ space: 4 }) {
                    Text($r('app.string.personal_goal_empty')).fontSize(15).fontWeight(FontWeight.Medium)
                      .fontColor(this.colors.foreground).width('100%')
                    Text($r('app.string.personal_goal_empty_help')).fontSize(13).lineHeight(19)
                      .fontColor(this.colors.secondary).width('100%')
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                }.width('100%').padding(16)
              }.width('100%').padding(0).borderRadius(16).backgroundColor(this.colors.panel)
                .onClick((): void => { this.openGoalEditor(); })
            }

            this.sectionHeading($r('app.string.personal_understanding_title'))
            Column({ space: 14 }) {
              Text($r('app.string.personal_understanding_help')).fontSize(14).lineHeight(20)
                .fontColor(this.colors.secondary).width('100%')
              Row() {
                this.countCell(this.model.explicitCount, $r('app.string.about_you_explicit'))
                this.countCell(this.model.learnedCount, $r('app.string.about_you_learned'))
                this.countCell(this.model.reviewCount, $r('app.string.about_you_needs_review'), true)
              }.width('100%')
              Row({ space: 8 }) {
                SymbolGlyph($r('sys.symbol.square_stack_3d')).fontSize(16).fontColor([this.colors.secondary])
                Text($r('app.string.about_you_work_memory_count', this.model.workMemoryCount))
                  .fontSize(12).fontColor(this.colors.secondary)
              }.width('100%')
            }.width('100%').padding(18).borderRadius(18).backgroundColor(this.colors.panel)

            if (this.model.recent.length > 0) {
              XopcSectionLabel({ heading: $r('app.string.about_you_recent') })
              ForEach(this.model.recent, (item: XopcUnderstandingItem) => { this.understandingRow(item) },
                (item: XopcUnderstandingItem): string => item.id)
            }
            if (this.model.rules.length > 0) {
              XopcSectionLabel({ heading: $r('app.string.about_you_rules') })
              Column() {
                ForEach(this.model.rules, (rule: XopcUnderstandingRule) => { this.ruleRow(rule) },
                  (rule: XopcUnderstandingRule): string => rule.id)
              }.width('100%').borderRadius(16).backgroundColor(this.colors.panel)
            }
          }
          if (this.model.error) {
            Text($r('app.string.personal_profile_unavailable')).fontSize(12).fontColor(this.colors.tertiary).margin({ top: 12 })
          }
        }.width('100%').padding({ left: 20, right: 20, bottom: this.bottomInset }).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').align(Alignment.Top).scrollBar(BarState.Off)
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
      .bindSheet($$this.goalEditorOpen, this.goalEditor, {
        height: SheetSize.LARGE, dragBar: true, backgroundColor: this.colors.panel
      })
  }
}
