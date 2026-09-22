import { XopcChatOptionsViewModel } from '../viewmodel/chatOptionsViewModel';
import { XopcChatModel, XopcChatAgent, XopcQueuedInput } from '../model/chat';
import { XopcHubRow, XopcListSkeleton } from './MobileComponents';
import { appSettings } from '../service/settings';

@ComponentV2
export struct XopcChatOptions {
  @Param model: XopcChatOptionsViewModel = new XopcChatOptionsViewModel();
  @Param mode: string = 'actions';
  @Param continuousRead: boolean = false;
  @Event onContinuousRead: () => void = (): void => {};
  @Event onMode: (mode: string) => void = (_mode: string): void => {};
  @Event onAgent: (id: string) => void = (_id: string): void => {};
  @Event onFiles: () => void = (): void => {};
  @Event onNewChat: () => void = (): void => {};
  @Event onClose: () => void = (): void => {};
  @Event onRetry: () => void = (): void => {};
  @Local query: string = '';
  @Local editing: string = '';
  @Local editText: string = '';

  build() {
    Column({ space: 12 }) {
      Row() {
        Text(this.mode === 'model' ? $r('app.string.chat_model') : this.mode === 'agent' ? $r('app.string.chat_agent')
          : this.mode === 'queue' ? $r('app.string.chat_queue') : $r('app.string.chat_actions'))
          .fontSize(22).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground')).layoutWeight(1)
        Button('×').width(44).height(44).padding(0).fontSize(28).backgroundColor(Color.Transparent)
          .fontColor($r('app.color.secondary')).accessibilityText($r('app.string.chat_close')).onClick((): void => { this.onClose(); })
      }.width('100%')
      if (this.mode === 'model' || this.mode === 'agent') {
        TextInput({ text: this.query, placeholder: $r('app.string.search') }).onChange((value: string): void => { this.query = value; })
      }
      if (this.model.loading) { XopcListSkeleton() }
      if (this.model.error && this.mode !== 'queue') {
        Text(this.model.error).fontColor($r('app.color.danger'))
        Button($r('app.string.refresh')).onClick((): void => { this.onRetry(); })
      }
      List({ space: 8 }) {
        if (this.mode === 'model') {
          ForEach(this.model.models.filter((item: XopcChatModel): boolean => (item.name + ' ' + item.id).toLowerCase().includes(this.query.toLowerCase())), (item: XopcChatModel) => {
            ListItem() {
              XopcHubRow({ heading: (item.id === this.model.modelId ? '✓ ' : '') + (item.displayNames?.[appSettings.effectiveLanguage().startsWith('zh') ? 'zh-CN' : 'en'] || item.name || item.id),
                summary: item.id, navigable: false, onOpen: async (): Promise<void> => { if (await this.model.selectModel(item.id)) this.onClose(); } })
            }.enabled(!this.model.saving)
          }, (item: XopcChatModel): string => item.id)
        } else if (this.mode === 'agent') {
          ForEach(this.model.agents.filter((item: XopcChatAgent): boolean => (item.name + ' ' + item.id).toLowerCase().includes(this.query.toLowerCase())), (item: XopcChatAgent) => {
            ListItem() { XopcHubRow({ heading: (item.id === this.model.agentId ? '✓ ' : '') + (item.name || item.id), summary: item.description || item.id,
              onOpen: (): void => { this.onAgent(item.id); } }) }
          }, (item: XopcChatAgent): string => item.id)
        } else if (this.mode === 'queue') {
          if (this.model.queueError) {
            ListItem() {
              Column({ space: 8 }) {
                Text(this.model.queueError).fontColor($r('app.color.danger'))
                Button($r('app.string.refresh')).onClick((): void => { this.model.refreshQueue(); })
              }
            }
          }
          ForEach(this.model.queued, (item: XopcQueuedInput) => {
            ListItem() {
              Column({ space: 8 }) {
                if (this.editing === item.id) {
                  TextArea({ text: this.editText }).constraintSize({ minHeight: 80, maxHeight: 180 })
                    .onChange((value: string): void => { this.editText = value; })
                  Row({ space: 8 }) {
                    Button($r('app.string.cancel')).onClick((): void => { this.editing = ''; })
                    Button($r('app.string.save')).enabled(!this.model.queueBusy && !!this.editText.trim())
                      .onClick(async (): Promise<void> => { if (await this.model.changeQueued(item, this.editText)) this.editing = ''; })
                  }
                } else {
                  Text(item.content || $r('app.string.add_attachment')).fontColor($r('app.color.foreground')).width('100%')
                  Row({ space: 8 }) {
                    Button($r('app.string.chat_edit')).enabled(!this.model.queueBusy).onClick((): void => { this.editing = item.id; this.editText = item.content; })
                    Button($r('app.string.cancel')).enabled(!this.model.queueBusy).onClick((): void => { this.model.changeQueued(item); })
                  }
                }
              }.width('100%').padding(12).borderRadius(12).backgroundColor($r('app.color.grouped'))
            }
          }, (item: XopcQueuedInput): string => item.id)
          if (!this.model.queued.length && !this.model.queueError) { ListItem() { Text($r('app.string.chat_queue_empty')).fontColor($r('app.color.secondary')).padding(24) } }
        } else {
          ListItem() { XopcHubRow({ heading: $r('app.string.chat_agent'), summary: this.model.agentName(), onOpen: (): void => { this.onMode('agent'); } }) }
          ListItem() { XopcHubRow({ heading: $r('app.string.chat_model'), summary: this.model.modelName(appSettings.effectiveLanguage()), onOpen: (): void => { this.onMode('model'); } }) }
          ListItem() { XopcHubRow({ heading: $r('app.string.new_chat'), onOpen: (): void => { this.onNewChat(); } }) }
          ListItem() { XopcHubRow({ heading: $r('app.string.chat_session_files'), onOpen: (): void => { this.onFiles(); } }) }
          ListItem() { XopcHubRow({ heading: this.continuousRead ? $r('app.string.chat_continuous_stop') : $r('app.string.chat_continuous_start'), onOpen: (): void => { this.onContinuousRead(); } }) }
        }
      }.layoutWeight(1).width('100%')
    }.padding({ left: 24, right: 24, top: 8, bottom: 24 }).width('100%').height('100%').backgroundColor($r('app.color.panel'))
  }
}
