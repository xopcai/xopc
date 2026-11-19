import { util } from '@kit.ArkTS';
import { fileIo } from '@kit.CoreFileKit';
import { image } from '@kit.ImageKit';
import { media } from '@kit.MediaKit';
import { pdfService } from '@kit.PDFKit';

import { CHAT_MEDIA_LIMIT } from '../common/chatMediaSource';
import { filePreviewKind, normalizedFileMimeType } from '../common/filePreview';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcHistoryMedia } from '../model/chat';
import { readChatMedia } from '../service/chatMedia';

const PERSONAL_THUMBNAIL_PIXELS = 192;

async function personalImageThumbnail(bytes: ArrayBuffer): Promise<image.PixelMap> {
  const source = image.createImageSource(bytes);
  try {
    const info = await source.getImageInfo();
    const scale = Math.min(1, PERSONAL_THUMBNAIL_PIXELS / Math.max(1, info.size.width, info.size.height));
    return await source.createPixelMap({ desiredSize: {
      width: Math.max(1, Math.round(info.size.width * scale)), height: Math.max(1, Math.round(info.size.height * scale))
    } });
  } finally { await source.release(); }
}

function personalPdfThumbnail(path: string): image.PixelMap | undefined {
  const document = new pdfService.PdfDocument();
  if (document.loadDocument(path) !== pdfService.ParseResult.PARSE_SUCCESS) return undefined;
  try {
    if (document.getPageCount() < 1) return undefined;
    const page = document.getPage(0);
    const matrix = new pdfService.PdfMatrix();
    matrix.x = 0;
    matrix.y = 0;
    matrix.width = page.getWidth();
    matrix.height = page.getHeight();
    matrix.rotate = 0;
    const scale = PERSONAL_THUMBNAIL_PIXELS / Math.max(1, matrix.width, matrix.height);
    return page.getAreaPixelMap(matrix, Math.max(1, Math.round(matrix.width * scale)),
      Math.max(1, Math.round(matrix.height * scale)), false, false);
  } finally { document.releaseDocument(); }
}

async function personalLibraryMediaThumbnail(bytes: ArrayBuffer, cacheDir: string,
  isPdf: boolean): Promise<image.PixelMap | undefined> {
  const path = cacheDir + '/personal-preview-' + util.generateRandomUUID() + (isPdf ? '.pdf' : '.video');
  try {
    const file = await fileIo.open(path, fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE);
    try {
      if (await fileIo.write(file.fd, bytes) !== bytes.byteLength) return undefined;
      if (isPdf) return personalPdfThumbnail(path);
      const generator = await media.createAVImageGenerator();
      try {
        generator.fdSrc = { fd: file.fd, offset: 0, length: bytes.byteLength };
        return await generator.fetchScaledFrameByTime(0, media.AVImageQueryOptions.AV_IMAGE_QUERY_CLOSEST_SYNC,
          { width: PERSONAL_THUMBNAIL_PIXELS });
      } finally { await generator.release(); }
    } finally { await fileIo.close(file); }
  } finally { try { await fileIo.unlink(path); } catch (_) {} }
}

@ComponentV2
export struct XopcPersonalLibraryThumbnail {
  @Param file: XopcHistoryMedia | undefined = undefined;
  @Param conversationId: string = '';
  @Param mediaKind: string = '';
  @Local colors: XopcThemeColors = appThemeColors;
  @Local picture?: image.PixelMap;
  private visible: boolean = false;
  private requestedFile?: XopcHistoryMedia;
  private requestedScope: string = '';
  private generation: number = 0;

  aboutToDisappear(): void {
    this.visible = false;
    this.reset();
  }

  @Monitor('file', 'conversationId')
  sourceChanged(): void {
    if (this.hasRequestedFile()) return;
    this.reset();
    if (this.visible) void this.load();
  }

  private hasRequestedFile(): boolean {
    const file = this.file;
    const previous = this.requestedFile;
    return !!file && !!previous && this.conversationId === this.requestedScope && file.id === previous.id
      && file.uri === previous.uri && file.workspaceRelativePath === previous.workspaceRelativePath
      && file.name === previous.name && file.mimeType === previous.mimeType && file.size === previous.size;
  }

  private reset(): void {
    this.generation++;
    this.requestedFile = undefined;
    const picture = this.picture;
    this.picture = undefined;
    if (picture) void picture.release();
  }

  private isPdf(): boolean {
    return !!this.file && normalizedFileMimeType(this.file.name, this.file.mimeType) === 'application/pdf';
  }

  private symbol(): Resource {
    const kind = this.file ? filePreviewKind(this.file.name, this.file.mimeType) : this.mediaKind;
    if (kind === 'image') return $r('sys.symbol.picture');
    if (kind === 'video') return $r('sys.symbol.film');
    if (kind === 'audio' || kind === 'music') return $r('sys.symbol.waveform');
    if (kind === 'link' || kind === 'url') return $r('sys.symbol.link');
    return $r('sys.symbol.doc_text');
  }

  private async load(): Promise<void> {
    const file = this.file;
    if (!file || this.hasRequestedFile() || file.size > CHAT_MEDIA_LIMIT) return;
    const kind = filePreviewKind(file.name, file.mimeType);
    const isPdf = this.isPdf();
    if (kind !== 'image' && kind !== 'video' && !isPdf) return;
    if (kind === 'video' && !canIUse('SystemCapability.Multimedia.Media.AVImageGenerator')) return;
    if (isPdf && !canIUse('SystemCapability.OfficeService.PDFService.Core')) return;
    const context = this.getUIContext().getHostContext();
    if (!context) return;
    this.requestedFile = file;
    this.requestedScope = this.conversationId;
    const generation = ++this.generation;
    try {
      const bytes = await readChatMedia(file, this.conversationId, context);
      if (generation !== this.generation) return;
      const picture = kind === 'image' ? await personalImageThumbnail(bytes)
        : await personalLibraryMediaThumbnail(bytes, context.cacheDir, isPdf);
      if (!picture) return;
      if (generation === this.generation) this.picture = picture;
      else await picture.release();
    } catch (_) {
      // Keep the type icon when the content is unavailable or cannot be decoded.
    }
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      if (this.picture) {
        Image(this.picture).id('personal-library-thumbnail-' + this.file?.id)
          .width('100%').height('100%').objectFit(this.isPdf() ? ImageFit.Contain : ImageFit.Cover)
      } else {
        SymbolGlyph(this.symbol()).fontSize(23).fontColor([this.colors.secondary])
      }
    }.width(58).height(58).borderRadius(this.colors.corner(12)).clip(true)
      .backgroundColor(this.colors.grouped).accessibilityLevel('no-hide-descendants')
      .onVisibleAreaChange([0.1], (visible: boolean): void => {
        this.visible = visible;
        if (visible) void this.load();
      })
  }
}
