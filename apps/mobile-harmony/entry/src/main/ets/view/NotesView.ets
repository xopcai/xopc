import { common } from '@kit.AbilityKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcNote, XopcNoteAttachment, XopcNoteHistoryEntry, XopcNoteIndexEntry, XopcNoteStatus } from '../model/note';
import { XopcHistoryMedia } from '../model/chat';
import { XopcShareResult } from '../model/share';
import { shareService } from '../service/shareService';
import { XopcNoteViewModel } from '../viewmodel/noteViewModel';
import { XopcMarkdownView } from './MarkdownView';
import { XopcEmptyHint, XopcHubRow, XopcListSkeleton } from './MobileComponents';
import { XopcNativeNoteEditor } from './NativeNoteEditor';
import { XopcShareResultView } from './ShareResultView';
import { XopcVoiceCapture } from '../service/voiceCapture';
import { XopcChatMediaView } from './ChatMediaView';

/** Dedicated native note list/detail/editor. Notes no longer depend on the generic workspace screen. */
@ComponentV2
export struct XopcNotesView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param initialId: string = '';
  @Param initialStatus: XopcNoteStatus | '' = '';
  @Param createOnAppear: boolean = false;
  @Param embedded: boolean = false;
  @Event onExit: () => void = (): void => {};
  @Event onOpenConversation: (id: string) => void = (_id: string): void => {};
  @Local model: XopcNoteViewModel = new XopcNoteViewModel();
  @Local aiInstruction: string = '';
  @Local tagsText: string = '';
  @Local historyOpen: boolean = false;
  @Local aiOpen: boolean = false;
  @Local shareOpen: boolean = false;
  @Local tagsOpen: boolean = false;
  @Local moreOpen: boolean = false;
  @Local attachmentOpen: boolean = false;
  @Local voiceOpen: boolean = false;
  @Local shareResult?: XopcShareResult;
  @Local voice: XopcVoiceCapture = new XopcVoiceCapture();

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.Context;
    void this.start(context);
  }

  private async start(context: common.Context): Promise<void> {
    await this.model.start(context, this.initialId, this.initialStatus);
    if (this.createOnAppear && !this.model.draft) this.model.create();
  }

  aboutToDisappear(): void { void this.model.saveNow(); this.model.dispose(); void this.voice.cancel(); }

  @Monitor('initialId')
  onInitialIdChanged(): void { if (this.initialId) void this.model.open(this.initialId); }

  private back(): void {
    if (this.model.editing) { void this.model.closeEditor(); return; }
    if (this.embedded) { this.onExit(); return; }
    if (this.model.selected || this.model.draft) { this.model.backToList(); return; }
    this.onExit();
  }

  private syncText(): ResourceStr {
    if (this.model.saving || this.model.draft?.syncState === 'saving') return $r('app.string.note_sync_saving');
    if (this.model.draft?.syncState === 'offline') return $r('app.string.note_sync_offline');
    if (this.model.draft?.syncState === 'conflict') return $r('app.string.note_sync_conflict');
    if (this.model.draft?.syncState === 'dirty') return $r('app.string.note_sync_pending');
    return $r('app.string.note_sync_saved');
  }

  private statusLabel(status: XopcNoteStatus): ResourceStr {
    if (status === 'inbox') return $r('app.string.inbox');
    if (status === 'archived') return $r('app.string.archive');
    if (status === 'trashed') return $r('app.string.delete');
    return $r('app.string.note_processed');
  }

  private async confirmDelete(): Promise<void> {
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: $r('app.string.delete'), message: $r('app.string.note_delete_confirm'),
        buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
          { text: $r('app.string.delete'), color: this.colors.danger }]
      });
      if (result.index === 1) {
        await this.model.remove();
        if (this.embedded && !this.model.selected) this.onExit();
      }
    } catch (error) { this.model.error = (error as Error).message; }
  }

  private async share(note: XopcNote): Promise<void> {
    try {
      this.shareResult = await shareService.note(note.id, note.remoteVersion ?? 1); this.shareOpen = true;
    } catch (error) { this.model.error = (error as Error).message; }
  }

  private attach(source: 'file' | 'photo' | 'camera'): void {
    this.attachmentOpen = false;
    const context = this.getUIContext().getHostContext() as common.Context;
    void this.model.attach(context, source);
  }

  private recordVoice(): void {
    this.attachmentOpen = false; this.voiceOpen = true;
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    void this.voice.start(context);
  }

  private async continueInChat(): Promise<void> {
    const conversationId = await this.model.openConversation();
    if (conversationId) this.onOpenConversation(conversationId);
  }

  private attachmentMedia(note: XopcNote, attachment: XopcNoteAttachment): XopcHistoryMedia {
    return {
      id: attachment.id, name: attachment.fileName, type: attachment.type, mimeType: attachment.mimeType,
      size: attachment.size, duration: attachment.duration,
      uri: 'xopc-attachment://notes/' + encodeURIComponent(note.id) + '/' + encodeURIComponent(attachment.id)
    };
  }

  @Builder
  noteAttachment(note: XopcNote, attachment: XopcNoteAttachment, editing: boolean = false) {
    if (attachment.type === 'audio') {
      XopcChatMediaView({ file: this.attachmentMedia(note, attachment), conversationId: note.id, inlineVoice: true })
        .padding({ left: 8, right: 8 }).borderRadius(12).backgroundColor(this.colors.input)
    } else {
      XopcChatMediaView({ file: this.attachmentMedia(note, attachment), conversationId: note.id, compact: true,
        compactThumbnail: attachment.type === 'image', compactAvailable: true, embedded: editing })
    }
  }

  @Builder
  header() {
    Row({ space: 8 }) {
      Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([this.colors.foreground]) }
        .width(44).height(44).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.back')).onClick((): void => { this.back(); })
      Text(this.model.selected || this.model.draft ? $r('app.string.notes') : $r('app.string.library'))
        .fontSize(24).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).layoutWeight(1)
      if (this.model.draft) {
        Text(this.syncText()).fontSize(12).fontColor(this.model.draft.syncState === 'conflict' ? this.colors.danger : this.colors.secondary)
      }
      if (!this.model.selected && !this.model.draft) {
        Button() { SymbolGlyph($r('sys.symbol.plus')).fontSize(22).fontColor([this.colors.accent]) }
          .width(44).height(44).padding(0).backgroundColor(this.colors.accentSoft).borderRadius(22)
          .accessibilityText($r('app.string.new_note')).onClick((): void => { this.model.create(); })
      }
    }.width('100%').padding({ left: 12, right: 16, top: 10, bottom: 8 })
  }

  @Builder
  filterChip(label: ResourceStr, status: XopcNoteStatus | '') {
    Button(label).fontSize(13).fontColor(this.model.status === status ? Color.White : this.colors.secondary)
      .height(36).padding({ left: 14, right: 14 }).borderRadius(18)
      .backgroundColor(this.model.status === status ? this.colors.accent : this.colors.input)
      .onClick((): void => { this.model.status = status; void this.model.list(); })
  }

  @Builder
  list() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        TextInput({ text: this.model.search, placeholder: $r('app.string.search_notes') })
          .layoutWeight(1).height(44).backgroundColor(this.colors.input).borderRadius(14)
          .onChange((value: string): void => { this.model.search = value; })
          .onSubmit((): void => { void this.model.list(); })
        Button() { SymbolGlyph($r('sys.symbol.arrow_clockwise')).fontSize(20).fontColor([this.colors.secondary]) }
          .width(44).height(44).padding(0).backgroundColor(this.colors.input).borderRadius(14)
          .accessibilityText($r('app.string.refresh')).onClick((): void => { void this.model.list(); })
      }.width('100%')
      Scroll() {
        Row({ space: 8 }) {
          this.filterChip($r('app.string.note_all'), '')
          this.filterChip($r('app.string.inbox'), 'inbox')
          this.filterChip($r('app.string.note_processed'), 'processed')
          this.filterChip($r('app.string.archive'), 'archived')
        }
      }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%')
      if (this.model.loading) {
        XopcListSkeleton()
      } else if (!this.model.items.length) {
        XopcEmptyHint({ message: $r('app.string.no_notes') })
      } else {
        List({ space: 2 }) {
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
                    Row({ space: 8 }) {
                      Text(new Date(item.updatedAt).toLocaleDateString()).fontSize(12).fontColor(this.colors.tertiary)
                      Text(this.statusLabel(item.status)).fontSize(12).fontColor(this.colors.tertiary)
                      if (item.tags?.length) { Text(item.tags.slice(0, 2).map((tag: string): string => '#' + tag).join(' ')).fontSize(12).fontColor(this.colors.accent) }
                    }.width('100%')
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                  SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([this.colors.tertiary])
                  if (this.model.selecting) {
                    SymbolGlyph(this.model.selectedIds.includes(item.id) ? $r('sys.symbol.checkmark_circle_fill')
                      : $r('sys.symbol.circle')).fontSize(21).fontColor([this.colors.accent])
                  }
                }.width('100%').padding({ left: 16, right: 14, top: 14, bottom: 14 })
              }.width('100%').padding(0).borderRadius(16).backgroundColor(this.colors.panel)
                .onClick((): void => { if (this.model.selecting) this.model.toggleSelection(item.id); else void this.model.open(item.id); })
                .gesture(LongPressGesture({ duration: 350, repeat: false }).onAction((): void => { this.model.toggleSelection(item.id); }))
            }
          }, (item: XopcNoteIndexEntry): string => item.id + ':' + item.updatedAt)
          if (this.model.hasMore) {
            ListItem() { Button($r('app.string.load_more')).width('100%').height(44).enabled(!this.model.loadingMore)
              .onClick((): void => { void this.model.list(true); }) }
          }
        }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
      }
      if (this.model.selecting) {
        Row({ space: 4 }) {
          Button($r('app.string.pin')).layoutWeight(1).height(44).enabled(!this.model.saving)
            .onClick((): void => { void this.model.batch('pin'); })
          Button($r('app.string.archive')).layoutWeight(1).height(44).enabled(!this.model.saving)
            .onClick((): void => { void this.model.batch('archive'); })
          Button($r('app.string.delete')).layoutWeight(1).height(44).fontColor(this.colors.danger).enabled(!this.model.saving)
            .onClick((): void => { void this.model.batch('delete'); })
          Button($r('app.string.cancel')).layoutWeight(1).height(44).onClick((): void => { this.model.clearSelection(); })
        }.width('100%').padding({ top: 4 })
      }
    }.layoutWeight(1).width('100%').padding({ left: 20, right: 20, bottom: 16 }).alignItems(HorizontalAlign.Start)
  }

  @Builder
  conflictCard() {
    if (this.model.remoteConflict) {
      Column({ space: 10 }) {
        Text($r('app.string.note_conflict_title')).fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.colors.danger)
        Text($r('app.string.note_conflict_help')).fontSize(13).lineHeight(19).fontColor(this.colors.secondary)
        Row({ space: 8 }) {
          Button($r('app.string.note_use_remote')).layoutWeight(1).height(42).backgroundColor(this.colors.input)
            .fontColor(this.colors.foreground).onClick((): void => { void this.model.resolveConflict(false); })
          Button($r('app.string.note_keep_local')).layoutWeight(1).height(42).backgroundColor(this.colors.accent)
            .fontColor(Color.White).onClick((): void => { void this.model.resolveConflict(true); })
        }.width('100%')
      }.width('100%').padding(14).borderRadius(14).backgroundColor(this.colors.accentSoft)
    }
  }

  @Builder
  editor() {
    Column({ space: 8 }) {
      this.conflictCard()
      TextInput({ text: this.model.draft?.title ?? '', placeholder: $r('app.string.note_title_placeholder') })
        .width('100%').fontSize(25).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
        .backgroundColor(Color.Transparent).onChange((value: string): void => { this.model.updateTitle(value); })
      XopcNativeNoteEditor({ markdown: this.model.draft?.markdown ?? '', revision: this.model.editorRevision,
        onChange: (value: string): void => { this.model.updateMarkdown(value); },
        onSelection: (value: string): void => { this.model.selectedText = value; } })
      if (this.model.selected?.attachments?.length) {
        Scroll() {
          Row({ space: 8 }) {
            ForEach(this.model.selected.attachments, (attachment: XopcNoteAttachment) => {
              Column() { this.noteAttachment(this.model.selected as XopcNote, attachment, true) }.width(220)
            }, (attachment: XopcNoteAttachment): string => attachment.id)
          }
        }.width('100%').scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
      }
      Row({ space: 8 }) {
        Button($r('app.string.note_add_attachment')).layoutWeight(1).height(42).backgroundColor(this.colors.input)
          .fontColor(this.colors.foreground).enabled(!this.model.saving).onClick((): void => { this.attachmentOpen = true; })
        Button($r('app.string.note_done')).layoutWeight(1).height(42).backgroundColor(this.colors.accent)
          .fontColor(Color.White).enabled(!this.model.saving).onClick((): void => { void this.model.closeEditor(); })
      }.width('100%')
    }.layoutWeight(1).width('100%').padding({ left: 20, right: 20, bottom: 12 }).alignItems(HorizontalAlign.Start)
  }

  @Builder
  detailAction(label: ResourceStr, symbol: Resource, emphasized: boolean, handleTap: () => void) {
    Button() {
      Column({ space: 5 }) {
        SymbolGlyph(symbol).fontSize(20).fontColor([emphasized ? this.colors.accent : this.colors.secondary])
        Text(label).fontSize(12).fontWeight(FontWeight.Medium)
          .fontColor(emphasized ? this.colors.accent : this.colors.foreground)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%').justifyContent(FlexAlign.Center)
    }.layoutWeight(1).height(64).padding(0).borderRadius(14)
      .backgroundColor(emphasized ? this.colors.accentSoft : this.colors.input)
      .onClick((): void => { handleTap(); })
  }

  @Builder
  detail() {
    if (this.model.selected) {
      List({ space: 0 }) {
        ListItem() {
          Column({ space: 16 }) {
            Column({ space: 7 }) {
              Text(this.model.selected.title || $r('app.string.untitled')).fontSize(27).lineHeight(34).fontWeight(FontWeight.Bold)
                .fontColor(this.colors.foreground).width('100%')
              Row({ space: 8 }) {
                Text(new Date(this.model.selected.updatedAt).toLocaleString()).fontSize(12).fontColor(this.colors.tertiary)
                Text(this.statusLabel(this.model.selected.status)).fontSize(12).fontColor(this.colors.secondary)
              }.width('100%')
            }.width('100%').alignItems(HorizontalAlign.Start)

            Row({ space: 8 }) {
              if (this.model.selected.tags?.length) {
                Scroll() {
                  Row({ space: 6 }) {
                    ForEach(this.model.selected.tags, (tag: string) => {
                      Text('#' + tag).fontSize(12).fontColor(this.colors.accent)
                        .height(30).padding({ left: 10, right: 10 }).borderRadius(15).backgroundColor(this.colors.accentSoft)
                    }, (tag: string): string => tag)
                  }
                }.layoutWeight(1).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
              } else {
                Text($r('app.string.note_manage_tags')).layoutWeight(1).fontSize(13).fontColor(this.colors.tertiary)
              }
              Button() { SymbolGlyph($r('sys.symbol.flag')).fontSize(18).fontColor([this.colors.secondary]) }
                .width(38).height(38).padding(0).borderRadius(12).backgroundColor(this.colors.input)
                .accessibilityText($r('app.string.note_manage_tags')).onClick((): void => {
                  this.tagsText = this.model.selected?.tags?.join(', ') ?? ''; this.tagsOpen = true;
                })
            }.width('100%').alignItems(VerticalAlign.Center)

            XopcMarkdownView({ content: this.model.selected.markdown, conversationId: this.model.selected.id })
            if (this.model.selected.attachments?.length) {
              Column({ space: 8 }) {
                ForEach(this.model.selected.attachments, (attachment: XopcNoteAttachment) => {
                  this.noteAttachment(this.model.selected as XopcNote, attachment)
                }, (attachment: XopcNoteAttachment): string => attachment.id)
              }.width('100%')
            }

            Button() {
              Row({ space: 8 }) {
                SymbolGlyph($r('sys.symbol.message')).fontSize(19).fontColor([Color.White])
                Text($r('app.string.note_continue_chat')).fontSize(15).fontWeight(FontWeight.Medium).fontColor(Color.White)
              }.width('100%').justifyContent(FlexAlign.Center)
            }.width('100%').height(46).padding(0).borderRadius(14).backgroundColor(this.colors.accent)
              .enabled(!this.model.openingConversation && !this.model.saving)
              .onClick((): void => { void this.continueInChat(); })

            Row({ space: 8 }) {
              this.detailAction($r('app.string.edit'), $r('sys.symbol.pencil_line'), true,
                (): void => { this.model.editing = true; })
              this.detailAction($r('app.string.note_ai_edit'), $r('sys.symbol.star'), false,
                (): void => { this.aiOpen = true; })
              this.detailAction($r('app.string.history'), $r('sys.symbol.clock'), false, (): void => {
                void this.model.loadHistory().then((): void => { this.historyOpen = true; });
              })
              this.detailAction($r('app.string.more'), $r('sys.symbol.ellipsis_circle'), false,
                (): void => { this.moreOpen = true; })
            }.width('100%')
          }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: 30 }).alignItems(HorizontalAlign.Start)
        }
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off).edgeEffect(EdgeEffect.Spring)
    }
  }

  @Builder
  moreSheet() {
    Column({ space: 8 }) {
      Text($r('app.string.more')).fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
        .width('100%').margin({ bottom: 4 })
      XopcHubRow({ heading: this.model.selected?.pinned ? $r('app.string.unpin') : $r('app.string.pin'),
        symbol: $r('sys.symbol.pin'), compact: true, onOpen: (): void => {
          this.moreOpen = false; void this.model.togglePin();
        } })
      XopcHubRow({ heading: $r('app.string.note_manage_tags'), symbol: $r('sys.symbol.flag'), compact: true,
        onOpen: (): void => {
          this.tagsText = this.model.selected?.tags?.join(', ') ?? ''; this.moreOpen = false; this.tagsOpen = true;
        } })
      XopcHubRow({ heading: $r('app.string.chat_share'), symbol: $r('sys.symbol.share'), compact: true,
        onOpen: (): void => {
          const note = this.model.selected; this.moreOpen = false; if (note) void this.share(note);
        } })
      XopcHubRow({ heading: $r('app.string.archive'), symbol: $r('sys.symbol.archivebox'), compact: true,
        onOpen: (): void => { this.moreOpen = false; void this.model.archive(); } })
      Button() {
        Row({ space: 10 }) {
          SymbolGlyph($r('sys.symbol.trash')).fontSize(19).fontColor([this.colors.danger])
          Text($r('app.string.delete')).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.danger)
        }.width('100%').padding({ left: 12, right: 12 })
      }.width('100%').height(48).padding(0).borderRadius(12).backgroundColor(Color.Transparent)
        .onClick((): void => { this.moreOpen = false; void this.confirmDelete(); })
    }.width('100%').padding({ left: 20, right: 20, top: 4, bottom: 20 })
      .backgroundColor(this.colors.surface).alignItems(HorizontalAlign.Start)
  }

  @Builder
  historySheet() {
    Column({ space: 12 }) {
      Text($r('app.string.note_version_history')).fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).width('100%')
      if (this.model.snapshot) {
        Scroll() { Column({ space: 12 }) {
          XopcMarkdownView({ content: this.model.snapshot?.markdown ?? '' })
          Button($r('app.string.note_restore_version')).width('100%').height(44).backgroundColor(this.colors.accent).fontColor(Color.White)
            .onClick((): void => { this.model.restoreSnapshotToDraft(); this.historyOpen = false; })
        }.width('100%').alignItems(HorizontalAlign.Start) }.layoutWeight(1).width('100%')
      } else {
        List({ space: 8 }) {
          ForEach(this.model.history, (entry: XopcNoteHistoryEntry) => {
            ListItem() { XopcHubRow({ heading: new Date(entry.timestamp).toLocaleString(), summary: entry.snippet ?? entry.trigger,
              symbol: $r('sys.symbol.clock'), onOpen: (): void => { void this.model.loadSnapshot(entry.timestamp); } }) }
          }, (entry: XopcNoteHistoryEntry): string => entry.timestamp.toString())
        }.layoutWeight(1).width('100%')
      }
    }.width('100%').height('100%').padding(20).backgroundColor(this.colors.surface).alignItems(HorizontalAlign.Start)
  }

  @Builder
  aiSheet() {
    Column({ space: 14 }) {
      Text($r('app.string.note_ai_edit')).fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).width('100%')
      if (this.model.aiPreview) {
        Text(this.model.aiPreview?.patch.summary ?? '').fontSize(14).lineHeight(20).fontColor(this.colors.secondary).width('100%')
        Scroll() {
          Column({ space: 12 }) {
            Text($r('app.string.note_ai_before')).fontSize(13).fontWeight(FontWeight.Bold).fontColor(this.colors.tertiary).width('100%')
            Column() { XopcMarkdownView({ content: this.model.aiOriginalMarkdown() }) }
              .width('100%').padding(12).borderRadius(12).backgroundColor(this.colors.input)
            Text($r('app.string.note_ai_after')).fontSize(13).fontWeight(FontWeight.Bold).fontColor(this.colors.accent).width('100%')
            Column() { XopcMarkdownView({ content: this.model.aiPreviewMarkdown() }) }
              .width('100%').padding(12).borderRadius(12).backgroundColor(this.colors.accentSoft)
          }.width('100%').alignItems(HorizontalAlign.Start)
        }.layoutWeight(1).width('100%')
        Row({ space: 8 }) {
          Button($r('app.string.cancel')).layoutWeight(1).height(44).backgroundColor(this.colors.input).fontColor(this.colors.foreground)
            .onClick((): void => { this.model.discardAiPreview(); })
          Button($r('app.string.note_apply_ai')).layoutWeight(1).height(44).backgroundColor(this.colors.accent).fontColor(Color.White)
            .onClick((): void => { void this.model.applyAiPreview(); this.aiOpen = false; })
        }.width('100%')
      } else {
        Scroll() {
          Row({ space: 8 }) {
            Button($r('app.string.note_ai_summary')).height(36).onClick((): void => { this.aiInstruction = '总结并提炼核心观点'; })
            Button($r('app.string.note_ai_polish')).height(36).onClick((): void => { this.aiInstruction = '润色并优化结构'; })
            Button($r('app.string.note_ai_todos')).height(36).onClick((): void => { this.aiInstruction = '提取待办事项'; })
          }
        }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%')
        TextArea({ text: this.aiInstruction, placeholder: $r('app.string.note_ai_instruction') }).height(150)
          .backgroundColor(this.colors.input).borderRadius(14).onChange((value: string): void => { this.aiInstruction = value; })
        Button($r('app.string.note_generate_preview')).width('100%').height(46).backgroundColor(this.colors.accent).fontColor(Color.White)
          .enabled(!this.model.loading && Boolean(this.aiInstruction.trim()))
          .onClick((): void => { void this.model.previewAi(this.aiInstruction); })
      }
    }.width('100%').height('100%').padding(20).backgroundColor(this.colors.surface).alignItems(HorizontalAlign.Start)
  }

  @Builder
  shareSheet() { if (this.shareResult) { XopcShareResultView({ share: this.shareResult, onClose: (): void => { this.shareOpen = false; } }) } }

  @Builder
  tagsSheet() {
    Column({ space: 16 }) {
      Text($r('app.string.note_manage_tags')).fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).width('100%')
      TextInput({ text: this.tagsText, placeholder: $r('app.string.note_tags_placeholder') }).height(46)
        .backgroundColor(this.colors.input).borderRadius(14).onChange((value: string): void => { this.tagsText = value; })
      Button($r('app.string.save')).width('100%').height(46).backgroundColor(this.colors.accent).fontColor(Color.White)
        .onClick((): void => {
          void this.model.updateTags(this.tagsText.split(',')).then((): void => { this.tagsOpen = false; });
        })
    }.width('100%').padding(20).backgroundColor(this.colors.surface).alignItems(HorizontalAlign.Start)
  }

  @Builder
  attachmentSheet() {
    Column({ space: 10 }) {
      Text($r('app.string.note_add_attachment')).fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).width('100%')
      Button($r('app.string.note_choose_photo')).width('100%').height(46).onClick((): void => { this.attach('photo'); })
      Button($r('app.string.note_take_photo')).width('100%').height(46).onClick((): void => { this.attach('camera'); })
      Button($r('app.string.note_choose_file')).width('100%').height(46).onClick((): void => { this.attach('file'); })
      Button($r('app.string.note_record_audio')).width('100%').height(46).onClick((): void => { this.recordVoice(); })
    }.width('100%').padding(20).backgroundColor(this.colors.surface).alignItems(HorizontalAlign.Start)
  }

  @Builder
  voiceSheet() {
    Column({ space: 14 }) {
      Text($r('app.string.note_record_audio')).fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).width('100%')
      Text(this.voice.state === 'recording' ? this.voice.seconds.toString() + ' s' : $r('app.string.note_voice_ready'))
        .fontSize(26).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
      if (this.voice.error) { Text(this.voice.error).fontSize(13).fontColor(this.colors.danger).width('100%') }
      if (this.voice.state === 'recording') {
        Button($r('app.string.stop')).width('100%').height(46).enabled(!this.voice.busy)
          .onClick((): void => { void this.voice.stop(); })
      } else if (this.voice.state === 'ready') {
        Row({ space: 8 }) {
          Button($r('app.string.chat_media_play')).layoutWeight(1).height(46).backgroundColor(this.colors.input)
            .fontColor(this.colors.foreground).enabled(!this.voice.busy).onClick((): void => { void this.voice.play(); })
          Button($r('app.string.note_attach_recording')).layoutWeight(1).height(46).backgroundColor(this.colors.accent)
            .fontColor(Color.White).enabled(!this.voice.busy).onClick((): void => {
              void this.voice.send(async (attachment): Promise<boolean> => {
                const result = await this.model.attachPayload(attachment); if (result) this.voiceOpen = false; return result;
              });
            })
        }.width('100%')
      } else if (this.voice.state === 'playing') {
        Button($r('app.string.stop')).width('100%').height(46).enabled(!this.voice.busy)
          .onClick((): void => { void this.voice.stopPlayback(); })
      }
      Button($r('app.string.cancel')).width('100%').height(44).enabled(!this.voice.busy)
        .onClick((): void => { void this.voice.cancel(); this.voiceOpen = false; })
    }.width('100%').padding(20).backgroundColor(this.colors.surface).alignItems(HorizontalAlign.Start)
  }

  @Builder
  page() {
    Column() {
        this.header()
        if (this.model.error) {
          Text(this.model.error).fontSize(13).fontColor(this.colors.danger).width('100%').padding({ left: 20, right: 20, bottom: 8 })
        }
        if (this.model.loading && (this.model.selected || this.initialId)) {
          Column() { XopcListSkeleton() }.padding(20).width('100%')
        } else if (this.model.editing && this.model.draft) {
          this.editor()
        } else if (this.model.selected) {
          this.detail()
        } else {
          this.list()
        }
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
      .bindSheet($$this.historyOpen, this.historySheet, { height: '88%', dragBar: true })
      .bindSheet($$this.aiOpen, this.aiSheet, { height: '76%', dragBar: true })
      .bindSheet($$this.shareOpen, this.shareSheet, { height: '92%', dragBar: false })
      .bindSheet($$this.tagsOpen, this.tagsSheet, { height: 220, dragBar: true })
      .bindSheet($$this.moreOpen, this.moreSheet, { height: 410, dragBar: true })
      .bindSheet($$this.attachmentOpen, this.attachmentSheet, { height: 340, dragBar: true })
      .bindSheet($$this.voiceOpen, this.voiceSheet, { height: 300, dragBar: true })
  }

  build() {
    if (this.embedded) {
      this.page()
    } else {
      NavDestination() { this.page() }.hideTitleBar(true).onBackPressed((): boolean => { this.back(); return true; })
    }
  }
}
