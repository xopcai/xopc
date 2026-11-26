@ObservedV2
export class XopcLayoutState {
  @Trace foreground: boolean = true;
  @Trace systemTopInsetPx: number = 0;
  @Trace systemBottomInsetPx: number = 0;
  @Trace keyboardHeightPx: number = 0;
  @Trace reduceMotion: boolean = true;
  @Trace bottomChromeInset: number = 0;
  dismissChatOverlay?: () => boolean;
  dismissSidebar?: () => boolean;
  handleBackPress?: () => boolean;

  get keyboardVisible(): boolean {
    return this.keyboardHeightPx > 0;
  }
}
export const layoutState: XopcLayoutState = new XopcLayoutState();
