import { XopcLoopiMood, XopcLoopiMotion, XopcLoopiPose } from '../common/loopiMotion';
import { layoutState, XopcLayoutState } from '../service/layoutState';

@ComponentV2
export struct XopcLoopi {
  @Param extent: number = 96;
  @Param activePage: boolean = true;
  @Param compact: boolean = false;
  @Param interactive: boolean = false;
  @Param mood: XopcLoopiMood = 'listen';
  @Local layout: XopcLayoutState = layoutState;
  @Local pose: XopcLoopiPose = new XopcLoopiPose();
  private areaVisible: boolean = false;
  private mounted: boolean = false;
  private motion: XopcLoopiMotion = new XopcLoopiMotion((pose: XopcLoopiPose, durationMs: number): void => {
    if (!this.mounted) return;
    if (durationMs === 0) { this.pose = pose; return; }
    this.getUIContext().animateTo({ duration: durationMs, curve: Curve.EaseInOut }, (): void => { this.pose = pose; });
  });

  aboutToAppear(): void { this.mounted = true; }
  aboutToDisappear(): void { this.mounted = false; this.areaVisible = false; this.motion.dispose(); }

  @Monitor('activePage', 'compact', 'mood', 'layout.reduceMotion', 'layout.foreground')
  syncMotion(): void {
    this.motion.update(this.mounted && this.areaVisible && this.activePage && this.layout.foreground &&
      !this.layout.reduceMotion, this.compact, this.mood);
  }

  build() {
    Stack() {
      Image($r('app.media.loopi_ring')).width(this.extent).height(this.extent).objectFit(ImageFit.Contain)
        .rotate({ angle: this.pose.ringAngle }).translate({ y: this.pose.lift * this.extent / 304 })
      Stack() {
        Image($r('app.media.loopi_core')).width(this.extent).height(this.extent).objectFit(ImageFit.Contain)
        Image($r('app.media.loopi_eyes')).width(this.extent * 52 / 304).height(this.extent * 14 / 304)
          .objectFit(ImageFit.Contain).scale({ x: 1, y: this.pose.eyeOpen })
          .translate({ x: this.pose.gaze * this.extent / 304, y: -2 * this.extent / 304 })
      }.width(this.extent).height(this.extent).translate({ y: this.pose.lift * this.extent / 200 })
    }.width(this.extent).height(this.extent).accessibilityLevel('no-hide-descendants')
      .onVisibleAreaChange([0, 0.5], (_expanding: boolean, ratio: number): void => {
        this.areaVisible = ratio >= 0.5; this.syncMotion();
      })
      .onTouch((event: TouchEvent): void => {
        if (this.interactive && event.type === TouchType.Down) this.motion.greet();
      })
  }
}
