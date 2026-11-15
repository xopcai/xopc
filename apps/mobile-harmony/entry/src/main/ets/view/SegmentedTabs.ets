import { common } from '@kit.AbilityKit';
import { curves } from '@kit.ArkUI';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { layoutState, XopcLayoutState } from '../service/layoutState';

export interface XopcSegmentOption {
  key: string;
  label: ResourceStr;
  icon?: Resource;
  count?: number;
  testId?: string;
}

const segmentCurve: ICurve = curves.cubicBezierCurve(0.32, 0.72, 0, 1);

@ComponentV2
export struct XopcSegmentedTabs {
  @Param options: XopcSegmentOption[] = [];
  @Param selectedKey: string = '';
  @Param segmentMin: number = 64;
  @Event onSelect: (key: string) => void = (_key: string): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Local viewportWidth: number = 0;
  @Local fontScale: number = 1;

  @Computed get segmentWidth(): number {
    return Math.max(this.segmentMin * this.fontScale, this.viewportWidth / Math.max(this.options.length, 1));
  }

  @Computed get selectedIndex(): number {
    return this.options.findIndex((option: XopcSegmentOption): boolean => option.key === this.selectedKey);
  }

  @Computed get selectedForeground(): Resource {
    return this.colors.light ? this.colors.accent : this.colors.foreground;
  }

  build() {
    Scroll() {
      if (this.viewportWidth > 0) {
        Stack({ alignContent: Alignment.Start }) {
          if (this.selectedIndex >= 0) {
            Blank().width(this.segmentWidth).height(44 * this.fontScale)
              .backgroundColor(this.colors.light ? this.colors.panel : this.colors.active)
              .border(this.colors.panelStroke).borderRadius(22 * this.fontScale).translate({ x: this.segmentWidth * this.selectedIndex })
              .animation({ duration: this.layout.reduceMotion ? 0 : 250, curve: segmentCurve })
              .hitTestBehavior(HitTestMode.None).accessibilityLevel('no')
          }
          Row() {
            ForEach(this.options, (option: XopcSegmentOption) => {
              Button({ type: ButtonType.Normal }) {
                Row({ space: 5 }) {
                  if (option.icon) {
                    SymbolGlyph(option.icon).fontSize(16).fontColor([
                      option.key === this.selectedKey ? this.selectedForeground : this.colors.secondary
                    ]).animation({ duration: this.layout.reduceMotion ? 0 : 150, curve: Curve.EaseOut })
                  }
                  Text(option.label).fontSize(14)
                    .fontWeight(this.colors.light && option.key === this.selectedKey ? FontWeight.Bold : FontWeight.Medium).maxLines(2)
                    .textAlign(TextAlign.Center).textOverflow({ overflow: TextOverflow.Ellipsis })
                    .fontColor(option.key === this.selectedKey ? this.selectedForeground : this.colors.secondary)
                    .animation({ duration: this.layout.reduceMotion ? 0 : 150, curve: Curve.EaseOut })
                  if (option.count !== undefined) {
                    Text(option.count.toString()).fontSize(11)
                      .fontColor(option.key === this.selectedKey ? this.selectedForeground : this.colors.secondary)
                    .animation({ duration: this.layout.reduceMotion ? 0 : 150, curve: Curve.EaseOut })
                  }
                }.padding({ left: 6, right: 6 }).justifyContent(FlexAlign.Center)
              }.id(option.testId ?? '').width(this.segmentWidth).height(44 * this.fontScale).padding(0)
                .borderRadius(22 * this.fontScale).backgroundColor(Color.Transparent)
                .accessibilitySelected(option.key === this.selectedKey).onClick((): void => { this.onSelect(option.key); })
            }, (option: XopcSegmentOption): string => option.key + ':' + (option.count ?? ''))
          }
        }.width(this.segmentWidth * this.options.length).height(44 * this.fontScale)
          .borderRadius(22 * this.fontScale).backgroundColor(this.colors.input).clip(true)
      }
    }.width('100%').height(44 * this.fontScale).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
      .onAreaChange((_before: Area, next: Area): void => {
        this.viewportWidth = Number(next.width);
        const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
        this.fontScale = Math.max(context.config.fontSizeScale ?? 1, 1);
      })
  }
}
