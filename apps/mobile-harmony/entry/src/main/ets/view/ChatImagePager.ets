import { image } from '@kit.ImageKit';
import { XopcHistoryMedia } from '../model/chat';
import { readChatMedia } from '../service/chatMedia';
import { imageZoomOffset, boundedImageOffset } from '../common/chatImageViewport';
import { appThemeColors } from '../common/themePalette';

@ComponentV2
export struct XopcChatImagePager {
  @Param files: XopcHistoryMedia[] = [];
  @Param conversationId: string = '';
  @Param selectedIndex: number = 0;
  @Param requestedZoom: number = 1;
  @Event onSelect: (index: number) => void = (_index: number): void => {};
  @Event onZoom: (zoom: number) => void = (_zoom: number): void => {};
  build() {
    Swiper() {
      ForEach(this.files, (file: XopcHistoryMedia, index: number) => {
        XopcChatImagePage({ file, conversationId: this.conversationId, active: index === this.selectedIndex,
          prefetch: Math.abs(index - this.selectedIndex) <= 1, requestedZoom: this.requestedZoom,
          onZoom: (zoom: number): void => { if (index === this.selectedIndex) this.onZoom(zoom); } })
      }, (file: XopcHistoryMedia): string => file.id || file.uri)
    }.id('chat-image-pager').index(this.selectedIndex).loop(false).indicator(false).cachedCount(1)
      .disableSwipe(this.requestedZoom > 1.01).duration(250).width('100%').height('100%')
      .onChange((index: number): void => { this.onSelect(index); })
  }
}

@ComponentV2
struct XopcChatImagePage {
  @Param file: XopcHistoryMedia = { id: '', name: '', type: '', mimeType: '', size: 0, uri: '' };
  @Param conversationId: string = '';
  @Param active: boolean = false;
  @Param prefetch: boolean = false;
  @Param requestedZoom: number = 1;
  @Event onZoom: (zoom: number) => void = (_zoom: number): void => {};
  @Local picture?: image.PixelMap;
  @Local failed: boolean = false;
  @Local pictureRatio: number = 1;
  @Local zoom: number = 1;
  @Local imageOffsetX: number = 0;
  @Local imageOffsetY: number = 0;
  @Local viewportWidth: number = 1;
  @Local viewportHeight: number = 1;
  private generation: number = 0;
  private loading: boolean = false;
  private pinchZoom: number = 1;
  private startOffsetX: number = 0;
  private startOffsetY: number = 0;
  private pinchX: number = 0;
  private pinchY: number = 0;
  aboutToAppear(): void { if (this.prefetch) this.load(); }
  aboutToDisappear(): void { this.release(); }
  @Monitor('prefetch')
  onPrefetch(): void { if (this.prefetch) this.load(); else this.release(); }
  @Monitor('active')
  onActive(): void { this.zoom = 1; this.imageOffsetX = 0; this.imageOffsetY = 0; }
  @Monitor('requestedZoom')
  onZoomRequest(): void {
    if (!this.active || this.zoom === this.requestedZoom) return;
    const ratio = this.requestedZoom / this.zoom;
    this.imageOffsetX *= ratio; this.imageOffsetY *= ratio; this.zoom = this.requestedZoom;
    this.clampImageOffset();
  }
  private release(): void { this.generation++; this.picture?.release(); this.picture = undefined; this.loading = false; }
  private async load(): Promise<void> {
    if (this.picture || this.loading) return;
    const context = this.getUIContext().getHostContext(); if (!context) return;
    const generation = ++this.generation; this.loading = true; this.failed = false;
    try {
      const bytes = await readChatMedia(this.file, this.conversationId, context);
      if (generation !== this.generation) return;
      const source = image.createImageSource(bytes);
      try {
        const info = await source.getImageInfo();
        const ratio = Math.min(1, 4096 / Math.max(info.size.width, info.size.height),
          Math.sqrt(4 * 1024 * 1024 / (info.size.width * info.size.height)));
        const picture = await source.createPixelMap({ desiredSize: {
          width: Math.max(1, Math.round(info.size.width * ratio)), height: Math.max(1, Math.round(info.size.height * ratio)) } });
        if (generation !== this.generation) { await picture.release(); return; }
        this.pictureRatio = info.size.width / info.size.height; this.picture = picture;
      } finally { await source.release(); }
    } catch (_) { if (generation === this.generation) this.failed = true; }
    finally { if (generation === this.generation) this.loading = false; }
  }
  private clampImageOffset(): void {
    const fittedWidth = Math.min(this.viewportWidth, this.viewportHeight * this.pictureRatio);
    this.imageOffsetX = boundedImageOffset(this.imageOffsetX, fittedWidth, this.viewportWidth, this.zoom);
    this.imageOffsetY = boundedImageOffset(this.imageOffsetY, fittedWidth / this.pictureRatio, this.viewportHeight, this.zoom);
  }
  build() {
    Stack({ alignContent: Alignment.Center }) {
      if (this.picture) {
        Image(this.picture).id('chat-gallery-image-' + this.file.id).width('100%').height('100%').objectFit(ImageFit.Contain)
          .scale({ x: this.zoom, y: this.zoom }).translate({ x: this.imageOffsetX, y: this.imageOffsetY })
      } else if (this.failed) {
        Button($r('app.string.refresh')).onClick((): void => { this.load(); })
      } else { LoadingProgress().width(28).height(28).color(appThemeColors.secondary) }
    }.width('100%').height('100%').clip(true)
      .onAreaChange((_old: Area, area: Area): void => {
        this.viewportWidth = Number(area.width); this.viewportHeight = Number(area.height); this.clampImageOffset();
      })
      .gesture(GestureGroup(GestureMode.Exclusive,
        PinchGesture({ fingers: 2 }).onActionStart((event: GestureEvent): void => {
          this.pinchZoom = this.zoom; this.startOffsetX = this.imageOffsetX; this.startOffsetY = this.imageOffsetY;
          this.pinchX = event.pinchCenterX - this.viewportWidth / 2; this.pinchY = event.pinchCenterY - this.viewportHeight / 2;
        }).onActionUpdate((event: GestureEvent): void => {
          this.zoom = Math.max(1, Math.min(3, this.pinchZoom * event.scale));
          this.imageOffsetX = imageZoomOffset(this.pinchX, this.startOffsetX, this.pinchZoom, this.zoom)
            + event.pinchCenterX - this.viewportWidth / 2 - this.pinchX;
          this.imageOffsetY = imageZoomOffset(this.pinchY, this.startOffsetY, this.pinchZoom, this.zoom)
            + event.pinchCenterY - this.viewportHeight / 2 - this.pinchY;
          this.clampImageOffset(); this.onZoom(this.zoom);
        }),
        TapGesture({ count: 2 }).onAction((event: GestureEvent): void => {
          const finger = event.fingerList[0];
          if (this.zoom > 1) { this.zoom = 1; this.imageOffsetX = 0; this.imageOffsetY = 0; }
          else { this.zoom = 2; if (finger) { this.imageOffsetX = this.viewportWidth / 2 - finger.localX;
            this.imageOffsetY = this.viewportHeight / 2 - finger.localY; } }
          this.clampImageOffset(); this.onZoom(this.zoom);
        })))
      .parallelGesture(PanGesture({ fingers: 1, direction: PanDirection.All, distance: 10 })
        .onActionStart((): void => { this.startOffsetX = this.imageOffsetX; this.startOffsetY = this.imageOffsetY; })
        .onActionUpdate((event: GestureEvent): void => {
          if (this.zoom <= 1.01) return;
          this.imageOffsetX = this.startOffsetX + event.offsetX; this.imageOffsetY = this.startOffsetY + event.offsetY;
          this.clampImageOffset();
        }))
  }
}
