import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { fileIo as fs, fileUri } from '@kit.CoreFileKit';
import { uniformTypeDescriptor as utd } from '@kit.ArkData';
import { systemShare } from '@kit.ShareKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';

@ObservedV2
class XopcChartBudget {
  @Trace active: string[] = [];
  private waiting: string[] = [];
  request(id: string, priority: boolean = false): void {
    if (this.active.includes(id)) return;
    if (!this.waiting.includes(id)) this.waiting.push(id);
    if (priority && this.active.length === 2) {
      const displaced = this.active[0];
      this.active = this.active.slice(1).concat([id]); this.waiting.push(displaced);
      this.waiting = this.waiting.filter((value: string): boolean => value !== id);
    }
    this.promote();
  }
  release(id: string): void {
    this.waiting = this.waiting.filter((value: string): boolean => value !== id);
    this.active = this.active.filter((value: string): boolean => value !== id); this.promote();
  }
  private promote(): void {
    while (this.active.length < 2 && this.waiting.length) {
      const id = this.waiting.shift();
      if (id) this.active = this.active.concat([id]);
    }
  }
}
const chartBudget: XopcChartBudget = new XopcChartBudget();

export function chartSourceAllowed(source: string): boolean {
  return source.length <= 102400 && new util.TextEncoder().encodeInto(source).byteLength <= 102400;
}

interface XopcChartMessage { id: string; revision: number; type: string; height?: number; data?: string; }
interface XopcChartPayload { id: string; revision: number; source: string; dark: boolean; expanded: boolean; fontSize: number; }
class XopcChartBridge {
  private receive: (message: string) => void;
  constructor(receive: (message: string) => void) { this.receive = receive; }
  postMessage(message: string): void { this.receive(message); }
}

@ComponentV2
export struct XopcChartMarkdownView {
  @Param content: string = '';
  @Param closed: boolean = false;
  @Event onCopy: (source: string) => void = (_source: string): void => {};
  @Event onRendered: (success: boolean) => void = (_success: boolean): void => {};
  @Local budget: XopcChartBudget = chartBudget;
  @Local expanded: boolean = false;
  @Local visible: boolean = false;
  @Local showSource: boolean = false;
  @Local rendered: boolean = false;
  @Local measuredHeight: number = 400;
  @Local exportRequest: number = 0;
  @Local colors: XopcThemeColors = appThemeColors;
  private chartId: string = util.generateRandomUUID();

  @Computed get allowed(): boolean { return chartSourceAllowed(this.content); }
  @Monitor('visible', 'expanded', 'closed', 'content')
  private updateLease(): void {
    if ((this.visible || this.expanded) && this.closed && this.allowed) this.budget.request(this.chartId, this.expanded);
    else this.budget.release(this.chartId);
  }
  aboutToDisappear(): void { this.budget.release(this.chartId); }

  private async shareImage(image: string): Promise<void> {
    try {
      if (!image.startsWith('data:image/png;base64,') || image.length > 12 * 1024 * 1024) return;
      const bytes = new util.Base64Helper().decodeSync(image.slice(22));
      if (bytes.byteLength > 8 * 1024 * 1024) return;
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const directory = context.cacheDir + '/charts';
      fs.mkdirSync(directory, true);
      const names = fs.listFileSync(directory);
      // Only this feature's bounded temporary directory is pruned.
      if (names.length >= 10) names.slice(0, names.length - 9).forEach((name: string): void => {
        try { fs.unlinkSync(directory + '/' + name); } catch (_) {}
      });
      const path = directory + '/' + this.chartId + '.png';
      const file = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
      try { fs.writeSync(file.fd, bytes.buffer); } finally { fs.closeSync(file); }
      const data = new systemShare.SharedData({ utd: utd.UniformDataType.PNG, uri: fileUri.getUriFromPath(path), title: 'xopc 图表' });
      await new systemShare.ShareController(data).show(context,
        { selectionMode: systemShare.SelectionMode.SINGLE, previewMode: systemShare.SharePreviewMode.DEFAULT });
    } catch (_) {
      try { this.getUIContext().getPromptAction().showToast({ message: '图表分享失败' }); } catch (_) {}
    }
  }

  @Builder
  private chartContent(fullscreen: boolean) {
    Column({ space: 8 }) {
      Row() {
        Button('复制数据').fontSize(12).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
          .onClick((): void => { this.onCopy(this.content); })
        Button(fullscreen ? '关闭' : '放大').fontSize(12).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
          .onClick((): void => { this.expanded = !fullscreen; })
        Button('分享图片').fontSize(12).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.accent).enabled(this.rendered)
          .onClick((): void => { this.exportRequest++; })
        Button('源码').fontSize(12).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
          .onClick((): void => { this.showSource = !this.showSource; })
      }.width('100%')
      if (!this.closed) {
        Text('等待图表数据完成…').fontColor(this.colors.secondary)
      } else if (!this.allowed) {
        Text('图表数据超过 100 KiB，请缩小数据范围。').fontColor(this.colors.secondary)
      } else if (this.budget.active.includes(this.chartId)) {
        XopcChartWebContent({ content: this.content, chartId: this.chartId, expanded: fullscreen, exportRequest: this.exportRequest,
          onRendered: (success: boolean): void => { this.rendered = success; this.onRendered(success); },
          onHeight: (height: number): void => { this.measuredHeight = height; },
          onImage: (image: string): void => { this.shareImage(image); } })
      } else {
        Text('图表将在可见时加载；可点放大查看。').height(this.measuredHeight).fontColor(this.colors.secondary)
      }
      if (this.showSource) { Text(this.content.slice(0, 4096)).fontSize(12).fontColor(this.colors.foreground).copyOption(CopyOptions.InApp) }
    }.width('100%').padding(8).alignItems(HorizontalAlign.Start)
  }

  @Builder
  private preview() {
    Scroll() { this.chartContent(true) }.width('100%').height('100%')
  }

  build() {
    Column() {
      if (!this.expanded) { this.chartContent(false) }
      else { Text('图表已在预览中打开。').padding(16).fontColor(this.colors.secondary) }
    }.width('100%').borderRadius(10).backgroundColor(this.colors.grouped).id('markdown-chart')
      .onVisibleAreaChange([0, 0.1], (visible: boolean, ratio: number): void => { this.visible = visible && ratio > 0; })
      .bindSheet($$this.expanded, this.preview, { height: SheetSize.LARGE, showClose: true, dragBar: true })
  }
}

@ComponentV2
struct XopcChartWebContent {
  @Param content: string = '';
  @Param chartId: string = '';
  @Param expanded: boolean = false;
  @Param exportRequest: number = 0;
  @Event onRendered: (success: boolean) => void = (_success: boolean): void => {};
  @Event onImage: (data: string) => void = (_data: string): void => {};
  @Event onHeight: (height: number) => void = (_height: number): void => {};
  @Local chartHeight: number = 400;
  @Local failed: boolean = false;
  @Local colors: XopcThemeColors = appThemeColors;
  private controller: webview.WebviewController = new webview.WebviewController();
  private revision: number = 0;
  private ready: boolean = false;
  private shareRequested: boolean = false;
  private bridge: XopcChartBridge = new XopcChartBridge((message: string): void => { this.receive(message); });

  private receive(message: string): void {
    if (!this.ready || message.length > 12 * 1024 * 1024) return;
    try {
      const value = JSON.parse(message) as XopcChartMessage;
      if (value.id !== this.chartId || value.revision !== this.revision) return;
      if (value.type === 'height' && typeof value.height === 'number' && Number.isFinite(value.height)) {
        this.chartHeight = Math.min(1600, Math.max(100, value.height)); this.onHeight(this.chartHeight);
      } else if (value.type === 'rendered') this.onRendered(true);
      else if (value.type === 'error') this.onRendered(false);
      else if (value.type === 'image' && this.shareRequested && value.data) {
        this.shareRequested = false; this.onImage(value.data);
      }
    } catch (_) {}
  }
  @Monitor('content', 'expanded', 'colors.foreground')
  private updateContent(): void {
    if (!this.ready) return;
    this.shareRequested = false;
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    const payload: XopcChartPayload = { id: this.chartId, revision: ++this.revision, source: this.content,
      dark: context.config.colorMode === 0, expanded: this.expanded, fontSize: 14 * (context.config.fontSizeScale || 1) };
    this.controller.runJavaScript('window.xopcChart.update(' + JSON.stringify(payload) + ')').catch((): void => { this.onRendered(false); });
  }
  @Monitor('exportRequest')
  private exportImage(): void {
    if (!this.ready) return;
    this.shareRequested = true;
    this.controller.runJavaScript('window.xopcChart.exportImage()').catch((): void => { this.shareRequested = false; });
  }
  aboutToDisappear(): void { this.ready = false; this.shareRequested = false; this.revision++; }

  build() {
    if (this.failed) { Text('图表加载失败，可重新打开预览或复制数据。').width('100%') } else {
    Web({ src: $rawfile('charts/index.html'), controller: this.controller })
      .width('100%').height(this.chartHeight).backgroundColor(Color.Transparent)
      .javaScriptAccess(true).domStorageAccess(false).fileAccess(true).imageAccess(false).mixedMode(MixedMode.None)
      .horizontalScrollBarAccess(false).verticalScrollBarAccess(false)
      .javaScriptProxy({ object: this.bridge, name: 'XopcChartBridge', methodList: ['postMessage'], controller: this.controller })
      .onPageEnd((): void => { this.ready = true; this.updateContent(); })
      .onLoadIntercept((event: OnLoadInterceptEvent): boolean => {
        const url = event.data.getRequestUrl();
        return !/^resource:\/\/rawfile\/charts\/(index\.html|host\.js|host\.css)$/i.test(url);
      })
      .onRenderExited((): void => { this.ready = false; this.failed = true; this.onRendered(false); })
    }
  }
}
