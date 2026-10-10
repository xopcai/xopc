import { fetchPersonalAgentAvatar } from '../service/personalAgentAvatar';
import { XopcLoopi } from './Loopi';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';

@ComponentV2
export struct XopcPersonalAgentAvatar {
  @Param agentId: string = '';
  @Param appearance: string = 'loopi';
  @Param avatarReference: string = '';
  @Param revision: number = 0;
  @Param extent: number = 48;
  @Param activePage: boolean = true;
  @Param compact: boolean = false;
  @Local picture: string = '';
  @Local colors: XopcThemeColors = appThemeColors;
  private generation: number = 0;

  aboutToAppear(): void { void this.loadPicture(); }
  aboutToDisappear(): void { this.generation++; }

  @Monitor('agentId', 'appearance', 'revision', 'avatarReference')
  async loadPicture(): Promise<void> {
    const generation = ++this.generation;
    this.picture = '';
    if ((this.appearance !== 'custom' && this.appearance !== 'configured') || !this.agentId) return;
    try {
      const picture = await fetchPersonalAgentAvatar(this.agentId, this.appearance === 'configured' ? this.avatarReference : undefined);
      if (generation === this.generation) this.picture = picture;
    } catch (_) { /* Keep the local fallback if the image is unavailable. */ }
  }

  build() {
    if (this.picture && (this.appearance === 'custom' || this.appearance === 'configured')) {
      Image(this.picture).width(this.extent).height(this.extent).objectFit(ImageFit.Cover)
        .borderRadius(this.extent / 2).accessibilityLevel('no-hide-descendants')
    } else if (this.appearance === 'configured') {
      Text(this.agentId.slice(0, 1).toUpperCase()).fontSize(this.extent * 0.4)
        .width(this.extent).height(this.extent).textAlign(TextAlign.Center).borderRadius(this.extent / 2)
        .backgroundColor(this.colors.accentSoft).fontColor(this.colors.foreground).accessibilityLevel('no-hide-descendants')
    } else {
      XopcLoopi({ extent: this.extent, compact: this.compact, activePage: this.activePage,
        mood: this.appearance === 'loopi-care' ? 'care' : 'listen' })
    }
  }
}
