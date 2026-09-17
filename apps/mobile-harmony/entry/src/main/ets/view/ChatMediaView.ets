import { image } from '@kit.ImageKit';
import { XopcHistoryMedia } from '../model/chat';
import { readChatMedia, saveChatMedia } from '../service/chatMedia';

@ComponentV2
export struct XopcChatMediaView {
  @Param file: XopcHistoryMedia = { id: '', name: '', type: '', mimeType: '', size: 0, uri: '' };
  @Param conversationId: string = '';
  @Local picture?: image.PixelMap;
  @Local expanded: boolean = false;
  @Local error: string = '';
  @Local busy: boolean = false;
  private generation: number = 0;
  private attempted: boolean = false;
  aboutToDisappear(): void { this.generation++; this.picture?.release(); this.picture = undefined; }
  private async load(): Promise<void> {
    if (this.busy || this.picture || !this.file.mimeType.startsWith('image/')) return;
    const generation = ++this.generation; this.busy = true; this.error = ''; this.attempted = true;
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
    this.busy = true; this.error = '';
    try { await saveChatMedia(context, this.file, this.conversationId); }
    catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; }
  }
  build() {
    Column({ space: 8 }) {
      if (this.picture) {
        Image(this.picture).width('100%').height(200).objectFit(ImageFit.Contain).borderRadius(12)
          .accessibilityText(this.file.name).onClick((): void => { this.expanded = true; })
      }
      Row({ space: 8 }) {
        Text(this.file.name || this.file.type).fontSize(13).fontColor($r('app.color.secondary')).layoutWeight(1).maxLines(2)
        Button($r('app.string.download')).height(44).fontSize(12).enabled(!this.busy).onClick((): void => { this.save(); })
      }.width('100%')
      if (this.error) {
        Text(this.error).fontSize(12).fontColor($r('app.color.danger'))
        Button($r('app.string.refresh')).onClick((): void => { if (!this.picture && this.file.mimeType.startsWith('image/')) this.load(); else this.save(); })
      }
    }.width('100%').onVisibleAreaChange([0.1], (visible: boolean): void => { if (visible && !this.attempted) this.load(); })
      .bindSheet($$this.expanded, this.preview, { height: '90%', dragBar: true })
  }
  @Builder
  preview() {
    Column({ space: 12 }) {
      if (this.picture) { Image(this.picture).width('100%').layoutWeight(1).objectFit(ImageFit.Contain) }
      Button($r('app.string.chat_close')).height(44).onClick((): void => { this.expanded = false; })
    }.width('100%').height('100%').padding(16)
  }
}
