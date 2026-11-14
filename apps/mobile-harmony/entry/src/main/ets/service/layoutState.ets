@ObservedV2
export class XopcLayoutState {
  @Trace foreground: boolean = true;
  @Trace systemTopInsetPx: number = 0;
  @Trace reduceMotion: boolean = true;
  dismissChatOverlay?: () => boolean;
  dismissSidebar?: () => boolean;
}
export const layoutState: XopcLayoutState = new XopcLayoutState();
