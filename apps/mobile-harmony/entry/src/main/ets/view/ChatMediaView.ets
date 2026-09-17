import { image } from '@kit.ImageKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { XopcHistoryMedia } from '../model/chat';
import { readChatMedia, saveChatMedia } from '../service/chatMedia';
import { XopcChatMediaPlayback } from '../service/chatMediaPlayback';

@ComponentV2
export struct XopcChatMediaView {
  @Param file: XopcHistoryMedia = { id: '', name: '', type: '', mimeType: '', size: 0, uri: '' };
  @Param conversationId: string = '';
  @Local picture?: image.PixelMap;
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
  private generation: number = 0;
  private attempted: boolean = false;
  private failedAction: string = 'preview';
  private sourceIdentity: string = '';
  aboutToDisappear(): void { this.reset(); }
  @Monitor('file', 'conversationId')
  onSourceChange(): void {
    const key = this.sourceKey(); if (key === this.sourceIdentity) return;
    this.reset(); this.sourceIdentity = key; this.load();
  }
  private sourceKey(): string { return this.conversationId + ':' + this.file.uri + ':' + (this.file.workspaceRelativePath || '') + ':' + this.file.mimeType; }
  private reset(): void {
    this.generation++; this.picture?.release(); this.picture = undefined; this.busy = false;
    this.previewText = ''; this.expanded = false; this.attempted = false; this.zoom = 1; this.error = '';
    this.clearPlayback();
  }
  private async clearPlayback(): Promise<void> {
    try { this.controller.stop(); } catch (_) {}
    const path = this.playbackPath; this.playbackPath = '';
    this.playbackReady = false; this.playing = false; this.playTime = 0; this.playDuration = 0;
    await this.audioPlayer.stop();
    if (path) { try { await fs.unlink(path); } catch (_) {} }
  }
  private async openPreview(): Promise<void> {
    if (this.busy) return;
    this.failedAction = 'preview';
    const sourceIdentity = this.sourceKey();
    if (this.file.mimeType.startsWith('image/') && !this.picture) await this.load();
    if (sourceIdentity !== this.sourceKey()) return;
    if (this.picture) { this.zoom = 1; this.expanded = true; return; }
    if (!this.previewable() || this.file.mimeType.startsWith('image/')) return;
    const context = this.getUIContext().getHostContext(); if (!context) return;
    this.sourceIdentity = this.sourceKey();
    const generation = ++this.generation; this.busy = true; this.error = '';
    try {
      const bytes = await readChatMedia(this.file, this.conversationId);
      if (generation !== this.generation) return;
      if (this.file.mimeType.startsWith('audio/') || this.file.mimeType.startsWith('video/')) {
        const path = context.cacheDir + '/chat-media-' + util.generateRandomUUID() + (this.file.mimeType.startsWith('audio/') ? '.audio' : '.video');
        try {
          const output = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY);
          try { if (await fs.write(output.fd, bytes) !== bytes.byteLength) throw new Error('INCOMPLETE_MEDIA'); }
          finally { await fs.close(output); }
        } catch (error) { try { await fs.unlink(path); } catch (_) {} throw new Error((error as Error).message); }
        if (generation !== this.generation) { await fs.unlink(path); return; }
        this.playbackPath = path;
        if (this.file.mimeType.startsWith('audio/')) await this.audioPlayer.open(path, bytes.byteLength);
      } else this.previewText = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(bytes)).slice(0, 100000);
      if (generation === this.generation) this.expanded = true;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  private previewable(): boolean {
    return /^(image|audio|video|text)\//.test(this.file.mimeType) || /\.(md|txt|csv|json|log)$/i.test(this.file.name);
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
    if (this.busy || this.picture || !this.file.mimeType.startsWith('image/')) return;
    const generation = ++this.generation; this.busy = true; this.error = ''; this.attempted = true; this.sourceIdentity = this.sourceKey();
    try {
      const bytes = await readChatMedia(this.file, this.conversationId);
      if (generation !== this.generation) return;
      const source = image.createImageSource(bytes);
      try {
        const info = await source.getImageInfo();
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
  build() {
    Column({ space: 8 }) {
      if (this.picture) {
        Image(this.picture).width('100%').height(200).objectFit(ImageFit.Contain).borderRadius(12)
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
        Button($r('app.string.download')).height(44).fontSize(12).enabled(!this.busy && !!(this.file.uri || this.file.workspaceRelativePath)).onClick((): void => { this.save(); })
      }.width('100%')
      if (this.error) {
        Text(this.error === 'INVALID_MEDIA_OR_TOO_LARGE' ? $r('app.string.chat_media_too_large') : $r('app.string.chat_media_failed')).fontSize(12).fontColor($r('app.color.danger'))
        Button($r('app.string.refresh')).onClick((): void => { if (this.failedAction === 'save') this.save(); else this.openPreview(); })
      }
    }.width('100%').onVisibleAreaChange([0.1], (visible: boolean): void => { if (visible && !this.attempted) this.load(); })
      .bindSheet($$this.expanded, this.preview, { height: this.file.mimeType.startsWith('audio/') ? 280 : '90%', dragBar: true, onDisappear: (): void => { this.clearPlayback(); } })
  }
  @Builder
  preview() {
    Column({ space: 12 }) {
      Text(this.file.name).fontSize(15).fontColor($r('app.color.foreground')).maxLines(2)
      if (this.error || this.audioPlayer.error) { Text($r('app.string.chat_media_failed')).fontSize(13).fontColor($r('app.color.danger')) }
      if (this.picture) {
        Scroll() { Image(this.picture).width((this.zoom * 100) + '%').aspectRatio(1).objectFit(ImageFit.Contain) }
          .width('100%').layoutWeight(1).scrollable(ScrollDirection.FREE)
        Row({ space: 8 }) {
          Button('−').width(44).height(44).onClick((): void => { this.zoom = Math.max(1, this.zoom - 0.5); })
          Button('+').width(44).height(44).onClick((): void => { this.zoom = Math.min(3, this.zoom + 0.5); })
        }
      } else if (this.playbackPath && this.file.mimeType.startsWith('audio/')) {
        Row({ space: 12 }) {
          Button(this.audioPlayer.state === 'playing' ? $r('app.string.pause') : $r('app.string.chat_media_play'))
            .id(this.audioPlayer.state === 'playing' ? 'chat-media-pause' : 'chat-media-play').height(44)
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
            .onClick((): void => { this.togglePlayback(); })
          Text(this.timeLabel(this.playTime)).id('chat-media-position').fontSize(14).fontColor($r('app.color.secondary'))
          if (this.playbackReady) { Text('/ ' + this.timeLabel(this.playDuration)).id('chat-media-duration').fontSize(14).fontColor($r('app.color.secondary')) }
        }.width('100%')
      } else {
        Scroll() { Text(this.previewText).id('chat-media-text').fontSize(14).fontFamily('monospace').fontColor($r('app.color.foreground')).copyOption(CopyOptions.InApp) }.layoutWeight(1).width('100%')
      }
      Button($r('app.string.chat_close')).id('chat-media-close').height(44).onClick((): void => { this.expanded = false; this.clearPlayback(); })
    }.id('chat-media-preview').width('100%').height('100%').padding(16)
  }
}
