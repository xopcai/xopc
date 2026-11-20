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

@ComponentV2
export struct XopcNotesTabView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local music: XopcGeneratedMusicPlayback = generatedMusicPlayback;
  @Local capture: XopcDiscussionCapture = discussionCapture;
  @Param activePage: boolean = false;
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

  private async restoreRecording(id: string): Promise<void> {
    if (this.capture.recoveryBusy) return;
    const noteId = await this.capture.recoverRecording(this.getUIContext().getHostContext() as common.UIAbilityContext, id);
    if (!noteId || this.capture.phase === 'error') return;
    this.capture.reset();
    void this.model.list(); this.onNavigate({ page: 'notes', itemId: noteId });
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
      XopcPageHeader({ heading: $r('app.string.notes'), backVisible: true, onBack: this.onExit,
        searchId: 'notes-open-search', searchOpen: this.searchOpen, searchLabel: $r('app.string.search_notes'),
        onSearch: (): void => { this.toggleSearch(); }, actionLabel: $r('app.string.new_note'),
        actionIcon: $r('sys.symbol.plus'), onAction: (): void => { this.onNavigate({ page: 'note-create', itemId: '' }); } })
      if (this.searchOpen) {
        Column() {
          XopcPageSearchField({ searchId: 'notes-search', text: this.searchText, placeholder: $r('app.string.search_notes'),
            onChange: (value: string): void => { this.searchText = value; }, onSubmit: (): void => { this.searchAll(); } })
        }.padding({ left: 20, right: 20, bottom: 12 })
      }
      Row({ space: 8 }) {
        XopcSegmentedTabs({ options: [
          { key: '', label: $r('app.string.note_all') },
          { key: 'inbox', label: $r('app.string.inbox') },
          { key: 'processed', label: $r('app.string.note_processed') },
          { key: 'archived', label: $r('app.string.archive') }
        ], selectedKey: this.model.status, onSelect: (key: string): void => {
          this.model.status = key as XopcNoteStatus | '';
          void this.model.list(false, true);
        } }).layoutWeight(1)
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.mic')).fontSize(20).fontColor([this.colors.foreground])
        }.id('notes-create-voice').width(44).height(44).padding(0).backgroundColor(this.colors.panel)
          .accessibilityText($r('app.string.note_voice_option')).onClick((): void => { this.onStartVoice(); })
      }.width('100%').padding({ left: 20, right: 20, bottom: 8 })
      if (this.capture.pendingRecordings.length && this.capture.phase !== 'recording' && this.capture.phase !== 'paused') {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 8 }) {
            Text($r('app.string.capture_recovery_list')).fontSize(14).fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.Start)
            Text(this.capture.pendingRecordings.length.toString()).fontSize(13).fontColor(this.colors.secondary)
            SymbolGlyph(this.recoveriesOpen ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down')).fontSize(13).fontColor([this.colors.secondary])
          }.width('100%')
        }.width('100%').height(48).padding({ left: 20,right: 20 }).backgroundColor(this.colors.input).onClick((): void => { this.recoveriesOpen = !this.recoveriesOpen; })
        if (this.recoveriesOpen) {
        Scroll() {
        Column({ space: 8 }) {
          Text($r('app.string.capture_recovery_list')).fontSize(16).fontColor(this.colors.foreground)
          ForEach(this.capture.pendingRecordings, (recording: XopcLocalRecording) => {
            Column({ space: 4 }) {
              Text(new Date(recording.recordedAt).toLocaleString()).fontSize(13).fontColor(this.colors.foreground)
              Text(recording.gatewayId + ' · ' + recording.id).fontSize(11).fontColor(this.colors.secondary)
              Text(recording.recoveryError ? $r('app.string.capture_storage_failed') : $r('app.string.capture_local_saved', xopcFormatCaptureTime(recording.savedDurationMs ?? 0))).fontSize(12).fontColor(this.colors.secondary)
              Row({ space: 8 }) {
                Button($r('app.string.retry')).enabled(!this.capture.recoveryBusy)
                  .onClick((): void => { void this.restoreRecording(recording.id); })
                Button($r('app.string.capture_continue')).enabled(!this.capture.recoveryBusy && !recording.sealRequested)
                  .onClick((): void => { void this.capture.continueRecording(this.getUIContext().getHostContext() as common.UIAbilityContext, recording.id); })
              }
              Row({ space: 8 }) {
                Button($r('app.string.capture_export')).enabled(!this.capture.recoveryBusy)
                  .onClick((): void => { void this.capture.exportRecording(this.getUIContext().getHostContext() as common.UIAbilityContext, recording.id); })
                Button($r('app.string.capture_discard')).enabled(!this.capture.recoveryBusy)
                  .onClick((): void => { void this.capture.discardRecording(this.getUIContext().getHostContext() as common.UIAbilityContext, recording.id); })
              }
            }.width('100%').alignItems(HorizontalAlign.Start)
          }, (recording: XopcLocalRecording): string => recording.id)
        }.width('100%').padding(16)
        }.width('100%').height(260)
        }
      }
      if (this.model.error) {
        Row({ space: 12 }) {
          Text(userErrorMessage(this.model.error, 'collection')).fontSize(13).fontColor(this.colors.secondary)
            .layoutWeight(1)
          Button($r('app.string.retry')).fontSize(13).fontColor(this.colors.accent)
            .backgroundColor(Color.Transparent).padding(0).height(36)
            .onClick((): void => { void this.model.list(); })
        }.width('100%').padding({ left: 20, right: 20, bottom: 8 })
      }
        List({ space: 8 }) {
          if (this.model.loading && !this.model.items.length) {
            ListItem() { XopcListSkeleton() }
          } else if (!this.model.items.length && !this.model.error) {
            ListItem() { XopcEmptyHint({ message: $r('app.string.no_notes') }) }
          }
          ForEach(this.model.items, (item: XopcNoteIndexEntry) => {
            ListItem() {
              Button({ type: ButtonType.Normal }) {
                Row({ space: 12 }) {
                  Column({ space: 5 }) {
                    Row({ space: 6 }) {
                      if (item.pinned) { SymbolGlyph($r('sys.symbol.pin')).fontSize(13).fontColor([this.colors.accent]) }
                      Text(item.kind === 'voice' && /^Discussion · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(item.title) ? $r('app.string.note_voice_option') : item.title || $r('app.string.untitled')).fontSize(17).fontWeight(FontWeight.Medium)
                        .fontColor(this.colors.foreground).layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                    }.width('100%')
                    Text(item.snippet ?? '').fontSize(14).lineHeight(20).fontColor(this.colors.secondary)
                      .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                    Text(new Date(item.updatedAt).toLocaleString()).fontSize(12).fontColor(this.colors.tertiary).width('100%')
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
              }.width('100%').constraintSize({ minHeight: 96 }).padding(0)
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
        }.layoutWeight(1).width('100%').padding({ left: 20, right: 20 }).scrollBar(BarState.Off)
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
