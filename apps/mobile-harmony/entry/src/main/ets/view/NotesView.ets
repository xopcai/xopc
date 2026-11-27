import { XOPC_ICON_HEADER, XOPC_PAGE_PADDING_X, xopcBackIcon, xopcMoreIcon } from '../common/designTokens';
import { xopcConfirmDialog, xopcSheetOptions } from '../common/dialogActions';
import { xopcClickEffect } from '../common/motionTokens';
import { markdownBlocks, XopcMarkdownCell, XopcMarkdownTableRow } from '../common/markdown';
import { markdownReadingBlocks } from '../common/markdownLayout';
import { common } from '@kit.AbilityKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcNote, XopcNoteAttachment, XopcNoteHistoryEntry, XopcNoteStatus } from '../model/note';
import { XopcHistoryMedia } from '../model/chat';
import { XopcShareResult } from '../model/share';
import { shareService } from '../service/shareService';
import { XopcNoteViewModel } from '../viewmodel/noteViewModel';
import { XopcMarkdownView } from './MarkdownView';
import {
  XopcBrandLoading,
  XopcEmptyHint,
  XopcErrorState,
  XopcHubRow,
  XopcInlineBanner,
  XopcListSkeleton,
  XopcSheetHeader,
} from './MobileComponents';
import { XopcNativeNoteEditor } from './NativeNoteEditor';
import { XopcShareResultView } from './ShareResultView';
import { XopcVoiceCapture } from '../service/voiceCapture';
import { XopcChatMediaView } from './ChatMediaView';
import { XopcDiscussionReviewPlayer } from './DiscussionReviewPlayer';
import { XopcDiscussionNoteView } from './DiscussionNoteView';
import { userErrorMessage } from '../common/userError';
import { formatNoteTimestamp } from '../common/notePresentation';
import { appSettings } from '../service/settings';

type XopcNoteSheet = 'history' | 'ai' | 'share' | 'tags' | 'more' | 'attachment' | 'voice' | 'reading';

interface XopcNoteReadingEntry {
  index: number;
  text: string;
  level: number;
}

/** Dedicated native note list/detail/editor. Notes no longer depend on the generic workspace screen. */
@ComponentV2
export struct XopcNotesView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param initialId: string = '';
  @Param createOnAppear: boolean = false;
  @Param projectId: string = '';
  @Param embedded: boolean = false;
  @Event onExit: () => void = (): void => {};
  @Event onOpenConversation: (id: string) => void = (_id: string): void => {};
  @Local model: XopcNoteViewModel = new XopcNoteViewModel();
  @Local aiInstruction: string = '';
  @Local tagsText: string = '';
  @Local sheetOpen: boolean = false;
  @Local activeSheet: XopcNoteSheet = 'more';
  @Local shareResult?: XopcShareResult;
  @Local editorPreview?: XopcHistoryMedia;
  @Local voice: XopcVoiceCapture = new XopcVoiceCapture();
  @Local readingQuery: string = '';
  @Local readingTarget: number = -1;
  @Local editorFlush: number = 0;
  private detailScroller: Scroller = new Scroller();
  private pendingReadingJump: number = -1;
  private restoreDetailOffset: number = 0;
  private startTask?: Promise<void>;
  private visible: boolean = false;

  aboutToAppear(): void {
    this.visible = true;
    const context = this.getUIContext().getHostContext() as common.Context;
    this.startTask = this.start(context);
  }

  private async start(context: common.Context): Promise<void> {
    await this.model.start(context, this.initialId, '', this.projectId, !this.createOnAppear);
    if (this.createOnAppear && !this.model.draft) this.model.create(this.projectId);
  }

  aboutToDisappear(): void {
    this.visible = false;
    void this.model.saveNow(); this.model.dispose(); void this.voice.cancel();
  }

  @Monitor('initialId')
  onInitialIdChanged(): void { void this.openInitialIdAfterStart(); }

  private async openInitialIdAfterStart(): Promise<void> {
    const startup = this.startTask;
    if (!startup) return;
    await startup;
    const id = this.initialId;
    if (this.visible && id && this.model.selected?.id !== id && this.model.openingId !== id) {
      this.readingTarget = -1;
      this.restoreDetailOffset = 0;
      this.readingQuery = '';
      await this.model.open(id);
    }
  }

  private openSheet(sheet: XopcNoteSheet): void {
    this.activeSheet = sheet;
    this.sheetOpen = true;
  }

  private sheetHeight(): number | string {
    if (this.activeSheet === 'history' || this.activeSheet === 'reading') return '88%';
    if (this.activeSheet === 'ai') return '76%';
    if (this.activeSheet === 'share') return '92%';
    if (this.activeSheet === 'tags') return 280;
    if (this.activeSheet === 'attachment') return 380;
    if (this.activeSheet === 'voice') return 340;
    return 540;
  }

  private openHistory(): void {
    this.model.snapshot = undefined;
    this.openSheet('history');
    void this.model.loadHistory();
  }

  private back(): void {
    if (this.model.editing) { this.editorFlush++; return; }
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
      const confirmed = await xopcConfirmDialog(this.getUIContext(), {
        title: $r('app.string.delete'),
        message: $r('app.string.note_delete_confirm'),
        confirmLabel: $r('app.string.delete'),
        destructive: true,
      });
      if (confirmed) {
        await this.model.remove();
        if ((this.embedded || this.initialId || this.createOnAppear) && !this.model.selected) this.onExit();
      }
    } catch (error) { this.model.error = (error as Error).message; }
  }

  private async share(note: XopcNote): Promise<void> {
    try {
      this.shareResult = await shareService.note(note.id, note.remoteVersion ?? 1); this.openSheet('share');
    } catch (error) { this.model.error = (error as Error).message; }
  }

  private attach(source: 'file' | 'photo' | 'camera'): void {
    this.sheetOpen = false;
    const context = this.getUIContext().getHostContext() as common.Context;
    void this.model.attach(context, source);
  }

  private recordVoice(): void {
    this.openSheet('voice');
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
  private attachmentInBody(note: XopcNote, attachment: XopcNoteAttachment): boolean {
    const target = 'xopc-attachment://notes/' + encodeURIComponent(note.id) + '/' + encodeURIComponent(attachment.id);
    return note.markdown.includes(target);
  }

  private visibleAttachments(note: XopcNote): XopcNoteAttachment[] {
    return (note.attachments ?? []).filter((attachment: XopcNoteAttachment): boolean => {
      if (this.attachmentInBody(note, attachment)) return false;
      // Recording recovery manifests are kept by Gateway for repair, outside the note content.
      return note.kind !== 'voice' || attachment.mimeType !== 'application/json' ||
        !/^recording-(events|sources)-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\.json$/i.test(attachment.fileName);
    });
  }

  private recordingLabel(note: XopcNote, attachment: XopcNoteAttachment): ResourceStr {
    if (this.visibleAttachments(note).filter((item: XopcNoteAttachment): boolean => item.type === 'audio').length > 1) {
      return attachment.fileName || $r('app.string.note_recording_audio');
    }
    return $r('app.string.note_recording_audio');
  }

  @Builder
  noteAttachment(note: XopcNote, attachment: XopcNoteAttachment, editing: boolean = false) {
    if (attachment.type === 'audio') {
      XopcChatMediaView({ file: this.attachmentMedia(note, attachment), conversationId: note.id, inlineVoice: true,
        noteRecordingLabel: note.kind === 'voice' && !editing ? this.recordingLabel(note, attachment) : '' })
        .padding({ left: 8, right: 8 }).borderRadius(this.colors.corner(12)).backgroundColor(this.colors.input)
    } else if (attachment.type === 'image') {
      XopcChatMediaView({ file: this.attachmentMedia(note, attachment), conversationId: note.id,
        noteInlineImage: true })
    } else {
      XopcChatMediaView({ file: this.attachmentMedia(note, attachment), conversationId: note.id, compact: true,
        compactAvailable: true, embedded: editing })
    }
  }

  @Builder
  header() {
    Row({ space: 8 }) {
      if (!this.embedded) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph(xopcBackIcon()).fontSize(XOPC_ICON_HEADER).fontColor([this.colors.foreground])
        }.id('note-back').width(44).height(44).padding(0).backgroundColor(this.colors.panel)
          .clickEffect(xopcClickEffect())
          .accessibilityText($r('app.string.back')).onClick((): void => { this.back(); })
      }
      Blank().layoutWeight(1)
      if (this.model.draft) {
        Text(this.syncText()).fontSize(12).fontColor(this.model.draft.syncState === 'conflict' ? this.colors.danger : this.colors.secondary)
      }
      if (this.model.selected?.markdown && !this.model.editing) {
        Button({ type: ButtonType.Circle }) { SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(XOPC_ICON_HEADER).fontColor([this.colors.secondary]) }
          .id('note-reading-tools').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .clickEffect(xopcClickEffect())
          .accessibilityText($r('app.string.note_reading_tools')).onClick((): void => { this.openSheet('reading'); })
      }
      if (this.model.selected && !this.model.editing) {
        Button({ type: ButtonType.Circle }) { SymbolGlyph(xopcMoreIcon()).fontSize(XOPC_ICON_HEADER).fontColor([this.colors.secondary]) }
          .id('note-more').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .clickEffect(xopcClickEffect())
          .accessibilityText($r('app.string.more')).onClick((): void => { this.openSheet('more'); })
      }
    }.width('100%').padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X, top: 8, bottom: 8 })
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
            .fontColor(this.colors.onAccent).onClick((): void => { void this.model.resolveConflict(true); })
        }.width('100%')
      }.width('100%').padding(14).borderRadius(this.colors.corner(14)).backgroundColor(this.colors.accentSoft)
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
        flushRevision: this.editorFlush, onFlushed: (): void => {
          void this.model.closeEditor().then((): void => {
            if (!this.model.editing && !this.model.selected && !this.model.draft) this.onExit();
          });
        },
        noteId: this.model.selected?.id || '', attachments: this.model.selected?.attachments || [],
        onChange: (value: string): void => { this.model.updateMarkdown(value); },
        onSelection: (value: string): void => { this.model.selectedText = value; },
        onImageTap: (attachmentId: string): void => {
          const note = this.model.selected;
          const attachment = note?.attachments?.find((item: XopcNoteAttachment): boolean => item.id === attachmentId);
          if (note && attachment) this.editorPreview = this.attachmentMedia(note, attachment);
        } })
        .layoutWeight(1)
      if (this.editorPreview && this.model.selected) {
        XopcChatMediaView({ file: this.editorPreview, conversationId: this.model.selected.id, previewOnly: true,
          onPreviewClosed: (): void => { this.editorPreview = undefined; } }).height(0)
      }
      if (this.model.selected && this.visibleAttachments(this.model.selected).length) {
        Scroll() {
          Column({ space: 8 }) {
            ForEach(this.visibleAttachments(this.model.selected), (attachment: XopcNoteAttachment) => {
              this.noteAttachment(this.model.selected as XopcNote, attachment, true)
            }, (attachment: XopcNoteAttachment): string => attachment.id)
          }.width('100%')
        }.width('100%').constraintSize({ maxHeight: 200 }).scrollBar(BarState.Off)
      }
      Row({ space: 10 }) {
        Button($r('app.string.note_add_attachment'), { type: ButtonType.Normal })
          .id('note-add-attachment').layoutWeight(1).height(46).fontSize(15).fontWeight(FontWeight.Medium)
          .backgroundColor(this.colors.panel).fontColor(this.colors.foreground)
          .borderRadius(23).clipShape(this.colors.cornerClip(23))
          .enabled(!this.model.saving).clickEffect(xopcClickEffect())
          .onClick((): void => { this.openSheet('attachment'); })
        Button($r('app.string.note_done'), { type: ButtonType.Normal })
          .id('note-done').layoutWeight(1).height(46).fontSize(15).fontWeight(FontWeight.Medium)
          .backgroundColor(this.colors.accent).fontColor(this.colors.onAccent)
          .borderRadius(23).clipShape(this.colors.cornerClip(23))
          .enabled(!this.model.saving).clickEffect(xopcClickEffect())
          .onClick((): void => { this.editorFlush++; })
      }.width('100%')
    }.layoutWeight(1).width('100%').padding({ left: 20, right: 20, bottom: 12 }).alignItems(HorizontalAlign.Start)
  }

  @Builder
  detailToolbar() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 7 }) {
        SymbolGlyph($r('sys.symbol.square_and_pencil')).fontSize(16).fontColor([this.colors.accent])
        Text($r('app.string.edit_note')).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
      }
    }.id('note-edit').height(44).padding({ left: 18, right: 18 })
      .borderRadius(22).backgroundColor(this.colors.accentSoft).clickEffect(xopcClickEffect())
      .onClick((): void => {
        this.restoreDetailOffset = this.detailScroller.currentOffset().yOffset;
        this.model.editing = true;
      })
  }

  @Builder
  detail() {
    if (this.model.selected) {
      Column() {
        List({ space: 0, scroller: this.detailScroller }) {
          ListItem() {
            Column({ space: 16 }) {
              Column({ space: 8 }) {
                Text(this.model.selected.kind === 'voice' && /^Discussion · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(this.model.selected.title) ? $r('app.string.note_voice_option') : this.model.selected.title || $r('app.string.untitled')).fontSize(26).lineHeight(34).fontWeight(FontWeight.Bold)
                  .fontColor(this.colors.foreground).width('100%')
                Row({ space: 8 }) {
                  Text(formatNoteTimestamp(this.model.selected.updatedAt, appSettings.effectiveLanguage()))
                    .fontSize(13).fontColor(this.colors.tertiary).layoutWeight(1)
                  Text(this.statusLabel(this.model.selected.status)).fontSize(12).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary)
                    .padding({ left: 10, right: 10, top: 4, bottom: 4 })
                    .borderRadius(999).backgroundColor(this.colors.panel)
                }.width('100%').alignItems(VerticalAlign.Center)
              }.width('100%').alignItems(HorizontalAlign.Start)

              if (this.model.selected.tags?.length) {
                Scroll() {
                  Row({ space: 6 }) {
                    ForEach(this.model.selected.tags, (tag: string) => {
                      Text('#' + tag).fontSize(12).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
                        .height(28).constraintSize({ maxWidth: 200 }).maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .padding({ left: 10, right: 10 }).borderRadius(14).backgroundColor(this.colors.accentSoft)
                    }, (tag: string): string => tag)
                  }
                }.width('100%').scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
              }

              if (this.model.selected.kind === 'voice') {
                ForEach(this.visibleAttachments(this.model.selected).filter((attachment: XopcNoteAttachment): boolean =>
                  attachment.type === 'audio'), (attachment: XopcNoteAttachment) => {
                  this.noteAttachment(this.model.selected as XopcNote, attachment)
                }, (attachment: XopcNoteAttachment): string => attachment.id)
                XopcDiscussionNoteView({ noteId: this.model.selected.id,
                  onNoteUpdated: (): void => { void this.model.refreshSelected(); } })
              }
              if (this.model.selected.markdown) {
                XopcMarkdownView({ content: this.model.selected.markdown, conversationId: this.model.selected.id,
                  inlineNoteImages: true, noteReaderPrefix: 'note-block-' + this.model.selected.id + '-',
                  noteReaderTarget: this.readingTarget })
              }
              ForEach(this.visibleAttachments(this.model.selected).filter((attachment: XopcNoteAttachment): boolean =>
                this.model.selected?.kind !== 'voice' || attachment.type !== 'audio'), (attachment: XopcNoteAttachment) => {
                this.noteAttachment(this.model.selected as XopcNote, attachment)
              }, (attachment: XopcNoteAttachment): string => attachment.id)

            }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: 16 }).alignItems(HorizontalAlign.Start)
          }
        }.id('note-detail-content').layoutWeight(1).width('100%').scrollBar(BarState.Off)
          .edgeEffect(EdgeEffect.Spring)
          .onAreaChange((_previous: Area, current: Area): void => {
            if (this.restoreDetailOffset <= 0 || Number(current.height) <= 0) return;
            const offset = this.restoreDetailOffset;
            this.restoreDetailOffset = 0;
            this.detailScroller.scrollTo({ xOffset: 0, yOffset: offset });
          })
        Column({ space: 8 }) {
          if (this.model.selected.kind === 'voice') XopcDiscussionReviewPlayer({ noteId: this.model.selected.id })
          this.detailToolbar()
        }.width('100%').alignItems(HorizontalAlign.End).padding({ left: 20, right: 20, top: 8, bottom: 12 })
      }.layoutWeight(1).width('100%').clip(true)
    }
  }

  @Builder
  moreSheet() {
    Column() {
      XopcSheetHeader({ heading: $r('app.string.more'), onClose: (): void => { this.sheetOpen = false; } })
      Scroll() {
        Column({ space: 8 }) {
          XopcHubRow({ heading: $r('app.string.note_version_history'), symbol: $r('sys.symbol.clock'), compact: true,
            onOpen: (): void => { this.openHistory(); } })
          XopcHubRow({ heading: $r('app.string.note_ai_edit'), symbol: $r('sys.symbol.star'), compact: true,
            onOpen: (): void => { this.openSheet('ai'); } })
          XopcHubRow({ heading: $r('app.string.note_continue_chat'), symbol: $r('sys.symbol.message'), compact: true,
            onOpen: (): void => { this.sheetOpen = false; void this.continueInChat(); } })
          XopcHubRow({ heading: this.model.selected?.pinned ? $r('app.string.unpin') : $r('app.string.pin'),
            symbol: $r('sys.symbol.pin'), compact: true, onOpen: (): void => {
              this.sheetOpen = false; void this.model.togglePin();
            } })
          XopcHubRow({ heading: $r('app.string.note_manage_tags'), symbol: $r('sys.symbol.flag'), compact: true,
            onOpen: (): void => {
              this.tagsText = this.model.selected?.tags?.join(', ') ?? ''; this.openSheet('tags');
            } })
          XopcHubRow({ heading: $r('app.string.chat_share'), symbol: $r('sys.symbol.share'), compact: true,
            onOpen: (): void => {
              const note = this.model.selected; this.sheetOpen = false; if (note) void this.share(note);
            } })
          XopcHubRow({ heading: $r('app.string.archive'), symbol: $r('sys.symbol.archivebox'), compact: true,
            onOpen: (): void => { this.sheetOpen = false; void this.model.archive(); } })
          Button({ type: ButtonType.Normal }) {
            Row({ space: 10 }) {
              SymbolGlyph($r('sys.symbol.trash')).fontSize(18).fontColor([this.colors.danger])
              Text($r('app.string.delete')).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.danger)
            }.width('100%').padding({ left: 14, right: 14 })
          }.width('100%').height(48).padding(0).borderRadius(this.colors.corner(14)).clipShape(this.colors.cornerClip(14))
            .backgroundColor(this.colors.dangerSoft).clickEffect(xopcClickEffect())
            .onClick((): void => { this.sheetOpen = false; void this.confirmDelete(); })
        }.width('100%').padding({ left: 20, right: 20, top: 4, bottom: 20 }).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
    }.width('100%').height('100%').backgroundColor(this.colors.surface).alignItems(HorizontalAlign.Start)
  }

  @Builder
  historySheet() {
    Column() {
      XopcSheetHeader({ heading: $r('app.string.note_version_history'), onClose: (): void => { this.sheetOpen = false; } })
      Column({ space: 12 }) {
        if (this.model.loading) {
          XopcListSkeleton()
        } else if (this.model.snapshot) {
          Scroll() { Column({ space: 12 }) {
            XopcMarkdownView({ content: this.model.snapshot?.markdown ?? '' })
            Button($r('app.string.note_restore_version'), { type: ButtonType.Normal }).width('100%').height(46)
              .fontSize(15).fontWeight(FontWeight.Medium).borderRadius(23)
              .backgroundColor(this.colors.accent).fontColor(this.colors.onAccent).clickEffect(xopcClickEffect())
              .onClick((): void => { this.model.restoreSnapshotToDraft(); this.sheetOpen = false; })
          }.width('100%').alignItems(HorizontalAlign.Start) }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
        } else if (!this.model.history.length) {
          XopcEmptyHint({ message: $r('app.string.note_history_empty') })
        } else {
          List({ space: 8 }) {
            ForEach(this.model.history, (entry: XopcNoteHistoryEntry) => {
              ListItem() { XopcHubRow({ heading: new Date(entry.timestamp).toLocaleString(), summary: entry.snippet ?? entry.trigger,
                symbol: $r('sys.symbol.clock'), onOpen: (): void => { void this.model.loadSnapshot(entry.timestamp); } }) }
            }, (entry: XopcNoteHistoryEntry): string => entry.timestamp.toString())
          }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
        }
      }.width('100%').layoutWeight(1).padding({ left: 20, right: 20, top: 4, bottom: 20 }).alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').backgroundColor(this.colors.surface).alignItems(HorizontalAlign.Start)
  }

  @Builder
  aiSheet() {
    Column() {
      XopcSheetHeader({ heading: $r('app.string.note_ai_edit'), onClose: (): void => { this.sheetOpen = false; } })
      Column({ space: 14 }) {
        if (this.model.aiPreview) {
          Text(this.model.aiPreview?.patch.summary ?? '').fontSize(14).lineHeight(20).fontColor(this.colors.secondary).width('100%')
          Scroll() {
            Column({ space: 12 }) {
              Text($r('app.string.note_ai_before')).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.tertiary).width('100%')
              Column() { XopcMarkdownView({ content: this.model.aiOriginalMarkdown() }) }
                .width('100%').padding(14).borderRadius(this.colors.corner(14)).backgroundColor(this.colors.panel)
              Text($r('app.string.note_ai_after')).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.accent).width('100%')
              Column() { XopcMarkdownView({ content: this.model.aiPreviewMarkdown() }) }
                .width('100%').padding(14).borderRadius(this.colors.corner(14)).backgroundColor(this.colors.accentSoft)
            }.width('100%').alignItems(HorizontalAlign.Start)
          }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
          Row({ space: 10 }) {
            Button($r('app.string.cancel'), { type: ButtonType.Normal }).layoutWeight(1).height(46).fontSize(15).fontWeight(FontWeight.Medium)
              .borderRadius(23).backgroundColor(this.colors.input).fontColor(this.colors.foreground).clickEffect(xopcClickEffect())
              .onClick((): void => { this.model.discardAiPreview(); })
            Button($r('app.string.note_apply_ai'), { type: ButtonType.Normal }).layoutWeight(1).height(46).fontSize(15).fontWeight(FontWeight.Medium)
              .borderRadius(23).backgroundColor(this.colors.accent).fontColor(this.colors.onAccent).clickEffect(xopcClickEffect())
              .onClick((): void => { void this.model.applyAiPreview(); this.sheetOpen = false; })
          }.width('100%')
        } else {
          Scroll() {
            Row({ space: 8 }) {
              Button($r('app.string.note_ai_summary'), { type: ButtonType.Normal }).height(36).padding({ left: 14, right: 14 })
                .fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.accent).backgroundColor(this.colors.accentSoft)
                .borderRadius(18).clickEffect(xopcClickEffect()).onClick((): void => { this.aiInstruction = '总结并提炼核心观点'; })
              Button($r('app.string.note_ai_polish'), { type: ButtonType.Normal }).height(36).padding({ left: 14, right: 14 })
                .fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.accent).backgroundColor(this.colors.accentSoft)
                .borderRadius(18).clickEffect(xopcClickEffect()).onClick((): void => { this.aiInstruction = '润色并优化结构'; })
              Button($r('app.string.note_ai_todos'), { type: ButtonType.Normal }).height(36).padding({ left: 14, right: 14 })
                .fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.accent).backgroundColor(this.colors.accentSoft)
                .borderRadius(18).clickEffect(xopcClickEffect()).onClick((): void => { this.aiInstruction = '提取待办事项'; })
            }
          }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%')
          TextArea({ text: this.aiInstruction, placeholder: $r('app.string.note_ai_instruction') }).height(150)
            .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(14)).fontColor(this.colors.foreground)
            .onChange((value: string): void => { this.aiInstruction = value; })
          Button($r('app.string.note_generate_preview'), { type: ButtonType.Normal }).width('100%').height(46)
            .fontSize(15).fontWeight(FontWeight.Medium).borderRadius(23)
            .backgroundColor(this.colors.accent).fontColor(this.colors.onAccent).clickEffect(xopcClickEffect())
            .enabled(!this.model.loading && Boolean(this.aiInstruction.trim()))
            .onClick((): void => { void this.model.previewAi(this.aiInstruction); })
        }
      }.width('100%').layoutWeight(1).padding({ left: 20, right: 20, top: 4, bottom: 20 }).alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').backgroundColor(this.colors.surface).alignItems(HorizontalAlign.Start)
  }

  @Builder
  shareSheet() { if (this.shareResult) { XopcShareResultView({ share: this.shareResult, onClose: (): void => { this.sheetOpen = false; } }) } }

  @Builder
  tagsSheet() {
    Column() {
      XopcSheetHeader({ heading: $r('app.string.note_manage_tags'), onClose: (): void => { this.sheetOpen = false; } })
      Column({ space: 14 }) {
        TextInput({ text: this.tagsText, placeholder: $r('app.string.note_tags_placeholder') }).height(46)
          .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(14)).fontColor(this.colors.foreground)
          .onChange((value: string): void => { this.tagsText = value; })
        Button($r('app.string.save'), { type: ButtonType.Normal }).width('100%').height(46)
          .fontSize(15).fontWeight(FontWeight.Medium).borderRadius(23)
          .backgroundColor(this.colors.accent).fontColor(this.colors.onAccent).clickEffect(xopcClickEffect())
          .onClick((): void => {
            void this.model.updateTags(this.tagsText.split(',')).then((): void => {
              if (!this.model.error) this.sheetOpen = false;
            });
          })
      }.width('100%').padding({ left: 20, right: 20, top: 4, bottom: 20 }).alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').backgroundColor(this.colors.surface).alignItems(HorizontalAlign.Start)
  }

  @Builder
  attachmentSheet() {
    Column() {
      XopcSheetHeader({ heading: $r('app.string.note_add_attachment'), onClose: (): void => { this.sheetOpen = false; } })
      Column({ space: 8 }) {
        XopcHubRow({ heading: $r('app.string.note_choose_photo'), symbol: $r('sys.symbol.picture'), compact: true,
          onOpen: (): void => { this.attach('photo'); } })
        XopcHubRow({ heading: $r('app.string.note_take_photo'), symbol: $r('sys.symbol.camera'), compact: true,
          onOpen: (): void => { this.attach('camera'); } })
        XopcHubRow({ heading: $r('app.string.note_choose_file'), symbol: $r('sys.symbol.folder'), compact: true,
          onOpen: (): void => { this.attach('file'); } })
        XopcHubRow({ heading: $r('app.string.note_record_audio'), symbol: $r('sys.symbol.mic'), compact: true,
          onOpen: (): void => { this.recordVoice(); } })
      }.width('100%').padding({ left: 20, right: 20, top: 4, bottom: 20 }).alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').backgroundColor(this.colors.surface).alignItems(HorizontalAlign.Start)
  }

  @Builder
  voiceSheet() {
    Column() {
      XopcSheetHeader({ heading: $r('app.string.note_record_audio'), onClose: (): void => { void this.voice.cancel(); this.sheetOpen = false; } })
      Column({ space: 16 }) {
        Text(this.voice.state === 'recording' ? this.voice.seconds.toString() + ' s' : $r('app.string.note_voice_ready'))
          .fontSize(32).fontFamily('monospace').fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
          .width('100%').textAlign(TextAlign.Center).padding({ top: 8, bottom: 8 })
        if (this.voice.error) { Text(userErrorMessage(this.voice.error, 'save')).fontSize(13).fontColor(this.colors.danger).width('100%') }
        if (this.voice.state === 'recording') {
          Button($r('app.string.stop'), { type: ButtonType.Normal }).width('100%').height(46)
            .fontSize(15).fontWeight(FontWeight.Medium).borderRadius(23)
            .backgroundColor(this.colors.danger).fontColor(this.colors.onAccent)
            .enabled(!this.voice.busy).clickEffect(xopcClickEffect())
            .onClick((): void => { void this.voice.stop(); })
        } else if (this.voice.state === 'ready') {
          Row({ space: 10 }) {
            Button($r('app.string.chat_media_play'), { type: ButtonType.Normal }).layoutWeight(1).height(46)
              .fontSize(15).fontWeight(FontWeight.Medium).borderRadius(23)
              .backgroundColor(this.colors.input).fontColor(this.colors.foreground)
              .enabled(!this.voice.busy).clickEffect(xopcClickEffect()).onClick((): void => { void this.voice.play(); })
            Button($r('app.string.note_attach_recording'), { type: ButtonType.Normal }).layoutWeight(1).height(46)
              .fontSize(15).fontWeight(FontWeight.Medium).borderRadius(23)
              .backgroundColor(this.colors.accent).fontColor(this.colors.onAccent)
              .enabled(!this.voice.busy).clickEffect(xopcClickEffect()).onClick((): void => {
                void this.voice.send(async (attachment): Promise<boolean> => {
                  const result = await this.model.attachPayload(attachment); if (result) this.sheetOpen = false; return result;
                });
              })
          }.width('100%')
        } else if (this.voice.state === 'playing') {
          Button($r('app.string.stop'), { type: ButtonType.Normal }).width('100%').height(46)
            .fontSize(15).fontWeight(FontWeight.Medium).borderRadius(23)
            .backgroundColor(this.colors.input).fontColor(this.colors.foreground)
            .enabled(!this.voice.busy).clickEffect(xopcClickEffect())
            .onClick((): void => { void this.voice.stopPlayback(); })
        }
        Button($r('app.string.cancel'), { type: ButtonType.Normal }).width('100%').height(44)
          .fontSize(14).fontWeight(FontWeight.Medium).borderRadius(22)
          .backgroundColor(this.colors.input).fontColor(this.colors.secondary)
          .enabled(!this.voice.busy).clickEffect(xopcClickEffect())
          .onClick((): void => { void this.voice.cancel(); this.sheetOpen = false; })
      }.width('100%').padding({ left: 20, right: 20, top: 4, bottom: 20 }).alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').backgroundColor(this.colors.surface).alignItems(HorizontalAlign.Start)
  }

  @Computed get readingEntries(): XopcNoteReadingEntry[] {
    const blocks = markdownReadingBlocks(markdownBlocks(this.model.selected?.markdown ?? ''));
    const query = this.readingQuery.trim().toLowerCase();
    const results: XopcNoteReadingEntry[] = [];
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      if (!query) {
        if (block.kind === 'heading') results.push({ index, text: block.text, level: block.level });
        continue;
      }
      const text = block.kind === 'table'
        ? (block.rows ?? []).map((row: XopcMarkdownTableRow): string => row.cells.map((cell: XopcMarkdownCell): string => cell.text).join(' ')).join(' ')
        : block.text;
      const match = text.toLowerCase().indexOf(query);
      if (match < 0) continue;
      const start = Math.max(0, match - 48);
      results.push({ index, text: (start > 0 ? '…' : '') + text.slice(start, match + query.length + 72), level: 0 });
    }
    return results;
  }

  private jumpToReadingResult(): void {
    const index = this.pendingReadingJump;
    this.pendingReadingJump = -1;
    const note = this.model.selected;
    if (index < 0 || !note) return;
    const context = this.getUIContext();
    const components = context.getComponentUtils();
    const viewport = components.getRectangleById('note-detail-content');
    const target = components.getRectangleById('note-block-' + note.id + '-' + index.toString());
    if (!viewport.size.height || !target.size.height) return;
    const offset = this.detailScroller.currentOffset().yOffset + context.px2vp(target.windowOffset.y - viewport.windowOffset.y);
    this.readingTarget = index;
    this.detailScroller.scrollTo({ xOffset: 0, yOffset: Math.max(0, offset) });
  }

  @Builder
  readingSheet() {
    Column() {
      XopcSheetHeader({
        heading: this.readingQuery.trim() ? $r('app.string.note_find_results') : $r('app.string.note_outline'),
        onClose: (): void => { this.sheetOpen = false; },
      })
      Column({ space: 12 }) {
        TextInput({ text: this.readingQuery, placeholder: $r('app.string.note_search_body') })
          .id('note-find-query').width('100%').height(46).backgroundColor(this.colors.panel)
          .borderRadius(23).fontColor(this.colors.foreground)
          .onChange((value: string): void => { this.readingQuery = value; })
        if (!this.readingEntries.length) {
          XopcEmptyHint({ message: this.readingQuery.trim() ? $r('app.string.note_no_matches') : $r('app.string.note_no_headings') })
        } else {
          List({ space: 6 }) {
            ForEach(this.readingEntries, (entry: XopcNoteReadingEntry) => {
              ListItem() {
                Button({ type: ButtonType.Normal }) {
                  Text(entry.text).fontSize(15).maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%').textAlign(TextAlign.Start).fontColor(this.colors.foreground)
                }.width('100%').constraintSize({ minHeight: 46 })
                  .padding({ left: 14 + Math.max(0, entry.level - 1) * 10, right: 14, top: 8, bottom: 8 })
                  .borderRadius(this.colors.corner(12)).backgroundColor(this.colors.panel).clickEffect(xopcClickEffect())
                  .onClick((): void => {
                    this.pendingReadingJump = entry.index;
                    this.sheetOpen = false;
                  })
              }
            }, (entry: XopcNoteReadingEntry): string => entry.index.toString())
          }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
        }
      }.width('100%').layoutWeight(1).padding({ left: 20, right: 20, top: 4, bottom: 20 }).alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').backgroundColor(this.colors.surface).alignItems(HorizontalAlign.Start)
  }

  @Builder
  activeSheetContent() {
    Column() {
      if (this.model.error) {
        Text(userErrorMessage(this.model.error, 'save')).fontSize(13).fontColor(this.colors.danger)
          .width('100%').padding({ left: 20, right: 20, bottom: 8 })
      }
      if (this.activeSheet === 'reading') { this.readingSheet() }
      else if (this.activeSheet === 'history') { this.historySheet() }
      else if (this.activeSheet === 'ai') { this.aiSheet() }
      else if (this.activeSheet === 'share') { this.shareSheet() }
      else if (this.activeSheet === 'tags') { this.tagsSheet() }
      else if (this.activeSheet === 'attachment') { this.attachmentSheet() }
      else if (this.activeSheet === 'voice') { this.voiceSheet() }
      else { this.moreSheet() }
    }.id('note-sheet-' + this.activeSheet).width('100%').height('100%')
      .backgroundColor(this.colors.surface)
  }

  @Builder
  page() {
    Column() {
        this.header()
        if (this.model.error && this.model.selected) {
          Column() {
            XopcInlineBanner({ message: userErrorMessage(this.model.error, 'collection') })
          }.width('100%').padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X, bottom: 8 })
        }
        if (this.model.openingId) {
          XopcBrandLoading()
        } else if (this.model.error && !this.model.selected && !this.model.editing) {
          XopcErrorState({
            error: this.model.error,
            context: 'collection',
            onAction: (): void => { if (this.initialId) void this.model.open(this.initialId); },
          })
        } else if (this.model.editing && this.model.draft) {
          this.editor()
        } else if (this.model.selected) {
          this.detail()
        } else {
          XopcListSkeleton()
        }
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
      .bindSheet($$this.sheetOpen, this.activeSheetContent, xopcSheetOptions('medium', {
        height: this.sheetHeight(),
        onDisappear: (): void => {
          if (this.activeSheet === 'voice') void this.voice.cancel();
          if (this.activeSheet === 'reading') this.jumpToReadingResult();
        },
      }))
  }

  build() {
    if (this.embedded) {
      this.page()
    } else {
      NavDestination() { this.page() }.hideTitleBar(true).onBackPressed((): boolean => { this.back(); return true; })
    }
  }
}
