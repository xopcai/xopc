import { XopcChatAgent, XopcContextSummary } from '../model/chat';
import { XopcWelcomeData, XopcWelcomeStarter } from '../common/chatWelcome';
import { XopcChatWelcomeViewModel } from '../viewmodel/chatWelcomeViewModel';
import { fromUtf8 } from '../service/secureStore';
import { XopcListSkeleton } from './MobileComponents';

@ComponentV2
export struct XopcChatWelcome {
  @Param scope: XopcContextSummary | undefined = undefined;
  @Param workspace: string = '';
  @Param agent: XopcChatAgent | undefined = undefined;
  @Param agentId: string = 'main';
  @Param language: string = 'en';
  @Param contextPending: boolean = false;
  @Param contextError: boolean = false;
  @Event onRetryContext: () => void = (): void => {};
  @Event onChoose: (prompt: string) => void = (_prompt: string): void => {};
  @Event onDismissComposer: () => void = (): void => {};
  @Local model: XopcChatWelcomeViewModel = new XopcChatWelcomeViewModel();
  @Local data?: XopcWelcomeData;
  @Local loadError: boolean = false;
  @Local viewportHeight: number = 0;
  private generation: number = 0;

  aboutToAppear(): void { this.loadCopy(); }
  aboutToDisappear(): void { this.generation++; this.model.dispose(); }
  @Monitor('language')
  async loadCopy(): Promise<void> {
    const generation = ++this.generation; this.loadError = false;
    try {
      const context = this.getUIContext().getHostContext(); if (!context) return;
      const bytes = await context.resourceManager.getRawFileContent(this.language.startsWith('zh') ? 'welcome-zh.json' : 'welcome-en.json');
      if (generation !== this.generation) return;
      this.data = JSON.parse(fromUtf8(bytes)) as XopcWelcomeData; this.reload();
    } catch (_) { if (generation === this.generation) this.loadError = true; }
  }
  @Monitor('scope', 'workspace', 'agent', 'agentId', 'contextPending')
  reload(): void {
    if (!this.data || this.contextPending) { this.model.dispose(); return; }
    this.model.load(this.data, this.scope, this.workspace, this.agent, this.agentId);
  }
  private starterSymbol(icon: string): Resource {
    if (icon === 'folder') return $r('sys.symbol.folder');
    if (icon === 'search') return $r('sys.symbol.magnifyingglass');
    if (icon === 'task' || icon === 'check') return $r('sys.symbol.checkmark_circle');
    if (icon === 'content') return $r('sys.symbol.square_and_pencil');
    return $r('sys.symbol.doc_text');
  }
  build() {
    Scroll() {
      Column({ space: 10 }) {
        if (!this.data || this.contextPending || this.model.loading) { XopcListSkeleton() }
        else if (this.model.model) {
          Text(this.model.model.headline).fontSize(17).lineHeight(24).fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.foreground')).width('100%').textAlign(TextAlign.Center)
          Text(this.model.model.tagline).fontSize(13).lineHeight(18).fontColor($r('app.color.secondary'))
            .constraintSize({ maxWidth: 280 }).textAlign(TextAlign.Center).opacity(0.58)
          Column({ space: 8 }) {
          ForEach(this.model.model.starters, (starter: XopcWelcomeStarter) => {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 10 }) {
                Row() { SymbolGlyph(this.starterSymbol(starter.icon)).fontSize(18).fontColor([$r('app.color.accent')]) }
                  .width(36).height(36).justifyContent(FlexAlign.Center).borderRadius(18).backgroundColor($r('app.color.accent_soft'))
                Column({ space: 2 }) {
                  Text(starter.title).fontSize(15).lineHeight(20).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground')).width('100%').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text(starter.description).fontSize(12).lineHeight(16).fontColor($r('app.color.secondary')).width('100%').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                }.layoutWeight(1)
              }.width('100%')
            }.id('chat-starter-' + starter.id).width('100%').constraintSize({ minHeight: 60 }).padding({ left: 12, right: 12, top: 10, bottom: 10 })
              .border({ width: 0.5, color: $r('app.color.border_subtle'), radius: 16 })
              .backgroundColor($r('app.color.panel')).onClick((): void => { this.onChoose(starter.prompt); })
          }, (starter: XopcWelcomeStarter): string => starter.id + ':' + starter.prompt)
          }.width('100%').constraintSize({ maxWidth: 360 }).margin({ top: 14 })
          if ((this.model.degraded || this.contextError) && this.data) {
            Text(this.data.copy.contextFallback).fontSize(12).fontColor($r('app.color.secondary')).width('100%')
            Button(this.data.copy.retryContext).height(44).backgroundColor(Color.Transparent).fontColor($r('app.color.accent'))
              .onClick((): void => { if (this.contextError) this.onRetryContext(); else this.reload(); })
          }
        }
        if (this.loadError) {
          Button($r('app.string.retry')).height(44).onClick((): void => { this.loadCopy(); })
        }
      }.width('100%').constraintSize({ minHeight: this.viewportHeight }).justifyContent(FlexAlign.Center)
        .padding({ top: 24, bottom: 32, left: 28, right: 28 })
    }.id('chat-welcome').width('100%').height('100%').scrollBar(BarState.Off)
      .onTouch((event: TouchEvent): void => { if (event.type === TouchType.Down) this.onDismissComposer(); })
      .onSizeChange((_before: SizeOptions, after: SizeOptions): void => { this.viewportHeight = Number(after.height ?? 0); })
  }
}
