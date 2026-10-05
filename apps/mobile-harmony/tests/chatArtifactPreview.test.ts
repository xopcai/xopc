import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const media = readFileSync(new URL('../entry/src/main/ets/view/ChatMediaView.ets', import.meta.url), 'utf8');
const resultTail = readFileSync(new URL('../entry/src/main/ets/view/ChatResultTail.ets', import.meta.url), 'utf8');
const zh = readFileSync(new URL('../entry/src/main/resources/zh_CN/element/string.json', import.meta.url), 'utf8');

describe('chat artifact image preview', () => {
  it('requests compact thumbnails only for image deliverables', () => {
    expect(resultTail).toContain("compactThumbnail: item.item.kind === 'image' || item.item.mimeType?.startsWith('image/') === true");
    expect(resultTail).toContain('compactAvailable: true');
  });

  it('loads and opens compact image thumbnails with configurable sizing and fit', () => {
    expect(media).toContain("if (!this.compact || (this.compactThumbnail && this.previewKind() === 'image')) this.load();");
    expect(media).toContain('@Param compactThumbnailWidth: number = 0;');
    expect(media).toContain('@Param compactThumbnailHeight: number = 0;');
    expect(media).toContain("Image(this.picture).id('chat-compact-thumbnail-' + this.file.id)");
    expect(media).toContain('.width(this.compactThumbnailWidth || (this.compactMetadata ? 36 : 48))');
    expect(media).toContain('.height(this.compactThumbnailHeight || (this.compactMetadata ? 36 : 48))');
    expect(media).toContain('.objectFit(this.compactThumbnailContain ? ImageFit.Contain : ImageFit.Cover)');
    expect(media).toContain('const maxDimension = this.compactThumbnail ? Math.min(512, Math.max(128, thumbnailExtent * 3)) : 1024;');
    expect(media).toContain(".onClick((): void => { this.openPreview(); })");
    expect(media).toContain("$r('app.string.chat_artifact_available_size', this.fileSizeLabel())");
    expect(zh).toContain('"value":"可用 · %s"');
  });

  it('offers system-app and download fallbacks for unsupported files', () => {
    expect(media).toContain('openChatMedia(context, this.activeFile(), this.conversationId)');
    expect(media).toContain("$r('app.string.chat_open_with_app')");
    expect(media).toContain("Button($r('app.string.download')).height(44)");
    expect(media).toContain('this.fileDetailsLabel()');
    expect(media).toContain("this.failedAction === 'open'");
  });

  it('renders script-backed HTML in a restricted WebView and exposes a failure fallback', () => {
    expect(media).toContain('.javaScriptAccess(true).domStorageAccess(false).fileAccess(false)');
    expect(media).toContain('.horizontalScrollBarAccess(false).verticalScrollBarAccess(false)');
    expect(media).toContain(".padding(this.previewKind() === 'html' ? { top: 16 } : 16)");
    expect(media).toContain("Web({ src: 'about:blank', controller: this.webController })");
    expect(media).toContain("event.url === 'about:blank'");
    expect(media).toContain('this.loadHtmlData()');
    expect(media).toContain('new util.Base64Helper().encodeToStringSync(bytes)');
    expect(media).toContain("this.webController.loadData(encoded, 'text/html', 'base64')");
    expect(media).toContain("this.allowInitialHtmlNavigation && url.startsWith('data:text/')");
    expect(media).toContain("kind === 'html' ? htmlPreviewTextLimit(decoded) : previewTextLimit(decoded)");
    expect(media).toContain("if (this.compact && this.previewKind() === 'html') this.prefetchHtml();");
    expect(media).toContain('private async prefetchHtml(): Promise<void>');
    expect(media).toContain('.onLoadIntercept((event: OnLoadInterceptEvent): boolean =>');
    expect(media).toContain('event.request.isMainFrame()');
    expect(media).toContain('this.htmlError = true');
    expect(media).not.toContain('verifyHtmlRendered');
    expect(media).not.toContain('.onUrlLoadIntercept(');
  });
});

describe('chat image gallery preview', () => {
  it('passes same-message images into each attachment preview', () => {
    const content = readFileSync(new URL('../entry/src/main/ets/view/ChatMessageContent.ets', import.meta.url), 'utf8');
    expect(content).toContain("filePreviewKind(file.name, file.mimeType) === 'image'");
    expect(content).toContain('imageGallery: this.imageMedia');
  });

  it('navigates within bounds and keeps actions attached to the active image', () => {
    expect(media).toContain('const next = current + offset;');
    expect(media).toContain('next < 0 || next >= this.imageGallery.length');
    expect(media).toContain(".id('chat-media-previous-image')");
    expect(media).toContain(".id('chat-media-next-image')");
    expect(media).toContain('PanGesture({ fingers: 1, direction: PanDirection.Horizontal, distance: 30 })');
    expect(media).toContain('this.zoom > 1.05 || Math.abs(event.offsetX) < 60');
    expect(media).toContain('saveChatMedia(context, this.activeFile(), this.conversationId)');
    expect(media).toContain('createChatMediaShare(this.activeFile(), this.conversationId)');
  });
});
