@ObservedV2
export class XopcLayoutState {
  @Trace foreground: boolean = true;
  @Trace keyboardVisible: boolean = false;
  @Trace chatActionsOpen: boolean = false;
  @Trace reduceMotion: boolean = true;
  dismissChatOverlay?: () => boolean;
  dismissTabNavigation?: () => boolean;

  isMainDockVisible(_tab: number): boolean {
    return !this.keyboardVisible && !this.chatActionsOpen;
  }
}
export const layoutState: XopcLayoutState = new XopcLayoutState();
