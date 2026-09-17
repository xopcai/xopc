@ObservedV2
export class XopcLayoutState {
  @Trace keyboardVisible: boolean = false;
  @Trace chatDrawerOpen: boolean = false;
  @Trace chatActionsOpen: boolean = false;
  @Trace reduceMotion: boolean = true;
  dismissChatOverlay?: () => boolean;

  isMainDockVisible(tab: number): boolean {
    return !this.keyboardVisible && !(tab === 0 && (this.chatDrawerOpen || this.chatActionsOpen));
  }
}
export const layoutState: XopcLayoutState = new XopcLayoutState();
