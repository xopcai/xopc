import { XOPC_PAGE_PADDING_X } from '../common/designTokens';
import { xopcConfirmDialog, xopcSheetOptions } from '../common/dialogActions';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { userErrorMessage } from '../common/userError';
import { XopcFile, XopcFileSpace } from '../model/files';
import { XopcShareResult } from '../model/share';
import { createManagedShare } from '../service/chatMediaShare';
import { managedFileMedia } from '../viewmodel/fileDocumentViewModel';
import { XopcFilesViewModel } from '../viewmodel/filesViewModel';
import { XopcChatMediaView } from './ChatMediaView';
import {
  XOPC_PAGE_HEADER_HEIGHT_VP,
  XopcBrandLoading,
  XopcEmptyHint,
  XopcErrorState,
  XopcHubRow,
  XopcInlineBanner,
  XopcPageHeader,
  XopcPageSearchField,
} from './MobileComponents';
import { XopcShareResultView } from './ShareResultView';

@ComponentV2
export struct XopcFilesView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param initialId: string = '';
  @Param uploadOnAppear: boolean = false;
  @Param conversationId: string = '';
  @Event onExit: () => void = (): void => {};
  @Local model: XopcFilesViewModel = new XopcFilesViewModel();
  @Local search: string = '';
  @Local searchOpen: boolean = false;
  @Local shareResult?: XopcShareResult;
  @Local shareOpen: boolean = false;

  aboutToAppear(): void { void this.openInitial(); }
  private async openInitial(): Promise<void> {
    await this.model.start(this.initialId, this.conversationId);
    if (!this.uploadOnAppear || this.model.error) return;
    const defaults = this.model.spaces.filter((space: XopcFileSpace): boolean => space.writable);
    if (defaults.length === 1) await this.model.choose(defaults[0]);
    const context = this.getUIContext().getHostContext();
    if (context && this.model.space?.writable) await this.model.upload(context);
  }
  aboutToDisappear(): void { this.model.dispose(); }

  private closeSearch(): void {
    if (!this.model.clearSearch()) return;
    this.getUIContext().getFocusController().clearFocus();
    this.searchOpen = false;
    this.search = '';
  }

  private toggleSearch(): void {
    if (this.searchOpen) this.closeSearch();
    else this.searchOpen = true;
  }

  private async goBack(): Promise<void> {
    if (this.searchOpen) { this.closeSearch(); return; }
    if (this.model.busy) return;
    try {
      if (this.conversationId && !this.model.directory && !this.model.selected) this.onExit();
      else if (!this.initialId && (this.model.space || this.model.selected)) this.model.parent();
      else this.onExit();
    } catch (error) { this.model.error = (error as Error).message; }
  }

  private async remove(file: XopcFile): Promise<void> {
    try {
      const confirmed = await xopcConfirmDialog(this.getUIContext(), {
        title: $r('app.string.delete'),
        message: $r('app.string.confirm_action_help'),
        confirmLabel: $r('app.string.delete'),
        destructive: true,
      });
      if (confirmed) await this.model.remove(file);
    } catch (error) { this.model.error = (error as Error).message; }
  }

  private async shareDirectory(file: XopcFile, zipOnly: boolean): Promise<void> {
    if (this.model.busy) return;
    this.model.busy = true; this.model.error = '';
    try {
      const payload = await createManagedShare({ fileId: file.id, audience: 'friend', mode: zipOnly ? 'force-zip' : 'auto' });
      this.shareResult = payload.share; this.shareOpen = true;
    } catch (error) { this.model.error = (error as Error).message; }
    finally { this.model.busy = false; }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return bytes.toString() + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  private fileSummary(file: XopcFile): string {
    if (file.kind === 'directory') return file.relativePath;
    const metadata = this.formatSize(file.size) + ' · ' + new Date(file.modifiedAt).toLocaleDateString();
    return file.relativePath ? file.relativePath + ' · ' + metadata : metadata;
  }

  private hasContextActions(file: XopcFile): boolean {
    return (file.kind === 'directory' && file.capabilities.includes('share')) || file.capabilities.includes('delete');
  }

  @Builder
  fileContextMenu(file: XopcFile) {
    Menu() {
      if (file.kind === 'directory' && file.capabilities.includes('share')) {
        MenuItem({ content: $r('app.string.share_directory_browse') })
          .onClick((): void => { void this.shareDirectory(file, false); })
        MenuItem({ content: $r('app.string.share_directory_zip') })
          .onClick((): void => { void this.shareDirectory(file, true); })
      }
      if (file.capabilities.includes('delete')) {
        MenuItem({ content: $r('app.string.delete') })
          .contentFontColor(this.colors.danger)
          .onClick((): void => { void this.remove(file); })
      }
    }
  }

  @Builder
  shareSheet() {
    if (this.shareResult) { XopcShareResultView({ share: this.shareResult, onClose: (): void => { this.shareOpen = false; } }) }
  }

  @Builder
  fileDetail(file: XopcFile) {
    XopcChatMediaView({ file: managedFileMedia(file), conversationId: this.conversationId, previewOnly: true,
      onPreviewClosed: (): void => {
        this.model.selected = undefined;
        if (this.initialId) this.onExit(); else void this.model.load(this.search);
      } })
  }

  @Builder
  fileList() {
    Column({ space: 0 }) {
      if (this.searchOpen) {
        Column() {
          XopcPageSearchField({ searchId: 'files-search', text: this.search, placeholder: $r('app.string.search'),
            onChange: (query: string): void => { this.search = query; },
            onSubmit: (): void => { void this.model.load(this.search); } })
        }.width('100%').padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X, bottom: 10 })
      }

      Row({ space: 6 }) {
        if (this.model.space) {
          SymbolGlyph($r('sys.symbol.folder')).fontSize(15).fontColor([this.colors.secondary])
        }
        Text(this.model.space ? this.model.space.title + (this.model.directory ? ' / ' + this.model.directory : '') : $r('app.string.recent_files'))
          .fontColor(this.colors.secondary).fontSize(13).fontWeight(FontWeight.Medium)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%').padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X, bottom: 10 })

      Refresh({ refreshing: this.model.busy && (this.model.items.length > 0 || this.model.spaces.length > 0) }) {
        List({ space: 0 }) {
          if (!this.model.busy && this.model.error && !this.model.items.length && !this.model.spaces.length) {
            ListItem() {
              XopcErrorState({ error: this.model.error, context: 'collection',
                onAction: (): void => { void this.model.load(this.search); } })
            }
          }
          if (!this.model.space && !this.search.trim()) {
            ForEach(this.model.spaces, (space: XopcFileSpace) => {
              ListItem() {
                XopcHubRow({ heading: space.title, symbol: $r('sys.symbol.folder'),
                  compact: true,
                  onOpen: (): void => { void this.model.choose(space); } })
              }
            }, (space: XopcFileSpace): string => space.id)
          }
          ForEach(this.model.items, (file: XopcFile) => {
            ListItem() {
              XopcHubRow({ heading: file.name, summary: this.fileSummary(file),
                compact: true,
                symbol: file.kind === 'directory' ? $r('sys.symbol.folder') : $r('sys.symbol.doc'),
                onOpen: (): void => { void this.model.open(file); } })
            }.bindContextMenu(this.hasContextActions(file) ? this.fileContextMenu(file) : undefined, ResponseType.LongPress, {
              hapticFeedbackMode: HapticFeedbackMode.ENABLED,
            })
          }, (file: XopcFile): string => file.id)
          if (!this.model.busy && !this.model.error && !this.model.items.length && (!!this.model.space || !!this.search.trim() || !this.model.spaces.length)) {
            ListItem() {
              XopcEmptyHint({ message: $r('app.string.no_files'), centered: true })
            }
          }
        }.layoutWeight(1).width('100%').padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X }).scrollBar(BarState.Off)
      }.layoutWeight(1).width('100%').pullToRefresh(!this.model.busy)
        .onRefreshing((): void => { void this.model.load(this.search); })

      Row({ space: 6 }) {
        SymbolGlyph($r('sys.symbol.info_circle')).fontSize(13).fontColor([this.colors.tertiary])
        Text($r('app.string.transfer_limits')).fontSize(11).fontColor(this.colors.tertiary)
      }.height(36).width('100%').justifyContent(FlexAlign.Center)
        .backgroundColor(this.colors.grouped)
    }.layoutWeight(1).width('100%')
  }

  build() {
    NavDestination() {
      Stack({ alignContent: Alignment.Top }) {
        Column() {
          if (this.model.error && (this.model.items.length > 0 || this.model.spaces.length > 0)) {
            Column() {
              XopcInlineBanner({
                message: userErrorMessage(this.model.error, 'generic'),
                actionLabel: !this.model.busy && !this.model.selected ? $r('app.string.retry') : '',
                busy: this.model.busy,
                onAction: (): void => { void this.model.load(this.search); },
              })
            }.width('100%').padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X, top: XOPC_PAGE_HEADER_HEIGHT_VP, bottom: 8 })
          }
          if (this.model.busy && !!this.initialId && !this.model.selected) {
            Column() { XopcBrandLoading() }.width('100%').padding({ top: XOPC_PAGE_HEADER_HEIGHT_VP })
          } else {
            Column() { this.fileList() }.width('100%').layoutWeight(1)
              .padding({ top: this.model.error && (this.model.items.length > 0 || this.model.spaces.length > 0) ? 0 : XOPC_PAGE_HEADER_HEIGHT_VP })
          }
          if (this.model.selected) { this.fileDetail(this.model.selected) }
        }.height('100%').width('100%')
        XopcPageHeader({
          heading: this.model.space ? this.model.space.title : $r('app.string.files'),
          showStaticTitle: true,
          backVisible: true,
          backId: 'files-back',
          backEnabled: this.searchOpen || !this.model.busy,
          onBack: (): void => { void this.goBack(); },
          searchId: !this.model.selected ? 'files-open-search' : '',
          searchOpen: this.searchOpen,
          onSearch: (): void => { this.toggleSearch(); },
          actionLabel: this.model.space?.writable && !this.model.selected ? $r('app.string.upload') : '',
          actionIcon: $r('sys.symbol.plus'),
          actionTone: 'accent',
          actionEnabled: !this.model.busy,
          onAction: (): void => {
            const context = this.getUIContext().getHostContext();
            if (context) void this.model.upload(context);
          },
        })
      }.height('100%').width('100%').backgroundColor(this.colors.surface)
        .bindSheet($$this.shareOpen, this.shareSheet, xopcSheetOptions('immersive', { backgroundColor: this.colors.panel }))
    }.hideTitleBar(true).backgroundColor(this.colors.surface).onBackPressed((): boolean => {
      void this.goBack(); return true;
    })
  }
}
