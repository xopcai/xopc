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

  private async finishCapture(): Promise<void> {
    const noteId = await this.capture.stop();
    if (!noteId || this.capture.phase === 'error') return;
    this.capture.reset();
    void this.model.list();
    this.onNavigate({ page: 'notes', itemId: noteId });
  }

  @Builder
  captureControl(label: ResourceStr, symbol: Resource, action: () => void, primary: boolean = false) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 5 }) {
        Row() {
          SymbolGlyph(symbol).fontSize(primary ? 22 : 20)
            .fontColor([primary ? this.colors.panel : this.colors.foreground])
        }.width(primary ? 52 : 44).height(primary ? 52 : 44).borderRadius(primary ? 26 : 22)
          .justifyContent(FlexAlign.Center).backgroundColor(primary ? this.colors.danger : this.colors.input)
        Text(label).fontSize(12).fontColor(this.colors.secondary)
      }
    }.height(76).padding(0).backgroundColor(Color.Transparent).onClick(action)
  }

  @Builder
  capturePane() {
    Column() {
      Row() {
        Text($r('app.string.capture_title')).fontSize(22).fontWeight(FontWeight.Bold)
          .fontColor(this.colors.foreground).layoutWeight(1)
        Row({ space: 7 }) {
          Row() {}.width(7).height(7).borderRadius(4).backgroundColor(this.colors.danger)
          Text(xopcFormatCaptureTime(this.capture.elapsedMs)).fontSize(14).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.secondary)
        }.height(34).padding({ left: 12, right: 12 }).borderRadius(17).backgroundColor(this.colors.input)
      }.width('100%').padding({ left: 20, right: 20, top: 18, bottom: 8 }).alignItems(VerticalAlign.Center)
      Column() {
        Row({ space: 4 }) {
          ForEach([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], (index: number) => {
            Row() {}.width(4).height(7 + Math.max(0.08, this.capture.level) * (10 + (index % 5) * 5))
              .borderRadius(2).backgroundColor(this.capture.phase === 'paused' ? this.colors.border : this.colors.danger)
              .opacity(index % 3 === 0 ? 1 : 0.55)
          }, (index: number): string => index.toString())
        }.height(56).width('100%').justifyContent(FlexAlign.Center)
        if (this.capture.visibleTranscript) {
          Scroll() {
            Column({ space: 12 }) {
              Text(this.capture.visibleTranscript).fontSize(19).lineHeight(31).fontColor(this.colors.foreground)
                .textAlign(TextAlign.Start).width('100%')
              if (!this.capture.realtimeActive && this.capture.transcriptPending) {
                Row({ space: 7 }) {
                  LoadingProgress().width(13).height(13).color(this.colors.secondary)
                  Text($r('app.string.capture_transcribing')).fontSize(13).fontColor(this.colors.secondary)
                }.width('100%')
              }
              if (this.capture.markers.length) {
                Text($r('app.string.capture_markers', this.capture.markers.length)).fontSize(13)
                  .fontColor(this.colors.accent).width('100%').textAlign(TextAlign.Start)
              }
              if (this.capture.error) {
                Text($r('app.string.capture_transcript_delayed')).fontSize(13).fontColor(this.colors.secondary)
                  .width('100%').textAlign(TextAlign.Start)
              }
            }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 24, right: 24, top: 10, bottom: 24 })
          }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
        } else {
          Column({ space: 8 }) {
            Text(this.capture.phase === 'paused' ? $r('app.string.capture_paused') : $r('app.string.capture_listening'))
              .fontSize(20).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
              .width('100%').textAlign(TextAlign.Center)
            Text($r('app.string.capture_listening_hint')).fontSize(14).lineHeight(21).fontColor(this.colors.tertiary)
              .width('100%').textAlign(TextAlign.Center)
            if (!this.capture.realtimeActive && this.capture.transcriptPending) {
              Text($r('app.string.capture_transcribing')).fontSize(13).fontColor(this.colors.secondary)
                .margin({ top: 8 }).width('100%').textAlign(TextAlign.Center)
            }
          }.layoutWeight(1).width('100%').justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
            .padding({ left: 32, right: 32, bottom: 42 })
        }
      }.layoutWeight(1).width('100%')
      if (this.capture.phase === 'recording' || this.capture.phase === 'paused') {
        Row() {
          this.captureControl($r('app.string.capture_marker'), $r('sys.symbol.bookmark'), (): void => { this.capture.mark(); })
          Blank().layoutWeight(1)
          this.captureControl(this.capture.phase === 'paused' ? $r('app.string.resume') : $r('app.string.pause'),
            this.capture.phase === 'paused' ? $r('sys.symbol.play_fill') : $r('sys.symbol.pause_fill'),
            (): void => { this.capture.togglePause(); })
          Blank().layoutWeight(1)
          this.captureControl($r('app.string.capture_finish'), $r('sys.symbol.stop_circle_fill'), (): void => { void this.finishCapture(); }, true)
        }.width('100%').padding({ left: 28, right: 28, top: 8, bottom: this.bottomInset + 12 })
      } else if (this.capture.phase === 'error') {
        Row({ space: 10 }) {
          Button($r('app.string.capture_discard')).layoutWeight(1).height(48).borderRadius(14)
            .backgroundColor(this.colors.input).fontColor(this.colors.secondary)
            .onClick((): void => { void this.capture.discard(); })
          Button($r('app.string.retry')).layoutWeight(1).height(48).borderRadius(14)
            .backgroundColor(this.colors.foreground).fontColor(this.colors.panel)
            .onClick((): void => { void this.finishCapture(); })
        }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: this.bottomInset + 12 })
      } else {
        Row({ space: 10 }) {
          LoadingProgress().width(18).height(18).color(this.colors.accent)
          Text($r('app.string.capture_saving')).fontSize(15).fontColor(this.colors.secondary)
        }.height(64 + this.bottomInset).padding({ bottom: this.bottomInset })
      }
    }.id('notes-live-capture').width('100%').height('100%').alignItems(HorizontalAlign.Center)
      .backgroundColor(this.colors.surface)
  }

  @Monitor('activePage')
  updateActivity(): void {
    if (!this.activePage) return;
    if (!this.initialized) {
      this.initialized = true;
      const context = this.getUIContext().getHostContext() as common.Context;
      void this.model.start(context);
    } else {
      void this.model.list();
    }
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
                      Text(item.title || $r('app.string.untitled')).fontSize(17).fontWeight(FontWeight.Medium)
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
      if (this.capture.active) {
        this.capturePane()
      } else {
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
      }
    }.id('notes-tab-root').width('100%').height('100%').backgroundColor(this.colors.surface)
      .onAreaChange((_previous: Area, current: Area): void => { this.contentWidth = Number(current.width); })
      .bindSheet($$this.creationSheetOpen, this.creationSheet, {
        height: 244, dragBar: true, showClose: false, backgroundColor: this.colors.surface,
        onDisappear: (): void => { this.finishCreationSheet(); }
      })
  }
}
