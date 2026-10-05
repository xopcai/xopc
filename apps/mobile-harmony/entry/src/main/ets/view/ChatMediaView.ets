import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { userErrorMessage } from '../common/userError';
import { image } from '@kit.ImageKit';
import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { webview } from '@kit.ArkWeb';
import { XopcHistoryMedia } from '../model/chat';
import { clearChatMediaCache, openChatMedia, readChatMedia, saveChatMedia } from '../service/chatMedia';
import { XopcFileDocumentViewModel } from '../viewmodel/fileDocumentViewModel';
import { XopcChatMediaPlayback } from '../service/chatMediaPlayback';
import { chatMediaShareRequest, createChatMediaShare, shareChatLink, shareReachabilityText } from '../service/chatMediaShare';
import { copyChatMessage } from '../service/chatMessageActions';
import { appSettings } from '../service/settings';
import { XopcMarkdownView } from './MarkdownView';
import { filePreviewKind, htmlPreviewTextLimit, normalizedFileMimeType, previewTextLimit, safeHtmlPreview, XopcFilePreviewKind } from '../common/filePreview';

@ComponentV2
export struct XopcChatMediaView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param file: XopcHistoryMedia = { id: '', name: '', type: '', mimeType: '', size: 0, uri: '' };
  @Param conversationId: string = '';
  @Param draftPreview: boolean = false;
  @Param compact: boolean = false;
  @Param embedded: boolean = false;
  @Param compactThumbnail: boolean = false;
  @Param compactAvailable: boolean = false;
  @Param compactDisclosure: boolean = true;
  @Param compactMetadata: boolean = true;
  @Param compactThumbnailWidth: number = 0;
  @Param compactThumbnailHeight: number = 0;
  @Param compactThumbnailContain: boolean = false;
  @Param inlineVoice: boolean = false;
  @Param previewOnly: boolean = false;
  @Event onPreviewClosed: () => void = (): void => {};
  @Local document: XopcFileDocumentViewModel = new XopcFileDocumentViewModel();
  @Param previewRequest: number = 0;
  @Param imageGallery: XopcHistoryMedia[] = [];
  @Local picture?: image.PixelMap;
  @Local previewPicture?: image.PixelMap;
  @Local pictureRatio: number = 1;
  @Local expanded: boolean = false;
  @Local error: string = '';
  @Local busy: boolean = false;
  @Local previewText: string = '';
  @Local htmlLoading: boolean = false;
  @Local htmlError: boolean = false;
  @Local playbackPath: string = '';
  @Local playbackReady: boolean = false;
  @Local playing: boolean = false;
  @Local playTime: number = 0;
  @Local playDuration: number = 0;
  @Local audioPlayer: XopcChatMediaPlayback = new XopcChatMediaPlayback();
  @Local zoom: number = 1;
  @Local galleryFile?: XopcHistoryMedia;
  private pinchZoom: number = 1;
  private controller: VideoController = new VideoController();
  private webController: webview.WebviewController = new webview.WebviewController();
  private allowInitialHtmlNavigation: boolean = false;
  private htmlDataLoaded: boolean = false;
  private generation: number = 0;
  private attempted: boolean = false;
  private failedAction: string = 'preview';
  private sourceIdentity: string = '';
  aboutToAppear(): void {
    if (this.previewOnly) { this.sourceIdentity = this.sourceKey(); this.openPreview(); }
  }
  @Monitor('previewRequest')
  onPreviewRequest(): void {
    if (!this.previewOnly) return;
    if (this.sourceKey() !== this.sourceIdentity) { this.reset(); this.sourceIdentity = this.sourceKey(); }
    this.openPreview();
  }
  aboutToDisappear(): void { try { this.webController.stop(); } catch (_) {} this.reset(); }
  @Monitor('file', 'conversationId')
  onSourceChange(): void {
    const key = this.sourceKey(); if (key === this.sourceIdentity) return;
    this.reset(); this.sourceIdentity = key;
    if (this.previewOnly) this.openPreview();
    else if (!this.compact || (this.compactThumbnail && this.previewKind() === 'image')) this.load();
  }
  private activeFile(): XopcHistoryMedia { return this.galleryFile || this.file; }
  private mediaKey(file: XopcHistoryMedia): string {
    return file.id || file.uri || file.workspaceRelativePath || (file.name + ':' + file.size);
  }
  private galleryIndex(): number {
    const key = this.mediaKey(this.activeFile());
    return this.imageGallery.findIndex((file: XopcHistoryMedia): boolean => this.mediaKey(file) === key);
  }
  private canNavigateGallery(): boolean { return this.previewKind() === 'image' && this.imageGallery.length > 1; }
  private sourceKey(): string {
    const file = this.activeFile();
    return this.conversationId + ':' + file.uri + ':' + (file.workspaceRelativePath || '') + ':' + file.mimeType;
  }
  private activateInitialGalleryFile(): void {
    if (this.previewKind() !== 'image' || !this.imageGallery.length || this.galleryFile) return;
    const key = this.mediaKey(this.file);
    const index = this.imageGallery.findIndex((file: XopcHistoryMedia): boolean => this.mediaKey(file) === key);
    if (index >= 0) this.galleryFile = this.imageGallery[index];
  }
  private async navigateGallery(offset: number): Promise<void> {
    const current = this.galleryIndex();
    const next = current + offset;
    if (current < 0 || next < 0 || next >= this.imageGallery.length || this.busy) return;
    this.generation++;
    this.picture?.release(); this.picture = undefined;
    this.previewPicture?.release(); this.previewPicture = undefined;
    await this.clearPlayback();
    this.previewText = ''; this.attempted = false; this.error = ''; this.zoom = 1; this.pinchZoom = 1;
    this.galleryFile = this.imageGallery[next];
    this.sourceIdentity = this.sourceKey();
    await this.openPreview();
  }
  private reset(): void {
    this.document.reset();
    this.generation++; this.picture?.release(); this.picture = undefined; this.busy = false;
    this.previewText = ''; this.expanded = false; this.attempted = false; this.zoom = 1; this.pinchZoom = 1; this.error = '';
    this.htmlLoading = false; this.htmlError = false;
    this.allowInitialHtmlNavigation = false;
    this.htmlDataLoaded = false;
    this.clearPlayback();
  }
  private async clearPlayback(): Promise<void> {
    this.previewPicture?.release(); this.previewPicture = undefined;
    try { this.controller.stop(); } catch (_) {}
    const path = this.playbackPath; this.playbackPath = '';
    this.playbackReady = false; this.playing = false; this.playTime = 0; this.playDuration = 0;
    await this.audioPlayer.stop();
    if (path) { try { await fs.unlink(path); } catch (_) {} }
  }
  private restoreOriginalFile(): void {
    if (!this.galleryFile) return;
    this.generation++;
    this.picture?.release(); this.picture = undefined;
    this.previewPicture?.release(); this.previewPicture = undefined;
    this.galleryFile = undefined;
    this.previewText = ''; this.error = ''; this.attempted = false; this.zoom = 1; this.pinchZoom = 1;
    this.sourceIdentity = this.sourceKey();
    if (!this.compact || (this.compactThumbnail && this.previewKind() === 'image')) this.load();
  }
  private async openPreview(): Promise<void> {
    if (this.busy) return;
    const context = this.getUIContext().getHostContext(); if (!context) return;
    this.activateInitialGalleryFile();
    this.expanded = true;
    if (this.activeFile().uri.startsWith('xopc-file:') || this.activeFile().workspaceRelativePath) this.previewText = '';
    if (!this.draftPreview) this.document.inspect(this.activeFile(), this.conversationId);
    this.failedAction = 'preview';
    const kind = this.previewKind();
    if (kind === 'binary') { this.previewText = this.activeFile().extractedText || ''; this.expanded = true; return; }
    if (kind === 'html') {
      this.htmlError = false; this.htmlLoading = true; this.htmlDataLoaded = false; this.expanded = true;
      if (this.previewText) return;
    }
    const sourceIdentity = this.sourceKey();
    if (kind === 'image' && !this.picture) await this.load();
    if (sourceIdentity !== this.sourceKey()) return;
    if (this.picture) {
      this.zoom = 1; this.pinchZoom = 1; this.expanded = true;
      const generation = this.generation;
      try {
        const bytes = await readChatMedia(this.activeFile(), this.conversationId, context);
        if (generation !== this.generation || !this.expanded) return;
        const source = image.createImageSource(bytes);
        try {
          const info = await source.getImageInfo();
          const scale = Math.min(1, 4096 / Math.max(info.size.width, info.size.height), Math.sqrt(8 * 1024 * 1024 / (info.size.width * info.size.height)));
          const picture = await source.createPixelMap({ desiredSize: { width: Math.max(1, Math.round(info.size.width * scale)), height: Math.max(1, Math.round(info.size.height * scale)) } });
          if (generation !== this.generation || !this.expanded) { await picture.release(); return; }
          this.previewPicture?.release(); this.previewPicture = picture;
        } finally { await source.release(); }
      } catch (_) { /* The existing thumbnail remains usable when full preview fails. */ }
      return;
    }
    if (kind === 'image') return;
    this.sourceIdentity = this.sourceKey();
    const generation = ++this.generation; this.busy = true; this.error = '';
    try {
      const bytes = await readChatMedia(this.activeFile(), this.conversationId, context);
      if (generation !== this.generation) return;
      if (kind === 'audio' || kind === 'video') {
        const path = context.cacheDir + '/chat-media-' + util.generateRandomUUID() + (kind === 'audio' ? '.audio' : '.video');
        try {
          const output = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY);
          try { if (await fs.write(output.fd, bytes) !== bytes.byteLength) throw new Error('INCOMPLETE_MEDIA'); }
          finally { await fs.close(output); }
        } catch (error) { try { await fs.unlink(path); } catch (_) {} throw new Error((error as Error).message); }
        if (generation !== this.generation) { await fs.unlink(path); return; }
        this.playbackPath = path;
        if (kind === 'audio') await this.audioPlayer.open(path, bytes.byteLength);
      } else {
        const decoded = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(bytes));
        this.previewText = kind === 'html' ? htmlPreviewTextLimit(decoded) : previewTextLimit(decoded);
        if (kind === 'html') {
          if (!this.previewText) { this.htmlLoading = false; this.htmlError = true; }
        }
      }
      if (generation === this.generation && kind !== 'html') this.expanded = true;
    } catch (error) {
      if (generation === this.generation) {
        this.error = (error as Error).message;
        if (kind === 'html') { this.htmlLoading = false; this.htmlError = true; }
      }
    }
    finally { if (generation === this.generation) this.busy = false; }
  }
  private previewKind(): XopcFilePreviewKind {
    const file = this.activeFile();
    return filePreviewKind(file.name, file.mimeType);
  }
  private async canLeaveEditor(): Promise<boolean> {
    if (this.document.busy) return false;
    if (!this.document.dirty()) return true;
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({ message: $r('app.string.discard_changes'),
        buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
          { text: $r('app.string.confirm'), color: this.colors.danger }] });
      return result.index === 1;
    } catch (_) { return false; }
  }
  private async closePreview(): Promise<void> {
    if (await this.canLeaveEditor()) { this.document.cancelEdit(); this.expanded = false; }
  }
  private async dismissPreview(action: DismissSheetAction): Promise<void> {
    if (await this.canLeaveEditor()) { this.document.cancelEdit(); action.dismiss(); }
  }
  private async cancelEditing(): Promise<void> {
    if (await this.canLeaveEditor()) this.document.cancelEdit();
  }
  private async saveEditing(): Promise<void> {
    if (!await this.document.save()) return;
    clearChatMediaCache();
    this.previewText = this.previewKind() === 'html' ? htmlPreviewTextLimit(this.document.savedContent)
      : previewTextLimit(this.document.savedContent);
    this.htmlDataLoaded = false; this.htmlLoading = this.previewKind() === 'html'; this.htmlError = false;
  }
  private loadHtmlData(): void {
    if (this.htmlDataLoaded || !this.previewText) return;
    try {
      const bytes = new util.TextEncoder().encodeInto(safeHtmlPreview(this.previewText));
      const encoded = new util.Base64Helper().encodeToStringSync(bytes);
      this.allowInitialHtmlNavigation = true;
      this.htmlDataLoaded = true;
      this.webController.loadData(encoded, 'text/html', 'base64');
    } catch (error) {
      this.allowInitialHtmlNavigation = false; this.htmlDataLoaded = false;
      this.error = (error as Error).message; this.htmlLoading = false; this.htmlError = true;
    }
  }
  private previewable(): boolean {
    const file = this.activeFile();
    return !!(file.uri || file.workspaceRelativePath || file.extractedText);
  }
  private transferable(): boolean {
    const file = this.activeFile();
    return !!(file.uri || file.workspaceRelativePath);
  }
  private shareable(): boolean { return chatMediaShareRequest(this.activeFile(), this.conversationId) !== undefined; }
  private mediaSymbol(): Resource {
    const kind = this.previewKind();
    if (kind === 'image') return $r('sys.symbol.picture');
    if (kind === 'audio') return $r('sys.symbol.waveform');
    if (kind === 'video') return $r('sys.symbol.film');
    return $r('sys.symbol.doc');
  }
  private fileSizeLabel(): string {
    const size = this.activeFile().size;
    if (size <= 0) return '';
    if (size < 1024) return size.toString() + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
    return (size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }
  private fileDetailsLabel(): string {
    const file = this.activeFile();
    const mime = normalizedFileMimeType(file.name, file.mimeType);
    const size = this.fileSizeLabel();
    return size ? mime + ' · ' + size : mime;
  }
  private timeLabel(seconds: number): string {
    const time = Math.max(0, Math.floor(seconds));
    return Math.floor(time / 60) + ':' + String(time % 60).padStart(2, '0');
  }
  private inlineAudioDuration(): number { return this.audioPlayer.duration || this.activeFile().duration || 0; }
  private togglePlayback(): void {
    try { if (this.playing) this.controller.pause(); else this.controller.start(); }
    catch (_) { this.error = 'MEDIA_PLAYBACK_FAILED'; }
  }
  private async toggleInlineAudio(): Promise<void> {
    if (this.busy) return;
    if (this.playbackPath) { await this.audioPlayer.toggle(); return; }
    const context = this.getUIContext().getHostContext();
    if (!context || !this.previewable()) return;
    const generation = ++this.generation;
    this.busy = true; this.error = ''; this.sourceIdentity = this.sourceKey();
    try {
      const bytes = await readChatMedia(this.activeFile(), this.conversationId, context);
      if (generation !== this.generation) return;
      const path = context.cacheDir + '/chat-voice-' + util.generateRandomUUID() + '.audio';
      try {
        const output = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY);
        try { if (await fs.write(output.fd, bytes) !== bytes.byteLength) throw new Error('INCOMPLETE_MEDIA'); }
        finally { await fs.close(output); }
      } catch (error) { try { await fs.unlink(path); } catch (_) {} throw error as Error; }
      if (generation !== this.generation) { await fs.unlink(path); return; }
      this.playbackPath = path;
      await this.audioPlayer.open(path, bytes.byteLength, true);
    } catch (error) {
      if (generation === this.generation) {
        this.error = (error as Error).message;
        this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_media_failed') });
      }
    } finally { if (generation === this.generation) this.busy = false; }
  }
  private async prefetchHtml(): Promise<void> {
    if (this.attempted || this.previewText || this.previewKind() !== 'html') return;
    const context = this.getUIContext().getHostContext(); if (!context) return;
    const generation = this.generation; this.attempted = true; this.sourceIdentity = this.sourceKey();
    try {
      const bytes = await readChatMedia(this.activeFile(), this.conversationId, context);
      if (generation !== this.generation) return;
      const decoded = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(bytes));
      this.previewText = htmlPreviewTextLimit(decoded);
    } catch (_) { if (generation === this.generation) this.attempted = false; }
  }
  private async load(): Promise<void> {
    if (this.busy || this.picture || this.previewKind() !== 'image') return;
    const generation = ++this.generation; this.busy = true; this.error = ''; this.attempted = true; this.sourceIdentity = this.sourceKey();
    try {
      const context = this.getUIContext().getHostContext(); if (!context) return;
      const bytes = await readChatMedia(this.activeFile(), this.conversationId, context);
      if (generation !== this.generation) return;
      const source = image.createImageSource(bytes);
      try {
        const info = await source.getImageInfo();
        this.pictureRatio = info.size.width / Math.max(1, info.size.height);
        const thumbnailExtent = Math.max(this.compactThumbnailWidth || 48, this.compactThumbnailHeight || 48);
        const maxDimension = this.compactThumbnail ? Math.min(512, Math.max(128, thumbnailExtent * 3)) : 1024;
        const scale = Math.min(1, maxDimension / Math.max(info.size.width, info.size.height));
        const picture = await source.createPixelMap({ desiredSize: { width: Math.max(1, Math.round(info.size.width * scale)), height: Math.max(1, Math.round(info.size.height * scale)) } });
        if (generation !== this.generation) { await picture.release(); return; }
        this.picture = picture;
      } finally { await source.release(); }
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  private async save(): Promise<void> {
    const context = this.getUIContext().getHostContext(); if (!context || this.busy) return;
    this.busy = true; this.error = ''; this.failedAction = 'save';
    const generation = this.generation;
    try { await saveChatMedia(context, this.activeFile(), this.conversationId); }
    catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  private async openWithSystem(): Promise<void> {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    if (!context || this.busy || !this.transferable()) return;
    this.busy = true; this.error = ''; this.failedAction = 'open';
    const generation = this.generation;
    try { await openChatMedia(context, this.activeFile(), this.conversationId); }
    catch (error) {
      if (generation === this.generation) {
        this.error = (error as Error).message;
        this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_open_file_failed') });
      }
    } finally { if (generation === this.generation) this.busy = false; }
  }
  private async share(): Promise<void> {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    if (!context || this.busy || !this.shareable()) return;
    const generation = this.generation;
    this.busy = true; this.error = ''; this.failedAction = 'share';
    try {
      const payload = await createChatMediaShare(this.activeFile(), this.conversationId);
      if (generation !== this.generation) return;
      const result = await this.getUIContext().getPromptAction().showDialog({ title: payload.share.title,
        message: payload.share.shareUrl + '\n\n' + shareReachabilityText(payload.share, appSettings.effectiveLanguage().startsWith('zh')),
        buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
          { text: $r('app.string.chat_copy_link'), color: this.colors.secondary },
          { text: $r('app.string.chat_system_share'), color: this.colors.accent }] });
      if (generation !== this.generation) return;
      if (result.index === 1) {
        await copyChatMessage(payload.share.shareUrl);
        this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_link_copied') });
      } else if (result.index === 2) await shareChatLink(context, payload.share);
    }
    catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  build() {
    Column({ space: 8 }) {
      if (!this.previewOnly) {
      if (this.inlineVoice && this.previewKind() === 'audio') {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 8 }) {
            if (this.busy || this.audioPlayer.state === 'loading') {
              LoadingProgress().width(20).height(20).color(this.colors.foreground)
            } else {
              SymbolGlyph(this.audioPlayer.state === 'playing' ? $r('sys.symbol.stop_circle_fill') : $r('sys.symbol.speaker_wave_2'))
                .fontSize(24).fontColor([this.error || this.audioPlayer.error ? this.colors.danger : this.colors.foreground])
            }
            SymbolGlyph($r('sys.symbol.waveform')).fontSize(30).fontColor([this.colors.secondary]).layoutWeight(1)
            if (this.inlineAudioDuration() > 0) {
              Text(Math.max(1, Math.ceil(this.inlineAudioDuration())).toString() + '″')
                .fontSize(13).fontColor(this.colors.secondary)
            }
          }.width('100%').height(48).padding({ left: 10, right: 10 }).justifyContent(FlexAlign.Start)
            .alignItems(VerticalAlign.Center)
        }.id('chat-inline-voice-' + this.file.id).width('100%').height(48).padding(0)
          .backgroundColor(Color.Transparent).enabled(!this.busy && this.previewable())
          .accessibilityText(this.audioPlayer.state === 'playing' ? $r('app.string.stop') : $r('app.string.chat_media_play'))
          .onClick((): void => { this.toggleInlineAudio(); })
      } else if (this.compact) {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 10 }) {
            if (this.compactThumbnail && this.previewKind() === 'image') {
              if (this.picture) {
                Image(this.picture).id('chat-compact-thumbnail-' + this.file.id)
                  .width(this.compactThumbnailWidth || (this.compactMetadata ? 36 : 48))
                  .height(this.compactThumbnailHeight || (this.compactMetadata ? 36 : 48))
                  .objectFit(this.compactThumbnailContain ? ImageFit.Contain : ImageFit.Cover)
                  .borderRadius(8).accessibilityText(this.file.name)
              } else {
                Stack({ alignContent: Alignment.Center }) {
                  if (this.busy) {
                    LoadingProgress().width(18).height(18).color(this.colors.secondary)
                  } else {
                    SymbolGlyph($r('sys.symbol.picture')).fontSize(19).fontColor([this.colors.secondary])
                  }
                }.id('chat-compact-thumbnail-placeholder-' + this.file.id)
                  .width(this.compactThumbnailWidth || (this.compactMetadata ? 36 : 48))
                  .height(this.compactThumbnailHeight || (this.compactMetadata ? 36 : 48))
                  .borderRadius(8).backgroundColor(this.colors.grouped)
              }
            } else {
              SymbolGlyph(this.mediaSymbol()).fontSize(20).fontColor([this.colors.secondary])
            }
            if (this.compactMetadata) {
              Column({ space: 2 }) {
                Text(this.file.name || this.file.type).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
                  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                if (this.compactAvailable) {
                  Text(this.draftPreview ? this.fileSizeLabel() : this.file.size > 0
                    ? $r('app.string.chat_artifact_available_size', this.fileSizeLabel())
                    : $r('app.string.chat_artifact_available')).fontSize(11).fontColor(this.colors.secondary).maxLines(1)
                }
              }
              .layoutWeight(1).alignItems(HorizontalAlign.Start)
            }
            if (this.compactDisclosure) {
              SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([this.colors.tertiary])
            }
          }.width('100%').constraintSize({ minHeight: this.compactThumbnailHeight > 0
            ? this.compactThumbnailHeight + (this.compactMetadata ? 8 : 0) : this.compactThumbnail ? 56 : 48 })
            .padding({ left: this.compactMetadata ? 12 : this.compactThumbnail ? 0 : 4,
              right: this.compactMetadata ? 12 : this.compactThumbnail ? 0 : 4 })
        }.id('chat-preview-' + this.file.id).width('100%').padding(0)
          .backgroundColor(this.embedded ? Color.Transparent : this.colors.input)
          .borderRadius(this.embedded ? 0 : 10)
          .enabled(!this.busy && this.previewable())
          .accessibilityText($r('app.string.chat_preview_file', this.file.name)).onClick((): void => { this.openPreview(); })
      } else if (this.picture) {
        Image(this.picture).width(this.draftPreview ? 120 : '100%').height(this.draftPreview ? 100 : 200).objectFit(ImageFit.Contain).borderRadius(12)
          .id('chat-image-' + this.file.id).accessibilityText(this.file.name).onClick((): void => { this.openPreview(); })
      } else if (this.file.mimeType.startsWith('image/') && !this.error) {
        Column() {}.width('100%').height(160).borderRadius(12).backgroundColor(this.colors.grouped)
          .accessibilityText($r('app.string.chat_media_loading'))
      }
      if (!this.inlineVoice && !this.compact) {
        Row({ space: 8 }) {
          Text(this.file.name || this.file.type).fontSize(13).fontColor(this.colors.secondary).layoutWeight(1).maxLines(2)
          if (this.previewable()) {
            Button($r('app.string.chat_preview')).height(44).fontSize(12).fontColor(this.colors.accent).backgroundColor(Color.Transparent)
              .id('chat-preview-' + this.file.id).enabled(!this.busy && !!(this.file.uri || this.file.workspaceRelativePath)).onClick((): void => { this.openPreview(); })
          }
          if (!this.draftPreview) {
            if (this.shareable()) {
              Button($r('app.string.chat_share')).height(44).fontSize(12).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
                .enabled(!this.busy).onClick((): void => { this.share(); })
            }
            Button($r('app.string.download')).height(44).fontSize(12).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
              .enabled(!this.busy && !!(this.file.uri || this.file.workspaceRelativePath)).onClick((): void => { this.save(); })
          }
        }.width('100%')
        if (this.error) {
          Text(this.error === 'INVALID_MEDIA_OR_TOO_LARGE' ? $r('app.string.chat_media_too_large') : $r('app.string.chat_media_failed')).fontSize(12).fontColor(this.colors.danger)
          Button($r('app.string.refresh')).backgroundColor(this.colors.grouped).fontColor(this.colors.secondary).onClick((): void => {
            if (this.failedAction === 'save') this.save(); else if (this.failedAction === 'share') this.share();
            else if (this.failedAction === 'open') this.openWithSystem(); else this.openPreview();
          })
        }
      }
      }
    }.width('100%').onVisibleAreaChange([0.1], (visible: boolean): void => {
      if (!visible || this.previewOnly || this.inlineVoice || this.attempted) return;
      if (this.compact && this.previewKind() === 'html') this.prefetchHtml();
      else if (!this.compact || this.compactThumbnail) this.load();
    })
      .bindSheet($$this.expanded, this.preview, { height: this.previewKind() === 'audio' ? 280 : '100%', dragBar: false,
        showClose: false, backgroundColor: this.colors.surface,
        onWillDismiss: (action: DismissSheetAction): void => { this.dismissPreview(action); },
        onDisappear: (): void => {
          try { this.webController.stop(); } catch (_) {}
          if (this.busy) { this.generation++; this.busy = false; }
          this.htmlLoading = false; this.htmlError = false; this.htmlDataLoaded = false; this.clearPlayback();
          this.restoreOriginalFile();
          this.document.reset(); this.onPreviewClosed();
        } })
  }
  @Builder
  preview() {
    Column({ space: 12 }) {
      Row({ space: 4 }) {
        Text(this.activeFile().name).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        if (this.document.editing) {
          Button($r('app.string.cancel')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
            .enabled(!this.document.busy).onClick((): void => { this.cancelEditing(); })
          Button($r('app.string.save')).id('file-preview-save').height(44).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
            .enabled(!this.document.busy && this.document.dirty()).onClick((): void => { this.saveEditing(); })
        } else {
        if (this.document.canEdit()) {
          Button($r('app.string.edit')).id('file-preview-edit').height(44).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
            .enabled(!this.busy && !this.document.busy).onClick((): void => { this.document.beginEdit(); })
        }
        if (this.shareable()) {
          Button() { SymbolGlyph($r('sys.symbol.share')).fontSize(20).fontColor([this.colors.secondary]) }
            .width(44).height(44).padding(0).backgroundColor(Color.Transparent).enabled(!this.busy)
            .accessibilityText($r('app.string.chat_share')).onClick((): void => { this.share(); })
        }
        Button() { SymbolGlyph($r('sys.symbol.arrow_down_to_line')).fontSize(20).fontColor([this.colors.secondary]) }
          .width(44).height(44).padding(0).backgroundColor(Color.Transparent).enabled(!this.busy && this.transferable())
          .accessibilityText($r('app.string.download')).onClick((): void => { this.save(); })
        }
        Button() { SymbolGlyph($r('sys.symbol.xmark')).fontSize(20).fontColor([this.colors.secondary]) }
          .id('chat-media-close').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.chat_close')).enabled(!this.document.busy).onClick((): void => { this.closePreview(); })
      }.width('100%').padding(this.previewKind() === 'html' ? { left: 16, right: 16 } : 0)
      if (this.error || this.audioPlayer.error) {
        Text($r('app.string.chat_media_failed')).fontSize(13).fontColor(this.colors.danger)
        if (!this.document.editing) {
          Button($r('app.string.refresh')).height(44).enabled(!this.busy)
            .backgroundColor(this.colors.input).fontColor(this.colors.foreground).onClick((): void => { this.openPreview(); })
        }
      }
      if (this.document.error) { Text(userErrorMessage(this.document.error, 'media')).fontSize(13)
        .fontColor(this.colors.danger).padding({ left: 16, right: 16 }) }
      if (this.document.busy) { LoadingProgress().width(24).height(24).color(this.colors.secondary) }
      if (this.document.editing) {
        TextArea({ text: this.document.content }).id('file-preview-editor').width('100%').layoutWeight(1)
          .fontFamily('monospace').fontSize(14).fontColor(this.colors.foreground).backgroundColor(this.colors.panel)
          .padding(16).enabled(!this.document.busy)
          .onChange((content: string): void => { this.document.content = content; })
      } else if (this.busy && this.previewKind() !== 'html' && !this.picture) {
        Column() {}.width('100%').layoutWeight(1).borderRadius(12).backgroundColor(this.colors.grouped)
      } else if (this.picture) {
        Scroll() { Image(this.previewPicture || this.picture).width((this.zoom * 100) + '%').aspectRatio(this.pictureRatio).objectFit(ImageFit.Contain)
          .gesture(PinchGesture({ fingers: 2 }).onActionStart((_event: GestureEvent): void => { this.pinchZoom = this.zoom; })
            .onActionUpdate((event: GestureEvent): void => { this.zoom = Math.max(1, Math.min(3, this.pinchZoom * event.scale)); })) }
          .width('100%').layoutWeight(1).scrollable(ScrollDirection.FREE)
          .parallelGesture(PanGesture({ fingers: 1, direction: PanDirection.Horizontal, distance: 30 })
            .onActionEnd((event: GestureEvent): void => {
              if (this.zoom > 1.05 || Math.abs(event.offsetX) < 60) return;
              this.navigateGallery(event.offsetX > 0 ? -1 : 1);
            }))
        Row({ space: 8 }) {
          if (this.canNavigateGallery()) {
            Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(20).fontColor([this.colors.secondary]) }
              .id('chat-media-previous-image').width(44).height(44).padding(0).backgroundColor(this.colors.grouped)
              .enabled(this.galleryIndex() > 0 && !this.busy).accessibilityText($r('app.string.chat_previous_image'))
              .onClick((): void => { this.navigateGallery(-1); })
            Text((this.galleryIndex() + 1).toString() + ' / ' + this.imageGallery.length.toString())
              .fontSize(13).fontColor(this.colors.secondary).constraintSize({ minWidth: 52 }).textAlign(TextAlign.Center)
            Button() { SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(20).fontColor([this.colors.secondary]) }
              .id('chat-media-next-image').width(44).height(44).padding(0).backgroundColor(this.colors.grouped)
              .enabled(this.galleryIndex() >= 0 && this.galleryIndex() < this.imageGallery.length - 1 && !this.busy)
              .accessibilityText($r('app.string.chat_next_image')).onClick((): void => { this.navigateGallery(1); })
          }
          Button('−').width(44).height(44).backgroundColor(this.colors.grouped).fontColor(this.colors.secondary).onClick((): void => { this.zoom = Math.max(1, this.zoom - 0.5); })
          Button('+').width(44).height(44).backgroundColor(this.colors.grouped).fontColor(this.colors.secondary).onClick((): void => { this.zoom = Math.min(3, this.zoom + 0.5); })
        }
      } else if (this.playbackPath && this.previewKind() === 'audio') {
        Row({ space: 12 }) {
          Button(this.audioPlayer.state === 'playing' ? $r('app.string.pause') : $r('app.string.chat_media_play'))
            .id(this.audioPlayer.state === 'playing' ? 'chat-media-pause' : 'chat-media-play').height(44)
            .backgroundColor(this.colors.grouped).fontColor(this.colors.secondary)
            .enabled(['prepared', 'playing', 'paused', 'completed'].includes(this.audioPlayer.state))
            .onClick((): void => { this.audioPlayer.toggle(); })
          Text(this.timeLabel(this.audioPlayer.position)).id('chat-media-position').fontSize(14).fontColor(this.colors.secondary)
          if (this.audioPlayer.duration > 0) {
            Text('/ ' + this.timeLabel(this.audioPlayer.duration)).id('chat-media-duration').fontSize(14).fontColor(this.colors.secondary)
          }
        }.width('100%')
      } else if (this.playbackPath) {
        Video({ src: this.playbackPath, controller: this.controller }).width('100%').height(240)
          .autoPlay(false).controls(true).objectFit(ImageFit.Contain)
          .onPrepared((info: PreparedInfo): void => { this.playDuration = info.duration; this.playbackReady = true; })
          .onStart((): void => { this.playing = true; })
          .onPause((): void => { this.playing = false; })
          .onFinish((): void => { this.playing = false; })
          .onUpdate((info: PlaybackInfo): void => { this.playTime = info.time; })
          .onError((): void => { this.playbackReady = false; this.playing = false; this.error = 'MEDIA_PLAYBACK_FAILED'; })
        Row({ space: 12 }) {
          Button(this.playing ? $r('app.string.pause') : $r('app.string.chat_media_play'))
            .id(this.playing ? 'chat-media-pause' : 'chat-media-play').height(44).enabled(this.playbackReady && !this.error)
            .backgroundColor(this.colors.grouped).fontColor(this.colors.secondary)
            .onClick((): void => { this.togglePlayback(); })
          Text(this.timeLabel(this.playTime)).id('chat-media-position').fontSize(14).fontColor(this.colors.secondary)
          if (this.playbackReady) { Text('/ ' + this.timeLabel(this.playDuration)).id('chat-media-duration').fontSize(14).fontColor(this.colors.secondary) }
        }.width('100%')
      } else if (this.previewKind() === 'markdown') {
        Scroll() { XopcMarkdownView({ content: this.previewText, conversationId: this.conversationId }) }.layoutWeight(1).width('100%')
      } else if (this.previewKind() === 'html') {
        Stack({ alignContent: Alignment.Center }) {
          if (this.previewText) {
            Web({ src: 'about:blank', controller: this.webController }).width('100%').height('100%')
              .javaScriptAccess(true).domStorageAccess(false).fileAccess(false).imageAccess(true).mixedMode(MixedMode.None)
              .horizontalScrollBarAccess(false).verticalScrollBarAccess(false)
              .onPageEnd((event: OnPageEndEvent): void => {
                if (!this.htmlDataLoaded && event.url === 'about:blank') { this.loadHtmlData(); return; }
                // The bootstrap page must not become a Back destination for a file preview.
                if (this.htmlDataLoaded && event.url !== 'about:blank') {
                  try { this.webController.clearHistory(); } catch (_) {}
                }
                this.htmlLoading = false;
              })
              .onErrorReceive((event: OnErrorReceiveEvent): void => {
                if (event.request.isMainFrame()) { this.htmlLoading = false; this.htmlError = true; }
              })
              .onLoadIntercept((event: OnLoadInterceptEvent): boolean => {
                const url = event.data.getRequestUrl();
                if (event.data.isMainFrame() && this.allowInitialHtmlNavigation && url.startsWith('data:text/')) {
                  this.allowInitialHtmlNavigation = false;
                  return false;
                }
                return event.data.isMainFrame() && !!url && url !== 'about:blank';
              })
          }
          if (this.htmlLoading) { LoadingProgress().width(24).height(24).color(this.colors.secondary) }
          if ((!this.previewText && !this.htmlLoading) || this.htmlError) {
            Column({ space: 12 }) {
              Text(this.activeFile().name || this.activeFile().type).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
                .maxLines(2).textAlign(TextAlign.Center)
              Text($r('app.string.chat_html_unavailable')).fontSize(14).fontColor(this.colors.secondary).textAlign(TextAlign.Center)
              Button($r('app.string.chat_open_with_app')).height(44).backgroundColor(this.colors.accent).fontColor(Color.White)
                .width('100%').enabled(!this.busy && this.transferable()).onClick((): void => { this.openWithSystem(); })
              Button($r('app.string.download')).height(44).backgroundColor(this.colors.input).fontColor(this.colors.foreground)
                .width('100%').enabled(!this.busy && this.transferable()).onClick((): void => { this.save(); })
            }.width(300).padding(20).borderRadius(12).backgroundColor(this.colors.grouped)
          }
        }.layoutWeight(1).width('100%')
      } else if (this.previewKind() === 'binary') {
        Column({ space: 12 }) {
          Column({ space: 8 }) {
            SymbolGlyph(this.mediaSymbol()).fontSize(36).fontColor([this.colors.secondary])
            Text(this.activeFile().name || this.activeFile().type).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
              .maxLines(2).textAlign(TextAlign.Center).width('100%')
            Text(this.fileDetailsLabel()).fontSize(12).fontColor(this.colors.secondary).maxLines(1)
            Text(this.previewText ? $r('app.string.chat_preview_unsupported_text') : $r('app.string.chat_preview_unsupported'))
              .fontSize(13).lineHeight(19).textAlign(TextAlign.Center).fontColor(this.colors.secondary).width('100%')
            Row({ space: 8 }) {
              Button($r('app.string.chat_open_with_app')).height(44).layoutWeight(1).backgroundColor(this.colors.accent)
                .fontColor(Color.White).enabled(!this.busy && this.transferable()).onClick((): void => { this.openWithSystem(); })
              Button($r('app.string.download')).height(44).layoutWeight(1).backgroundColor(this.colors.grouped)
                .fontColor(this.colors.foreground).enabled(!this.busy && this.transferable()).onClick((): void => { this.save(); })
            }.width('100%')
          }.width('100%').padding(16).borderRadius(12).backgroundColor(this.colors.input)
          if (this.previewText) {
            Scroll() { Text(this.previewText).id('chat-media-extracted-text').fontSize(14).fontFamily('monospace')
              .fontColor(this.colors.foreground).copyOption(CopyOptions.InApp).width('100%') }.layoutWeight(1).width('100%')
          }
        }.layoutWeight(1).width('100%')
      } else {
        Scroll() { Text(this.previewText).id('chat-media-text').fontSize(14).fontFamily('monospace').fontColor(this.colors.foreground).copyOption(CopyOptions.InApp) }.layoutWeight(1).width('100%')
      }
    }.id('chat-media-preview').width('100%').height('100%')
      .padding(this.previewKind() === 'html' ? { top: 16 } : 16)
  }
}
