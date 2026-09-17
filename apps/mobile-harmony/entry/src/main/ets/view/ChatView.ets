import { XopcChatViewModel } from '../viewmodel/chatViewModel';
import { XopcChatRow, XopcSessionItem, XopcChatAttachment } from '../model/chat';
import { common } from '@kit.AbilityKit';
import { voiceCapture, XopcVoiceCapture } from '../service/voiceCapture';
import { appSettings } from '../service/settings';
import { XopcMarkdownView } from './MarkdownView';
import { pickChatAttachment } from '../service/chatAttachmentPicker';

@ComponentV2
export struct XopcChatView {
  @Param initialId: string = '';
  @Local chat: XopcChatViewModel = new XopcChatViewModel();
  @Local draft: string = '';
  @Local search: string = '';
  @Local rename: string = '';
  @Local showActions: boolean = false;
  @Local voice: XopcVoiceCapture = voiceCapture;
  @Local attachments: XopcChatAttachment[] = [];
  @Local pickingAttachment: boolean = false;
  private visible: boolean = false;

  aboutToAppear(): void { this.visible = true; this.chat.start(this.initialId); }
  @Monitor('initialId')
  onTargetChange(): void {
    if (this.initialId && this.initialId !== this.chat.selectedId) {
      this.voice.cancel(); this.draft = ''; this.attachments = []; this.showActions = false; this.chat.open(this.initialId);
    }
  }
  aboutToDisappear(): void { this.visible = false; this.chat.dispose(); this.voice.cancel(); this.attachments = []; }

  private async addAttachment(): Promise<void> {
    if (this.pickingAttachment || this.chat.sending) return;
    const id = this.chat.selectedId; const context = this.getUIContext().getHostContext();
    if (!id || !context) return;
    this.pickingAttachment = true;
    try {
      const file = await pickChatAttachment(context, this.attachments);
      if (file && this.visible && id === this.chat.selectedId) this.attachments = this.attachments.concat([file]);
    } catch (error) { if (this.visible && id === this.chat.selectedId) this.chat.error = (error as Error).message; }
    finally { this.pickingAttachment = false; }
  }

  private async transcribe(): Promise<void> {
    const conversationId = this.chat.selectedId;
    const result = await this.voice.transcribe(appSettings.language.startsWith('zh') ? 'zh'
      : appSettings.language.startsWith('en') ? 'en' : '');
    if (result && this.chat.selectedId === conversationId) this.draft = this.draft ? this.draft + '\n' + result : result;
  }

  private async confirm(action: string): Promise<void> {
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: this.getUIContext().getHostContext()?.resourceManager.getStringSync($r('app.string.confirm_change').id),
        message: this.getUIContext().getHostContext()?.resourceManager.getStringSync($r('app.string.confirm_change_help').id),
        buttons: [
          { text: $r('app.string.cancel'), color: $r('app.color.secondary') },
          { text: $r('app.string.confirm'), color: $r('app.color.danger') }
        ]
      });
      if (result.index === 1) await this.chat.action(action);
    } catch (error) { this.chat.error = (error as Error).message; }
  }

  @Builder
  skeleton() {
    Column({ space: 16 }) {
      ForEach([0, 1, 2, 3], (index: number) => {
        Column() {}.width(index % 2 === 0 ? '90%' : '70%').height(64).borderRadius(12)
          .backgroundColor($r('app.color.panel'))
      }, (index: number): string => index.toString())
    }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
  }

  @Builder
  sessionList() {
    Row({ space: 8 }) {
      TextInput({ text: this.search, placeholder: $r('app.string.search') })
        .layoutWeight(1).onChange((value: string): void => { this.search = value; })
        .onSubmit((): void => { this.chat.loadList(this.search); })
      Button($r('app.string.refresh')).onClick((): void => { this.chat.loadList(this.search); })
    }.padding({ left: 16, right: 16, bottom: 12 })
    if (this.chat.loading && this.chat.sessions.length === 0) { this.skeleton() }
    List({ space: 8 }) {
      ForEach(this.chat.sessions, (session: XopcSessionItem) => {
        ListItem() {
          Column({ space: 6 }) {
            Text(session.displayName ?? session.name ?? session.title ?? $r('app.string.untitled'))
              .fontSize(17).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground')).maxLines(2)
            Text(session.updatedAt).fontSize(12).fontColor($r('app.color.secondary'))
          }.alignItems(HorizontalAlign.Start).width('100%').padding(16).borderRadius(12)
            .backgroundColor($r('app.color.panel')).onClick((): void => { this.draft = ''; this.attachments = []; this.chat.open(session.key); })
        }
      }, (session: XopcSessionItem): string => session.key)
      if (this.chat.hasMore) {
        ListItem() { Button($r('app.string.load_more')).onClick((): void => { this.chat.loadList(this.search, true); }) }
      }
      if (!this.chat.loading && this.chat.sessions.length === 0) {
        ListItem() { Text($r('app.string.no_conversations')).fontColor($r('app.color.secondary')).padding(24) }
      }
    }.layoutWeight(1).width('100%').padding({ left: 16, right: 16 })
  }

  @Builder
  conversation() {
    if (this.showActions) {
      Column({ space: 8 }) {
        Row({ space: 8 }) {
          TextInput({ text: this.rename, placeholder: $r('app.string.name') })
            .layoutWeight(1).onChange((value: string): void => { this.rename = value; })
          Button($r('app.string.save')).enabled(this.rename.trim().length > 0)
            .onClick((): void => { this.chat.rename(this.rename.trim()); })
        }
        Row({ space: 8 }) {
          Button(this.chat.status === 'pinned' ? $r('app.string.unpin') : $r('app.string.pin'))
            .onClick((): void => { this.chat.action(this.chat.status === 'pinned' ? 'unpin' : 'pin'); })
          Button(this.chat.status === 'archived' ? $r('app.string.unarchive') : $r('app.string.archive'))
            .onClick((): void => { this.confirm(this.chat.status === 'archived' ? 'unarchive' : 'archive'); })
          Button($r('app.string.reset')).onClick((): void => { this.confirm('reset'); })
          Button($r('app.string.delete')).onClick((): void => { this.confirm('delete'); })
        }
      }.padding(12)
    }
    if (this.chat.loading) { this.skeleton() }
    List({ space: 16 }) {
      if (this.chat.hasOlder) {
        ListItem() { Button($r('app.string.older_messages')).onClick((): void => { this.chat.loadHistory(true); }) }
      }
      ForEach(this.chat.rows, (row: XopcChatRow) => {
        ListItem() {
          Column({ space: 8 }) {
            Text(row.role).fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.secondary'))
            XopcMarkdownView({ content: row.text })
          }.width('100%').padding(16).alignItems(HorizontalAlign.Start).borderRadius(12)
            .backgroundColor(row.role === 'user' ? $r('app.color.panel') : $r('app.color.surface'))
        }
      }, (row: XopcChatRow): string => row.id)
      if (this.chat.thinking) {
        ListItem() { Text(this.chat.thinking).fontSize(13).fontColor($r('app.color.secondary')).padding(16) }
      }
      if (this.chat.streaming) {
        ListItem() { Text(this.chat.streaming).fontSize(16).fontColor($r('app.color.foreground')).padding(16) }
      }
      if (this.chat.tool) {
        ListItem() { Text(this.chat.tool).fontColor($r('app.color.secondary')).padding(16) }
      }
    }.layoutWeight(1).width('100%').padding({ left: 12, right: 12 })
    if (this.chat.runId) {
      Button($r('app.string.stop')).onClick((): void => { this.chat.abort(); }).margin(8)
    }
    if (this.attachments.length) {
      Scroll() {
        Column({ space: 4 }) {
          ForEach(this.attachments, (file: XopcChatAttachment, index: number) => {
            Row({ space: 8 }) {
              Text(file.name).layoutWeight(1).maxLines(1).fontColor($r('app.color.foreground'))
              Button($r('app.string.remove_attachment')).enabled(!this.chat.sending)
                .onClick((): void => { this.attachments = this.attachments.filter((_file: XopcChatAttachment, i: number): boolean => i !== index); })
            }.width('100%')
          }, (file: XopcChatAttachment, index: number): string => index.toString() + ':' + file.name)
        }.padding(8)
      }.width('100%').constraintSize({ maxHeight: 120 })
    }
    if (this.voice.error) { Text(this.voice.error).fontColor($r('app.color.danger')).padding(8) }
    Row({ space: 8 }) {
      Button($r('app.string.add_attachment')).enabled(!this.pickingAttachment && !this.chat.sending && this.attachments.length < 10)
        .onClick((): void => { this.addAttachment(); })
      if (this.voice.state === 'idle') {
        Button($r('app.string.record_voice')).enabled(!this.voice.busy && !this.chat.sending)
          .onClick((): void => { this.voice.start(this.getUIContext().getHostContext() as common.UIAbilityContext); })
      } else if (this.voice.state === 'recording') {
        Text(this.voice.seconds.toString() + ' / 120 s').fontColor($r('app.color.danger'))
        Button($r('app.string.stop_recording')).enabled(!this.voice.busy).onClick((): void => { this.voice.stop(); })
      } else if (this.voice.state === 'ready') {
        Button($r('app.string.play_recording')).enabled(!this.voice.busy).onClick((): void => { this.voice.play(); })
        Button($r('app.string.transcribe')).enabled(!this.voice.busy).onClick((): void => { this.transcribe(); })
      } else if (this.voice.state === 'playing') {
        Button($r('app.string.stop')).enabled(!this.voice.busy).onClick((): void => { this.voice.stopPlayback(); })
      } else { Text($r('app.string.voice_working')).fontColor($r('app.color.secondary')) }
      if (this.voice.state !== 'idle') {
        Button($r('app.string.cancel')).onClick((): void => { this.voice.cancel(); })
      }
    }.width('100%').padding({ left: 12, right: 12 })
    Row({ space: 8 }) {
      TextArea({ text: this.draft, placeholder: $r('app.string.message_hint') })
        .layoutWeight(1).height(90).enabled(!this.chat.sending)
        .onChange((value: string): void => { this.draft = value; })
      Button($r('app.string.send')).enabled(!this.pickingAttachment && this.voice.state === 'idle' && !this.voice.busy && !this.chat.sending && !this.chat.runId && this.chat.connection === 'connected' && (this.draft.trim().length > 0 || this.attachments.length > 0))
        .onClick(async (): Promise<void> => { if (await this.chat.send(this.draft, this.attachments)) { this.draft = ''; this.attachments = []; } })
    }.padding(12).width('100%')
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        if (this.chat.selectedId) {
          Button($r('app.string.back')).enabled(!this.chat.sending && !this.pickingAttachment)
            .onClick((): void => { this.voice.cancel(); this.chat.back(); this.showActions = false; this.attachments = []; })
        }
        Text(this.chat.selectedId ? this.chat.title || $r('app.string.untitled') : $r('app.string.conversations'))
          .layoutWeight(1).fontSize(22).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground')).maxLines(1)
        if (this.chat.selectedId) {
          Button('···').onClick((): void => { this.showActions = !this.showActions; this.rename = this.chat.title; })
        } else {
          Button($r('app.string.new_chat')).enabled(!this.chat.loading).onClick((): void => { this.draft = ''; this.attachments = []; this.chat.create(); })
        }
      }.width('100%').padding(16)
      if (this.chat.connection !== 'connected') {
        Text(this.chat.connection === 'unauthorized' ? $r('app.string.connection_revoked')
          : this.chat.connection === 'protocol_incompatible' ? $r('app.string.protocol_incompatible')
          : this.chat.connection.startsWith('error:') ? this.chat.connection : $r('app.string.reconnecting'))
          .fontSize(12).fontColor($r('app.color.secondary')).padding(8)
      }
      if (this.chat.error) {
        Text(this.chat.error).fontColor($r('app.color.danger')).padding(12)
      }
      if (this.chat.selectedId) { this.conversation() } else { this.sessionList() }
    }.width('100%').height('100%').backgroundColor($r('app.color.surface'))
  }
}
