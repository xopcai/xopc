import { common } from '@kit.AbilityKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcMobileRoute } from '../model/home';
import { XopcNoteIndexEntry } from '../model/note';
import { XopcNoteViewModel } from '../viewmodel/noteViewModel';
import { XopcFilesViewModel } from '../viewmodel/filesViewModel';
import { XopcFile } from '../model/files';
import { XopcEmptyHint, XopcListSkeleton, XopcPageHeader } from './MobileComponents';
import { XopcNotesView } from './NotesView';

/** Notes-first Library tab. Files remain a peer destination, not a competing default. */
@ComponentV2
export struct XopcNotesTabView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param activePage: boolean = false;
  @Param bottomInset: number = 0;
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Local model: XopcNoteViewModel = new XopcNoteViewModel();
  @Local files: XopcFilesViewModel = new XopcFilesViewModel();
  @Local contentWidth: number = 0;
  @Local selectedId: string = '';
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
        actionIcon: $r('sys.symbol.plus'), onAction: (): void => { this.onNavigate({ page: 'note-create', itemId: '' }); } })
      Row({ space: 8 }) {
        TextInput({ text: this.model.search, placeholder: $r('app.string.search_notes') }).layoutWeight(1).height(44)
          .backgroundColor(this.colors.input).borderRadius(14).onChange((value: string): void => { this.model.search = value; })
          .onSubmit((): void => { this.searchAll(); })
        Button() { SymbolGlyph($r('sys.symbol.folder')).fontSize(20).fontColor([this.colors.secondary]) }
          .width(44).height(44).padding(0).borderRadius(14).backgroundColor(this.colors.input)
          .accessibilityText($r('app.string.files')).onClick((): void => { this.onNavigate({ page: 'files', itemId: '' }); })
      }.width('100%').padding({ left: 20, right: 20, bottom: 12 })
      if (this.model.error) {
        Text(this.model.error).fontSize(13).fontColor(this.colors.danger).width('100%').padding({ left: 20, right: 20, bottom: 8 })
      }
      if (this.model.loading) {
        Column() { XopcListSkeleton() }.width('100%').padding({ left: 20, right: 20 })
      } else if (!this.model.items.length && !this.files.items.length) {
        Column() { XopcEmptyHint({ message: $r('app.string.no_notes') }) }.width('100%').padding({ left: 20, right: 20 })
      } else {
        List({ space: 8 }) {
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
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                  SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([this.colors.tertiary])
                }.width('100%').padding({ left: 16, right: 14, top: 14, bottom: 14 })
              }.width('100%').padding(0).borderRadius(16).backgroundColor(this.colors.panel)
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
  }
}
