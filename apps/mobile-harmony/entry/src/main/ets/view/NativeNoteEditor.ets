import { common } from '@kit.AbilityKit';
import { image } from '@kit.ImageKit';

import { noteEditorMarkdown, noteEditorSpans, XopcNoteEditorResultSpan, XopcNoteEditorSpan } from '../common/noteMarkdown';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcNoteAttachment } from '../model/note';
import { XopcHistoryMedia } from '../model/chat';
import { readChatMedia } from '../service/chatMedia';

/** Native RichEditor surface. Markdown conversion remains a pure, testable boundary. */
@ComponentV2
export struct XopcNativeNoteEditor {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param markdown: string = '';
  @Param noteId: string = '';
  @Param attachments: XopcNoteAttachment[] = [];
  @Param revision: number = 0;
  @Param readOnly: boolean = false;
  @Event onChange: (markdown: string) => void = (_markdown: string): void => {};
  @Event onSelection: (text: string) => void = (_text: string): void => {};
  @Event onImageTap: (attachmentId: string) => void = (_attachmentId: string): void => {};
  private controller: RichEditorController = new RichEditorController();
  private ready: boolean = false;
  @Local loading: boolean = false;
  private loadGeneration: number = 0;
  private imageTokens: Map<image.PixelMap, string> = new Map<image.PixelMap, string>();
  private imageOrder: string[] = [];
  private selectionStart: number = 0;
  private selectionEnd: number = 0;
  private changeTimer: number = -1;
  private lastMarkdown: string = '';
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  aboutToDisappear(): void { this.cancelChangeTimer(); this.emitChange(); this.loadGeneration++; this.releaseImages(); }

  @Monitor('revision')
  onRevisionChanged(): void {
    if (!this.ready) return;
    this.undoStack = []; this.redoStack = [];
    this.loadMarkdown();
  }

  private fontSize(heading: number): number {
    if (heading === 1) return 30;
    if (heading === 2) return 24;
    if (heading === 3) return 20;
    return 17;
  }

  private releaseImages(): void {
    this.imageTokens.forEach((_token: string, picture: image.PixelMap): void => { void picture.release(); });
    this.imageTokens.clear();
    this.imageOrder = [];
  }

  private imageAttachment(token: string): XopcNoteAttachment | undefined {
    return this.attachments.find((attachment: XopcNoteAttachment): boolean => token.includes(
      'xopc-attachment://notes/' + encodeURIComponent(this.noteId) + '/' + encodeURIComponent(attachment.id)));
  }

  private imageMedia(attachment: XopcNoteAttachment): XopcHistoryMedia {
    return { id: attachment.id, name: attachment.fileName, type: attachment.type, mimeType: attachment.mimeType,
      size: attachment.size, uri: 'xopc-attachment://notes/' + encodeURIComponent(this.noteId) + '/' + encodeURIComponent(attachment.id) };
  }

  private addText(span: XopcNoteEditorSpan): void {
    this.controller.addTextSpan(span.text, { style: {
      fontColor: this.colors.foreground,
      fontSize: this.fontSize(span.heading),
      fontWeight: span.heading > 0 || span.bold ? FontWeight.Bold : FontWeight.Normal,
      fontStyle: span.italic ? FontStyle.Italic : FontStyle.Normal,
      fontFamily: span.code ? 'monospace' : undefined
    } });
  }
  private addImageFallback(token: string): void {
    this.addText({ text: token, bold: false, italic: false, heading: 0, code: false });
  }

  private loadMarkdown(): void { void this.renderMarkdown(); }

  private async renderMarkdown(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loading = true;
    this.controller.deleteSpans();
    this.releaseImages();
    try {
      for (const span of noteEditorSpans(this.markdown)) {
        if (generation !== this.loadGeneration) return;
        const attachment = span.imageMarkdown ? this.imageAttachment(span.imageMarkdown) : undefined;
        if (!span.imageMarkdown) { this.addText(span); continue; }
        if (!attachment || !this.noteId) { this.addImageFallback(span.imageMarkdown); continue; }
        try {
          const context = this.getUIContext().getHostContext() as common.Context;
          const bytes = await readChatMedia(this.imageMedia(attachment), this.noteId, context);
          if (generation !== this.loadGeneration) return;
          const source = image.createImageSource(bytes);
          try {
            const info = await source.getImageInfo();
            const scale = Math.min(1, 900 / Math.max(info.size.width, info.size.height));
            const picture = await source.createPixelMap({ desiredSize: {
              width: Math.max(1, Math.round(info.size.width * scale)), height: Math.max(1, Math.round(info.size.height * scale)) } });
            if (generation !== this.loadGeneration) { await picture.release(); return; }
            const height = Math.max(220, Math.min(400, 300 * info.size.height / Math.max(1, info.size.width)));
            try {
              this.controller.addImageSpan(picture, { imageStyle: { size: [300, height], objectFit: ImageFit.Cover },
                gesture: { onClick: (_event: ClickEvent): void => { this.onImageTap(attachment.id); } } });
              this.imageTokens.set(picture, span.imageMarkdown);
              this.imageOrder.push(span.imageMarkdown);
            } catch (error) { await picture.release(); throw error as Error; }
          } finally { await source.release(); }
        } catch (_error) { this.addImageFallback(span.imageMarkdown); }
      }
      this.lastMarkdown = this.markdown;
    } finally { if (generation === this.loadGeneration) this.loading = false; }
  }

  private currentMarkdown(): string {
    const spans: XopcNoteEditorResultSpan[] = [];
    let unknownImage = false;
    const currentSpans = this.controller.getSpans();
    const imageCount = currentSpans.filter((raw: RichEditorImageSpanResult | RichEditorTextSpanResult): boolean =>
      !!(raw as RichEditorImageSpanResult).imageStyle).length;
    let imageIndex = 0;
    currentSpans.forEach((raw: RichEditorImageSpanResult | RichEditorTextSpanResult): void => {
      const imageSpan = raw as RichEditorImageSpanResult;
      if (imageSpan.imageStyle) {
        const token = imageSpan.valuePixelMap ? this.imageTokens.get(imageSpan.valuePixelMap) : undefined;
        const fallback = imageCount === this.imageOrder.length ? this.imageOrder[imageIndex] : undefined;
        imageIndex++;
        if (token || fallback) spans.push({ text: '', fontSize: 17, fontWeight: 400, italic: false, code: false,
          imageMarkdown: token || fallback });
        else unknownImage = true;
        return;
      }
      const span = raw as RichEditorTextSpanResult;
      if (typeof span.value !== 'string') return;
      spans.push({
        text: span.value,
        fontSize: typeof span.textStyle.fontSize === 'number' ? span.textStyle.fontSize : 17,
        fontWeight: typeof span.textStyle.fontWeight === 'number' ? span.textStyle.fontWeight : 400,
        italic: span.textStyle.fontStyle === FontStyle.Italic,
        code: span.textStyle.fontFamily.toLowerCase().includes('mono')
      });
    });
    return unknownImage ? this.lastMarkdown : noteEditorMarkdown(spans);
  }

  private emitChange(): void {
    if (this.loading) return;
    const current = this.currentMarkdown();
    if (current === this.lastMarkdown) return;
    this.undoStack.push(this.lastMarkdown);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.lastMarkdown = current;
    this.onChange(current);
  }

  private restoreMarkdown(value: string): void {
    this.loading = true;
    this.controller.deleteSpans();
    noteEditorSpans(value).forEach((span: XopcNoteEditorSpan): void => {
      this.controller.addTextSpan(span.text, { style: {
        fontColor: this.colors.foreground,
        fontSize: this.fontSize(span.heading),
        fontWeight: span.heading > 0 || span.bold ? FontWeight.Bold : FontWeight.Normal,
        fontStyle: span.italic ? FontStyle.Italic : FontStyle.Normal,
        fontFamily: span.code ? 'monospace' : undefined
      } });
    });
    this.lastMarkdown = value;
    this.loading = false;
    this.onChange(value);
  }

  private undo(): void {
    const previous = this.undoStack.pop();
    if (previous === undefined) return;
    this.redoStack.push(this.lastMarkdown);
    this.restoreMarkdown(previous);
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.lastMarkdown);
    this.restoreMarkdown(next);
  }

  private scheduleChange(): void {
    this.cancelChangeTimer();
    const delay = this.lastMarkdown.length > 100000 ? 600 : this.lastMarkdown.length > 30000 ? 300 : 120;
    this.changeTimer = setTimeout((): void => { this.changeTimer = -1; this.emitChange(); }, delay);
  }

  private cancelChangeTimer(): void { if (this.changeTimer >= 0) clearTimeout(this.changeTimer); this.changeTimer = -1; }

  private selectedRange(): RichEditorRange {
    if (this.selectionEnd > this.selectionStart) return { start: this.selectionStart, end: this.selectionEnd };
    const caret = Math.max(0, this.controller.getCaretOffset());
    return { start: caret, end: caret };
  }

  private toggleBold(): void {
    const range = this.selectedRange();
    if ((range.end ?? 0) > (range.start ?? 0)) {
      const bold = this.controller.getSpans(range).filter((raw: RichEditorImageSpanResult | RichEditorTextSpanResult): boolean =>
        typeof (raw as RichEditorTextSpanResult).value === 'string')
        .every((raw: RichEditorImageSpanResult | RichEditorTextSpanResult): boolean =>
          (raw as RichEditorTextSpanResult).textStyle.fontWeight >= 600);
      this.controller.updateSpanStyle({ start: range.start, end: range.end,
        textStyle: { fontWeight: bold ? FontWeight.Normal : FontWeight.Bold } });
      this.emitChange();
    } else {
      this.controller.setTypingStyle({ fontWeight: FontWeight.Bold });
    }
  }

  private toggleItalic(): void {
    const range = this.selectedRange();
    if ((range.end ?? 0) > (range.start ?? 0)) {
      const italic = this.controller.getSpans(range).filter((raw: RichEditorImageSpanResult | RichEditorTextSpanResult): boolean =>
        typeof (raw as RichEditorTextSpanResult).value === 'string')
        .every((raw: RichEditorImageSpanResult | RichEditorTextSpanResult): boolean =>
          (raw as RichEditorTextSpanResult).textStyle.fontStyle === FontStyle.Italic);
      this.controller.updateSpanStyle({ start: range.start, end: range.end,
        textStyle: { fontStyle: italic ? FontStyle.Normal : FontStyle.Italic } });
      this.emitChange();
    } else {
      this.controller.setTypingStyle({ fontStyle: FontStyle.Italic });
    }
  }

  private setHeading(level: number): void {
    const text = this.controller.getSpans().map((raw: RichEditorImageSpanResult | RichEditorTextSpanResult): string =>
      typeof (raw as RichEditorTextSpanResult).value === 'string' ? (raw as RichEditorTextSpanResult).value : '').join('');
    const caret = Math.max(0, this.controller.getCaretOffset());
    const start = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
    const foundEnd = text.indexOf('\n', caret);
    const end = foundEnd < 0 ? text.length : foundEnd;
    this.controller.updateSpanStyle({ start, end, textStyle: {
      fontSize: this.fontSize(level), fontWeight: level > 0 ? FontWeight.Bold : FontWeight.Normal
    } });
    this.emitChange();
  }

  private insert(value: string): void {
    const range = this.selectedRange();
    if ((range.end ?? 0) > (range.start ?? 0)) this.controller.deleteSpans(range);
    const offset = range.start ?? Math.max(0, this.controller.getCaretOffset());
    this.controller.addTextSpan(value, { offset, style: { fontColor: this.colors.foreground, fontSize: 17 } });
    this.controller.setCaretOffset(offset + value.length);
    this.emitChange();
  }

  @Builder
  tool(label: string, action: () => void) {
    Button(label).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
      .height(38).constraintSize({ minWidth: 42 }).padding({ left: 10, right: 10 })
      .borderRadius(12).backgroundColor(this.colors.input).onClick(action)
  }

  build() {
    Column({ space: 8 }) {
      RichEditor({ controller: this.controller })
        .layoutWeight(1).width('100%').padding({ left: 2, right: 2, top: 8, bottom: 28 })
        .enabled(!this.readOnly && !this.loading).backgroundColor(Color.Transparent).placeholder($r('app.string.note_editor_placeholder'), {
          fontColor: this.colors.tertiary
        }).copyOptions(CopyOptions.LocalDevice).enableDataDetector(false)
        .onReady((): void => { this.ready = true; this.loadMarkdown(); })
        .onSelectionChange((range: RichEditorRange): void => {
          this.selectionStart = range.start ?? 0; this.selectionEnd = range.end ?? this.selectionStart;
          const text = this.selectionEnd > this.selectionStart ? this.controller.getSpans(range)
            .map((raw: RichEditorImageSpanResult | RichEditorTextSpanResult): string =>
              typeof (raw as RichEditorTextSpanResult).value === 'string' ? (raw as RichEditorTextSpanResult).value : '').join('') : '';
          this.onSelection(text);
        })
        .onDidChange((_before: TextRange, _after: TextRange): void => { this.scheduleChange(); })
        .onBlur((): void => { this.cancelChangeTimer(); this.emitChange(); })
      if (!this.readOnly) {
        Scroll() {
          Row({ space: 8 }) {
            this.tool('↶', (): void => { this.undo(); })
            this.tool('↷', (): void => { this.redo(); })
            this.tool('B', (): void => { this.toggleBold(); })
            this.tool('I', (): void => { this.toggleItalic(); })
            this.tool('H1', (): void => { this.setHeading(1); })
            this.tool('H2', (): void => { this.setHeading(2); })
            this.tool('H3', (): void => { this.setHeading(3); })
            this.tool('•', (): void => { this.insert('- '); })
            this.tool('☐', (): void => { this.insert('- [ ] '); })
            this.tool('❝', (): void => { this.insert('> '); })
            this.tool('</>', (): void => { this.insert('`code`'); })
            this.tool('🔗', (): void => { this.insert('[链接](https://)'); })
            this.tool('—', (): void => { this.insert('\n---\n'); })
          }.padding({ left: 2, right: 2 })
        }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%')
      }
    }.width('100%').height('100%').alignItems(HorizontalAlign.Start)
  }
}
