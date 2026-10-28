import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcShareIntake, shareIntake } from '../service/shareIntake';
import { XopcIncomingShare, XopcIncomingShareAttachment } from '../model/share';
import { XopcSessionItem } from '../model/chat';
import { XopcChatRepository } from '../repository/chatRepository';

@ComponentV2
export struct XopcShareIntakeDialog {
  @Param currentConversationId: string = '';
  @Local colors: XopcThemeColors = appThemeColors;
  @Event onExplore: (value: XopcIncomingShare, targetId: string) => Promise<boolean> = async (_value: XopcIncomingShare, _id: string): Promise<boolean> => false;
  @Event onSaved: (noteId: string) => void = (_noteId: string): void => {};
  @Local intake: XopcShareIntake = shareIntake;
  @Local saving: boolean = false;
  @Local error: string = '';
  @Local selectedTarget: string = '';
  @Local query: string = '';
  @Local sessions: XopcSessionItem[] = [];
  @Local searching: boolean = false;
  private repository: XopcChatRepository = new XopcChatRepository();
  private searchGeneration: number = 0;

  @Monitor('intake.revision')
  onIntakeChange(): void {
    this.selectedTarget = this.intake.pending?.targetConversationId ?? ''; this.error = ''; this.query = '';
    if (this.intake.pending) void this.search();
  }
  aboutToAppear(): void { this.onIntakeChange(); }
  private async search(): Promise<void> {
    const generation = ++this.searchGeneration; this.searching = true;
    try {
      const page = await this.repository.list(this.query, 0, 30, '');
      if (generation === this.searchGeneration) this.sessions = page.items.filter((item: XopcSessionItem): boolean => item.status !== 'archived');
    } catch (error) { if (generation === this.searchGeneration) this.error = (error as Error).message; }
    finally { if (generation === this.searchGeneration) this.searching = false; }
  }
  private async explore(): Promise<void> {
    const incoming = this.intake.pending; if (!incoming || this.saving) return;
    this.saving = true; this.error = '';
    try { if (!await this.onExplore(incoming, this.selectedTarget)) this.error = 'Unable to add files. Please retry.'; }
    catch (error) { this.error = (error as Error).message; }
    finally { this.saving = false; }
  }
  private async saveNote(): Promise<void> {
    if (this.saving) return;
    this.saving = true; this.error = '';
    try { const id = await this.intake.save(); if (id) this.onSaved(id); }
    catch (error) { this.error = (error as Error).message; }
    finally { this.saving = false; }
  }
  @Builder targetOption(id: string, label: string) {
    Button((this.selectedTarget === id ? '● ' : '○ ') + label).width('100%').height(48)
      .backgroundColor(this.selectedTarget === id ? this.colors.accentSoft : this.colors.input)
      .fontColor(this.colors.foreground).enabled(!this.saving && !this.intake.pending?.targetConversationId)
      .onClick((): void => { this.selectedTarget = id; })
  }
  build() {
    if (this.intake.pending) {
      Stack({ alignContent: Alignment.Bottom }) {
        Column().width('100%').height('100%').backgroundColor('#66000000')
        Column({ space: 12 }) {
          Text($r('app.string.intake_chat_title')).fontSize(19).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
          Scroll() {
            Column({ space: 10 }) {
              if (this.intake.pending.preview) {
                Text(this.intake.pending.preview).fontSize(14).fontColor(this.colors.secondary).maxLines(4).width('100%')
              }
              ForEach(this.intake.pending.attachments ?? [], (file: XopcIncomingShareAttachment): void => {
                Row({ space: 8 }) {
                  Text(file.name + ' · ' + Math.ceil(file.size / 1024) + ' KB').fontSize(14).fontColor(this.colors.foreground).layoutWeight(1)
                  Button('×').width(44).height(44).enabled(!this.saving).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
                    .accessibilityText($r('app.string.remove_attachment')).onClick((): void => {
                      this.intake.removeAttachment(file.path).catch((error: Error): void => { this.error = error.message; });
                    })
                }.padding(12).width('100%').backgroundColor(this.colors.input).borderRadius(10)
              }, (file: XopcIncomingShareAttachment): string => file.path)
              ForEach(this.intake.pending.issues ?? [], (issue: string): void => {
                Text(issue).fontSize(12).fontColor(this.colors.danger).width('100%')
              }, (issue: string): string => issue)
              this.targetOption('', this.getUIContext().getHostContext()?.resourceManager.getStringSync($r('app.string.intake_new_chat').id) ?? 'New conversation')
              if (this.currentConversationId) { this.targetOption(this.currentConversationId, this.getUIContext().getHostContext()?.resourceManager.getStringSync($r('app.string.intake_current_chat').id) ?? 'Current conversation') }
              TextInput({ placeholder: $r('app.string.intake_search_chat'), text: this.query }).height(48)
                .enabled(!this.saving).onChange((text: string): void => { this.query = text; void this.search(); })
              if (this.searching) {
                Column().width('100%').height(48).backgroundColor(this.colors.input).borderRadius(10)
              } else {
                ForEach(this.sessions, (session: XopcSessionItem): void => {
                  this.targetOption(session.key, (session.name || session.title || session.key) + ' · ' + (session.agentId || ''))
                }, (session: XopcSessionItem): string => session.key)
              }
              if (this.error || this.intake.persistenceError) { Text(this.error || this.intake.persistenceError).fontSize(12).fontColor(this.colors.danger).width('100%') }
            }.width('100%')
          }.layoutWeight(1).width('100%')
          Text($r('app.string.intake_draft_hint')).fontSize(12).fontColor(this.colors.secondary).width('100%')
          Button($r('app.string.intake_add_chat')).width('100%').height(50).enabled(!this.saving && (!!this.intake.pending.attachments?.length || !!this.intake.pending.sharedText))
            .backgroundColor(this.colors.accent).fontColor(Color.White).onClick((): void => { void this.explore(); })
          Button($r('app.string.share_intake_save')).width('100%').height(44).enabled(!this.saving && (!!this.intake.pending.attachments?.length || !!this.intake.pending.sharedText))
            .backgroundColor(this.colors.input).fontColor(this.colors.foreground).onClick((): void => { void this.saveNote(); })
          Button($r('app.string.dismiss')).width('100%').height(44).enabled(!this.saving).backgroundColor(Color.Transparent)
            .fontColor(this.colors.secondary).onClick((): void => { this.intake.dismiss(); })
        }.width('100%').height('90%').padding(20).borderRadius({ topLeft: 20, topRight: 20 }).backgroundColor(this.colors.panel)
      }.width('100%').height('100%').zIndex(100)
    }
  }
}
