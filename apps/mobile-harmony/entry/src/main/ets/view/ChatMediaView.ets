import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { image } from '@kit.ImageKit';
import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { webview } from '@kit.ArkWeb';
import { XopcHistoryMedia } from '../model/chat';
import { openChatMedia, readChatMedia, saveChatMedia } from '../service/chatMedia';
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
  @Param inlineVoice: boolean = false;
  @Param previewOnly: boolean = false;
  @Param previewRequest: number = 0;
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
  private sourceKey(): string { return this.conversationId + ':' + this.file.uri + ':' + (this.file.workspaceRelativePath || '') + ':' + this.file.mimeType; }
  private reset(): void {
    this.generation++; this.picture?.release(); this.picture = undefined; this.busy = false;
    this.previewText = ''; this.expanded = false; this.attempted = false; this.zoom = 1; this.error = '';
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
  private async openPreview(): Promise<void> {
    if (this.busy) return;
    const context = this.getUIContext().getHostContext(); if (!context) return;
    this.failedAction = 'preview';
    const kind = this.previewKind();
    if (kind === 'binary') { this.previewText = this.file.extractedText || ''; this.expanded = true; return; }
    if (kind === 'html') {
      this.htmlError = false; this.htmlLoading = true; this.htmlDataLoaded = false; this.expanded = true;
      if (this.previewText) return;
    }
    const sourceIdentity = this.sourceKey();
    if (kind === 'image' && !this.picture) await this.load();
    if (sourceIdentity !== this.sourceKey()) return;
    if (this.picture) {
      this.zoom = 1; this.expanded = true;
      const generation = this.generation;
      try {
        const bytes = await readChatMedia(this.file, this.conversationId, context);
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
      const bytes = await readChatMedia(this.file, this.conversationId, context);
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
  private previewKind(): XopcFilePreviewKind { return filePreviewKind(this.file.name, this.file.mimeType); }
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
  private previewable(): boolean { return !!(this.file.uri || this.file.workspaceRelativePath || this.file.extractedText); }
  private transferable(): boolean { return !!(this.file.uri || this.file.workspaceRelativePath); }
  private shareable(): boolean { return chatMediaShareRequest(this.file, this.conversationId) !== undefined; }
  private mediaSymbol(): Resource {
    const kind = this.previewKind();
    if (kind === 'image') return $r('sys.symbol.picture');
    if (kind === 'audio') return $r('sys.symbol.waveform');
    if (kind === 'video') return $r('sys.symbol.film');
    return $r('sys.symbol.doc');
  }
  private fileSizeLabel(): string {
    if (this.file.size <= 0) return '';
    if (this.file.size < 1024) return this.file.size.toString() + ' B';
    if (this.file.size < 1024 * 1024) return (this.file.size / 1024).toFixed(1) + ' KB';
    if (this.file.size < 1024 * 1024 * 1024) return (this.file.size / (1024 * 1024)).toFixed(1) + ' MB';
    return (this.file.size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }
  private fileDetailsLabel(): string {
    const mime = normalizedFileMimeType(this.file.name, this.file.mimeType);
    const size = this.fileSizeLabel();
    return size ? mime + ' · ' + size : mime;
  }
  private timeLabel(seconds: number): string {
    const time = Math.max(0, Math.floor(seconds));
    return Math.floor(time / 60) + ':' + String(time % 60).padStart(2, '0');
  }
  private inlineAudioDuration(): number { return this.audioPlayer.duration || this.file.duration || 0; }
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
      const bytes = await readChatMedia(this.file, this.conversationId, context);
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
      const bytes = await readChatMedia(this.file, this.conversationId, context);
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
      const bytes = await readChatMedia(this.file, this.conversationId, context);
      if (generation !== this.generation) return;
      const source = image.createImageSource(bytes);
      try {
        const info = await source.getImageInfo();
        this.pictureRatio = info.size.width / Math.max(1, info.size.height);
        const maxDimension = this.compactThumbnail ? 128 : 1024;
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
    try { await saveChatMedia(context, this.file, this.conversationId); }
    catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  private async openWithSystem(): Promise<void> {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    if (!context || this.busy || !this.transferable()) return;
    this.busy = true; this.error = ''; this.failedAction = 'open';
    const generation = this.generation;
    try { await openChatMedia(context, this.file, this.conversationId); }
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
      const payload = await createChatMediaShare(this.file, this.conversationId);
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
                .fontSize(22).fontColor([this.error || this.audioPlayer.error ? this.colors.danger : this.colors.foreground])
            }
            if (this.inlineAudioDuration() > 0) {
              Text(Math.max(1, Math.ceil(this.inlineAudioDuration())).toString() + '″')
                .fontSize(14).fontColor(this.colors.foreground)
            }
          }.width('100%').height(44).padding({ left: 8, right: 8 }).justifyContent(FlexAlign.Start)
        }.id('chat-inline-voice-' + this.file.id).width('100%').height(44).padding(0)
          .backgroundColor(Color.Transparent).enabled(!this.busy && this.previewable())
          .accessibilityText(this.audioPlayer.state === 'playing' ? $r('app.string.stop') : $r('app.string.chat_media_play'))
          .onClick((): void => { this.toggleInlineAudio(); })
      } else if (this.compact) {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 10 }) {
            if (this.compactThumbnail && this.previewKind() === 'image') {
              if (this.picture) {
                Image(this.picture).id('chat-compact-thumbnail-' + this.file.id).width(36).height(36)
                  .objectFit(ImageFit.Cover).borderRadius(8).accessibilityText(this.file.name)
              } else {
                Stack({ alignContent: Alignment.Center }) {
                  if (this.busy) {
                    LoadingProgress().width(18).height(18).color(this.colors.secondary)
                  } else {
                    SymbolGlyph($r('sys.symbol.picture')).fontSize(19).fontColor([this.colors.secondary])
                  }
                }.id('chat-compact-thumbnail-placeholder-' + this.file.id).width(36).height(36)
                  .borderRadius(8).backgroundColor(this.colors.grouped)
              }
            } else {
              SymbolGlyph(this.mediaSymbol()).fontSize(20).fontColor([this.colors.secondary])
            }
            Column({ space: 2 }) {
              Text(this.file.name || this.file.type).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
                .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              if (this.compactAvailable) {
                Text(this.file.size > 0 ? $r('app.string.chat_artifact_available_size', this.fileSizeLabel())
                  : $r('app.string.chat_artifact_available')).fontSize(11).fontColor(this.colors.secondary).maxLines(1)
              }
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
            SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([this.colors.tertiary])
          }.width('100%').constraintSize({ minHeight: this.compactThumbnail ? 56 : 48 }).padding({ left: 12, right: 12 })
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
        onDisappear: (): void => {
          try { this.webController.stop(); } catch (_) {}
          if (this.busy) { this.generation++; this.busy = false; }
          this.htmlLoading = false; this.htmlError = false; this.htmlDataLoaded = false; this.clearPlayback();
        } })
  }
  @Builder
  preview() {
    Column({ space: 12 }) {
      Row({ space: 4 }) {
        Text(this.file.name).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        if (this.shareable()) {
          Button() { SymbolGlyph($r('sys.symbol.share')).fontSize(20).fontColor([this.colors.secondary]) }
            .width(44).height(44).padding(0).backgroundColor(Color.Transparent).enabled(!this.busy)
            .accessibilityText($r('app.string.chat_share')).onClick((): void => { this.share(); })
        }
        Button() { SymbolGlyph($r('sys.symbol.arrow_down_to_line')).fontSize(20).fontColor([this.colors.secondary]) }
          .width(44).height(44).padding(0).backgroundColor(Color.Transparent).enabled(!this.busy && this.transferable())
          .accessibilityText($r('app.string.download')).onClick((): void => { this.save(); })
        Button() { SymbolGlyph($r('sys.symbol.xmark')).fontSize(20).fontColor([this.colors.secondary]) }
          .id('chat-media-close').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.chat_close')).onClick((): void => { this.expanded = false; this.clearPlayback(); })
      }.width('100%').padding(this.previewKind() === 'html' ? { left: 16, right: 16 } : 0)
      if (this.error || this.audioPlayer.error) { Text($r('app.string.chat_media_failed')).fontSize(13).fontColor(this.colors.danger) }
      if (this.picture) {
        Scroll() { Image(this.previewPicture || this.picture).width((this.zoom * 100) + '%').aspectRatio(this.pictureRatio).objectFit(ImageFit.Contain) }
          .width('100%').layoutWeight(1).scrollable(ScrollDirection.FREE)
        Row({ space: 8 }) {
          Button('−').width(44).height(44).backgroundColor(this.colors.grouped).fontColor(this.colors.secondary).onClick((): void => { this.zoom = Math.max(1, this.zoom - 0.5); })
          Button('+').width(44).height(44).backgroundColor(this.colors.grouped).fontColor(this.colors.secondary).onClick((): void => { this.zoom = Math.min(3, this.zoom + 0.5); })
        }
      } else if (this.playbackPath && this.file.mimeType.startsWith('audio/')) {
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
              Text(this.file.name || this.file.type).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
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
            Text(this.file.name || this.file.type).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
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
