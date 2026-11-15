import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { gatewaySession } from '../service/gatewaySession';

@ComponentV2
export struct XopcCapabilityLogo {
  @Param category: string = '';
  @Param iconUrl: string = '';
  @Param label: string = '';
  @Param extent: number = 48;
  @Local colors: XopcThemeColors = appThemeColors;
  @Local loaded: boolean = false;

  @Computed get source(): string {
    const url = this.iconUrl;
    if (/^\/(?:connector-icons|channel-icons)\/[a-z0-9_%.-]+(?:\/[a-z0-9_%.-]+)?$/i.test(url)
      && !url.includes('..') && !/%(?:2e|2f|5c)/i.test(url)) {
      try { return gatewaySession.activeOrigin() + url; }
      catch (_) { return ''; }
    }
    if (url.length <= 2048 && /^https:\/\/[^\s/@?#\\]+(?:[/?#][^\s\\]*)?$/i.test(url)) return url;
    if (url.length <= 176000 && /^data:image\/(?:svg\+xml|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) return url;
    return '';
  }

  @Monitor('iconUrl')
  reset(): void { this.loaded = false; }

  @Computed get initial(): string {
    const word = this.label.trim();
    const latin = word.match(/^[A-Za-z0-9]{1,2}/);
    return latin ? latin[0].toUpperCase() : Array.from(word)[0] ?? '';
  }

  private fallback(): Resource {
    if (this.category === 'skills') return $r('sys.symbol.checkmark_circle');
    if (this.category === 'connections') return $r('sys.symbol.link');
    if (this.category === 'channels') return $r('sys.symbol.ellipsis_bubble');
    return $r('sys.symbol.square_grid_2x2');
  }

  build() {
    Stack() {
      if (!this.loaded) {
        if (this.initial) {
          Text(this.initial).fontSize(this.extent * 0.39).fontWeight(FontWeight.Medium).fontColor(this.colors.chat.action)
        } else {
          SymbolGlyph(this.fallback()).fontSize(this.extent * 0.43).fontColor([this.colors.chat.action])
        }
      }
      if (this.source) {
        Image(this.source).width(this.extent * 0.65).height(this.extent * 0.65).objectFit(ImageFit.Contain)
          .onComplete((event): void => { this.loaded = event?.loadingStatus === 1; })
          .onError((): void => { this.loaded = false; })
      }
    }.width(this.extent).height(this.extent).borderRadius(this.colors.corner(14))
      .backgroundColor(this.loaded ? (this.colors.light ? this.colors.grouped : $r('app.color.theme_default_grouped_light'))
        : this.colors.accentSoft)
      .accessibilityLevel('no-hide-descendants')
  }
}
