import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';

export interface MathMeasurement {
  revision: number;
  height?: number;
  href?: string;
  ready?: number;
  pending?: number;
  fontsLoaded?: boolean;
}
interface MathPayload { revision: number; markdown: string; streaming: boolean; dark: boolean; fontSize: number; color?: string; }

class MathHeightBridge {
  private receive: (message: string) => void;
  constructor(receive: (message: string) => void) { this.receive = receive; }
  postMessage(message: string): void { this.receive(message); }
}

@ComponentV2
export struct XopcMathMarkdownView {
  @Param content: string = '';
  @Param textSelectable: boolean = true;
  @Param streaming: boolean = false;
  @Param fontSize: number = 16;
  @Param mathRenderingAllowed: boolean = true;
  @Event onOpenLink: (href: string) => void = (_href: string): void => {};
  @Event onMeasured: (measurement: MathMeasurement) => void = (_measurement: MathMeasurement): void => {};
  @Local mathHeight: number = 48;
  @Local colors: XopcThemeColors = appThemeColors;
  private revision: number = 0;
  private ready: boolean = false;
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: MathHeightBridge = new MathHeightBridge((message: string): void => { this.receive(message); });

  private receive(message: string): void {
    try {
      const value = JSON.parse(message) as MathMeasurement;
      if (value.revision !== this.revision || !this.ready) return;
      if (value.href) {
        if (/^(https?:\/\/|xopc:\/\/)/.test(value.href)) this.onOpenLink(value.href);
      } else if (typeof value.height === 'number' && Number.isFinite(value.height)) {
        this.mathHeight = Math.min(8192, Math.max(24, value.height));
        this.onMeasured(value);
      }
    } catch (_) {}
  }
  @Monitor('content', 'streaming', 'fontSize', 'mathRenderingAllowed', 'colors.foreground')
  private updateContent(): void {
    if (!this.ready) return;
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    const payload: MathPayload = { revision: ++this.revision, markdown: this.content, streaming: this.streaming,
      dark: context.config.colorMode === 0, fontSize: this.fontSize * (context.config.fontSizeScale || 1) };
    try { payload.color = '#' + (context.resourceManager.getColorSync(this.colors.foreground) >>> 0).toString(16).padStart(8, '0').slice(2); }
    catch (_) {}
    // JSON encodes the payload as data, without passing gateway credentials into the page.
    try { this.controller.runJavaScript('window.xopcMath.update(' + JSON.stringify(payload) + ')').catch((): void => {}); }
    catch (_) {}
  }
  aboutToDisappear(): void { this.ready = false; this.revision++; }
  build() {
    if (this.mathRenderingAllowed) {
    Web({ src: $rawfile('math/index.html'), controller: this.controller })
      .width('100%').height(this.mathHeight).backgroundColor(Color.Transparent).javaScriptAccess(true).domStorageAccess(false)
      .copyOptions(this.textSelectable ? CopyOptions.InApp : CopyOptions.None)
      .fileAccess(true).imageAccess(false).mixedMode(MixedMode.None)
      .horizontalScrollBarAccess(false).verticalScrollBarAccess(false)
      .javaScriptProxy({ object: this.bridge, name: 'XopcMathBridge', methodList: ['postMessage'], controller: this.controller })
      .onPageEnd((): void => { this.ready = true; this.updateContent(); })
      .onLoadIntercept((event: OnLoadInterceptEvent): boolean => {
        const url = event.data.getRequestUrl();
        return event.data.isMainFrame() && !!url && !url.includes('/math/') && url !== 'about:blank';
      })
    } else {
      Text(this.content).fontSize(this.fontSize).fontColor(this.colors.foreground).width('100%').copyOption(this.textSelectable ? CopyOptions.InApp : CopyOptions.None)
    }
  }
}
