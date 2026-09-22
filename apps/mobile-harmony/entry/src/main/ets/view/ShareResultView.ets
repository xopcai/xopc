import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { XopcShareResult } from '../model/share';
import { copyChatMessage } from '../service/chatMessageActions';
import { shareChatLink, shareReachabilityText } from '../service/chatMediaShare';
import { appSettings } from '../service/settings';

@ComponentV2
export struct XopcShareResultView {
  @Require @Param share: XopcShareResult;
  @Event onClose: () => void = (): void => {};
  @Local mode: string = 'summary';
  @Local copied: boolean = false;
  private webController: webview.WebviewController = new webview.WebviewController();

  aboutToDisappear(): void { try { this.webController.stop(); } catch (_) {} }
  private origin(url: string): string {
    const match = /^(https?:\/\/[^/]+)/i.exec(url); return match?.[1]?.toLowerCase() ?? '';
  }
  private sameOrigin(url: string): boolean {
    const source = this.origin(url); return !!source && source === this.origin(this.share.shareUrl);
  }
  private async copy(): Promise<void> {
    await copyChatMessage(this.share.shareUrl); this.copied = true;
    this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_link_copied') });
  }
  private async systemShare(): Promise<void> {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    if (context) await shareChatLink(context, this.share);
  }

  build() {
    Column({ space: 12 }) {
      Row({ space: 6 }) {
        Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(20).fontColor([$r('app.color.secondary')]) }
          .width(44).height(44).padding(0).backgroundColor(Color.Transparent).visibility(this.mode === 'summary' ? Visibility.Hidden : Visibility.Visible)
          .onClick((): void => { this.mode = 'summary'; })
        Text(this.share.title || this.share.fileName || $r('app.string.share_title')).fontSize(19).fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.foreground')).layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Button() { SymbolGlyph($r('sys.symbol.xmark')).fontSize(20).fontColor([$r('app.color.secondary')]) }
          .width(44).height(44).padding(0).backgroundColor(Color.Transparent).accessibilityText($r('app.string.close')).onClick(this.onClose)
      }.width('100%')
      if (this.mode === 'qr') {
        Column({ space: 16 }) {
          QRCode(this.share.shareUrl).width(260).height(260).color('#111318').backgroundColor(Color.White)
          Text(this.share.shareUrl).fontSize(12).fontColor($r('app.color.secondary')).maxLines(2).textAlign(TextAlign.Center)
        }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
      } else if (this.mode === 'preview') {
        Stack({ alignContent: Alignment.Center }) {
          Web({ src: this.share.shareUrl, controller: this.webController }).width('100%').height('100%')
            .javaScriptAccess(true).domStorageAccess(false).fileAccess(false).mixedMode(MixedMode.None)
            .onUrlLoadIntercept((event): boolean => {
              const source = event?.data; const url = typeof source === 'string' ? source : source?.getRequestUrl() || '';
              return !!url && !this.sameOrigin(url);
            })
          LoadingProgress().width(32).height(32).color($r('app.color.accent'))
            .visibility(this.share.shareUrl ? Visibility.Hidden : Visibility.Visible)
        }.width('100%').layoutWeight(1).borderRadius(14).clip(true)
      } else {
        Scroll() {
          Column({ space: 16 }) {
            Column({ space: 8 }) {
              Text(this.share.shareUrl).fontSize(14).fontColor($r('app.color.accent')).copyOption(CopyOptions.InApp).width('100%')
              Text(shareReachabilityText(this.share, appSettings.effectiveLanguage().startsWith('zh')))
                .fontSize(13).lineHeight(20).fontColor($r('app.color.secondary')).width('100%')
              Text(new Date(this.share.expiresAt).toLocaleString()).fontSize(12).fontColor($r('app.color.tertiary')).width('100%')
            }.width('100%').padding(16).borderRadius(16).backgroundColor($r('app.color.input'))
            Row({ space: 8 }) {
              Button(this.copied ? $r('app.string.share_copied') : $r('app.string.chat_copy_link')).layoutWeight(1).height(48)
                .backgroundColor($r('app.color.grouped')).fontColor($r('app.color.secondary')).onClick((): void => { this.copy(); })
              Button($r('app.string.share_qr')).layoutWeight(1).height(48).backgroundColor($r('app.color.grouped'))
                .fontColor($r('app.color.secondary')).onClick((): void => { this.mode = 'qr'; })
            }.width('100%')
            Row({ space: 8 }) {
              Button($r('app.string.share_preview')).layoutWeight(1).height(48).backgroundColor($r('app.color.grouped'))
                .fontColor($r('app.color.secondary')).onClick((): void => { this.mode = 'preview'; })
              Button($r('app.string.chat_system_share')).layoutWeight(1).height(48).backgroundColor($r('app.color.accent'))
                .fontColor(Color.White).onClick((): void => { this.systemShare(); })
            }.width('100%')
          }.width('100%')
        }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
      }
    }.width('100%').height('100%').padding(20).backgroundColor($r('app.color.panel'))
  }
}
