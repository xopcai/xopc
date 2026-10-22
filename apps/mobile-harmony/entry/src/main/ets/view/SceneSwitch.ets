import { appThemeColors, XopcThemeColors } from '../common/themePalette';

@ComponentV2
export struct XopcSceneSwitch {
  @Param lifeMode: boolean = false;
  @Param opening: boolean = false;
  @Param reduceMotion: boolean = false;
  @Event onSelect: (life: boolean) => void = (_life: boolean): void => {};
  @Local colors: XopcThemeColors = appThemeColors;

  build() {
    Stack({ alignContent: Alignment.Start }) {
      Column().width(64).height(36).borderRadius(20).backgroundColor(this.colors.panel)
        .translate({ x: this.lifeMode ? 4 : 68 })
        .animation({ duration: this.reduceMotion ? 0 : 260, curve: Curve.LinearOutSlowIn })
      Row() {
        Button($r('app.string.home_mode_life')).width(64).height(44).padding(0)
          .fontSize(14).fontWeight(this.lifeMode ? FontWeight.Medium : FontWeight.Regular)
          .fontColor(this.lifeMode ? this.colors.foreground : this.colors.secondary)
          .backgroundColor(Color.Transparent).enabled(!this.opening)
          .accessibilitySelected(this.lifeMode).id('home-mode-life')
          .onClick((): void => { this.onSelect(true); })
        Button($r('app.string.home_mode_work')).width(64).height(44).padding(0)
          .fontSize(14).fontWeight(this.lifeMode ? FontWeight.Regular : FontWeight.Medium)
          .fontColor(this.lifeMode ? this.colors.secondary : this.colors.foreground)
          .backgroundColor(Color.Transparent).accessibilitySelected(!this.lifeMode).id('home-mode-work')
          .onClick((): void => { this.onSelect(false); })
      }.padding({ left: 4, right: 4 })
    }.width(136).height(44).borderRadius(24).backgroundColor(this.colors.active)
  }
}
