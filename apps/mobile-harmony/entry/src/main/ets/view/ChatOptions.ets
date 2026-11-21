import { capabilityText } from '../common/capabilityText';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatOptionsViewModel } from '../viewmodel/chatOptionsViewModel';
import { XopcChatModel, XopcChatAgent } from '../model/chat';
import { XopcHubRow, XopcListSkeleton } from './MobileComponents';
import { appSettings } from '../service/settings';
import { userErrorMessage } from '../common/userError';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { XopcPersonalAgentRecord } from '../model/personalAgent';
import { agentDisplayDescription, agentDisplayName } from '../common/agentPresentation';

function chatThinkingLabel(level: string): ResourceStr {
  if (level === 'off') return $r('app.string.chat_thinking_off');
  if (level === 'minimal') return $r('app.string.chat_thinking_minimal');
  if (level === 'low') return $r('app.string.chat_thinking_low');
  if (level === 'medium') return $r('app.string.chat_thinking_medium');
  if (level === 'high') return $r('app.string.chat_thinking_high');
  if (level === 'xhigh') return $r('app.string.chat_thinking_xhigh');
  if (level === 'max') return $r('app.string.chat_thinking_max');
  return level;
}

function chatThinkingSummary(model: XopcChatOptionsViewModel): ResourceStr {
  const mode = model.selectedModel()?.thinking?.mode;
  if (mode === 'none' || !mode) return $r('app.string.chat_thinking_unsupported');
  if (mode === 'fixed') return $r('app.string.chat_thinking_fixed');
  return chatThinkingLabel(model.thinkingLevel);
}

@ComponentV2
export struct XopcChatOptions {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param model: XopcChatOptionsViewModel = new XopcChatOptionsViewModel();
  @Param personal: boolean = false;
  @Param personalRecord: XopcPersonalAgentRecord | null = null;
  @Param mode: string = 'actions';
  @Param skillLabels: Map<string, string> = new Map<string, string>();
  @Param contextSummary: ResourceStr = '';
  @Param thinkingBusy: boolean = false;
  @Param modelBusy: boolean = false;
  @Param rememberModel: boolean = true;
  @Event onMode: (mode: string) => void = (_mode: string): void => {};
  @Param canShare: boolean = false;
  @Event onShare: () => void = (): void => {};
  @Event onSearch: () => void = (): void => {};
  @Event onContext: () => void = (): void => {};
  @Event onAgent: (id: string) => void = (_id: string): void => {};
  @Event onFiles: () => void = (): void => {};
  @Event onNewChat: () => void = (): void => {};
  @Event onClose: () => void = (): void => {};
  @Event onRetry: () => void = (): void => {};
  @Local query: string = '';

  private thinkingSummary(): ResourceStr {
    return chatThinkingSummary(this.model);
  }

  private preparationErrorMessage(): ResourceStr {
    const error = this.model.preparationError;
    if (this.model.preparation?.state === 'preparation_failed') {
      if (error.startsWith('Repository has uncommitted changes:')) return $r('app.string.chat_worktree_dirty');
      if (error.startsWith('git rev-parse failed:')) return $r('app.string.chat_worktree_git_unavailable');
      if (error === 'Project workspace is unavailable' || error.startsWith('Local checkout does not exist:')) {
        return $r('app.string.chat_project_folder_unavailable');
      }
      if (error === this.model.preparation?.lastError || error === 'SESSION_PREPARATION_FAILED') {
        return $r('app.string.chat_project_preparation_failed');
      }
    }
    return userErrorMessage(error, 'save');
  }

  private agentText(label: ResourceStr): string {
    return typeof label === 'string' ? label : this.getUIContext().getHostContext()?.resourceManager.getStringSync(label) ?? '';
  }

  private modelName(item: XopcChatModel): string {
    const key = appSettings.effectiveLanguage().startsWith('zh') ? 'zh-CN' : 'en';
    return item.displayNames?.[key] || item.name || item.id;
  }

  private matchingModels(): XopcChatModel[] {
    const search = this.query.trim().toLowerCase();
    return this.model.models.filter((item: XopcChatModel): boolean =>
      (this.modelName(item) + ' ' + (item.name ?? '') + ' ' + item.id).toLowerCase().includes(search));
  }

  private matchesAgent(agent: XopcChatAgent): boolean {
    const query = this.query.trim().toLowerCase();
    if (!query) return true;
    const name = this.agentText(agentDisplayName(agent));
    const description = this.agentText(agentDisplayDescription(agent));
    return (name + ' ' + description + ' ' + (agent.name ?? '') + ' ' + agent.id).toLowerCase().includes(query);
  }

  private appearance(agent: XopcChatAgent): string {
    if (this.personalRecord?.agentId === agent.id) return this.personalRecord.appearance;
    if (agent.avatar?.startsWith('xopc:loopi:')) return agent.avatar.endsWith(':care') ? 'loopi-care' : 'loopi';
    return 'configured';
  }

  @Builder agentRow(agent: XopcChatAgent) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        XopcPersonalAgentAvatar({ agentId: agent.id, appearance: this.appearance(agent), avatarReference: agent.avatar ?? '',
          revision: this.personalRecord?.agentId === agent.id ? this.personalRecord.revision ?? 0 : 0,
          fallbackLabel: this.agentText(agentDisplayName(agent)), extent: 40, activePage: false, compact: true })
        Column({ space: 3 }) {
          Text(agentDisplayName(agent)).width('100%').fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          if (agentDisplayDescription(agent)) {
            Text(agentDisplayDescription(agent)).width('100%').fontSize(12).fontColor(this.colors.secondary)
              .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        if (agent.id === this.model.agentId) {
          SymbolGlyph($r('sys.symbol.checkmark')).fontSize(16).fontColor([this.colors.accent]).accessibilityLevel('no')
        }
      }.width('100%').padding(10)
    }.id('chat-agent-option-' + agent.id).width('100%').constraintSize({ minHeight: 60 }).padding(0)
      .borderRadius(this.colors.corner(14)).clipShape(this.colors.cornerClip(14)).backgroundColor(this.colors.chat.card)
      .onClick((): void => { if (agent.id === this.model.agentId) this.onClose(); else this.onAgent(agent.id); })
  }

  build() {
    Column({ space: 8 }) {
      Row() {
        Text(this.mode === 'model' ? $r('app.string.chat_model') : this.mode === 'thinking' ? $r('app.string.chat_thinking_effort')
          : this.mode === 'agent' ? $r('app.string.chat_agent')
          : this.mode === 'preparation' ? $r('app.string.chat_project_preparation_title') : $r('app.string.chat_actions'))
          .fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).layoutWeight(1)
        Button('×').width(44).height(44).padding(0).fontSize(28).backgroundColor(Color.Transparent)
          .fontColor(this.colors.secondary).accessibilityText($r('app.string.chat_close')).onClick((): void => { this.onClose(); })
      }.width('100%')
      if (this.mode === 'model' || this.mode === 'agent') {
        TextInput({ text: this.query, placeholder: $r('app.string.search') }).onChange((value: string): void => { this.query = value; })
      }
      if (this.model.loading) { XopcListSkeleton() }
      if (this.mode === 'model' && !this.model.loading && !this.model.error && !this.model.models.length) {
        Text($r('app.string.chat_models_empty')).fontColor(this.colors.secondary).width('100%')
      }
      if (this.model.error && this.mode !== 'preparation') {
        Text(userErrorMessage(this.model.error, 'collection')).fontColor(this.colors.secondary)
        Button($r('app.string.refresh')).onClick((): void => { this.onRetry(); })
      }
      List({ space: this.mode === 'actions' ? 0 : 8 }) {
        if (this.mode === 'model') {
          if (!this.model.loading && !this.model.error && this.model.models.length && !this.matchingModels().length) {
            ListItem() { Text($r('app.string.ms_no_match')).fontColor(this.colors.secondary).padding(12) }
          }
          ForEach(this.matchingModels(), (item: XopcChatModel) => {
            ListItem() {
              XopcHubRow({ heading: (item.id === this.model.modelId ? '✓ ' : '') + this.modelName(item),
                summary: item.id, showChevron: false, onOpen: async (): Promise<void> => { if (await this.model.selectModel(item.id, this.rememberModel)) this.onClose(); } })
            }.enabled(!this.model.loading && !this.model.saving && !this.modelBusy)
          }, (item: XopcChatModel): string => item.id)
        } else if (this.mode === 'thinking') {
          if (this.model.selectedModel()?.thinking?.mode === 'levels' || this.model.selectedModel()?.thinking?.mode === 'toggle') {
            ForEach(this.model.selectedModel()?.thinking?.options || [], (level: string) => {
              ListItem() {
                XopcHubRow({ heading: chatThinkingLabel(level),
                  summary: level === this.model.thinkingLevel ? $r('app.string.chat_thinking_selected') : '',
                  onOpen: async (): Promise<void> => { if (await this.model.selectThinking(level, this.rememberModel)) this.onClose(); } })
              }.enabled(!this.model.loading && !this.model.saving && !this.thinkingBusy)
            }, (level: string): string => level)
          } else {
            ListItem() { Text(this.thinkingSummary()).fontColor(this.colors.secondary).padding(12) }
          }
        } else if (this.mode === 'agent') {
          ForEach(this.model.agents.filter((item: XopcChatAgent): boolean => this.matchesAgent(item)), (item: XopcChatAgent) => {
            ListItem() { this.agentRow(item) }
          }, (item: XopcChatAgent): string => item.id)
        } else if (this.mode === 'preparation') {
          if (this.model.preparationError) {
            ListItem() {
              Column({ space: 8 }) {
                Text(this.preparationErrorMessage()).fontColor(this.colors.danger)
                Button($r('app.string.retry')).enabled(!this.model.preparationBusy).onClick((): void => { this.model.retryPreparation(); })
                if (this.model.preparation?.state === 'preparation_failed'
                  && this.model.preparation?.executionMode === 'managed_worktree') {
                  Button($r('app.string.chat_send_from_project_folder'), { buttonStyle: ButtonStyleMode.NORMAL })
                    .enabled(!this.model.preparationBusy).onClick((): void => { this.model.retryPreparation(true); })
                }
              }
            }
          }
        } else {
          if (this.canShare) {
            ListItem() { XopcHubRow({ heading: $r('app.string.share_session_title'), compact: true,
              symbol: $r('sys.symbol.link'), onOpen: this.onShare }) }
          }
          ListItem() { XopcHubRow({ heading: $r('app.string.chat_search_in_conversation'), compact: true, symbol: $r('sys.symbol.magnifyingglass'), onOpen: (): void => { this.onSearch(); } }) }
          ListItem() { XopcHubRow({ heading: $r('app.string.chat_context'), summary: this.contextSummary,
            compact: true, symbol: $r('sys.symbol.link'), onOpen: (): void => { this.onContext(); } }) }
          if (!this.personal) {
            ListItem() { XopcHubRow({ heading: $r('app.string.chat_agent'), summary: this.model.agentName(), compact: true, onOpen: (): void => { this.onMode('agent'); } }) }
          }
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
