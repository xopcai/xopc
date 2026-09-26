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

  it('loads, crops and opens compact image thumbnails with artifact metadata', () => {
    expect(media).toContain("if (!this.compact || (this.compactThumbnail && this.previewKind() === 'image')) this.load();");
    expect(media).toContain("Image(this.picture).id('chat-compact-thumbnail-' + this.file.id).width(36).height(36)");
    expect(media).toContain('.objectFit(ImageFit.Cover).borderRadius(8)');
    expect(media).toContain('const maxDimension = this.compactThumbnail ? 128 : 1024;');
    expect(media).toContain(".onClick((): void => { this.openPreview(); })");
    expect(media).toContain("$r('app.string.chat_artifact_available_size', this.fileSizeLabel())");
    expect(zh).toContain('"value":"可用 · %s"');
  });

  it('offers system-app and download fallbacks for unsupported files', () => {
    expect(media).toContain('openChatMedia(context, this.file, this.conversationId)');
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
