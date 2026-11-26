import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcContextSummary } from '../model/chat';
import { XopcWelcomeData } from '../common/chatWelcome';
import { XopcChatWelcomeViewModel } from '../viewmodel/chatWelcomeViewModel';
import { fromUtf8 } from '../service/secureStore';
import { XopcLoopi } from './Loopi';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';

@ComponentV2
export struct XopcChatWelcome {
  @Param activePage: boolean = true;
  @Local colors: XopcThemeColors = appThemeColors;
  @Param scope: XopcContextSummary | undefined = undefined;
  @Param language: string = 'en';
  @Param contextPending: boolean = false;
  @Param personal: boolean = false;
  @Param projectName: string = '';
  @Param standaloneDraft: boolean = false;
  @Param showPersonalAvatar: boolean = true;
  @Param personalName: string = 'Ada';
  @Param personalAgentId: string = '';
  @Param personalAppearance: string = 'loopi';
  @Param showQuickSetup: boolean = false;
  @Param agentId: string = '';
  @Param agentName: ResourceStr = '';
  @Param agentAppearance: string = 'configured';
  @Param agentAvatar: string = '';
  @Param modelLabel: string = '';
  @Param projectLabel: string = '';
  @Event onSelectAgent: () => void = (): void => {};
  @Event onSelectModel: () => void = (): void => {};
  @Event onSelectProject: () => void = (): void => {};
  @Event onChoose: (prompt: string) => void = (_prompt: string): void => {};
  @Event onDismissComposer: () => void = (): void => {};
  @Local model: XopcChatWelcomeViewModel = new XopcChatWelcomeViewModel();
  @Local data?: XopcWelcomeData;
  @Local loadError: boolean = false;
  @Local viewportHeight: number = 0;
  private generation: number = 0;

  aboutToAppear(): void { this.loadCopy(); }
  aboutToDisappear(): void { this.generation++; this.model.clear(); }

  @Monitor('language')
  async loadCopy(): Promise<void> {
    const generation = ++this.generation;
    this.loadError = false;
    this.data = undefined;
    this.model.clear();
    try {
      const context = this.getUIContext().getHostContext();
      if (!context) return;
      const file = this.language.startsWith('zh') ? 'welcome-zh.json' : 'welcome-en.json';
      const bytes = await context.resourceManager.getRawFileContent(file);
      if (generation !== this.generation) return;
      this.data = JSON.parse(fromUtf8(bytes)) as XopcWelcomeData;
      this.reload();
    } catch (_) {
      if (generation === this.generation) this.loadError = true;
    }
  }

  @Monitor('scope', 'contextPending')
  reload(): void {
    if (!this.data || this.contextPending) {
      this.model.clear();
      return;
    }
    this.model.load(this.data, this.scope);
  }

  private headline(): ResourceStr {
    return this.model.model?.headline ?? $r('app.string.chat_welcome');
  }

  private logoSize(): number {
    return this.viewportHeight > 0 && this.viewportHeight < 620 ? 88 : 108;
  }

  private recommendationAccessibility(): string {
    const recommendation = this.model.model?.recommendation;
    return recommendation ? recommendation.title + '。' + recommendation.reason : '';
  }

  private chooseRecommendation(): void {
    const prompt = this.model.model?.recommendation?.prompt;
    if (prompt) this.onChoose(prompt);
  }

  build() {
    Scroll() {
      Column({ space: 18 }) {
        if (this.personal && this.showPersonalAvatar) {
          XopcPersonalAgentAvatar({ extent: this.logoSize(), activePage: this.activePage,
            agentId: this.personalAgentId, appearance: this.personalAppearance }).id('chat-welcome-personal-avatar')
        } else if (this.standaloneDraft) {
          if (this.showQuickSetup && this.agentId) {
            XopcPersonalAgentAvatar({
              extent: 52,
              activePage: this.activePage,
              agentId: this.agentId,
              appearance: this.agentAppearance,
              avatarReference: this.agentAvatar,
              compact: true,
            })
          } else {
            Image($r('app.media.brand_logo')).width(52).height(52).accessibilityLevel('no')
          }
        } else if (this.projectName) {
          SymbolGlyph($r('sys.symbol.folder')).fontSize(43).fontColor([this.colors.accent])
        } else if (!this.personal) {
          XopcLoopi({ extent: this.logoSize(), activePage: this.activePage, interactive: true,
            mood: this.loadError ? 'care' : this.contextPending ? 'work' : 'listen' }).id('chat-welcome-loopi')
        }
        Text(this.personal ? $r('app.string.personal_chat_greeting', this.personalName) : this.standaloneDraft ? $r('app.string.chat_draft_greeting')
            : this.projectName ? $r('app.string.project_chat_greeting') : this.headline())
          .fontSize(this.standaloneDraft ? 27 : 20).lineHeight(this.standaloneDraft ? 38 : 28)
          .fontWeight(this.standaloneDraft ? FontWeight.Bold : FontWeight.Medium)
          .fontColor(this.colors.foreground).width('100%').textAlign(TextAlign.Center)
        if (this.personal) {
          Text($r('app.string.personal_chat_invitation')).fontSize(14).lineHeight(22)
            .fontColor(this.colors.secondary).width('100%').textAlign(TextAlign.Center)
        }
        if (this.projectName) {
          Text($r('app.string.project_chat_scope', this.projectName)).fontSize(14).lineHeight(22)
            .fontColor(this.colors.secondary).width('100%').textAlign(TextAlign.Center)
        }
        if (!this.personal && this.showQuickSetup) {
          Scroll() {
            Row({ space: 8 }) {
              Button({ type: ButtonType.Normal }) {
                Row({ space: 6 }) {
                  XopcPersonalAgentAvatar({
                    extent: 18,
                    activePage: false,
                    agentId: this.agentId,
                    appearance: this.agentAppearance,
                    avatarReference: this.agentAvatar,
                    compact: true,
                  })
                  Text(this.agentName || this.agentId || 'Main')
                    .fontSize(13)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.colors.foreground)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
              }
              .id('chat-welcome-agent')
              .height(36)
              .padding({ left: 12, right: 12 })
              .borderRadius(this.colors.corner(16))
              .clipShape(this.colors.cornerClip(16))
              .backgroundColor(this.colors.chat.card)
              .onClick((): void => { this.onSelectAgent(); })

              Button({ type: ButtonType.Normal }) {
                Row({ space: 5 }) {
                  SymbolGlyph($r('sys.symbol.waveform'))
                    .fontSize(13)
                    .fontColor([this.colors.secondary])
                    .accessibilityLevel('no')
                  Text(this.modelLabel || (this.language.startsWith('zh') ? '默认模型' : 'Default model'))
                    .fontSize(13)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.colors.foreground)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
              }
              .id('chat-welcome-model')
              .height(36)
              .padding({ left: 12, right: 12 })
              .borderRadius(this.colors.corner(16))
              .clipShape(this.colors.cornerClip(16))
              .backgroundColor(this.colors.chat.card)
              .onClick((): void => { this.onSelectModel(); })

              Button({ type: ButtonType.Normal }) {
                Row({ space: 5 }) {
                  SymbolGlyph($r('sys.symbol.folder'))
                    .fontSize(13)
                    .fontColor([this.projectLabel ? this.colors.accent : this.colors.secondary])
                    .accessibilityLevel('no')
                  Text(this.projectLabel || (this.language.startsWith('zh') ? '关联项目' : 'Project'))
                    .fontSize(13)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.colors.foreground)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
              }
              .id('chat-welcome-project')
              .height(36)
              .padding({ left: 12, right: 12 })
              .borderRadius(this.colors.corner(16))
              .clipShape(this.colors.cornerClip(16))
              .backgroundColor(this.colors.chat.card)
              .onClick((): void => { this.onSelectProject(); })
            }
          }
          .id('chat-draft-quick-actions')
          .scrollable(ScrollDirection.Horizontal)
          .scrollBar(BarState.Off)
          .constraintSize({ maxWidth: '100%' })
        }
        if (!this.personal && this.model.model?.recommendation) {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 12 }) {
              Column({ space: 4 }) {
                Text(this.model.model.recommendation.title).fontSize(15).lineHeight(21)
                  .fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
                  .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(this.model.model.recommendation.reason).fontSize(12).lineHeight(17)
                  .fontColor(this.colors.secondary).width('100%').maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(16).fontColor([this.colors.tertiary])
            }.width('100%')
          }.id('chat-starter-' + this.model.model.recommendation.id).width('100%')
            .constraintSize({ minHeight: 68, maxWidth: 380 }).padding({ left: 16, right: 14, top: 12, bottom: 12 })
            .borderRadius(this.colors.corner(14)).clipShape(this.colors.cornerClip(14)).backgroundColor(this.colors.panel)
            .accessibilityText(this.recommendationAccessibility())
            .onClick((): void => { this.chooseRecommendation(); })
        }
        if (this.loadError) {
          Button($r('app.string.retry')).height(44).backgroundColor(Color.Transparent)
            .fontColor(this.colors.accent).onClick((): void => { this.loadCopy(); })
        }
      }.width('100%').constraintSize({ minHeight: this.viewportHeight }).justifyContent(FlexAlign.Center)
        .padding({ top: this.viewportHeight > 0 && this.viewportHeight < 620 ? 16 : 28,
          bottom: 28, left: 20, right: 20 })
    }.id('chat-welcome').width('100%').height('100%').scrollBar(BarState.Off)
      .onTouch((event: TouchEvent): void => { if (event.type === TouchType.Down) this.onDismissComposer(); })
      .onSizeChange((_before: SizeOptions, after: SizeOptions): void => {
        this.viewportHeight = Number(after.height ?? 0);
      })
  }
}
