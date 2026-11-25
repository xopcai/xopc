import { xopcSheetOptions } from '../common/dialogActions';
import { xopcClickEffect } from '../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { hasConversationMcpSetup } from '../repository/capabilitiesRepository';
import { capabilityDrawerHeight, XopcCapabilityPanelView } from './CapabilityPanelView';

@ComponentV2
export struct XopcConversationMcpAction {
  @Param conversationId: string = '';
  @Param activeRun: boolean = false;
  @Param shown: boolean = false;
  @Local colors: XopcThemeColors = appThemeColors;
  @Local available: boolean = false;
  @Local panelOpen: boolean = false;
  @Local panelExpanded: boolean = false;
  @Local panelConversationId: string = '';
  private generation: number = 0;

  aboutToAppear(): void { void this.refresh(); }
  aboutToDisappear(): void { this.generation++; }

  @Monitor('conversationId', 'shown')
  reset(): void {
    this.generation++;
    this.available = false;
    this.panelOpen = false;
    void this.refresh();
  }

  @Monitor('activeRun')
  async refresh(): Promise<void> {
    const revision = ++this.generation;
    if (!this.shown || !this.conversationId || this.activeRun) return;
    try {
      const available = await hasConversationMcpSetup(this.conversationId);
      if (revision === this.generation) this.available = available;
    } catch (_) {
      if (revision === this.generation) this.available = false;
    }
  }

  @Builder
  panel() {
    XopcCapabilityPanelView({ category: 'connections', itemId: 'conversation:' + this.panelConversationId,
      itemName: this.getUIContext().getHostContext()?.resourceManager.getStringSync($r('app.string.capability_mcp_continue').id) ?? '',
      onExpandedChange: (expanded: boolean): void => { this.panelExpanded = expanded; },
      onClose: (): void => { this.panelOpen = false; } })
  }

  build() {
    Column() {
      if (this.available) {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 8 }) {
            SymbolGlyph($r('sys.symbol.link')).fontSize(17).fontColor([this.colors.chat.action])
            Text($r('app.string.capability_mcp_continue')).fontColor(this.colors.chat.action).fontSize(14)
          }
        }.id('chat-mcp-setup').height(44).backgroundColor(this.colors.accentSoft)
          .borderRadius(this.colors.corner(14)).clipShape(this.colors.cornerClip(14)).clickEffect(xopcClickEffect()).onClick((): void => {
            this.getUIContext().getFocusController().clearFocus();
            this.panelConversationId = this.conversationId;
            this.panelExpanded = false;
            this.panelOpen = true;
          })
      }
    }.width('100%').margin({ bottom: this.available ? 8 : 0 })
      .bindSheet($$this.panelOpen, this.panel, xopcSheetOptions('large', {
        height: capabilityDrawerHeight(this.panelExpanded),
        backgroundColor: this.colors.surface,
        onDisappear: (): void => { void this.refresh(); },
      }))
  }
}
