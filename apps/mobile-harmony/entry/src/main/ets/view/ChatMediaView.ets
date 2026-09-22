import { image } from '@kit.ImageKit';
import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { webview } from '@kit.ArkWeb';
import { XopcHistoryMedia } from '../model/chat';
import { readChatMedia, saveChatMedia } from '../service/chatMedia';
import { XopcChatMediaPlayback } from '../service/chatMediaPlayback';
import { chatMediaShareRequest, createChatMediaShare, shareChatLink, shareReachabilityText } from '../service/chatMediaShare';
import { copyChatMessage } from '../service/chatMessageActions';
import { appSettings } from '../service/settings';
import { XopcMarkdownView } from './MarkdownView';
import { filePreviewKind, previewTextLimit, safeHtmlPreview, XopcFilePreviewKind } from '../common/filePreview';

@ComponentV2
export struct XopcChatMediaView {
  @Param file: XopcHistoryMedia = { id: '', name: '', type: '', mimeType: '', size: 0, uri: '' };
  @Param conversationId: string = '';
  @Param draftPreview: boolean = false;
  @Param compact: boolean = false;
  @Local picture?: image.PixelMap;
  @Local previewPicture?: image.PixelMap;
  @Local pictureRatio: number = 1;
  @Local expanded: boolean = false;
  @Local error: string = '';
  @Local busy: boolean = false;
  @Local previewText: string = '';
  @Local playbackPath: string = '';
  @Local playbackReady: boolean = false;
  @Local playing: boolean = false;
  @Local playTime: number = 0;
  @Local playDuration: number = 0;
  @Local audioPlayer: XopcChatMediaPlayback = new XopcChatMediaPlayback();
  @Local zoom: number = 1;
  private controller: VideoController = new VideoController();
  private webController: webview.WebviewController = new webview.WebviewController();
  private htmlLoaded: boolean = false;
  private generation: number = 0;
  private attempted: boolean = false;
  private failedAction: string = 'preview';
  private sourceIdentity: string = '';
  aboutToDisappear(): void { try { this.webController.stop(); } catch (_) {} this.reset(); }
  @Monitor('file', 'conversationId')
  onSourceChange(): void {
    const key = this.sourceKey(); if (key === this.sourceIdentity) return;
    this.reset(); this.sourceIdentity = key; if (!this.compact) this.load();
  }
  private sourceKey(): string { return this.conversationId + ':' + this.file.uri + ':' + (this.file.workspaceRelativePath || '') + ':' + this.file.mimeType; }
  private reset(): void {
    this.generation++; this.picture?.release(); this.picture = undefined; this.busy = false;
    this.previewText = ''; this.expanded = false; this.attempted = false; this.zoom = 1; this.error = ''; this.htmlLoaded = false;
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
    this.failedAction = 'preview';
    const kind = this.previewKind();
    if (kind === 'binary') { this.previewText = this.file.extractedText || ''; this.expanded = true; return; }
    const sourceIdentity = this.sourceKey();
    if (kind === 'image' && !this.picture) await this.load();
    if (sourceIdentity !== this.sourceKey()) return;
    if (this.picture) {
      this.zoom = 1; this.expanded = true;
      const generation = this.generation;
      try {
        const bytes = await readChatMedia(this.file, this.conversationId);
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
    const context = this.getUIContext().getHostContext(); if (!context) return;
    this.sourceIdentity = this.sourceKey();
    const generation = ++this.generation; this.busy = true; this.error = '';
    try {
      const bytes = await readChatMedia(this.file, this.conversationId);
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
      } else this.previewText = previewTextLimit(util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(bytes)));
      if (generation === this.generation) this.expanded = true;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  private previewKind(): XopcFilePreviewKind { return filePreviewKind(this.file.name, this.file.mimeType); }
  private previewable(): boolean { return !!(this.file.uri || this.file.workspaceRelativePath || this.file.extractedText); }
  private shareable(): boolean { return chatMediaShareRequest(this.file, this.conversationId) !== undefined; }
  private mediaSymbol(): Resource {
    const kind = this.previewKind();
    if (kind === 'image') return $r('sys.symbol.picture');
    if (kind === 'audio') return $r('sys.symbol.waveform');
    if (kind === 'video') return $r('sys.symbol.film');
    return $r('sys.symbol.doc');
  }
  private timeLabel(seconds: number): string {
    const time = Math.max(0, Math.floor(seconds));
    return Math.floor(time / 60) + ':' + String(time % 60).padStart(2, '0');
  }
  private togglePlayback(): void {
    try { if (this.playing) this.controller.pause(); else this.controller.start(); }
    catch (_) { this.error = 'MEDIA_PLAYBACK_FAILED'; }
  }
  private async load(): Promise<void> {
    if (this.busy || this.picture || this.previewKind() !== 'image') return;
    const generation = ++this.generation; this.busy = true; this.error = ''; this.attempted = true; this.sourceIdentity = this.sourceKey();
    try {
      const bytes = await readChatMedia(this.file, this.conversationId);
      if (generation !== this.generation) return;
      const source = image.createImageSource(bytes);
      try {
        const info = await source.getImageInfo();
        this.pictureRatio = info.size.width / Math.max(1, info.size.height);
        const scale = Math.min(1, 1024 / Math.max(info.size.width, info.size.height));
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
        buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') },
          { text: $r('app.string.chat_copy_link'), color: $r('app.color.secondary') },
          { text: $r('app.string.chat_system_share'), color: $r('app.color.accent') }] });
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
      if (this.compact) {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 10 }) {
            SymbolGlyph(this.mediaSymbol()).fontSize(20).fontColor([$r('app.color.secondary')])
            Text(this.file.name || this.file.type).fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground'))
              .layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([$r('app.color.tertiary')])
          }.width('100%').height(44).padding({ left: 12, right: 12 })
        }.id('chat-preview-' + this.file.id).width('100%').padding(0).backgroundColor($r('app.color.input'))
          .border({ width: 0.5, color: $r('app.color.border_subtle'), radius: 10 }).enabled(!this.busy && this.previewable())
          .accessibilityText($r('app.string.chat_preview_file', this.file.name)).onClick((): void => { this.openPreview(); })
      } else if (this.picture) {
        Image(this.picture).width(this.draftPreview ? 120 : '100%').height(this.draftPreview ? 100 : 200).objectFit(ImageFit.Contain).borderRadius(12)
          .id('chat-image-' + this.file.id).accessibilityText(this.file.name).onClick((): void => { this.openPreview(); })
      } else if (this.file.mimeType.startsWith('image/') && !this.error) {
        Column() {}.width('100%').height(160).borderRadius(12).backgroundColor($r('app.color.grouped'))
          .accessibilityText($r('app.string.chat_media_loading'))
      }
      Row({ space: 8 }) {
        Text(this.file.name || this.file.type).fontSize(13).fontColor($r('app.color.secondary')).layoutWeight(1).maxLines(2)
        if (this.previewable()) {
          Button($r('app.string.chat_preview')).height(44).fontSize(12).fontColor($r('app.color.accent')).backgroundColor(Color.Transparent)
            .id('chat-preview-' + this.file.id).enabled(!this.busy && !!(this.file.uri || this.file.workspaceRelativePath)).onClick((): void => { this.openPreview(); })
        }
        if (!this.draftPreview) {
          if (this.shareable()) {
            Button($r('app.string.chat_share')).height(44).fontSize(12).backgroundColor(Color.Transparent).fontColor($r('app.color.secondary'))
              .enabled(!this.busy).onClick((): void => { this.share(); })
          }
          Button($r('app.string.download')).height(44).fontSize(12).backgroundColor(Color.Transparent).fontColor($r('app.color.secondary'))
            .enabled(!this.busy && !!(this.file.uri || this.file.workspaceRelativePath)).onClick((): void => { this.save(); })
        }
      }.width('100%')
      if (this.error) {
        Text(this.error === 'INVALID_MEDIA_OR_TOO_LARGE' ? $r('app.string.chat_media_too_large') : $r('app.string.chat_media_failed')).fontSize(12).fontColor($r('app.color.danger'))
        Button($r('app.string.refresh')).backgroundColor($r('app.color.grouped')).fontColor($r('app.color.secondary')).onClick((): void => { if (this.failedAction === 'save') this.save(); else if (this.failedAction === 'share') this.share(); else this.openPreview(); })
      }
    }.width('100%').onVisibleAreaChange([0.1], (visible: boolean): void => { if (visible && !this.compact && !this.attempted) this.load(); })
      .bindSheet($$this.expanded, this.preview, { height: this.previewKind() === 'audio' ? 280 : '100%', dragBar: false,
        onDisappear: (): void => { try { this.webController.stop(); } catch (_) {} this.htmlLoaded = false; this.clearPlayback(); } })
  }
  @Builder
  preview() {
    Column({ space: 12 }) {
      Row({ space: 4 }) {
        Text(this.file.name).fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground')).maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        if (this.shareable()) {
          Button() { SymbolGlyph($r('sys.symbol.share')).fontSize(20).fontColor([$r('app.color.secondary')]) }
            .width(44).height(44).padding(0).backgroundColor(Color.Transparent).enabled(!this.busy)
            .accessibilityText($r('app.string.chat_share')).onClick((): void => { this.share(); })
        }
        Button() { SymbolGlyph($r('sys.symbol.arrow_down_to_line')).fontSize(20).fontColor([$r('app.color.secondary')]) }
          .width(44).height(44).padding(0).backgroundColor(Color.Transparent).enabled(!this.busy && this.previewable())
          .accessibilityText($r('app.string.download')).onClick((): void => { this.save(); })
        Button() { SymbolGlyph($r('sys.symbol.xmark')).fontSize(20).fontColor([$r('app.color.secondary')]) }
          .id('chat-media-close').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.chat_close')).onClick((): void => { this.expanded = false; this.clearPlayback(); })
      }.width('100%')
      if (this.error || this.audioPlayer.error) { Text($r('app.string.chat_media_failed')).fontSize(13).fontColor($r('app.color.danger')) }
      if (this.picture) {
        Scroll() { Image(this.previewPicture || this.picture).width((this.zoom * 100) + '%').aspectRatio(this.pictureRatio).objectFit(ImageFit.Contain) }
          .width('100%').layoutWeight(1).scrollable(ScrollDirection.FREE)
        Row({ space: 8 }) {
          Button('−').width(44).height(44).backgroundColor($r('app.color.grouped')).fontColor($r('app.color.secondary')).onClick((): void => { this.zoom = Math.max(1, this.zoom - 0.5); })
          Button('+').width(44).height(44).backgroundColor($r('app.color.grouped')).fontColor($r('app.color.secondary')).onClick((): void => { this.zoom = Math.min(3, this.zoom + 0.5); })
        }
      } else if (this.playbackPath && this.file.mimeType.startsWith('audio/')) {
        Row({ space: 12 }) {
          Button(this.audioPlayer.state === 'playing' ? $r('app.string.pause') : $r('app.string.chat_media_play'))
            .id(this.audioPlayer.state === 'playing' ? 'chat-media-pause' : 'chat-media-play').height(44)
            .backgroundColor($r('app.color.grouped')).fontColor($r('app.color.secondary'))
            .enabled(['prepared', 'playing', 'paused', 'completed'].includes(this.audioPlayer.state))
            .onClick((): void => { this.audioPlayer.toggle(); })
          Text(this.timeLabel(this.audioPlayer.position)).id('chat-media-position').fontSize(14).fontColor($r('app.color.secondary'))
          if (this.audioPlayer.duration > 0) {
            Text('/ ' + this.timeLabel(this.audioPlayer.duration)).id('chat-media-duration').fontSize(14).fontColor($r('app.color.secondary'))
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
            .backgroundColor($r('app.color.grouped')).fontColor($r('app.color.secondary'))
            .onClick((): void => { this.togglePlayback(); })
          Text(this.timeLabel(this.playTime)).id('chat-media-position').fontSize(14).fontColor($r('app.color.secondary'))
          if (this.playbackReady) { Text('/ ' + this.timeLabel(this.playDuration)).id('chat-media-duration').fontSize(14).fontColor($r('app.color.secondary')) }
        }.width('100%')
      } else if (this.previewKind() === 'markdown') {
        Scroll() { XopcMarkdownView({ content: this.previewText, conversationId: this.conversationId }) }.layoutWeight(1).width('100%')
      } else if (this.previewKind() === 'html') {
        Stack({ alignContent: Alignment.Center }) {
          Web({ src: 'about:blank', controller: this.webController }).width('100%').height('100%')
            .javaScriptAccess(false).domStorageAccess(false).fileAccess(false).imageAccess(true).mixedMode(MixedMode.None)
            .onControllerAttached((): void => {
              if (!this.htmlLoaded) { this.htmlLoaded = true; this.webController.loadData(safeHtmlPreview(this.previewText), 'text/html', 'UTF-8'); }
            })
            .onUrlLoadIntercept((event): boolean => {
              const source = event?.data; const url = typeof source === 'string' ? source : source?.getRequestUrl() || '';
              return !!url && url !== 'about:blank' && !url.startsWith('data:text/html');
            })
          if (!this.previewText) { Text($r('app.string.chat_html_unavailable')).fontColor($r('app.color.secondary')) }
        }.layoutWeight(1).width('100%')
      } else if (this.previewKind() === 'binary') {
        Scroll() {
          Column({ space: 12 }) {
            Text(this.previewText ? $r('app.string.chat_preview_unsupported_text') : $r('app.string.chat_preview_unsupported'))
              .fontSize(14).lineHeight(21).textAlign(TextAlign.Center).fontColor($r('app.color.secondary')).width('100%')
            if (this.previewText) { Text(this.previewText).id('chat-media-text').fontSize(14).fontFamily('monospace')
              .fontColor($r('app.color.foreground')).copyOption(CopyOptions.InApp).width('100%') }
          }.width('100%')
        }.layoutWeight(1).width('100%')
      } else {
        Scroll() { Text(this.previewText).id('chat-media-text').fontSize(14).fontFamily('monospace').fontColor($r('app.color.foreground')).copyOption(CopyOptions.InApp) }.layoutWeight(1).width('100%')
      }
    }.id('chat-media-preview').width('100%').height('100%').padding(16)
  }
}
