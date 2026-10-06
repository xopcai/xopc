import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatOptionsViewModel } from '../viewmodel/chatOptionsViewModel';
import { XopcChatModel, XopcChatAgent, XopcQueuedInput } from '../model/chat';
import { XopcHubRow, XopcListSkeleton } from './MobileComponents';
import { appSettings } from '../service/settings';
import { userErrorMessage } from '../common/userError';

@ComponentV2
export struct XopcChatOptions {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param model: XopcChatOptionsViewModel = new XopcChatOptionsViewModel();
  @Param mode: string = 'actions';
  @Param contextSummary: ResourceStr = '';
  @Param thinkingBusy: boolean = false;
  @Event onMode: (mode: string) => void = (_mode: string): void => {};
  @Event onContext: () => void = (): void => {};
  @Event onAgent: (id: string) => void = (_id: string): void => {};
  @Event onFiles: () => void = (): void => {};
  @Event onEditQueued: (input: XopcQueuedInput) => void = (_input: XopcQueuedInput): void => {};
  @Event onNewChat: () => void = (): void => {};
  @Event onClose: () => void = (): void => {};
  @Event onRetry: () => void = (): void => {};
  @Local query: string = '';

  private queueImage(item: XopcQueuedInput): string {
    const image = item.attachments?.find((attachment): boolean => attachment.mimeType.startsWith('image/'));
    if (!image) return '';
    if (image.data) return 'data:' + image.mimeType + ';base64,' + image.data;
    return image.uri?.startsWith('http') || image.uri?.startsWith('file:') || image.uri?.startsWith('data:') ? image.uri : '';
  }
  private thinkingLabel(level: string): ResourceStr {
    if (level === 'off') return $r('app.string.chat_thinking_off');
    if (level === 'minimal') return $r('app.string.chat_thinking_minimal');
    if (level === 'low') return $r('app.string.chat_thinking_low');
    if (level === 'medium') return $r('app.string.chat_thinking_medium');
    if (level === 'high') return $r('app.string.chat_thinking_high');
    if (level === 'xhigh') return $r('app.string.chat_thinking_xhigh');
    if (level === 'max') return $r('app.string.chat_thinking_max');
    return level;
  }
  private thinkingSummary(): ResourceStr {
    const mode = this.model.selectedModel()?.thinking?.mode;
    if (mode === 'none' || !mode) return $r('app.string.chat_thinking_unsupported');
    if (mode === 'fixed') return $r('app.string.chat_thinking_fixed');
    return this.thinkingLabel(this.model.thinkingLevel);
  }

  build() {
    Column({ space: 8 }) {
      Row() {
        Text(this.mode === 'model' ? $r('app.string.chat_model') : this.mode === 'thinking' ? $r('app.string.chat_thinking_effort')
          : this.mode === 'agent' ? $r('app.string.chat_agent')
          : this.mode === 'queue' ? $r('app.string.chat_queue') : $r('app.string.chat_actions'))
          .fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).layoutWeight(1)
        Button('×').width(44).height(44).padding(0).fontSize(28).backgroundColor(Color.Transparent)
          .fontColor(this.colors.secondary).accessibilityText($r('app.string.chat_close')).onClick((): void => { this.onClose(); })
      }.width('100%')
      if (this.mode === 'model' || this.mode === 'agent') {
        TextInput({ text: this.query, placeholder: $r('app.string.search') }).onChange((value: string): void => { this.query = value; })
      }
      if (this.model.loading) { XopcListSkeleton() }
      if (this.model.error && this.mode !== 'queue') {
        Text(userErrorMessage(this.model.error, 'collection')).fontColor(this.colors.secondary)
        Button($r('app.string.refresh')).onClick((): void => { this.onRetry(); })
      }
      List({ space: this.mode === 'actions' ? 0 : 8 }) {
        if (this.mode === 'model') {
          ForEach(this.model.models.filter((item: XopcChatModel): boolean => (item.name + ' ' + item.id).toLowerCase().includes(this.query.toLowerCase())), (item: XopcChatModel) => {
            ListItem() {
              XopcHubRow({ heading: (item.id === this.model.modelId ? '✓ ' : '') + (item.displayNames?.[appSettings.effectiveLanguage().startsWith('zh') ? 'zh-CN' : 'en'] || item.name || item.id),
                summary: item.id, showChevron: false, onOpen: async (): Promise<void> => { if (await this.model.selectModel(item.id)) this.onClose(); } })
            }.enabled(!this.model.saving)
          }, (item: XopcChatModel): string => item.id)
        } else if (this.mode === 'thinking') {
          if (this.model.selectedModel()?.thinking?.mode === 'levels' || this.model.selectedModel()?.thinking?.mode === 'toggle') {
            ForEach(this.model.selectedModel()?.thinking?.options || [], (level: string) => {
              ListItem() {
                XopcHubRow({ heading: this.thinkingLabel(level),
                  summary: level === this.model.thinkingLevel ? $r('app.string.chat_thinking_selected') : '',
                  onOpen: async (): Promise<void> => { if (await this.model.selectThinking(level)) this.onClose(); } })
              }.enabled(!this.model.loading && !this.model.saving && !this.thinkingBusy)
            }, (level: string): string => level)
          } else {
            ListItem() { Text(this.thinkingSummary()).fontColor(this.colors.secondary).padding(12) }
          }
        } else if (this.mode === 'agent') {
          ForEach(this.model.agents.filter((item: XopcChatAgent): boolean => (item.name + ' ' + item.id).toLowerCase().includes(this.query.toLowerCase())), (item: XopcChatAgent) => {
            ListItem() { XopcHubRow({ heading: (item.id === this.model.agentId ? '✓ ' : '') + (item.name || item.id), summary: item.description || item.id,
              onOpen: (): void => { this.onAgent(item.id); } }) }
          }, (item: XopcChatAgent): string => item.id)
        } else if (this.mode === 'queue') {
          if (this.model.queueError) {
            ListItem() {
              Column({ space: 8 }) {
                Text(userErrorMessage(this.model.queueError, 'save')).fontColor(this.colors.danger)
                Button($r('app.string.retry')).enabled(!this.model.queueBusy).onClick((): void => { this.model.retryQueue(); })
              }
            }
          }
          ForEach(this.model.queued, (item: XopcQueuedInput, index: number) => {
            ListItem() {
              Column({ space: 8 }) {
                Row({ space: 10 }) {
                  if (this.queueImage(item)) {
                    Image(this.queueImage(item)).width(52).height(52).borderRadius(10).objectFit(ImageFit.Cover)
                      .sourceSize({ width: 104, height: 104 })
                  } else if (item.attachments?.length) {
                    SymbolGlyph($r('sys.symbol.paperclip')).fontSize(22).fontColor([this.colors.secondary])
                      .width(52).height(52)
                  }
                  Column({ space: 4 }) {
                    Text(item.content || $r('app.string.add_attachment')).fontColor(this.colors.foreground).width('100%')
                      .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                    if (item.attachments?.length || item.contextRefs?.length) {
                      Text((item.attachments?.length ? '📎 ' + item.attachments.length : '')
                        + (item.attachments?.length && item.contextRefs?.length ? '  ·  ' : '')
                        + (item.contextRefs?.length ? '@ ' + item.contextRefs.length : ''))
                        .fontSize(12).fontColor(this.colors.secondary)
                    }
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                }.width('100%')
                Row({ space: 4 }) {
                  Button('↑').enabled(!this.model.queueBusy && index > 0).height(40).backgroundColor(Color.Transparent)
                    .onClick((): void => { this.model.updateQueued(item, { position: index - 1 }); })
                  Button('↓').enabled(!this.model.queueBusy && index < this.model.queued.length - 1).height(40).backgroundColor(Color.Transparent)
                    .onClick((): void => { this.model.updateQueued(item, { position: index + 1 }); })
                  Blank()
                  Button($r('app.string.chat_edit')).enabled(!this.model.queueBusy).height(40).backgroundColor(Color.Transparent)
                    .onClick((): void => { this.onEditQueued(item); })
                  Button($r('app.string.cancel')).enabled(!this.model.queueBusy).height(40).backgroundColor(Color.Transparent)
                    .onClick((): void => { this.model.cancelQueued(item); })
                }.width('100%')
              }.width('100%').padding(12).borderRadius(12).backgroundColor(this.colors.grouped)
            }
          }, (item: XopcQueuedInput): string => item.id)
          if (!this.model.queued.length && !this.model.queueError) { ListItem() { Text($r('app.string.chat_queue_empty')).fontColor(this.colors.secondary).padding(24) } }
        } else {
          ListItem() { XopcHubRow({ heading: $r('app.string.chat_context'), summary: this.contextSummary,
            compact: true, symbol: $r('sys.symbol.link'), onOpen: (): void => { this.onContext(); } }) }
          ListItem() { XopcHubRow({ heading: $r('app.string.chat_agent'), summary: this.model.agentName(), compact: true, onOpen: (): void => { this.onMode('agent'); } }) }
          ListItem() { XopcHubRow({ heading: $r('app.string.chat_model'), summary: this.model.modelName(appSettings.effectiveLanguage()), compact: true, onOpen: (): void => { this.onMode('model'); } }) }
          ListItem() { XopcHubRow({ heading: $r('app.string.chat_thinking_effort'), summary: this.thinkingSummary(), compact: true,
            onOpen: (): void => { this.onMode('thinking'); } }) }
          ListItem() { XopcHubRow({ heading: $r('app.string.new_chat'), compact: true, symbol: $r('sys.symbol.square_and_pencil'), onOpen: (): void => { this.onNewChat(); } }) }
          ListItem() { XopcHubRow({ heading: $r('app.string.chat_session_files'), compact: true, symbol: $r('sys.symbol.folder'), onOpen: (): void => { this.onFiles(); } }) }
        }
      }.layoutWeight(1).width('100%')
    }.padding({ left: 20, right: 20, top: 4, bottom: 16 }).width('100%').height('100%').backgroundColor(this.colors.panel)
  }
}
