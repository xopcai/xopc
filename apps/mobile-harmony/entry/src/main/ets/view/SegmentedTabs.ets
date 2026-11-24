import { common } from '@kit.AbilityKit';
import { curves } from '@kit.ArkUI';
import { appThemeColors, xopcRoundedClip, XopcThemeColors } from '../common/themePalette';
import { layoutState, XopcLayoutState } from '../service/layoutState';

export interface XopcSegmentOption {
  key: string;
  label: ResourceStr;
  icon?: Resource;
  count?: number;
  testId?: string;
  minimumWidth?: number;
}

const segmentCurve: ICurve = curves.cubicBezierCurve(0.32, 0.72, 0, 1);
export const SEGMENTED_PAGE_TAP_SLOP_VP = 8;

@ObservedV2
export class XopcPagerProgress {
  @Trace page: number | undefined = undefined;

  update(index: number, position: number, mainAxisLength: number): void {
    if (mainAxisLength > 0) this.page = index - position;
  }

  reset(): void {
    this.page = undefined;
  }
}

export class XopcPageSwipe implements GestureModifier {
  private keys: string[];
  private selected: string;
  private onSelect: (key: string) => void;
  private enabled: boolean;

  constructor(keys: string[], selected: string, onSelect: (key: string) => void, enabled: boolean = true) {
    this.keys = keys;
    this.selected = selected;
    this.onSelect = onSelect;
    this.enabled = enabled;
  }

  applyGesture(event: UIGestureEvent): void {
    event.clearGestures();
    const index = this.keys.indexOf(this.selected);
    if (!this.enabled || index < 0 || this.keys.length < 2) return;
    const direction = index === 0 ? PanDirection.Left
      : index === this.keys.length - 1 ? PanDirection.Right : PanDirection.Horizontal;
    event.addGesture(new PanGestureHandler({ direction, distance: SEGMENTED_PAGE_TAP_SLOP_VP })
      .onActionEnd((swipe: GestureEvent): void => {
        if (Math.abs(swipe.offsetX) < 56) return;
        const target = index + (swipe.offsetX < 0 ? 1 : -1);
        if (target >= 0 && target < this.keys.length) this.onSelect(this.keys[target]);
      }));
  }
}

@ComponentV2
export struct XopcSegmentedTabs {
  @Param options: XopcSegmentOption[] = [];
  @Param selectedKey: string = '';
  @Param pagerProgress: XopcPagerProgress | undefined = undefined;
  @Param segmentMin: number = 64;
  @Param swipeToSelect: boolean = false;
  @Event onSelect: (key: string) => void = (_key: string): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Local viewportWidth: number = 0;
  @Local fontScale: number = 1;
  private scroller: Scroller = new Scroller();
  private revealTimer: number = -1;

  @Computed get minimumWidths(): Map<string, number> {
    const widths = new Map<string, number>();
    const context = this.getUIContext();
    const measure = context.getMeasureUtils();
    for (const option of this.options) {
      let width = 12 + context.px2vp(measure.measureText({
        textContent: option.label, fontSize: 14, fontWeight: FontWeight.Bold
      }));
      if (option.icon) width += 21;
      if (option.count !== undefined) {
        width += 5 + context.px2vp(measure.measureText({ textContent: option.count.toString(), fontSize: 11 }));
      }
      widths.set(option.key, Math.max((option.minimumWidth ?? this.segmentMin) * this.fontScale, Math.ceil(width)));
    }
    return widths;
  }

  @Computed get trackWidth(): number {
    return this.options.reduce((width: number, option: XopcSegmentOption): number =>
      width + (this.minimumWidths.get(option.key) ?? this.segmentMin), 0);
  }

  @Computed get canSwipeToSelect(): boolean {
    return this.swipeToSelect && this.viewportWidth > 0 && this.trackWidth <= this.viewportWidth;
  }

  @Computed get extraWidth(): number {
    return Math.max(0, this.viewportWidth - this.trackWidth) / Math.max(this.options.length, 1);
  }

  private segmentWidth(option: XopcSegmentOption): number {
    return (this.minimumWidths.get(option.key) ?? this.segmentMin) + this.extraWidth;
  }

  @Computed get selectedIndex(): number {
    return this.options.findIndex((option: XopcSegmentOption): boolean => option.key === this.selectedKey);
  }

  private segmentStart(index: number): number {
    return this.options.slice(0, Math.max(0, index))
      .reduce((offset: number, option: XopcSegmentOption): number => offset + this.segmentWidth(option), 0);
  }

  @Computed get selectedOffset(): number {
    return this.segmentStart(this.selectedIndex);
  }

  @Computed get indicatorPage(): number {
    return Math.max(0, Math.min(this.options.length - 1, this.pagerProgress?.page ?? this.selectedIndex));
  }

  @Computed get indicatorOffset(): number {
    const left = Math.floor(this.indicatorPage);
    return this.segmentStart(left) + this.segmentWidth(this.options[left]) * (this.indicatorPage - left);
  }

  @Computed get indicatorWidth(): number {
    const left = Math.floor(this.indicatorPage);
    const right = Math.min(left + 1, this.options.length - 1);
    const width = this.segmentWidth(this.options[left]);
    return width + (this.segmentWidth(this.options[right]) - width) * (this.indicatorPage - left);
  }

  @Computed get selectedForeground(): Resource {
    return this.colors.light ? this.colors.accent : this.colors.foreground;
  }

  @Computed get segmentRadius(): number {
    return this.colors.corner(18) * this.fontScale;
  }

  @Monitor('selectedKey', 'viewportWidth', 'fontScale')
  private revealSelection(): void {
    clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout((): void => {
      if (this.viewportWidth <= 0 || this.selectedIndex < 0) return;
      const start = this.selectedOffset;
      const width = this.segmentWidth(this.options[this.selectedIndex]);
      const current = this.scroller.currentOffset().xOffset;
      const target = start < current || width > this.viewportWidth
        ? start : Math.max(current, start + width - this.viewportWidth);
      if (Math.abs(target - current) >= 1) {
        this.scroller.scrollTo({ xOffset: target, yOffset: 0, animation: !this.layout.reduceMotion });
      }
    }, 0);
  }

  aboutToDisappear(): void {
    clearTimeout(this.revealTimer);
  }

  build() {
    Scroll(this.scroller) {
      if (this.viewportWidth > 0) {
        Stack({ alignContent: Alignment.Start }) {
          if (this.selectedIndex >= 0) {
            Blank().id('segmented-tab-indicator').width(this.indicatorWidth).height(44 * this.fontScale)
              .backgroundColor(this.colors.light ? this.colors.panel : this.colors.active)
              .borderRadius(this.segmentRadius).translate({ x: this.indicatorOffset })
              .animation({ duration: this.layout.reduceMotion || this.pagerProgress !== undefined ? 0 : 250, curve: segmentCurve })
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
                    .fontWeight(option.key === this.selectedKey ? FontWeight.Bold : FontWeight.Medium).maxLines(1)
                    .textAlign(TextAlign.Center).textOverflow({ overflow: TextOverflow.Ellipsis })
                    .fontColor(option.key === this.selectedKey ? this.selectedForeground : this.colors.secondary)
                    .animation({ duration: this.layout.reduceMotion ? 0 : 150, curve: Curve.EaseOut })
                  if (option.count !== undefined) {
                    Text(option.count.toString()).fontSize(11).maxLines(1)
                      .fontColor(option.key === this.selectedKey ? this.selectedForeground : this.colors.secondary)
                    .animation({ duration: this.layout.reduceMotion ? 0 : 150, curve: Curve.EaseOut })
                  }
                }.padding({ left: 6, right: 6 }).justifyContent(FlexAlign.Center)
              }.id(option.testId ?? '').width(this.segmentWidth(option)).height(44 * this.fontScale).padding(0)
                .borderRadius(this.segmentRadius).clipShape(xopcRoundedClip(this.segmentRadius)).backgroundColor(Color.Transparent)
                .accessibilitySelected(option.key === this.selectedKey)
                .onClick((): void => { this.onSelect(option.key); }, SEGMENTED_PAGE_TAP_SLOP_VP)
            }, (option: XopcSegmentOption): string => option.key + ':' + (option.count ?? ''))
          }
        }.width(Math.max(this.trackWidth, this.viewportWidth)).height(44 * this.fontScale)
          .borderRadius(this.segmentRadius).backgroundColor(this.colors.input).clip(true)
      }
    }.width('100%').height(44 * this.fontScale).clip(true)
      .scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).enableScrollInteraction(!this.canSwipeToSelect)
      .gestureModifier(new XopcPageSwipe(this.options.map((option: XopcSegmentOption): string => option.key),
        this.selectedKey, (key: string): void => { this.onSelect(key); },
        this.canSwipeToSelect))
      .onAreaChange((_before: Area, next: Area): void => {
        this.viewportWidth = Number(next.width);
        const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
        this.fontScale = Math.max(context.config.fontSizeScale ?? 1, 1);
      })
  }
}
