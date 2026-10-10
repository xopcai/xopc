import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcShareItem, XopcShareResult } from '../model/share';
import { XopcShareViewModel } from '../viewmodel/shareViewModel';
import { XopcListSkeleton } from './MobileComponents';
import { XopcShareResultView } from './ShareResultView';
import { userErrorMessage } from '../common/userError';

const DAY_MS: number = 86400000;

@ComponentV2
export struct XopcShareCenterView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Event onExit: () => void = (): void => {};
  @Local model: XopcShareViewModel = new XopcShareViewModel();
  @Local result?: XopcShareResult;
  @Local resultOpen: boolean = false;

  aboutToAppear(): void { this.model.load(); }
  aboutToDisappear(): void { this.model.dispose(); }
  private text(resource: Resource): string { return this.getUIContext().getHostContext()?.resourceManager.getStringSync(resource.id) ?? ''; }
  private active(item: XopcShareItem): boolean { return !item.revoked && !item.expired; }
  private status(item: XopcShareItem): ResourceStr {
    return item.revoked ? $r('app.string.share_revoked') : item.expired ? $r('app.string.share_expired') : $r('app.string.share_active');
  }
  private open(item: XopcShareItem): void {
    this.result = { id: item.id, kind: item.kind, title: item.fileName, fileName: item.fileName, shareUrl: item.shareUrl,
      lanUrl: item.lanUrl, reachability: item.reachability, reachabilityHint: item.reachabilityHint,
      expiresAt: item.expiresAt, maxViews: item.maxViews };
    this.resultOpen = true;
  }
  private extend(item: XopcShareItem): void {
    this.getUIContext().showActionSheet({ title: $r('app.string.share_extend'), message: '', sheets: [
      { title: this.text($r('app.string.share_extend_one')), action: (): void => { this.model.extend(item, DAY_MS); } },
      { title: this.text($r('app.string.share_extend_three')), action: (): void => { this.model.extend(item, 3 * DAY_MS); } },
      { title: this.text($r('app.string.share_extend_seven')), action: (): void => { this.model.extend(item, 7 * DAY_MS); } }
    ] });
  }
  private revoke(item: XopcShareItem): void {
    this.getUIContext().showAlertDialog({ title: $r('app.string.share_revoke'), message: $r('app.string.share_revoke_confirm'),
      primaryButton: { value: $r('app.string.cancel'), action: (): void => {} },
      secondaryButton: { value: $r('app.string.share_revoke'), fontColor: this.colors.danger,
        action: (): void => { this.model.revoke(item); } } });
  }
  private menu(item: XopcShareItem): void {
    if (this.active(item)) {
      this.getUIContext().showActionSheet({ title: item.fileName, message: item.shareUrl, sheets: [
        { title: this.text($r('app.string.share_preview')), action: (): void => { this.open(item); } },
        { title: this.text($r('app.string.share_extend')), action: (): void => { this.extend(item); } },
        { title: this.text($r('app.string.share_revoke')), action: (): void => { this.revoke(item); } }
      ] });
    } else {
      this.getUIContext().showActionSheet({ title: item.fileName, message: item.shareUrl, sheets: [
        { title: this.text($r('app.string.share_preview')), action: (): void => { this.open(item); } }
      ] });
    }
  }

  @Builder
  resultSheet() {
    if (this.result) { XopcShareResultView({ share: this.result, onClose: (): void => { this.resultOpen = false; } }) }
  }

  build() {
    NavDestination() {
      Column() {
        Row({ space: 8 }) {
          Text($r('app.string.share_center')).fontSize(24).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).layoutWeight(1)
          Button(this.model.showInactive ? $r('app.string.share_hide_inactive') : $r('app.string.share_show_inactive'))
            .height(44).fontSize(12).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
            .onClick((): void => { this.model.showInactive = !this.model.showInactive; })
        }.width('100%').padding(12)
        if (this.model.error) {
          Row({ space: 8 }) {
            Text(userErrorMessage(this.model.error, 'collection')).fontSize(13).fontColor(this.colors.secondary).layoutWeight(1)
            Button($r('app.string.refresh')).enabled(!this.model.loading).onClick((): void => { this.model.load(); })
          }.padding({ left: 20, right: 20 })
        }
        if (this.model.loading && !this.model.items.length) { XopcListSkeleton() }
        else {
          Refresh({ refreshing: this.model.loading }) {
            List({ space: 8 }) {
              ForEach(this.model.visibleItems(), (item: XopcShareItem) => {
                ListItem() {
                  Row({ space: 12 }) {
                    SymbolGlyph(item.kind === 'directory' ? $r('sys.symbol.folder') : item.kind === 'session'
                      ? $r('sys.symbol.message') : item.kind === 'note' ? $r('sys.symbol.doc_text') : $r('sys.symbol.doc'))
                      .fontSize(23).fontColor([this.colors.secondary])
                    Column({ space: 5 }) {
                      Text(item.fileName).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
                        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                      Text(this.status(item)).fontSize(12).fontColor(this.active(item) ? this.colors.accent : this.colors.tertiary)
                      Text(new Date(item.expiresAt).toLocaleString()).fontSize(11).fontColor(this.colors.tertiary).maxLines(1)
                    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                    Button('•••').width(44).height(44).padding(0).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
                      .onClick((): void => { this.menu(item); })
                  }.width('100%').padding(14).borderRadius(16).backgroundColor(this.colors.panel)
                    .onClick((): void => { this.open(item); })
                }
              }, (item: XopcShareItem): string => item.id + ':' + item.expiresAt + ':' + item.revoked)
              if (!this.model.loading && !this.model.visibleItems().length) {
                ListItem() { Text($r('app.string.share_empty')).fontColor(this.colors.secondary).width('100%').padding(32).textAlign(TextAlign.Center) }
              }
            }.layoutWeight(1).width('100%').padding({ left: 20, right: 20, bottom: 20 })
          }.layoutWeight(1).onRefreshing((): void => { this.model.load(); })
        }
      }.width('100%').height('100%').backgroundColor(this.colors.surface)
        .bindSheet($$this.resultOpen, this.resultSheet, { height: '92%', dragBar: false })
    }.hideTitleBar(true).onBackPressed((): boolean => { if (this.resultOpen) this.resultOpen = false; else this.onExit(); return true; })
  }
}
