import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import {
  XopcClarification, XopcClarificationQuestion, XopcClarificationChoice, XopcClarificationDraft,
  XopcClarificationBatchAnswer, XopcClarificationCommand, validClarificationAnswers,
} from '../model/clarification';
import { ClarifyPalette, resolveClarifyPalette } from './ClarificationCard';

@ComponentV2
export struct XopcClarificationWizard {
  @Require @Param prompt: XopcClarification;
  @Param submitting: boolean = false;
  @Param errorMessage: string = '';
  @Param draftRecord: string = '';
  @Event onDraft: (record: string) => void = (_record: string): void => {};
  @Event onRespond: (command: XopcClarificationCommand) => void = (_command: XopcClarificationCommand): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local collapsed: boolean = false;
  @Local expandedCustomId: string = '';
  @Local now: number = Date.now();
  private timer: number = -1;

  aboutToAppear(): void {
    if (this.prompt.expiresAt !== undefined) {
      this.timer = setInterval((): void => { this.now = Date.now(); }, 1000);
    }
  }

  aboutToDisappear(): void {
    if (this.timer !== -1) { clearInterval(this.timer); this.timer = -1; }
  }

  private draft(): XopcClarificationDraft {
    try { return this.draftRecord ? JSON.parse(this.draftRecord) as XopcClarificationDraft : { index: 0, answers: [] }; }
    catch (_error) { return { index: 0, answers: [] }; }
  }

  private questions(): XopcClarificationQuestion[] { return this.prompt.questions ?? []; }
  private index(): number { return Math.max(0, Math.min(this.questions().length - 1, this.draft().index)); }
  private current(): XopcClarificationQuestion | undefined { return this.questions()[this.index()]; }

  private answerFor(questionId: string): XopcClarificationBatchAnswer | undefined {
    return this.draft().answers.find((entry: XopcClarificationBatchAnswer): boolean => entry.questionId === questionId);
  }

  private answer(): XopcClarificationBatchAnswer | undefined {
    const cur = this.current();
    return cur ? this.answerFor(cur.id) : undefined;
  }

  private isAnswered(question: XopcClarificationQuestion): boolean {
    const entry = this.answerFor(question.id);
    return !!entry && (!!entry.choiceId || !!entry.text?.trim());
  }

  private answeredCount(): number {
    return this.questions().filter((q: XopcClarificationQuestion): boolean => this.isAnswered(q)).length;
  }

  private expired(): boolean { return this.prompt.expiresAt !== undefined && this.prompt.expiresAt <= this.now; }
  private disabled(): boolean { return this.submitting || this.expired(); }
  private locked(): boolean { return this.disabled() || !!this.draft().pendingAction; }
  private complete(): boolean { return validClarificationAnswers(this.prompt, this.draft().answers); }

  private allAnswered(): boolean {
    return this.questions().every((q: XopcClarificationQuestion): boolean => this.isAnswered(q));
  }

  private summaryText(): string {
    if (this.questions().length <= 1 || !this.allAnswered()) return '';
    const parts: string[] = [];
    for (const q of this.questions()) {
      const entry = this.answerFor(q.id);
      if (!entry) continue;
      const choiceLabel = q.choices?.find((c: XopcClarificationChoice): boolean => c.id === entry.choiceId)?.label;
      const trimmed = entry.text?.trim();
      const item = [choiceLabel, trimmed].filter((v: string | undefined): boolean => !!v).join(' · ');
      if (item) parts.push(item);
    }
    return parts.join(' · ');
  }

  private update(choiceId: string, text: string, nextIndex?: number): void {
    if (this.locked()) return;
    const question = this.current();
    if (!question) return;
    const draft = this.draft();
    draft.answers = draft.answers.filter((entry: XopcClarificationBatchAnswer): boolean => entry.questionId !== question.id);
    draft.answers.push({ questionId: question.id, choiceId: choiceId || undefined, text: text || undefined });
    if (nextIndex !== undefined) draft.index = nextIndex;
    this.onDraft(JSON.stringify(draft));
  }

  private pickChoice(choiceId: string): void {
    if (this.locked()) return;
    const question = this.current();
    if (!question) return;
    const existingText = this.answer()?.text ?? '';
    const draft = this.draft();
    draft.answers = draft.answers.filter((entry: XopcClarificationBatchAnswer): boolean => entry.questionId !== question.id);
    draft.answers.push({ questionId: question.id, choiceId, text: existingText || undefined });

    if (this.questions().length === 1 && !existingText.trim() && this.expandedCustomId !== question.id) {
      this.onDraft(JSON.stringify(draft));
      this.submitWithDraft('answer', draft);
      return;
    }

    const nextUnanswered = this.questions().findIndex((q: XopcClarificationQuestion): boolean => {
      const a = draft.answers.find((entry: XopcClarificationBatchAnswer): boolean => entry.questionId === q.id);
      return !a?.choiceId && !a?.text?.trim();
    });
    if (nextUnanswered !== -1) {
      this.expandedCustomId = '';
      draft.index = nextUnanswered;
    }
    this.onDraft(JSON.stringify(draft));
  }

  private jumpTo(targetIndex: number): void {
    this.expandedCustomId = '';
    const draft = this.draft();
    draft.index = Math.max(0, Math.min(this.questions().length - 1, targetIndex));
    this.onDraft(JSON.stringify(draft));
  }

  private submitWithDraft(action: string, draft: XopcClarificationDraft): void {
    if (this.disabled() || (action === 'answer' && !validClarificationAnswers(this.prompt, draft.answers))) return;
    draft.pendingAction = action;
    this.onDraft(JSON.stringify(draft));
    const command: XopcClarificationCommand = { action, schemaVersion: 2 };
    if (action === 'answer') {
      command.answers = this.questions().map((question: XopcClarificationQuestion): XopcClarificationBatchAnswer => {
        const entry = draft.answers.find((a: XopcClarificationBatchAnswer): boolean => a.questionId === question.id);
        return { questionId: question.id, choiceId: entry?.choiceId, text: entry?.text?.trim() || undefined };
      });
    }
    this.onRespond(command);
  }

  private submit(action: string): void {
    this.submitWithDraft(action, this.draft());
  }

  @Builder
  overflowMenu() {
    Menu() {
      MenuItem({ content: $r('app.string.chat_agent_decide') })
        .onClick((): void => { this.submit('agent_decide'); })
      MenuItem({ content: $r('app.string.clarify_cancel') })
        .contentFontColor(this.colors.danger)
        .onClick((): void => { this.submit('cancel'); })
    }
  }

  build() {
    if (this.collapsed) {
      this.collapsedBar(resolveClarifyPalette(this.colors))
    } else {
      this.wizardCard(resolveClarifyPalette(this.colors))
    }
  }

  @Builder
  collapsedBar(p: ClarifyPalette) {
    Row({ space: 10 }) {
      Column().width(8).height(8).borderRadius(4).backgroundColor(p.accent)
      Text(this.current()?.header || $r('app.string.clarify_title'))
        .fontSize(14).fontWeight(FontWeight.Medium).fontColor(p.primaryText)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
      if (this.questions().length > 1) {
        Text(this.answeredCount().toString() + '/' + this.questions().length.toString())
          .fontSize(12).fontColor(p.secondaryText)
      }
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
  wizardCard(p: ClarifyPalette) {
    Column() {
      Column({ space: 8 }) {
        Row({ space: 6 }) {
          if (this.questions().length > 1) {
            Scroll() {
              Row({ space: 6 }) {
                ForEach(this.questions(), (q: XopcClarificationQuestion, idx: number) => {
                  Button({ type: ButtonType.Normal }) {
                    Text((idx + 1).toString() + '. ' + q.header + (this.isAnswered(q) ? ' ✓' : ''))
                      .fontSize(12).fontWeight(FontWeight.Medium).maxLines(1)
                      .fontColor(idx === this.index() ? p.accentText : (this.isAnswered(q) ? p.primaryText : p.secondaryText))
                  }.height(28).padding({ left: 10, right: 10 }).borderRadius(14)
                    .backgroundColor(idx === this.index() ? p.accentSoft : (this.isAnswered(q) ? p.grouped : Color.Transparent))
                    .enabled(!this.locked())
                    .onClick((): void => { this.jumpTo(idx); })
                }, (q: XopcClarificationQuestion): string => q.id)
              }
            }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).layoutWeight(1)
            Text(this.answeredCount().toString() + '/' + this.questions().length.toString())
              .fontSize(12).fontColor(p.tertiaryText)
          } else {
            Text(this.current()?.header ?? '').fontSize(12).fontWeight(FontWeight.Medium).fontColor(p.secondaryText).layoutWeight(1)
          }
          if (!this.draft().pendingAction) {
            Button({ type: ButtonType.Normal }) {
              SymbolGlyph($r('sys.symbol.dot_grid_1x2')).fontSize(15).fontColor([p.secondaryText])
            }.width(30).height(30).borderRadius(8).backgroundColor(Color.Transparent).enabled(!this.locked())
              .accessibilityText($r('app.string.clarify_more')).bindMenu(this.overflowMenu)
          }
          Button({ type: ButtonType.Normal }) {
            SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(14).fontColor([p.secondaryText])
          }.width(30).height(30).borderRadius(8).backgroundColor(Color.Transparent)
            .accessibilityText($r('app.string.clarify_collapse'))
            .onClick((): void => { this.collapsed = true; })
        }.width('100%').alignItems(VerticalAlign.Center)

        if (this.questions().length > 1) {
          Row({ space: 4 }) {
            ForEach(this.questions(), (q: XopcClarificationQuestion, idx: number) => {
              Column().height(2.5).layoutWeight(1).borderRadius(2)
                .backgroundColor(this.isAnswered(q) ? p.accent : (idx === this.index() ? p.accentSoft : p.grouped))
            }, (q: XopcClarificationQuestion): string => q.id)
          }.width('100%')
        }
      }.width('100%').padding({ left: 16, right: 10, top: 12, bottom: 8 })

      Scroll() {
        Column({ space: 12 }) {
          Text(this.current()?.question ?? '').fontSize(15).fontWeight(FontWeight.Medium).fontColor(p.primaryText).width('100%')

          if (this.current()?.type === 'single_choice') {
            Column() {
              ForEach(this.current()?.choices ?? [], (choice: XopcClarificationChoice) => {
                Button({ type: ButtonType.Normal }) {
                  Row({ space: 12 }) {
                    Column({ space: 2 }) {
                      Row({ space: 6 }) {
                        Text(choice.label).fontSize(14).fontWeight(FontWeight.Medium)
                          .fontColor(this.answer()?.choiceId === choice.id ? p.accentText : p.primaryText)
                        if (choice.id === this.current()?.recommendedChoiceId) {
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
                      if (this.answer()?.choiceId === choice.id) {
                        Text('✓').fontSize(11).fontWeight(FontWeight.Bold).fontColor(p.onAccent)
                      }
                    }.width(20).height(20).borderRadius(10)
                      .backgroundColor(this.answer()?.choiceId === choice.id ? p.accent : p.inputFill)
                      .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
                  }.width('100%').padding({ left: 14, right: 14, top: 12, bottom: 12 }).alignItems(VerticalAlign.Center)
                }.width('100%').constraintSize({ minHeight: 48 })
                  .backgroundColor(this.answer()?.choiceId === choice.id ? p.accentSoft : Color.Transparent)
                  .enabled(!this.locked())
                  .onClick((): void => { this.pickChoice(choice.id); })
              }, (choice: XopcClarificationChoice): string => choice.id)
              Button({ type: ButtonType.Normal }) {
                Row({ space: 10 }) {
                  Text(this.answer()?.choiceId ? $r('app.string.clarify_supplement') : $r('app.string.clarify_custom'))
                    .fontSize(14).fontColor(p.secondaryText).layoutWeight(1)
                  SymbolGlyph(this.expandedCustomId === this.current()?.id || !!this.answer()?.text
                    ? $r('sys.symbol.chevron_down') : $r('sys.symbol.chevron_right'))
                    .fontSize(12).fontColor([p.tertiaryText])
                }.width('100%').padding({ left: 14, right: 14, top: 12, bottom: 12 })
              }.width('100%').constraintSize({ minHeight: 46 }).backgroundColor(Color.Transparent)
                .enabled(!this.locked())
                .onClick((): void => {
                  const id = this.current()?.id ?? '';
                  this.expandedCustomId = this.expandedCustomId === id ? '' : id;
                })
            }.width('100%').backgroundColor(p.grouped).borderRadius(14).clip(true)
          }

          if (this.current()?.type !== 'single_choice' || this.expandedCustomId === this.current()?.id || !!this.answer()?.text) {
            Column({ space: 6 }) {
              if (this.answer()?.choiceId) {
                Row() {
                  Text((this.current()?.choices ?? []).find((c: XopcClarificationChoice): boolean => c.id === this.answer()?.choiceId)?.label ?? '')
                    .fontSize(12).fontColor(p.secondaryText).maxLines(1).layoutWeight(1)
                  Button({ type: ButtonType.Normal }) {
                    Text($r('app.string.clarify_clear')).fontSize(12).fontColor(p.tertiaryText)
                  }.height(26).padding({ left: 6, right: 6 }).backgroundColor(Color.Transparent).enabled(!this.locked())
                    .onClick((): void => { this.update('', this.answer()?.text ?? ''); })
                }.width('100%')
              }
              TextArea({
                text: this.answer()?.text ?? '',
                placeholder: this.answer()?.choiceId ? $r('app.string.clarify_supplement') : $r('app.string.clarify_placeholder'),
              }).constraintSize({ minHeight: 72, maxHeight: 132 }).width('100%').fontSize(14).fontColor(p.primaryText)
                .backgroundColor(p.inputFill).borderRadius(12)
                .enabled(!this.locked())
                .onChange((text: string): void => { this.update(this.answer()?.choiceId ?? '', text); })
              if ((this.answer()?.text?.trim().length ?? 0) >= 1600) {
                Text((this.answer()?.text?.trim().length ?? 0).toString() + '/2000').fontSize(11)
                  .fontColor((this.answer()?.text?.trim().length ?? 0) > 2000 ? p.danger : p.tertiaryText).width('100%')
              }
            }.width('100%')
          }

          if (this.summaryText()) {
            Text('✓  ' + this.summaryText()).fontSize(12).fontColor(p.secondaryText)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
              .padding({ left: 12, right: 12, top: 8, bottom: 8 }).borderRadius(10).backgroundColor(p.grouped)
          }

          if (!this.complete() && this.allAnswered()) {
            Text($r('app.string.clarify_too_long')).fontSize(12).fontColor(p.danger).width('100%')
          }
          if (this.expired()) { Text($r('app.string.clarify_expired')).fontSize(12).fontColor(p.danger).width('100%') }
          if (this.errorMessage) { Text(this.errorMessage).fontSize(12).fontColor(p.danger).width('100%') }
        }.padding({ left: 16, right: 16, bottom: 12 }).width('100%')
      }.constraintSize({ maxHeight: 320 }).width('100%')

      if (this.questions().length > 1 || this.current()?.type !== 'single_choice'
        || this.expandedCustomId === this.current()?.id || !!this.answer()?.text
        || !!this.draft().pendingAction || this.submitting || this.complete()) {
        Row({ space: 10 }) {
          if (this.questions().length > 1 && this.index() > 0) {
            Button({ type: ButtonType.Normal }) {
              Text($r('app.string.clarify_previous')).fontSize(14).fontWeight(FontWeight.Medium).fontColor(p.tonalText)
            }.height(38).padding({ left: 14, right: 14 }).borderRadius(19).backgroundColor(p.tonalFill)
              .enabled(!this.disabled())
              .onClick((): void => { this.jumpTo(this.index() - 1); })
          }
          Blank().layoutWeight(1)
          if (this.questions().length > 1 && !this.complete() && this.index() < this.questions().length - 1 && !this.draft().pendingAction) {
            Button({ type: ButtonType.Normal }) {
              Text($r('app.string.clarify_next')).fontSize(14).fontWeight(FontWeight.Medium).fontColor(p.onAccent)
            }.height(38).padding({ left: 18, right: 18 }).borderRadius(19).backgroundColor(p.accent)
              .enabled(!this.disabled() && (!!this.current() && this.isAnswered(this.current()!)))
              .opacity((!this.disabled() && (!!this.current() && this.isAnswered(this.current()!))) ? 1 : 0.4)
              .onClick((): void => { this.jumpTo(this.index() + 1); })
          } else {
            Button({ type: ButtonType.Normal }) {
              Text(this.submitting
                ? $r('app.string.clarify_submitting')
                : (this.draft().pendingAction ? $r('app.string.clarify_retry') : $r('app.string.clarify_confirm')))
                .fontSize(14).fontWeight(FontWeight.Medium).fontColor(p.onAccent)
            }.height(38).padding({ left: 20, right: 20 }).borderRadius(19).backgroundColor(p.accent)
              .enabled(!this.disabled() && (this.complete() || !!this.draft().pendingAction))
              .opacity((!this.disabled() && (this.complete() || !!this.draft().pendingAction)) ? 1 : 0.4)
              .onClick((): void => { this.submit(this.draft().pendingAction ?? 'answer'); })
          }
        }.width('100%').padding({ left: 16, right: 16, top: 10, bottom: 10 })
      }
    }.width('100%').backgroundColor(p.surface).borderRadius(this.colors.corner(20))
  }
}
