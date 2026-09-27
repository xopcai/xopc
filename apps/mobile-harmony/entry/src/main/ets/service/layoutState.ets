@ObservedV2
export class XopcLayoutState {
  @Trace keyboardVisible: boolean = false;
  @Trace chatActionsOpen: boolean = false;
  @Trace reduceMotion: boolean = true;
  dismissChatOverlay?: () => boolean;
  dismissTabNavigation?: () => boolean;

  isMainDockVisible(tab: number): boolean {
    return !this.keyboardVisible && !(tab === 0 && this.chatActionsOpen);
  }
}
export const layoutState: XopcLayoutState = new XopcLayoutState();
