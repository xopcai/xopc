import { fetchPersonalAgentAvatar } from '../service/personalAgentAvatar';
import { XopcLoopi } from './Loopi';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { agentDefaultAvatar } from '../common/agentPresentation';
import { XopcLoopiMood } from '../common/loopiMotion';

@ComponentV2
export struct XopcPersonalAgentAvatar {
  @Param agentId: string = '';
  @Param appearance: string = 'loopi';
  @Param avatarReference: string = '';
  @Param fallbackLabel: string = '';
  @Param resolveUnconfigured: boolean = true;
  @Param revision: number = 0;
  @Param extent: number = 48;
  @Param activePage: boolean = true;
  @Param compact: boolean = false;
  @Param interactive: boolean = false;
  @Param moodOverride: XopcLoopiMood | undefined = undefined;
  @Local picture: string = '';
  @Local colors: XopcThemeColors = appThemeColors;
  private generation: number = 0;

  @Computed get defaultAvatar(): Resource | undefined {
    return this.appearance === 'configured' ? agentDefaultAvatar(this.agentId) : undefined;
  }

  aboutToAppear(): void { void this.loadPicture(); }
  aboutToDisappear(): void { this.generation++; }

  @Monitor('agentId', 'appearance', 'revision', 'avatarReference')
  async loadPicture(): Promise<void> {
    const generation = ++this.generation;
    this.picture = '';
    if ((this.appearance !== 'custom' && this.appearance !== 'configured') || !this.agentId) return;
    if (this.appearance === 'configured' && !this.resolveUnconfigured && !this.avatarReference.trim()) return;
    try {
      const picture = await fetchPersonalAgentAvatar(this.agentId, this.appearance === 'configured' ? this.avatarReference : undefined);
      if (generation === this.generation) this.picture = picture;
    } catch (_) { /* Keep the local fallback if the image is unavailable. */ }
  }

  build() {
    if (this.picture || this.defaultAvatar) {
      Image(this.picture || this.defaultAvatar).width(this.extent).height(this.extent).objectFit(ImageFit.Cover)
        .borderRadius(this.extent / 2).backgroundColor(this.colors.accentSoft).accessibilityLevel('no-hide-descendants')
    } else if (this.appearance === 'configured') {
      Text(Array.from((this.fallbackLabel.trim() || this.agentId).toUpperCase())[0] ?? '?').fontSize(this.extent * 0.5)
        .width(this.extent).height(this.extent).textAlign(TextAlign.Center).borderRadius(this.extent / 2)
        .backgroundColor(this.colors.accentSoft).fontColor(this.colors.foreground).accessibilityLevel('no-hide-descendants')
    } else {
      XopcLoopi({ extent: this.extent, compact: this.compact, activePage: this.activePage, interactive: this.interactive,
        mood: this.moodOverride ?? (this.appearance === 'loopi-care' ? 'care' : 'listen') })
    }
  }
}
