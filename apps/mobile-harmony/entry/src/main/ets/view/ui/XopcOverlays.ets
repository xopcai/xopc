import {
  XOPC_BUTTON_HEIGHT_MD,
  XOPC_PAGE_PADDING_X,
  XOPC_RADIUS_LG,
  XOPC_RADIUS_MD,
  XOPC_RADIUS_SM,
  XOPC_SHEET_PADDING_X,
  xopcCloseIcon,
} from '../../common/designTokens';
import { xopcClickEffect, xopcRevealTransition } from '../../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../../common/themePalette';
import { layoutState, XopcLayoutState } from '../../service/layoutState';

export type XopcBannerTone = 'error' | 'warning' | 'info';

@ComponentV2
export struct XopcSheetHeader {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param heading: ResourceStr = '';
  @Param subtitle: ResourceStr = '';
  @Param closeId: string = '';
  @Param showClose: boolean = true;
  @Event onClose: () => void = (): void => {};

  build() {
    Row({ space: 12 }) {
      Column({ space: 2 }) {
        Text(this.heading)
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.colors.foreground)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        if (this.subtitle !== '') {
          Text(this.subtitle)
            .fontSize(12)
            .fontColor(this.colors.secondary)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)

      if (this.showClose) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph(xopcCloseIcon()).fontSize(18).fontColor([this.colors.foreground])
        }
          .id(this.closeId)
          .width(XOPC_BUTTON_HEIGHT_MD)
          .height(XOPC_BUTTON_HEIGHT_MD)
          .padding(0)
          .backgroundColor(this.colors.input)
          .clickEffect(xopcClickEffect())
          .accessibilityText($r('app.string.close'))
          .onClick((): void => { this.onClose(); })
      }
    }
      .width('100%')
      .padding({ left: XOPC_SHEET_PADDING_X, right: XOPC_SHEET_PADDING_X, top: 12, bottom: 12 })
      .alignItems(VerticalAlign.Center)
  }
}

@ComponentV2
export struct XopcUndoBar {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Param message: ResourceStr = '';
  @Param actionLabel: ResourceStr = $r('app.string.sessions_undo');
  @Param busy: boolean = false;
  @Param barId: string = '';
  @Param actionId: string = '';
  @Event onUndo: () => void = (): void => {};

  build() {
    Row({ space: 10 }) {
      Text(this.message)
        .fontSize(13)
        .fontColor(this.colors.foreground)
        .layoutWeight(1)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Button(this.actionLabel, { type: ButtonType.Normal })
        .id(this.actionId)
        .height(36)
        .padding({ left: 14, right: 14 })
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.colors.accent)
        .backgroundColor(this.colors.accentSoft)
        .borderRadius(this.colors.corner(XOPC_RADIUS_SM))
        .clipShape(this.colors.cornerClip(XOPC_RADIUS_SM))
        .enabled(!this.busy)
        .clickEffect(xopcClickEffect())
        .onClick((): void => { this.onUndo(); })
    }
      .id(this.barId)
      .width('100%')
      .padding({ left: 16, right: 10, top: 8, bottom: 8 })
      .backgroundColor(this.colors.panel)
      .borderRadius(this.colors.corner(XOPC_RADIUS_MD))
      .clipShape(this.colors.cornerClip(XOPC_RADIUS_MD))
      .transition(xopcRevealTransition(TransitionEdge.BOTTOM, this.layout.reduceMotion))
  }
}

@ComponentV2
export struct XopcInlineBanner {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Param message: ResourceStr = '';
  @Param tone: XopcBannerTone = 'error';
  @Param actionLabel: ResourceStr = '';
  @Param busy: boolean = false;
  @Event onAction: () => void = (): void => {};

  private fill(): Resource {
    if (this.tone === 'warning') return this.colors.warningFill;
    if (this.tone === 'info') return this.colors.accentSoft;
    return this.colors.panel;
  }

  private textColor(): Resource {
    if (this.tone === 'warning') return this.colors.warningForeground;
    if (this.tone === 'info') return this.colors.accent;
    return this.colors.secondary;
  }

  build() {
    Row({ space: 10 }) {
      Text(this.message)
        .fontSize(13)
        .lineHeight(18)
        .fontColor(this.textColor())
        .layoutWeight(1)
        .maxLines(3)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      if (this.actionLabel !== '') {
        Button(this.actionLabel, { type: ButtonType.Normal })
          .height(36)
          .padding({ left: 12, right: 12 })
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.colors.accent)
          .backgroundColor(this.colors.accentSoft)
          .borderRadius(this.colors.corner(XOPC_RADIUS_SM))
          .clipShape(this.colors.cornerClip(XOPC_RADIUS_SM))
          .enabled(!this.busy)
          .clickEffect(xopcClickEffect())
          .onClick((): void => { this.onAction(); })
      }
    }
      .width('100%')
      .padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X, top: 8, bottom: 8 })
      .backgroundColor(this.fill())
      .borderRadius(this.colors.corner(XOPC_RADIUS_SM))
      .transition(xopcRevealTransition(TransitionEdge.TOP, this.layout.reduceMotion))
  }
}

@ComponentV2
export struct XopcBatchActionBar {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Param barId: string = '';
  @Param barEnabled: boolean = true;
  @BuilderParam actions: () => void = this.emptyActions;

  @Builder
  private emptyActions() {}

  build() {
    Row({ space: 4 }) {
      this.actions()
    }
      .id(this.barId)
      .width('92%')
      .padding(6)
      .backgroundColor(this.colors.panel)
      .borderRadius(this.colors.corner(XOPC_RADIUS_LG + 8))
      .margin({ top: 6, bottom: 8 })
      .enabled(this.barEnabled)
      .transition(xopcRevealTransition(TransitionEdge.BOTTOM, this.layout.reduceMotion))
  }
}
