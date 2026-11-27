import { XOPC_PAGE_PADDING_X, xopcMoreIcon } from '../common/designTokens';
import { xopcConfirmDialog } from '../common/dialogActions';
import { xopcClickEffect, xopcPagerAnimated, xopcPagerDuration, xopcRevealTransition } from '../common/motionTokens';
import { SEGMENTED_PAGE_TAP_SLOP_VP } from './SegmentedTabs';
import { generatedMusicPlayback, XopcGeneratedMusicPlayback } from '../service/generatedMusicPlayback';
import { XopcMusicMiniPlayer } from './MusicPlaybackView';
import { XopcLocalRecording } from '../service/discussionRecordingStore';
import { common } from '@kit.AbilityKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcMobileRoute } from '../model/home';
import { XopcNoteIndexEntry, XopcNoteProjectReference, XopcNoteStatus } from '../model/note';
import { XopcNoteViewModel } from '../viewmodel/noteViewModel';
import {
  XopcBatchActionBar,
  XopcEmptyHint,
  XopcErrorState,
  XopcInlineBanner,
  XopcListSkeleton,
  XopcPageHeader,
  XopcPageSearchField,
  XopcPageTitleOption,
  XopcPaginationFooter,
} from './MobileComponents';
import { XopcNotesView } from './NotesView';
import { userErrorMessage } from '../common/userError';
import { discussionCapture, XopcDiscussionCapture } from '../service/discussionCapture';
import { xopcFormatCaptureTime } from '../common/discussionAudio';
import { formatNoteTimestamp } from '../common/notePresentation';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { appSettings } from '../service/settings';

@ComponentV2
export struct XopcNotesTabView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Local music: XopcGeneratedMusicPlayback = generatedMusicPlayback;
  @Local capture: XopcDiscussionCapture = discussionCapture;
  @Param activePage: boolean = false;
  @Param rootTab: boolean = false;
  @Param bottomChromeInset: number = 0;
  @Param scrollTopRevision: number = 0;
  @Param recordingAvailable: boolean = false;
  @Param initialStatus: XopcNoteStatus | '' = '';
  @Local searchText: string = '';
  @Local searchOpen: boolean = false;
  @Event onExit: () => void = (): void => {};
  @Event onOpenSidebar: () => void = (): void => {};
  @Event onBackHandler: (handler?: () => boolean) => void = (_handler?: () => boolean): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Event onStartVoice: () => void = (): void => {};
  @Local model: XopcNoteViewModel = new XopcNoteViewModel();
  @Local contentWidth: number = 0;
  @Local selectedId: string = '';
  @Local recoveriesOpen: boolean = false;
  private initialized: boolean = false;
  private listScroller: Scroller = new Scroller();
  private pager: SwiperController = new SwiperController();
  private readonly statusOptions: XopcPageTitleOption[] = [
    { key: '', label: $r('app.string.note_all'), id: 'notes-status-all' },
    { key: 'inbox', label: $r('app.string.inbox'), id: 'notes-status-inbox' },
    { key: 'processed', label: $r('app.string.note_processed'), id: 'notes-status-processed' },
    { key: 'archived', label: $r('app.string.archive'), id: 'notes-status-archived' },
  ];

  private statusIndex(): number {
    return Math.max(0, this.statusOptions.findIndex((option: XopcPageTitleOption): boolean => option.key === this.model.status));
  }

  private currentStatusLabel(): ResourceStr {
    return this.statusOptions[this.statusIndex()]?.label ?? $r('app.string.note_all');
  }

  private selectStatus(key: string): void {
    const target = this.statusOptions.findIndex((option: XopcPageTitleOption): boolean => option.key === key);
    if (target < 0 || key === this.model.status) return;
    this.pager.changeIndex(target, xopcPagerAnimated(this.layout.reduceMotion, target - this.statusIndex()));
  }

  private commitStatus(index: number): void {
    const next = this.statusOptions[index]?.key ?? '';
    if (next === this.model.status) return;
    this.model.status = next as XopcNoteStatus | '';
    void this.model.list(false, true);
  }

  aboutToAppear(): void {
    this.onBackHandler((): boolean => this.back());
    this.updateActivity();
  }
  aboutToDisappear(): void {
    this.onBackHandler();
    this.model.dispose();
    this.initialized = false;
  }

  private back(): boolean {
    if (this.model.saving) return true;
    if (this.model.selecting) { this.model.clearSelection(); return true; }
    if (this.searchOpen) { this.toggleSearch(); return true; }
    return false;
  }

  private stackBottomInset(): number {
    return this.model.selecting || (this.activePage && !!this.music.track) ? 0 : this.bottomChromeInset;
  }

  private allSelectedPinned(): boolean {
    if (!this.model.selectedIds.length) return false;
    let remoteCount = 0;
    for (const id of this.model.selectedIds) {
      if (id.startsWith('local:')) continue;
      const item = this.model.items.find((entry: XopcNoteIndexEntry): boolean => entry.id === id);
      if (!item || !item.pinned) return false;
      remoteCount++;
    }
    return remoteCount > 0;
  }

  private searchAll(): void {
    this.model.search = this.searchText.trim();
    void this.model.list(false, true);
  }

  private toggleSearch(): void {
    this.searchOpen = !this.searchOpen;
    if (!this.searchOpen) {
      this.getUIContext().getFocusController().clearFocus();
      this.searchText = '';
      if (this.model.search) this.searchAll();
    }
  }

  private openNote(id: string): void {
    if (this.contentWidth >= 840) this.selectedId = id;
    else this.onNavigate({ page: 'notes', itemId: id });
  }

  @Monitor('activePage')
  updateActivity(): void {
    if (!this.activePage) return;
    void this.capture.refreshPending(this.getUIContext().getHostContext() as common.UIAbilityContext);
    if (!this.initialized) {
      this.initialized = true;
      const context = this.getUIContext().getHostContext() as common.Context;
      void this.model.start(context, '', this.initialStatus);
    } else {
      void this.model.list();
    }
  }

  @Monitor('capture.phase')
  refreshSavedRecording(): void {
    if (this.activePage && this.initialized && this.capture.phase === 'completed') void this.model.list(false, true);
  }

  @Monitor('scrollTopRevision')
  onScrollTop(): void {
    if (this.scrollTopRevision > 0) this.listScroller.scrollEdge(Edge.Top);
  }

  private recordingLabel(): Resource {
    if (!this.recordingAvailable) return $r('app.string.notes_action_record');
    switch (this.capture.phase) {
      case 'recording': return this.capture.captureStatus === 'recording'
        ? $r('app.string.capture_live') : $r('app.string.notes_action_recording_waiting');
      case 'paused': return $r('app.string.capture_paused');
      case 'stopping':
      case 'organizing': return $r('app.string.capture_saving');
      case 'completed': return this.capture.localSaveComplete || this.capture.syncStatus === 'available'
        ? $r('app.string.notes_action_recording_saved') : $r('app.string.capture_open_details');
      default: return $r('app.string.capture_open_details');
    }
  }

  @Builder
  captureActions() {
    Row({ space: 4 }) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 6 }) {
          if (this.capture.phase === 'recording' || this.capture.phase === 'paused') {
            Row() {}.width(7).height(7).borderRadius(4)
              .backgroundColor(this.capture.captureStatus === 'recording' ? this.colors.danger : this.colors.secondary)
          } else {
            SymbolGlyph($r('sys.symbol.mic')).fontSize(18).fontColor([this.colors.secondary])
          }
          Text(this.recordingLabel()).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).maxLines(1)
          if (this.capture.phase === 'recording' || this.capture.phase === 'paused') {
            Text(xopcFormatCaptureTime(this.capture.elapsedMs)).fontSize(12).fontFamily('monospace').fontColor(this.colors.secondary)
          }
        }.justifyContent(FlexAlign.Center)
      }.id('notes-create-voice').height(46).padding({ left: 12, right: 12 })
        .borderRadius(23).backgroundColor(Color.Transparent)
        .onClick((): void => {
          this.getUIContext().getFocusController().clearFocus();
          this.onStartVoice();
        })
      if (!this.model.selecting) {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 6 }) {
            SymbolGlyph($r('sys.symbol.square_and_pencil')).fontSize(18).fontColor([this.colors.accent])
            Text($r('app.string.new_note')).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.accent).maxLines(1)
          }.justifyContent(FlexAlign.Center)
        }.id('notes-create-text').height(46).padding({ left: 14, right: 14 })
          .borderRadius(23).backgroundColor(this.colors.accentSoft).accessibilityText($r('app.string.new_note'))
          .onClick((): void => {
            this.getUIContext().getFocusController().clearFocus();
            this.onNavigate({ page: 'note-create', itemId: '' });
          })
      }
    }.id('notes-capture-actions').padding(5).margin({ bottom: 12 + this.stackBottomInset() })
      .borderRadius(30).backgroundColor(this.colors.panel)
  }

  private async restoreRecording(id: string): Promise<void> {
    if (this.capture.recoveryBusy) return;
    const noteId = await this.capture.recoverRecording(this.getUIContext().getHostContext() as common.UIAbilityContext, id);
    if (!noteId || this.capture.phase === 'error') return;
    this.capture.reset();
    void this.model.list();
    this.onNavigate({ page: 'notes', itemId: noteId });
  }

  private async confirmRecordingDiscard(id: string): Promise<void> {
    try {
      const confirmed = await xopcConfirmDialog(this.getUIContext(), {
        title: $r('app.string.capture_discard_title'),
        message: $r('app.string.capture_discard_message'),
        confirmLabel: $r('app.string.capture_discard'),
        destructive: true,
      });
      if (confirmed) {
        await this.capture.discardRecording(this.getUIContext().getHostContext() as common.UIAbilityContext, id);
      }
    } catch (error) { this.model.error = (error as Error).message; }
  }

  private recoveryMenu(recording: XopcLocalRecording): MenuElement[] {
    return [
      { value: $r('app.string.capture_continue'), enabled: !recording.sealRequested,
        action: (): void => {
          void this.capture.continueRecording(this.getUIContext().getHostContext() as common.UIAbilityContext, recording.id);
        } },
      { value: $r('app.string.capture_export'), action: (): void => {
        void this.capture.exportRecording(this.getUIContext().getHostContext() as common.UIAbilityContext, recording.id);
      } },
      { value: $r('app.string.capture_discard'), action: (): void => { void this.confirmRecordingDiscard(recording.id); } }
    ];
  }

  @Builder
  recoveryHeader() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 10 }) {
        Row() {
          SymbolGlyph($r('sys.symbol.mic')).fontSize(17).fontColor([this.colors.accent])
        }.width(32).height(32).justifyContent(FlexAlign.Center)
          .borderRadius(this.colors.corner(8)).backgroundColor(this.colors.accentSoft)
        Text($r('app.string.capture_recovery_list')).fontSize(14).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.Start)
        Text(this.capture.pendingRecordings.length.toString()).fontSize(12).fontColor(this.colors.secondary)
        SymbolGlyph(this.recoveriesOpen ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
          .fontSize(12).fontColor([this.colors.secondary])
      }.width('100%')
    }.id('notes-recovery-toggle').width('100%').constraintSize({ minHeight: 52 })
      .padding({ left: 12, right: 14, top: 6, bottom: 6 })
      .borderRadius(this.colors.corner(14)).backgroundColor(this.colors.panel)
      .onClick((): void => { this.recoveriesOpen = !this.recoveriesOpen; })
  }

  @Builder
  recoveryRow(recording: XopcLocalRecording) {
    Column({ space: 4 }) {
      Text(formatNoteTimestamp(recording.recordedAt, appSettings.effectiveLanguage()))
        .fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
      Text($r('app.string.capture_local_saved', xopcFormatCaptureTime(recording.savedDurationMs ?? 0)))
        .fontSize(12).fontColor(this.colors.secondary).width('100%')
      if (recording.recoveryError) {
        Text($r('app.string.capture_storage_failed')).fontSize(12).fontColor(this.colors.danger).width('100%')
      }
      Row({ space: 8 }) {
        Button($r('app.string.capture_recover_action'), { type: ButtonType.Normal })
          .id('notes-recovery-restore-' + recording.id).constraintSize({ minHeight: 44 }).fontSize(13)
          .fontWeight(FontWeight.Medium).fontColor(this.colors.accent).backgroundColor(this.colors.accentSoft)
          .padding({ left: 14, right: 14 }).borderRadius(this.colors.corner(10)).enabled(!this.capture.recoveryBusy)
          .onClick((): void => { void this.restoreRecording(recording.id); })
        Blank().layoutWeight(1)
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph(xopcMoreIcon()).fontSize(20).fontColor([this.colors.secondary])
        }.id('notes-recovery-more-' + recording.id).width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .clickEffect(xopcClickEffect())
          .enabled(!this.capture.recoveryBusy).accessibilityText($r('app.string.more'))
          .bindMenu(this.recoveryMenu(recording), { placement: Placement.BottomRight })
      }.width('100%').margin({ top: 4 })
    }.width('100%').padding(12).alignItems(HorizontalAlign.Start)
      .borderRadius(this.colors.corner(14)).backgroundColor(this.colors.panel)
      .transition(xopcRevealTransition(TransitionEdge.TOP, this.layout.reduceMotion))
  }

  private async confirmBatchDelete(): Promise<void> {
    try {
      const confirmed = await xopcConfirmDialog(this.getUIContext(), {
        title: $r('app.string.delete'),
        message: $r('app.string.notes_delete_selection_confirm'),
        confirmLabel: $r('app.string.delete'),
        destructive: true,
      });
      if (confirmed) await this.model.batch('delete');
    } catch (error) { this.model.error = (error as Error).message; }
  }

  @Builder
  private notesListBody() {
    Refresh({ refreshing: this.model.loading && this.model.items.length > 0 }) {
      List({ space: 8, scroller: this.listScroller }) {
        if (this.capture.pendingRecordings.length && this.capture.phase !== 'recording' && this.capture.phase !== 'paused') {
          ListItem() { this.recoveryHeader() }
          if (this.recoveriesOpen) {
            ForEach(this.capture.pendingRecordings, (recording: XopcLocalRecording) => {
              ListItem() { this.recoveryRow(recording) }
            }, (recording: XopcLocalRecording): string => recording.id + ':' + (recording.savedDurationMs ?? 0) +
              ':' + (recording.sealRequested ?? false) + ':' + (recording.recoveryError ?? ''))
          }
        }
        if (this.model.loading && !this.model.items.length) {
          ListItem() { XopcListSkeleton() }
        } else if (this.model.error && !this.model.items.length) {
          ListItem() {
            XopcErrorState({ error: this.model.error, context: 'collection',
              onAction: (): void => { void this.model.list(); } })
          }
        } else if (!this.model.items.length) {
          ListItem() { XopcEmptyHint({ message: $r('app.string.no_notes'), centered: true }) }
        }
        ForEach(this.model.items, (item: XopcNoteIndexEntry) => {
          ListItem() {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 12 }) {
                if (item.kind === 'voice') {
                  Row() {
                    SymbolGlyph($r('sys.symbol.waveform')).fontSize(17).fontColor([this.colors.accent])
                  }.width(36).height(36).justifyContent(FlexAlign.Center)
                    .borderRadius(this.colors.corner(10)).backgroundColor(this.colors.accentSoft)
                }
                Column({ space: 5 }) {
                  Row({ space: 6 }) {
                    if (item.pinned) { SymbolGlyph($r('sys.symbol.pin')).fontSize(13).fontColor([this.colors.accent]) }
                    Text(item.kind === 'voice' && /^Discussion · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(item.title) ? $r('app.string.note_voice_option') : item.title || $r('app.string.untitled')).fontSize(16).fontWeight(FontWeight.Medium)
                      .fontColor(this.colors.foreground).layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  }.width('100%')
                  if (item.snippet) {
                    Text(item.snippet).fontSize(14).lineHeight(20).fontColor(this.colors.secondary)
                      .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                  }
                  Text(item.projects?.length
                    ? formatNoteTimestamp(item.updatedAt, appSettings.effectiveLanguage()) + ' · ' +
                      item.projects.map((project: XopcNoteProjectReference): string => project.name).join(' · ')
                    : formatNoteTimestamp(item.updatedAt, appSettings.effectiveLanguage()))
                    .fontSize(12).fontColor(this.colors.tertiary).maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                  if (item.tags?.length) {
                    Text(item.tags.slice(0, 2).map((tag: string): string => '#' + tag).join('  '))
                      .fontSize(12).fontColor(this.colors.accent).maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                  }
                }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                if (this.model.selecting) {
                  SymbolGlyph(this.model.selectedIds.includes(item.id) ? $r('sys.symbol.checkmark_circle_fill')
                    : $r('sys.symbol.circle')).fontSize(21)
                    .fontColor([this.model.selectedIds.includes(item.id) ? this.colors.accent : this.colors.tertiary])
                } else {
                  SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.tertiary])
                }
              }.width('100%').padding({ left: 16, right: 14, top: 14, bottom: 14 })
            }.width('100%').constraintSize({ minHeight: item.kind === 'voice' ? 72 : 84 }).padding(0)
              .backgroundColor(this.model.selecting && this.model.selectedIds.includes(item.id) ? this.colors.active : this.colors.panel)
              .borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16))
              .accessibilitySelected(this.model.selecting && this.model.selectedIds.includes(item.id))
              .clickEffect(xopcClickEffect())
              .onClick((): void => {
                if (this.model.selecting) this.model.toggleSelection(item.id);
                else this.openNote(item.id);
              }, SEGMENTED_PAGE_TAP_SLOP_VP)
              .gesture(LongPressGesture({ duration: 350, repeat: false }).onAction((): void => {
                this.model.toggleSelection(item.id);
              }))
          }
        }, (item: XopcNoteIndexEntry): string => item.id + ':' + item.updatedAt + ':' + (item.pinned ? '1' : '0'))
        if (this.model.hasMore) {
          ListItem() {
            XopcPaginationFooter({ loadingPage: this.model.loading || this.model.loadingMore, failedPage: !!this.model.error,
              onLoad: (): void => { void this.model.list(true); } })
          }
        }
      }.width('100%').height('100%').padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X }).scrollBar(BarState.Off)
        .contentEndOffset((!this.model.selecting || this.recordingAvailable ? 72 : 12) + this.stackBottomInset())
    }.width('100%').height('100%').pullToRefresh(!this.model.loading)
      .onRefreshing((): void => { void this.model.list(false, true); })
  }

  @Builder
  batchBar() {
    XopcBatchActionBar({ barId: 'notes-batch-bar', barEnabled: !this.model.saving && this.model.selectedIds.length > 0 }) {
      Button() {
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.pin')).fontSize(18).fontColor([this.colors.secondary])
          Text(this.allSelectedPinned() ? $r('app.string.unpin') : $r('app.string.pin')).fontSize(11).fontColor(this.colors.tertiary)
        }
      }.id('notes-batch-pin').layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent)
        .enabled(!this.model.saving).clickEffect(xopcClickEffect())
        .accessibilityText(this.allSelectedPinned() ? $r('app.string.unpin') : $r('app.string.pin'))
        .onClick((): void => { void this.model.batch(this.allSelectedPinned() ? 'unpin' : 'pin'); })
      Button() {
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.archivebox')).fontSize(18).fontColor([this.colors.secondary])
          Text($r('app.string.archive')).fontSize(11).fontColor(this.colors.tertiary)
        }
      }.id('notes-batch-archive').layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent)
        .enabled(!this.model.saving).clickEffect(xopcClickEffect()).accessibilityText($r('app.string.archive'))
        .onClick((): void => { void this.model.batch('archive'); })
      Button() {
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.trash')).fontSize(18).fontColor([this.colors.danger])
          Text($r('app.string.delete')).fontSize(11).fontColor(this.colors.danger)
        }
      }.id('notes-batch-delete').layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent)
        .enabled(!this.model.saving).clickEffect(xopcClickEffect()).accessibilityText($r('app.string.delete'))
        .onClick((): void => { void this.confirmBatchDelete(); })
      Button() {
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(18).fontColor([this.colors.secondary])
          Text($r('app.string.cancel')).fontSize(11).fontColor(this.colors.tertiary)
        }
      }.id('notes-batch-cancel').layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent)
        .clickEffect(xopcClickEffect()).accessibilityText($r('app.string.cancel'))
        .onClick((): void => { this.model.clearSelection(); })
    }
  }

  @Builder
  listPane() {
    Column() {
      XopcPageHeader({ heading: this.currentStatusLabel(),
        selectionTitle: this.model.selecting ? $r('app.string.sessions_selected', this.model.selectedIds.length) : '',
        titleOptions: this.statusOptions,
        selectedTitle: this.model.status, titleMenuId: 'notes-page-menu',
        onSelectTitle: (key: string): void => { this.selectStatus(key); },
        backVisible: !this.rootTab || this.model.selecting, backId: 'notes-back',
        onBack: (): void => { if (!this.back()) this.onExit(); },
        drawerVisible: this.rootTab && !this.model.selecting, drawerId: 'notes-header-sidebar', onOpenDrawer: this.onOpenSidebar,
        searchId: 'notes-open-search', searchOpen: this.searchOpen, searchLabel: $r('app.string.search_notes'),
        onSearch: (): void => { this.toggleSearch(); } })
      if (this.searchOpen && !this.model.selecting) {
        Column() {
          XopcPageSearchField({ searchId: 'notes-search', text: this.searchText, placeholder: $r('app.string.search_notes'),
            onChange: (value: string): void => { this.searchText = value; }, onSubmit: (): void => { this.searchAll(); } })
        }.padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X, bottom: 12 })
      }
      if (this.model.error && this.model.items.length > 0) {
        Column() {
          XopcInlineBanner({
            message: userErrorMessage(this.model.error, 'collection'),
            actionLabel: $r('app.string.retry'),
            busy: this.model.loading,
            onAction: (): void => { void this.model.list(); },
          })
        }.width('100%').padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X, bottom: 8 })
      }
      Stack({ alignContent: Alignment.Bottom }) {
        Swiper(this.pager) {
          ForEach(this.statusOptions, (option: XopcPageTitleOption) => {
            Column() {
              if (option.key === this.model.status) {
                this.notesListBody()
              } else {
                Column() { XopcListSkeleton() }.width('100%').padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X })
              }
            }.width('100%').height('100%')
              .accessibilityLevel(option.key === this.model.status ? 'auto' : 'no-hide-descendants')
          }, (option: XopcPageTitleOption): string => option.key || 'all')
        }.id('notes-tab-pager').index(this.statusIndex()).loop(false).indicator(false).cachedCount(1)
          .duration(xopcPagerDuration(this.layout.reduceMotion)).disableSwipe(true)
          .onChange((index: number): void => { this.commitStatus(index); })
          .width('100%').height('100%')
        if (!this.model.selecting || this.recordingAvailable) this.captureActions()
      }.layoutWeight(1).width('100%')
      if (this.model.selecting) {
        Column() { this.batchBar() }.width('100%')
          .padding({ bottom: this.activePage && this.music.track ? 0 : this.bottomChromeInset })
      }
      if (this.activePage && this.music.track) {
        Column() { XopcMusicMiniPlayer() }.width('100%')
          .padding({ top: 4, bottom: this.bottomChromeInset > 0 ? this.bottomChromeInset + 8 : 4 })
      }
    }.id('notes-tab-list-pane').width(this.contentWidth >= 840 ? 400 : '100%').height('100%')
      .backgroundColor(this.contentWidth >= 840 ? this.colors.grouped : Color.Transparent)
  }

  build() {
    Stack({ alignContent: Alignment.Top }) {
        Row() {
        this.listPane()
        if (this.contentWidth >= 840) {
          if (this.selectedId) {
            XopcNotesView({ initialId: this.selectedId, embedded: true, onExit: (): void => {
              this.selectedId = ''; void this.model.list();
            }, onOpenConversation: (id: string): void => { this.onNavigate({ page: 'chat', itemId: id }); } })
          } else {
            Column({ space: 12 }) {
              SymbolGlyph($r('sys.symbol.doc')).fontSize(42).fontColor([this.colors.tertiary])
              Text($r('app.string.note_select_hint')).fontSize(16).fontColor(this.colors.secondary)
            }.layoutWeight(1).height('100%').justifyContent(FlexAlign.Center)
          }
        }
        }.id('notes-tab-content-viewport').width('100%').height('100%')
          .clip(true)
    }.id('notes-tab-root').width('100%').height('100%').backgroundColor(this.colors.surface)
      .onAreaChange((_previous: Area, current: Area): void => { this.contentWidth = Number(current.width); })
  }
}
