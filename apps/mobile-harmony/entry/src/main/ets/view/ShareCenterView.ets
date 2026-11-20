import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcShareItem, XopcShareResult } from '../model/share';
import { validShareUrl } from '../service/shareService';
import { XopcShareViewModel } from '../viewmodel/shareViewModel';
import { XopcListSkeleton, XopcPageHeader } from './MobileComponents';
import { XopcPageSwipe, XopcSegmentedTabs, XopcSegmentOption } from './SegmentedTabs';
import { XopcShareResultView } from './ShareResultView';

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
    if (!this.active(item) || !validShareUrl(item.shareUrl)) return;
    this.result = { id: item.id, kind: item.kind, title: item.fileName, fileName: item.fileName, shareUrl: item.shareUrl,
      lanUrl: item.lanUrl, reachability: item.reachability, reachabilityHint: item.reachabilityHint,
      expiresAt: item.expiresAt, maxViews: item.maxViews, messageCount: item.messageCount,
      attachmentCount: item.attachmentCount };
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
    const actions: SheetInfo[] = [
      { title: this.text($r('app.string.share_extend')), action: (): void => { this.extend(item); } },
      { title: this.text($r('app.string.share_revoke')), action: (): void => { this.revoke(item); } }
    ];
    if (validShareUrl(item.shareUrl)) {
      actions.unshift({ title: this.text($r('app.string.share_preview')), action: (): void => { this.open(item); } });
    }
    this.getUIContext().showActionSheet({ title: item.fileName, message: '', sheets: actions });
  }

  private dateLabel(value: string): string {
    return new Date(value).toLocaleString();
  }

  @Builder
  resultSheet() {
    if (this.result) { XopcShareResultView({ share: this.result, onClose: (): void => { this.resultOpen = false; } }) }
  }

  @Builder
  private record(item: XopcShareItem) {
    Row({ space: 12 }) {
      SymbolGlyph(item.kind === 'directory' ? $r('sys.symbol.folder') : item.kind === 'session'
        ? $r('sys.symbol.message') : item.kind === 'note' ? $r('sys.symbol.doc_text') : $r('sys.symbol.doc'))
        .fontSize(21).fontColor([this.colors.secondary])
      Column({ space: 6 }) {
        Text(item.fileName).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        Text(this.status(item)).fontSize(13).fontColor(this.active(item) ? this.colors.success : this.colors.secondary)
        if (item.createdAt) {
          Text($r('app.string.share_created_date', this.dateLabel(item.createdAt))).fontSize(12)
            .fontColor(this.colors.secondary).width('100%')
        }
        Text($r('app.string.share_expiry_date', this.dateLabel(item.expiresAt))).fontSize(12)
          .fontColor(this.colors.secondary).width('100%')
      }.layoutWeight(1).alignItems(HorizontalAlign.Start).onClick((): void => { this.open(item); })
      if (this.active(item)) {
        Button('•••').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .fontColor(this.colors.secondary).accessibilityText($r('app.string.share_actions'))
          .enabled(!this.model.busyId && !this.model.loading && !this.model.error)
          .onClick((): void => { this.menu(item); })
      }
    }.id('share-record-' + item.id).width('100%').padding(14)
      .borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
  }

  private filters: XopcSegmentOption[] = [
    { key: 'all', label: $r('app.string.share_all'), testId: 'share-filter-all' },
    { key: 'active', label: $r('app.string.share_active_only'), testId: 'share-filter-active' }
  ];

  private selectFilter(key: string): void { this.model.activeOnly = key === 'active'; }

  build() {
    NavDestination() {
      Column() {
        XopcPageHeader({ heading: $r('app.string.share_center'), showStaticTitle: true,
          backVisible: true, onBack: (): void => { this.onExit(); },
          actionLabel: $r('app.string.refresh'), onAction: (): void => { void this.model.load(); } })
        Column() {
          XopcSegmentedTabs({ options: this.filters, selectedKey: this.model.activeOnly ? 'active' : 'all',
            swipeToSelect: !this.resultOpen,
            onSelect: (key: string): void => { this.selectFilter(key); } })
        }.width('100%').padding({ left: 20, right: 20, bottom: 12 })
        Refresh({ refreshing: this.model.loading && this.model.loaded }) {
          List({ space: 8 }) {
            if (this.model.error) {
              ListItem() {
                Row({ space: 12 }) {
                  Text($r('app.string.share_load_failed')).fontSize(14).fontColor(this.colors.secondary).layoutWeight(1)
                  Button($r('app.string.refresh')).height(44).onClick((): void => { void this.model.load(); })
                }.width('100%')
              }
            } else if (!this.model.loaded) {
              ListItem() { XopcListSkeleton() }
            } else if (!this.model.visibleItems().length) {
              ListItem() {
                Text(this.model.activeOnly ? $r('app.string.share_no_active') : $r('app.string.share_empty'))
                  .fontSize(15).fontColor(this.colors.secondary).width('100%').padding(16)
                  .borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
              }
            }
            ForEach(this.model.visibleItems(), (item: XopcShareItem) => {
              ListItem() { this.record(item) }
            }, (item: XopcShareItem): string => item.id + ':' + item.expiresAt + ':' + item.revoked + ':' + item.expired)
          }.id('share-history-list').width('100%').height('100%')
            .padding({ left: 20, right: 20, bottom: 24 }).scrollBar(BarState.Off)
            .gestureModifier(new XopcPageSwipe(this.filters.map((option: XopcSegmentOption): string => option.key),
              this.model.activeOnly ? 'active' : 'all', (key: string): void => { this.selectFilter(key); },
              !this.resultOpen && !this.model.busyId))
        }.layoutWeight(1).width('100%').onRefreshing((): void => { void this.model.load(); })
      }.width('100%').height('100%').backgroundColor(this.colors.surface)
        .bindSheet($$this.resultOpen, this.resultSheet, { height: '92%', dragBar: false })
    }.hideTitleBar(true).onBackPressed((): boolean => {
      if (this.resultOpen) this.resultOpen = false;
      else this.onExit();
      return true;
    })
  }
}
