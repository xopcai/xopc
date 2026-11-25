import { XOPC_ICON_HEADER, XOPC_PAGE_PADDING_X, xopcMoreIcon } from '../common/designTokens';
import { xopcConfirmDialog, xopcSheetOptions } from '../common/dialogActions';
import { xopcClickEffect, xopcPagerAnimated, xopcPagerDuration } from '../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcShareItem, XopcShareResult } from '../model/share';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { validShareUrl } from '../service/shareService';
import { XopcShareViewModel } from '../viewmodel/shareViewModel';
import { XopcEmptyHint, XopcErrorState, XopcListSkeleton, XopcPageHeader } from './MobileComponents';
import { XopcPagerProgress, XopcSegmentedTabs, XopcSegmentOption } from './SegmentedTabs';
import { XopcShareResultView } from './ShareResultView';

const DAY_MS: number = 86400000;

@ComponentV2
export struct XopcShareCenterView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Event onExit: () => void = (): void => {};
  @Local model: XopcShareViewModel = new XopcShareViewModel();
  @Local result?: XopcShareResult;
  @Local resultOpen: boolean = false;
  @Local layout: XopcLayoutState = layoutState;
  private pager: SwiperController = new SwiperController();
  private pagerProgress: XopcPagerProgress = new XopcPagerProgress();

  aboutToAppear(): void { this.model.load(); }
  aboutToDisappear(): void { this.model.dispose(); }
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
  private async revoke(item: XopcShareItem): Promise<void> {
    const confirmed = await xopcConfirmDialog(this.getUIContext(), {
      title: $r('app.string.share_revoke'),
      message: $r('app.string.share_revoke_confirm'),
      confirmLabel: $r('app.string.share_revoke'),
      destructive: true,
    });
    if (confirmed) void this.model.revoke(item);
  }

  @Builder
  private itemMenu(item: XopcShareItem) {
    Menu() {
      if (validShareUrl(item.shareUrl)) {
        MenuItem({ content: $r('app.string.share_preview') })
          .onClick((): void => { this.open(item); })
      }
      MenuItem({ content: $r('app.string.share_extend_one') })
        .onClick((): void => { void this.model.extend(item, DAY_MS); })
      MenuItem({ content: $r('app.string.share_extend_three') })
        .onClick((): void => { void this.model.extend(item, 3 * DAY_MS); })
      MenuItem({ content: $r('app.string.share_extend_seven') })
        .onClick((): void => { void this.model.extend(item, 7 * DAY_MS); })
      MenuItem({ content: $r('app.string.share_revoke') })
        .contentFontColor(this.colors.danger)
        .onClick((): void => { void this.revoke(item); })
    }
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
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph(xopcMoreIcon()).fontSize(XOPC_ICON_HEADER).fontColor([this.colors.secondary])
        }.width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .clickEffect(xopcClickEffect())
          .accessibilityText($r('app.string.share_actions'))
          .enabled(!this.model.busyId && !this.model.loading && !this.model.error)
          .bindMenu(this.itemMenu(item), { placement: Placement.BottomRight })
      }
    }.id('share-record-' + item.id).width('100%').padding(14)
      .borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
      .bindContextMenu(this.active(item) && !this.model.busyId && !this.model.loading && !this.model.error
        ? this.itemMenu(item) : undefined, ResponseType.LongPress, {
        hapticFeedbackMode: HapticFeedbackMode.ENABLED,
      })
  }

  private filters: XopcSegmentOption[] = [
    { key: 'all', label: $r('app.string.share_all'), testId: 'share-filter-all' },
    { key: 'active', label: $r('app.string.share_active_only'), testId: 'share-filter-active' }
  ];

  private selectFilter(key: string): void {
    const activeOnly = key === 'active';
    if (activeOnly !== this.model.activeOnly && !this.resultOpen && !this.model.busyId) {
      this.pager.changeIndex(activeOnly ? 1 : 0, xopcPagerAnimated(this.layout.reduceMotion));
    }
  }

  @Builder
  private sharePage(activeOnly: boolean) {
    Refresh({ refreshing: this.model.loading && this.model.loaded }) {
      List({ space: 8 }) {
        if (this.model.error) {
          ListItem() {
            XopcErrorState({ error: this.model.error, context: 'collection',
              actionLabel: $r('app.string.refresh'), onAction: (): void => { void this.model.load(); } })
          }
        } else if (!this.model.loaded) {
          ListItem() { XopcListSkeleton() }
        } else if (!this.model.visibleItems(activeOnly).length) {
          ListItem() {
            XopcEmptyHint({ message: activeOnly ? $r('app.string.share_no_active') : $r('app.string.share_empty'), centered: true })
          }
        }
        ForEach(this.model.visibleItems(activeOnly), (item: XopcShareItem) => {
          ListItem() { this.record(item) }
        }, (item: XopcShareItem): string => item.id + ':' + item.expiresAt + ':' + item.revoked + ':' + item.expired)
      }.id('share-history-list').width('100%').height('100%')
        .padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X, bottom: 24 }).scrollBar(BarState.Off)
        .accessibilityLevel(activeOnly === this.model.activeOnly ? 'auto' : 'no-hide-descendants')
    }.height('100%').width('100%').onRefreshing((): void => { void this.model.load(); })
  }

  build() {
    NavDestination() {
      Column() {
        XopcPageHeader({ heading: $r('app.string.share_center'), showStaticTitle: true,
          backVisible: true, onBack: (): void => { this.onExit(); },
          actionLabel: $r('app.string.refresh'), onAction: (): void => { void this.model.load(); } })
        Column() {
          XopcSegmentedTabs({ options: this.filters, selectedKey: this.model.activeOnly ? 'active' : 'all',
            pagerProgress: this.pagerProgress,
            swipeToSelect: !this.resultOpen,
            onSelect: (key: string): void => { this.selectFilter(key); } })
        }.width('100%').padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X, bottom: 12 })
        Swiper(this.pager) {
          this.sharePage(false)
          this.sharePage(true)
        }.id('share-history-pager').index(this.model.activeOnly ? 1 : 0)
          .loop(false).indicator(false).cachedCount(1).disableSwipe(this.resultOpen || !!this.model.busyId)
          .duration(xopcPagerDuration(this.layout.reduceMotion))
          .onContentDidScroll((_selected: number, index: number, position: number, length: number): void => {
            this.pagerProgress.update(index, position, length);
          })
          .onAnimationEnd((): void => { this.pagerProgress.reset(); })
          .onChange((index: number): void => { this.model.activeOnly = index === 1; })
          .width('100%').layoutWeight(1)
      }.width('100%').height('100%').backgroundColor(this.colors.surface)
        .bindSheet($$this.resultOpen, this.resultSheet, xopcSheetOptions('immersive', { backgroundColor: this.colors.panel }))
    }.hideTitleBar(true).onBackPressed((): boolean => {
      if (this.resultOpen) this.resultOpen = false;
      else this.onExit();
      return true;
    })
  }
}
