import { XopcLocalRecording } from '../service/discussionRecordingStore';
import { common } from '@kit.AbilityKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcMobileRoute } from '../model/home';
import { XopcNoteIndexEntry } from '../model/note';
import { XopcNoteViewModel } from '../viewmodel/noteViewModel';
import { XopcFilesViewModel } from '../viewmodel/filesViewModel';
import { XopcFile } from '../model/files';
import { XopcEmptyHint, XopcListSkeleton, XopcPageHeader } from './MobileComponents';
import { XopcNotesView } from './NotesView';
import { userErrorMessage } from '../common/userError';
import { discussionCapture, XopcDiscussionCapture } from '../service/discussionCapture';
import { xopcFormatCaptureTime } from '../common/discussionAudio';

/** Notes tab. Files remain a peer destination, not a competing default. */
@ComponentV2
export struct XopcNotesTabView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local capture: XopcDiscussionCapture = discussionCapture;
  @Param activePage: boolean = false;
  @Param bottomInset: number = 0;
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Event onStartVoice: () => void = (): void => {};
  @Local model: XopcNoteViewModel = new XopcNoteViewModel();
  @Local files: XopcFilesViewModel = new XopcFilesViewModel();
  @Local contentWidth: number = 0;
  @Local selectedId: string = '';
  @Local recoveriesOpen: boolean = false;
  @Local creationSheetOpen: boolean = false;
  @Local pendingCreation: string = '';
  private initialized: boolean = false;

  aboutToAppear(): void { this.updateActivity(); }
  aboutToDisappear(): void { this.model.dispose(); this.files.dispose(); this.initialized = false; }

  private searchAll(): void {
    void this.model.list();
    if (this.model.search.trim()) void this.files.load(this.model.search);
    else this.files.items = [];
  }

  private openNote(id: string): void {
    if (this.contentWidth >= 840) this.selectedId = id;
    else this.onNavigate({ page: 'notes', itemId: id });
  }

  private finishCreationSheet(): void {
    const action = this.pendingCreation;
    this.pendingCreation = '';
    if (action === 'text') this.onNavigate({ page: 'note-create', itemId: '' });
    else if (action === 'voice') this.onStartVoice();
  }

  @Builder
  creationSheet() {
    Column({ space: 10 }) {
      Text($r('app.string.new_note')).fontSize(20).fontWeight(FontWeight.Bold)
        .fontColor(this.colors.foreground).width('100%').padding({ bottom: 6 })
      Button({ type: ButtonType.Normal }) {
        Row({ space: 14 }) {
          SymbolGlyph($r('sys.symbol.doc')).fontSize(22).fontColor([this.colors.accent])
          Text($r('app.string.note_text_option')).fontSize(16).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.Start)
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([this.colors.tertiary])
        }.width('100%').height(56).padding({ left: 16, right: 16 })
      }.id('notes-create-text').width('100%').padding(0).borderRadius(16).backgroundColor(this.colors.input)
        .onClick((): void => { this.pendingCreation = 'text'; this.creationSheetOpen = false; })
      Button({ type: ButtonType.Normal }) {
        Row({ space: 14 }) {
          SymbolGlyph($r('sys.symbol.mic')).fontSize(22).fontColor([this.colors.danger])
          Column({ space: 2 }) {
            Text($r('app.string.note_voice_option')).fontSize(16).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.foreground)
            Text($r('app.string.capture_start_hint')).fontSize(12).fontColor(this.colors.secondary)
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([this.colors.tertiary])
        }.width('100%').height(64).padding({ left: 16, right: 16 })
      }.id('notes-create-voice').width('100%').padding(0).borderRadius(16).backgroundColor(this.colors.input)
        .onClick((): void => { this.pendingCreation = 'voice'; this.creationSheetOpen = false; })
    }.width('100%').padding({ left: 20, right: 20, top: 10, bottom: 16 })
  }

  @Monitor('activePage')
  updateActivity(): void {
    if (!this.activePage) return;
    void this.capture.refreshPending(this.getUIContext().getHostContext() as common.UIAbilityContext);
    if (!this.initialized) {
      this.initialized = true;
      const context = this.getUIContext().getHostContext() as common.Context;
      void this.model.start(context);
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

  @Builder
  listPane() {
    Column() {
      XopcPageHeader({ heading: $r('app.string.notes'), actionLabel: $r('app.string.new_note'),
        actionIcon: $r('sys.symbol.plus'), onAction: (): void => { this.creationSheetOpen = true; } })
      Row({ space: 8 }) {
        TextInput({ text: this.model.search, placeholder: $r('app.string.search_notes') }).layoutWeight(1).height(44)
          .backgroundColor(this.colors.input).borderRadius(14).onChange((value: string): void => { this.model.search = value; })
          .onSubmit((): void => { this.searchAll(); })
        Button() { SymbolGlyph($r('sys.symbol.folder')).fontSize(20).fontColor([this.colors.secondary]) }
          .width(44).height(44).padding(0).borderRadius(14).backgroundColor(this.colors.input)
          .accessibilityText($r('app.string.files')).onClick((): void => { this.onNavigate({ page: 'files', itemId: '' }); })
      }.width('100%').padding({ left: 20, right: 20, bottom: 12 })
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
      if (this.model.loading && !this.model.items.length && !this.files.items.length) {
        Column() { XopcListSkeleton() }.width('100%').padding({ left: 20, right: 20 })
      } else if (!this.model.items.length && !this.files.items.length && !this.model.error) {
        Column() { XopcEmptyHint({ message: $r('app.string.no_notes') }) }.width('100%').padding({ left: 20, right: 20 })
      } else {
        List({ space: 12 }) {
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
                    if (item.tags?.length) {
                      Text(item.tags.slice(0, 2).map((tag: string): string => '#' + tag).join('  '))
                        .fontSize(12).fontColor(this.colors.accent).maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                    }
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                  SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([this.colors.tertiary])
                }.width('100%').padding({ left: 16, right: 14, top: 16, bottom: 16 })
              }.width('100%').constraintSize({ minHeight: 96 }).padding(0).borderRadius(16).backgroundColor(this.colors.panel)
                .onClick((): void => { this.openNote(item.id); })
            }
          }, (item: XopcNoteIndexEntry): string => item.id + ':' + item.updatedAt)
          if (this.model.hasMore) {
            ListItem() { Button($r('app.string.load_more')).width('100%').height(44).enabled(!this.model.loadingMore)
              .onClick((): void => { void this.model.list(true); }) }
          }
          if (this.model.search.trim() && this.files.items.length) {
            ListItem() { Text($r('app.string.files')).fontSize(15).fontWeight(FontWeight.Bold)
              .fontColor(this.colors.secondary).padding({ top: 14, bottom: 6 }).width('100%') }
            ForEach(this.files.items, (file: XopcFile) => {
              ListItem() {
                Button({ type: ButtonType.Normal }) {
                  Row({ space: 12 }) {
                    SymbolGlyph(file.kind === 'directory' ? $r('sys.symbol.folder') : $r('sys.symbol.doc'))
                      .fontSize(20).fontColor([this.colors.secondary])
                    Column({ space: 4 }) {
                      Text(file.name).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
                        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                      Text(file.relativePath).fontSize(12).fontColor(this.colors.tertiary).maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                  }.width('100%').padding(14)
                }.width('100%').padding(0).borderRadius(16).backgroundColor(this.colors.panel)
                  .onClick((): void => { this.onNavigate({ page: 'files', itemId: file.id }); })
              }
            }, (file: XopcFile): string => file.id)
          }
        }.layoutWeight(1).width('100%').padding({ left: 20, right: 20 }).scrollBar(BarState.Off)
          .contentEndOffset(this.bottomInset)
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
      .bindSheet($$this.creationSheetOpen, this.creationSheet, {
        height: 244, dragBar: true, showClose: false, backgroundColor: this.colors.surface,
        onDisappear: (): void => { this.finishCreationSheet(); }
      })
  }
}
