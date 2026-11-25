import { SEGMENTED_PAGE_TAP_SLOP_VP, XopcSegmentedTabs } from './SegmentedTabs';
import { generatedMusicPlayback, XopcGeneratedMusicPlayback } from '../service/generatedMusicPlayback';
import { XopcMusicMiniPlayer } from './MusicPlaybackView';
import { XopcLocalRecording } from '../service/discussionRecordingStore';
import { common } from '@kit.AbilityKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcMobileRoute } from '../model/home';
import { XopcNoteIndexEntry, XopcNoteProjectReference, XopcNoteStatus } from '../model/note';
import { XopcNoteViewModel } from '../viewmodel/noteViewModel';
import { XopcEmptyHint, XopcListSkeleton, XopcPageHeader, XopcPageSearchField, XopcPaginationFooter } from './MobileComponents';
import { XopcNotesView } from './NotesView';
import { userErrorMessage } from '../common/userError';
import { discussionCapture, XopcDiscussionCapture } from '../service/discussionCapture';
import { xopcFormatCaptureTime } from '../common/discussionAudio';
import { formatNoteTimestamp } from '../common/notePresentation';
import { appSettings } from '../service/settings';

@ComponentV2
export struct XopcNotesTabView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local music: XopcGeneratedMusicPlayback = generatedMusicPlayback;
  @Local capture: XopcDiscussionCapture = discussionCapture;
  @Param activePage: boolean = false;
  @Param recordingAvailable: boolean = false;
  @Param initialStatus: XopcNoteStatus | '' = '';
  @Local searchText: string = '';
  @Local searchOpen: boolean = false;
  @Event onExit: () => void = (): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Event onStartVoice: () => void = (): void => {};
  @Local model: XopcNoteViewModel = new XopcNoteViewModel();
  @Local contentWidth: number = 0;
  @Local selectedId: string = '';
  @Local recoveriesOpen: boolean = false;
  private initialized: boolean = false;

  aboutToAppear(): void { this.updateActivity(); }
  aboutToDisappear(): void { this.model.dispose(); this.initialized = false; }

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
    }.id('notes-capture-actions').padding(5).margin({ bottom: 12 })
      .borderRadius(30).backgroundColor(this.colors.panel).shadow(ShadowStyle.OUTER_DEFAULT_SM)
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
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: $r('app.string.capture_discard_title'), message: $r('app.string.capture_discard_message'),
        buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
          { text: $r('app.string.capture_discard'), color: this.colors.danger }]
      });
      if (result.index === 1) {
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
          SymbolGlyph($r('sys.symbol.ellipsis_circle')).fontSize(20).fontColor([this.colors.secondary])
        }.id('notes-recovery-more-' + recording.id).width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .enabled(!this.capture.recoveryBusy).accessibilityText($r('app.string.more'))
          .bindMenu(this.recoveryMenu(recording), { placement: Placement.BottomRight })
      }.width('100%').margin({ top: 4 })
    }.width('100%').padding(12).alignItems(HorizontalAlign.Start)
      .borderRadius(this.colors.corner(14)).backgroundColor(this.colors.panel)
  }

  private async confirmBatchDelete(): Promise<void> {
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: $r('app.string.delete'), message: $r('app.string.notes_delete_selection_confirm'),
        buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
          { text: $r('app.string.delete'), color: this.colors.danger }]
      });
      if (result.index === 1) await this.model.batch('delete');
    } catch (error) { this.model.error = (error as Error).message; }
  }

  @Builder
  listPane() {
    Column() {
      XopcPageHeader({ heading: $r('app.string.notes'), showStaticTitle: true, backVisible: true, onBack: this.onExit,
        searchId: 'notes-open-search', searchOpen: this.searchOpen, searchLabel: $r('app.string.search_notes'),
        onSearch: (): void => { this.toggleSearch(); } })
      if (this.searchOpen) {
        Column() {
          XopcPageSearchField({ searchId: 'notes-search', text: this.searchText, placeholder: $r('app.string.search_notes'),
            onChange: (value: string): void => { this.searchText = value; }, onSubmit: (): void => { this.searchAll(); } })
        }.padding({ left: 20, right: 20, bottom: 12 })
      }
      Row() {
        XopcSegmentedTabs({ options: [
          { key: '', label: $r('app.string.note_all') },
          { key: 'inbox', label: $r('app.string.inbox') },
          { key: 'processed', label: $r('app.string.note_processed') },
          { key: 'archived', label: $r('app.string.archive') }
        ], selectedKey: this.model.status, onSelect: (key: string): void => {
          this.model.status = key as XopcNoteStatus | '';
          void this.model.list(false, true);
        } }).layoutWeight(1)
      }.width('100%').padding({ left: 20, right: 20, bottom: 8 })
      if (this.model.error) {
        Row({ space: 12 }) {
          Text(userErrorMessage(this.model.error, 'collection')).fontSize(13).fontColor(this.colors.secondary)
            .layoutWeight(1)
          Button($r('app.string.retry')).fontSize(13).fontColor(this.colors.accent)
            .backgroundColor(Color.Transparent).padding(0).height(36)
            .onClick((): void => { void this.model.list(); })
        }.width('100%').padding({ left: 20, right: 20, bottom: 8 })
      }
      Stack({ alignContent: Alignment.Bottom }) {
        List({ space: 8 }) {
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
          } else if (!this.model.items.length && !this.model.error) {
            ListItem() { XopcEmptyHint({ message: $r('app.string.no_notes') }) }
          }
          ForEach(this.model.items, (item: XopcNoteIndexEntry) => {
            ListItem() {
              Button({ type: ButtonType.Normal }) {
                Row({ space: 12 }) {
                  if (item.kind === 'voice') {
                    Row() {
                      SymbolGlyph($r('sys.symbol.mic')).fontSize(17).fontColor([this.colors.secondary])
                    }.width(32).height(32).justifyContent(FlexAlign.Center)
                      .borderRadius(this.colors.corner(8)).backgroundColor(this.colors.input)
                  }
                  Column({ space: 5 }) {
                    Row({ space: 6 }) {
                      if (item.pinned) { SymbolGlyph($r('sys.symbol.pin')).fontSize(13).fontColor([this.colors.accent]) }
                      Text(item.kind === 'voice' && /^Discussion · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(item.title) ? $r('app.string.note_voice_option') : item.title || $r('app.string.untitled')).fontSize(17).fontWeight(FontWeight.Medium)
                        .fontColor(this.colors.foreground).layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                    }.width('100%')
                    if (item.snippet) {
                      Text(item.snippet).fontSize(14).lineHeight(20).fontColor(this.colors.secondary)
                        .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                    }
                    Text(formatNoteTimestamp(item.updatedAt, appSettings.effectiveLanguage()))
                      .fontSize(12).fontColor(this.colors.tertiary).width('100%')
                    if (item.projects?.length) {
                      Text(item.projects.map((project: XopcNoteProjectReference): string => project.name).join(' · '))
                        .fontSize(12).fontColor(this.colors.secondary).maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                    }
                    if (item.tags?.length) {
                      Text(item.tags.slice(0, 2).map((tag: string): string => '#' + tag).join('  '))
                        .fontSize(12).fontColor(this.colors.accent).maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                    }
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                  SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([this.colors.tertiary])
                  if (this.model.selecting) {
                    SymbolGlyph(this.model.selectedIds.includes(item.id) ? $r('sys.symbol.checkmark_circle_fill')
                      : $r('sys.symbol.circle')).fontSize(21).fontColor([this.colors.accent])
                  }
                }.width('100%').padding({ left: 16, right: 14, top: 16, bottom: 16 })
              }.width('100%').constraintSize({ minHeight: item.kind === 'voice' ? 72 : 96 }).padding(0)
                .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16))
                .onClick((): void => {
                  if (this.model.selecting) this.model.toggleSelection(item.id);
                  else this.openNote(item.id);
                }, SEGMENTED_PAGE_TAP_SLOP_VP)
                .gesture(LongPressGesture({ duration: 350, repeat: false }).onAction((): void => {
                  this.model.toggleSelection(item.id);
                }))
            }
          }, (item: XopcNoteIndexEntry): string => item.id + ':' + item.updatedAt)
          if (this.model.hasMore) {
            ListItem() {
              XopcPaginationFooter({ loadingPage: this.model.loading || this.model.loadingMore, failedPage: !!this.model.error,
                onLoad: (): void => { void this.model.list(true); } })
            }
          }
        }.width('100%').height('100%').padding({ left: 20, right: 20 }).scrollBar(BarState.Off)
          .contentEndOffset(!this.model.selecting || this.recordingAvailable ? 72 : 0)
        if (!this.model.selecting || this.recordingAvailable) this.captureActions()
      }.layoutWeight(1).width('100%')
      if (this.model.selecting) {
        Row({ space: 4 }) {
          Button($r('app.string.pin')).layoutWeight(1).height(44).enabled(!this.model.saving)
            .onClick((): void => { void this.model.batch('pin'); })
          Button($r('app.string.archive')).layoutWeight(1).height(44).enabled(!this.model.saving)
            .onClick((): void => { void this.model.batch('archive'); })
          Button($r('app.string.delete')).layoutWeight(1).height(44).fontColor(this.colors.danger).enabled(!this.model.saving)
            .onClick((): void => { void this.confirmBatchDelete(); })
          Button($r('app.string.cancel')).layoutWeight(1).height(44).onClick((): void => { this.model.clearSelection(); })
        }.width('100%').padding({ left: 20, right: 20, bottom: 8 })
      }
      if (this.activePage && this.music.track) {
        XopcMusicMiniPlayer()
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
