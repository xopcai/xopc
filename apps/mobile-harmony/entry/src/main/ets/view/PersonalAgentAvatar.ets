import { fetchPersonalAgentAvatar } from '../service/personalAgentAvatar';
import { XopcLoopi } from './Loopi';

@ComponentV2
export struct XopcPersonalAgentAvatar {
  @Param agentId: string = '';
  @Param appearance: string = 'loopi';
  @Param revision: number = 0;
  @Param extent: number = 48;
  @Param activePage: boolean = true;
  @Param compact: boolean = false;
  @Local picture: string = '';
  private generation: number = 0;

  aboutToAppear(): void { void this.loadPicture(); }
  aboutToDisappear(): void { this.generation++; }

  @Monitor('agentId', 'appearance', 'revision')
  async loadPicture(): Promise<void> {
    const generation = ++this.generation;
    this.picture = '';
    if (this.appearance !== 'custom' || !this.agentId) return;
    try {
      const picture = await fetchPersonalAgentAvatar(this.agentId);
      if (generation === this.generation) this.picture = picture;
    } catch (_) { /* Keep the local character as a friendly fallback. */ }
  }

  build() {
    if (this.picture && this.appearance === 'custom') {
      Image(this.picture).width(this.extent).height(this.extent).objectFit(ImageFit.Cover)
        .borderRadius(this.extent / 2).accessibilityLevel('no-hide-descendants')
    } else {
      XopcLoopi({ extent: this.extent, compact: this.compact, activePage: this.activePage,
        mood: this.appearance === 'loopi-care' ? 'care' : 'listen' })
    }
  }
}
