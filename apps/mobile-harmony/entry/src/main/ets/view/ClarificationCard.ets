import { xopcMoreIcon } from '../common/designTokens';
import { xopcClickEffect, xopcRevealTransition } from '../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcClarification, XopcClarificationChoice, XopcClarificationCommand } from '../model/clarification';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { XopcClarificationWizard } from './ClarificationWizard';

export interface ClarifyPalette {
  surface: ResourceColor;
  grouped: ResourceColor;
  primaryText: ResourceColor;
  secondaryText: ResourceColor;
  tertiaryText: ResourceColor;
  accent: ResourceColor;
  onAccent: ResourceColor;
  accentSoft: ResourceColor;
  accentText: ResourceColor;
  tonalFill: ResourceColor;
  tonalText: ResourceColor;
  inputFill: ResourceColor;
  badgeAmberFill: ResourceColor;
  badgeAmberTint: ResourceColor;
  danger: ResourceColor;
  dangerSoft: ResourceColor;
}

export function resolveClarifyPalette(colors: XopcThemeColors): ClarifyPalette {
  return {
    surface: colors.panel,
    grouped: colors.grouped,
    primaryText: colors.foreground,
    secondaryText: colors.secondary,
    tertiaryText: colors.tertiary,
    accent: colors.accent,
    onAccent: colors.onAccent,
    accentSoft: colors.accentSoft,
    accentText: colors.accent,
    tonalFill: colors.grouped,
    tonalText: colors.foreground,
    inputFill: colors.input,
    badgeAmberFill: colors.warningFill,
    badgeAmberTint: colors.warningForeground,
    danger: colors.danger,
    dangerSoft: colors.dangerSoft,
  };
}

export function formatClarifyCountdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return mins.toString() + ':' + (secs < 10 ? '0' : '') + secs.toString();
}

@ComponentV2
export struct XopcClarificationCard {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Require @Param prompt: XopcClarification;
  @Param submitting: boolean = false;
  @Param errorMessage: string = '';
  @Event onRespond: (command: XopcClarificationCommand) => void = (_command: XopcClarificationCommand): void => {};
  @Param draftRecord: string = '';
  @Event onDraft: (record: string) => void = (_record: string): void => {};
  @Local draft: string = '';
  @Local selectedId: string = '';
  @Local editing: boolean = false;
  @Local expanded: boolean = false;
  @Local collapsed: boolean = false;
  @Local now: number = Date.now();
  private timer: number = -1;
  private questionId: string = '';

  aboutToAppear(): void {
    this.questionId = this.prompt.id;
    this.syncTimer();
  }

  aboutToDisappear(): void {
    this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timer !== -1) { clearInterval(this.timer); this.timer = -1; }
  }

  private syncTimer(): void {
    this.stopTimer();
    if (this.prompt.expiresAt !== undefined) {
      this.timer = setInterval((): void => { this.now = Date.now(); }, 1000);
    }
  }

  @Monitor('prompt')
  onQuestionChange(): void {
    if (this.questionId === this.prompt.id) return;
    this.questionId = this.prompt.id;
    this.draft = '';
    this.selectedId = '';
    this.editing = false;
    this.expanded = false;
    this.collapsed = false;
    this.syncTimer();
  }

  private remainingSeconds(): number | undefined {
    if (this.prompt.expiresAt === undefined) return undefined;
    return Math.max(0, Math.ceil((this.prompt.expiresAt - this.now) / 1000));
  }

  private expired(): boolean {
    return this.prompt.expiresAt !== undefined && this.prompt.expiresAt <= this.now;
  }

  private disabled(): boolean {
    return this.submitting || this.expired();
  }

  private send(action: string, choiceId: string = '', text: string = '', decision: string = ''): void {
    if (this.disabled()) return;
    const command: XopcClarificationCommand = { action };
    if (decision) command.decision = decision;
    else if (action === 'answer') {
      if ((!choiceId && !text.trim()) || text.trim().length > 8000) return;
      command.response = { choiceId: choiceId || undefined, text: text.trim() || undefined };
    }
    this.onRespond(command);
  }

  @Builder
  overflowMenu() {
    Menu() {
      MenuItem({ content: $r('app.string.chat_agent_decide') })
        .onClick((): void => { this.send('agent_decide'); })
      MenuItem({ content: $r('app.string.clarify_cancel') })
        .contentFontColor(this.colors.danger)
        .onClick((): void => { this.send('cancel'); })
    }
  }

  build() {
    if (this.prompt.schemaVersion === 2) {
      XopcClarificationWizard({
        prompt: this.prompt, submitting: this.submitting, errorMessage: this.errorMessage,
        draftRecord: this.draftRecord, onDraft: this.onDraft, onRespond: this.onRespond,
      })
    } else if (this.collapsed && this.prompt.kind !== 'approval') {
      this.collapsedBar(resolveClarifyPalette(this.colors))
    } else if (this.prompt.kind === 'approval') {
      this.approvalCard(resolveClarifyPalette(this.colors))
    } else {
      this.inputCard(resolveClarifyPalette(this.colors))
    }
  }

  @Builder
  collapsedBar(p: ClarifyPalette) {
    Row({ space: 10 }) {
      Column().width(8).height(8).borderRadius(4).backgroundColor(p.accent)
      Text(this.prompt.question).fontSize(14).fontWeight(FontWeight.Medium).fontColor(p.primaryText)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
      Button({ type: ButtonType.Normal }) {
        Row({ space: 4 }) {
          Text($r('app.string.clarify_expand')).fontSize(12).fontWeight(FontWeight.Medium).fontColor(p.tonalText)
          SymbolGlyph($r('sys.symbol.chevron_up')).fontSize(11).fontColor([p.tonalText])
        }.padding({ left: 12, right: 10 })
      }.height(32).borderRadius(16).backgroundColor(p.tonalFill)
        .onClick((): void => { this.collapsed = false; })
    }.width('100%').padding({ left: 14, right: 12, top: 10, bottom: 10 })
      .backgroundColor(p.surface).borderRadius(this.colors.corner(18))
  }

  @Builder
  approvalCard(p: ClarifyPalette) {
    Column({ space: 12 }) {
      Row({ space: 10 }) {
        Column() {
          SymbolGlyph($r('sys.symbol.checkmark_shield_fill')).fontSize(16).fontColor([p.badgeAmberTint])
        }.width(34).height(34).borderRadius(10).backgroundColor(p.badgeAmberFill)
          .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
        Column({ space: 2 }) {
          Text($r('app.string.clarify_approval_title')).fontSize(12).fontColor(p.secondaryText).width('100%')
          Text(this.prompt.approval?.operation || this.prompt.question)
            .fontSize(15).fontWeight(FontWeight.Medium).fontColor(p.primaryText).width('100%')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        if (this.remainingSeconds() !== undefined) {
          Text(this.expired() ? $r('app.string.clarify_expired') : formatClarifyCountdown(this.remainingSeconds() ?? 0))
            .fontSize(12).fontWeight(FontWeight.Medium)
            .fontColor(this.expired() ? p.danger : ((this.remainingSeconds() ?? 999) <= 60 ? p.badgeAmberTint : p.secondaryText))
            .padding({ left: 9, right: 9, top: 4, bottom: 4 }).borderRadius(999)
            .backgroundColor(this.expired() ? p.dangerSoft : ((this.remainingSeconds() ?? 999) <= 60 ? p.badgeAmberFill : p.grouped))
        }
      }.width('100%').alignItems(VerticalAlign.Center)

      if (this.prompt.approval?.operation && this.prompt.question && this.prompt.question.trim() !== this.prompt.approval.operation.trim()) {
        Text(this.prompt.question).fontSize(13).fontColor(p.secondaryText).width('100%')
      }

      if (this.prompt.approval && (this.prompt.approval.target || this.prompt.approval.impact || this.prompt.approval.argumentsPreview)) {
        Column() {
          if (this.prompt.approval.target) {
            Row({ space: 10 }) {
              Text($r('app.string.clarify_target')).fontSize(12).fontColor(p.tertiaryText).width(44)
              Text(this.prompt.approval.target).fontSize(13).fontColor(p.primaryText).layoutWeight(1)
            }.width('100%').padding({ left: 14, right: 14, top: 10, bottom: 10 }).alignItems(VerticalAlign.Top)
          }
          if (this.prompt.approval.impact) {
            Row({ space: 10 }) {
              Text($r('app.string.clarify_impact')).fontSize(12).fontColor(p.tertiaryText).width(44)
              Text(this.prompt.approval.impact).fontSize(13).fontColor(p.primaryText).layoutWeight(1)
            }.width('100%').padding({ left: 14, right: 14, top: 10, bottom: 10 }).alignItems(VerticalAlign.Top)
          }
          if (this.prompt.approval.argumentsPreview) {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 10 }) {
                Text($r('app.string.clarify_details')).fontSize(12).fontColor(p.tertiaryText).width(44)
                Text($r('app.string.clarify_params_count', Object.keys(this.prompt.approval.argumentsPreview).length))
                  .fontSize(13).fontColor(p.secondaryText).layoutWeight(1)
                SymbolGlyph(this.expanded ? $r('sys.symbol.chevron_down') : $r('sys.symbol.chevron_right'))
                  .fontSize(12).fontColor([p.tertiaryText])
              }.width('100%').padding({ left: 14, right: 14, top: 10, bottom: 10 })
            }.width('100%').backgroundColor(Color.Transparent)
              .onClick((): void => { this.expanded = !this.expanded; })
            if (this.expanded) {
              Scroll() {
                Text(JSON.stringify(this.prompt.approval.argumentsPreview, null, 2))
                  .fontSize(11).fontColor(p.secondaryText).width('100%')
              }.constraintSize({ maxHeight: 130 }).padding({ left: 14, right: 14, bottom: 10 }).width('100%')
                .transition(xopcRevealTransition(TransitionEdge.TOP, this.layout.reduceMotion))
            }
          }
        }.width('100%').backgroundColor(p.grouped).borderRadius(14).clip(true)
      }

      if (this.errorMessage) { Text(this.errorMessage).fontSize(12).fontColor(p.danger).width('100%') }
      Text($r('app.string.clarify_once')).fontSize(12).fontColor(p.tertiaryText).width('100%')

      Row({ space: 10 }) {
        Button({ type: ButtonType.Normal }) {
          Text($r('app.string.clarify_deny')).fontSize(14).fontWeight(FontWeight.Medium).fontColor(p.tonalText)
        }.layoutWeight(1).height(44).borderRadius(12).backgroundColor(p.tonalFill).enabled(!this.disabled())
          .opacity(this.disabled() ? 0.45 : 1)
          .onClick((): void => { this.send('answer', '', '', 'deny'); })
        Button({ type: ButtonType.Normal }) {
          Text(this.submitting ? $r('app.string.clarify_submitting') : $r('app.string.clarify_approve'))
            .fontSize(14).fontWeight(FontWeight.Medium).fontColor(p.onAccent)
        }.layoutWeight(1).height(44).borderRadius(12).backgroundColor(p.accent).enabled(!this.disabled())
          .opacity(this.disabled() ? 0.45 : 1)
          .onClick((): void => { this.send('answer', '', '', 'approve'); })
      }.width('100%')
    }.padding(16).width('100%').backgroundColor(p.surface).borderRadius(this.colors.corner(20))
  }

  @Builder
  inputCard(p: ClarifyPalette) {
    Column() {
      Row({ space: 4 }) {
        if (this.remainingSeconds() !== undefined) {
          Text(this.expired() ? $r('app.string.clarify_expired') : formatClarifyCountdown(this.remainingSeconds() ?? 0))
            .fontSize(12).fontColor(this.expired() ? p.danger : p.secondaryText)
        }
        Blank().layoutWeight(1)
        Button({ type: ButtonType.Normal }) {
          SymbolGlyph(xopcMoreIcon()).fontSize(18).fontColor([p.secondaryText])
        }.width(36).height(36).borderRadius(10).backgroundColor(Color.Transparent).enabled(!this.disabled())
          .clickEffect(xopcClickEffect())
          .accessibilityText($r('app.string.clarify_more')).bindMenu(this.overflowMenu)
        Button({ type: ButtonType.Normal }) {
          SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(14).fontColor([p.secondaryText])
        }.width(32).height(32).borderRadius(8).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.clarify_collapse'))
          .onClick((): void => { this.collapsed = true; })
      }.width('100%').padding({ left: 16, right: 10, top: 8, bottom: 2 }).alignItems(VerticalAlign.Center)

      Scroll() {
        Column({ space: 12 }) {
          Text(this.prompt.question).fontSize(15).fontWeight(FontWeight.Medium).fontColor(p.primaryText).width('100%')

          if ((this.prompt.choiceDetails?.length ?? 0) > 0) {
            Column() {
              ForEach(this.prompt.choiceDetails ?? [], (choice: XopcClarificationChoice) => {
                Button({ type: ButtonType.Normal }) {
                  Row({ space: 12 }) {
                    Column({ space: 2 }) {
                      Row({ space: 6 }) {
                        Text(choice.label).fontSize(14).fontWeight(FontWeight.Medium)
                          .fontColor(this.selectedId === choice.id ? p.accentText : p.primaryText)
                        if (this.prompt.recommendedChoiceId === choice.id) {
                          Text($r('app.string.clarify_recommended')).fontSize(11).fontWeight(FontWeight.Medium)
                            .fontColor(p.accentText).padding({ left: 7, right: 7, top: 2, bottom: 2 })
                            .borderRadius(999).backgroundColor(p.accentSoft)
                        }
                      }
                      if (choice.description) {
                        Text(choice.description).fontSize(12).fontColor(p.secondaryText).width('100%')
                      }
                    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                    Column() {
                      if (this.selectedId === choice.id) {
                        Text('✓').fontSize(11).fontWeight(FontWeight.Bold).fontColor(p.onAccent)
                      }
                    }.width(20).height(20).borderRadius(10)
                      .backgroundColor(this.selectedId === choice.id ? p.accent : p.inputFill)
                      .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
                  }.width('100%').padding({ left: 14, right: 14, top: 12, bottom: 12 }).alignItems(VerticalAlign.Center)
                }.width('100%').constraintSize({ minHeight: 48 })
                  .backgroundColor(this.selectedId === choice.id ? p.accentSoft : Color.Transparent)
                  .enabled(!this.disabled())
                  .onClick((): void => {
                    if (this.prompt.interactionMode === 'compose' || this.editing || this.draft) {
                      this.editing = true; this.selectedId = choice.id;
                    } else {
                      this.selectedId = choice.id; this.send('answer', choice.id);
                    }
                  })
              }, (choice: XopcClarificationChoice): string => choice.id)
              Button({ type: ButtonType.Normal }) {
                Row({ space: 10 }) {
                  Text(this.selectedId ? $r('app.string.clarify_supplement') : $r('app.string.clarify_custom'))
                    .fontSize(14).fontColor(p.secondaryText).layoutWeight(1)
                  SymbolGlyph(this.editing ? $r('sys.symbol.chevron_down') : $r('sys.symbol.chevron_right'))
                    .fontSize(12).fontColor([p.tertiaryText])
                }.width('100%').padding({ left: 14, right: 14, top: 12, bottom: 12 })
              }.width('100%').constraintSize({ minHeight: 46 }).backgroundColor(Color.Transparent)
                .enabled(!this.disabled())
                .onClick((): void => { this.editing = !this.editing; })
            }.width('100%').backgroundColor(p.grouped).borderRadius(14).clip(true)
          }

          if (this.editing || (this.prompt.choiceDetails?.length ?? 0) === 0) {
            Column({ space: 6 }) {
              if (this.selectedId) {
                Row() {
                  Text((this.prompt.choiceDetails ?? []).find((c: XopcClarificationChoice): boolean => c.id === this.selectedId)?.label ?? '')
                    .fontSize(12).fontColor(p.secondaryText).maxLines(1).layoutWeight(1)
                  Button({ type: ButtonType.Normal }) {
                    Text($r('app.string.clarify_clear')).fontSize(12).fontColor(p.tertiaryText)
                  }.height(26).padding({ left: 6, right: 6 }).backgroundColor(Color.Transparent).enabled(!this.disabled())
                    .onClick((): void => { this.selectedId = ''; })
                }.width('100%')
              }
              TextArea({ text: this.draft, placeholder: this.selectedId ? $r('app.string.clarify_supplement') : $r('app.string.clarify_placeholder') })
                .constraintSize({ minHeight: 72, maxHeight: 132 }).width('100%').fontSize(14).fontColor(p.primaryText)
                .backgroundColor(p.inputFill).borderRadius(12)
                .enabled(!this.disabled())
                .onChange((text: string): void => { this.draft = text; if (text) this.editing = true; })
              if (this.draft.trim().length >= 6400) {
                Text(this.draft.trim().length.toString() + '/8000').fontSize(11)
                  .fontColor(this.draft.trim().length > 8000 ? p.danger : p.tertiaryText).width('100%')
              }
            }.width('100%')
          }

          if (this.errorMessage) { Text(this.errorMessage).fontSize(12).fontColor(p.danger).width('100%') }
        }.padding({ left: 16, right: 16, bottom: 12 }).width('100%')
      }.constraintSize({ maxHeight: 320 }).width('100%')

      if (this.editing || (this.prompt.choiceDetails?.length ?? 0) === 0 || this.submitting) {
        Row() {
          Blank().layoutWeight(1)
          Button({ type: ButtonType.Normal }) {
            Text(this.submitting ? $r('app.string.clarify_submitting') : $r('app.string.send'))
              .fontSize(14).fontWeight(FontWeight.Medium).fontColor(p.onAccent)
          }.height(38).padding({ left: 20, right: 20 }).borderRadius(19).backgroundColor(p.accent)
            .enabled(!this.disabled() && this.draft.trim().length <= 8000 && (!!this.selectedId || !!this.draft.trim()))
            .opacity((!this.disabled() && this.draft.trim().length <= 8000 && (!!this.selectedId || !!this.draft.trim())) ? 1 : 0.4)
            .onClick((): void => { this.send('answer', this.selectedId, this.draft); })
        }.width('100%').padding({ left: 16, right: 16, top: 10, bottom: 10 })
      }
    }.width('100%').backgroundColor(p.surface).borderRadius(this.colors.corner(20))
  }
}
