import { XOPC_ICON_HEADER, xopcBackIcon, xopcMoreIcon } from '../common/designTokens';
import { xopcClickEffect } from '../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcWorkspaceRepository } from '../repository/workspaceRepository';
import { XopcWorkspaceItem } from '../model/workspace';
import { layoutState } from '../service/layoutState';

@ComponentV2
export struct XopcTaskChatHeader {
  @Param taskId: string = '';
  @Param topInset: number = 0;
  @BuilderParam readAloudAction: () => void;
  @Event onClose: () => void = (): void => {};
  @Event onSearch: () => void = (): void => {};
  @Event onOptions: () => void = (): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local item?: XopcWorkspaceItem;
  @Local busy: boolean = false;
  @Local headerVisible: boolean = true;
  private repository: XopcWorkspaceRepository = new XopcWorkspaceRepository();
  private timer: number = -1;
  private generation: number = 0;

  aboutToAppear(): void {
    void this.refresh();
    this.timer = setInterval((): void => { if (this.headerVisible && layoutState.foreground) void this.refresh(); }, 8000);
  }
  aboutToDisappear(): void { clearInterval(this.timer); this.generation++; }
  private async refresh(): Promise<void> {
    if (this.busy || !this.taskId) return;
    const generation = this.generation;
    this.busy = true;
    try {
      const item = await this.repository.detail('tasks', this.taskId);
      if (generation === this.generation) this.item = item;
    } catch (_error) {
      // The details page has its own retry when the task cannot be loaded.
    }
    finally { if (generation === this.generation) this.busy = false; }
  }
  @Builder
  taskMenu() {
    Menu() {
      MenuItem({ content: $r('app.string.search') }).onClick((): void => { this.onSearch(); })
      MenuItem({ content: $r('app.string.chat_actions') }).onClick((): void => { this.onOptions(); })
    }
  }

  build() {
    Row({ space: 8 }) {
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph(xopcBackIcon()).fontSize(XOPC_ICON_HEADER).fontColor([this.colors.foreground])
      }.id('task-chat-close').width(44).height(44).padding(0).backgroundColor(this.colors.chat.card)
        .hitTestBehavior(HitTestMode.Default)
        .clickEffect(xopcClickEffect())
        .accessibilityText($r('app.string.back')).onClick((): void => { this.onClose(); })
      Row() {
        Text(this.item?.title || $r('app.string.task_detail_title')).fontSize(16).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.foreground).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.height(44).padding({ left: 14, right: 14 }).borderRadius(22).backgroundColor(this.colors.chat.card)
        .alignItems(VerticalAlign.Center).layoutWeight(1)
      this.readAloudAction()
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph(xopcMoreIcon()).fontSize(XOPC_ICON_HEADER).fontColor([this.colors.foreground])
      }.id('task-chat-menu').width(44).height(44).padding(0).backgroundColor(this.colors.chat.card)
        .hitTestBehavior(HitTestMode.Default)
        .clickEffect(xopcClickEffect())
        .accessibilityText($r('app.string.more')).bindMenu(this.taskMenu)
    }.id('task-chat-header').width('100%').height(this.topInset + 64).padding({ left: 12, right: 12, top: this.topInset })
      .backgroundColor(Color.Transparent)
      .hitTestBehavior(HitTestMode.None)
      .onVisibleAreaChange([0, 0.1], (visible: boolean, ratio: number): void => {
        const returning = !this.headerVisible && visible && ratio > 0;
        this.headerVisible = visible && ratio > 0;
        if (returning) void this.refresh();
      })
  }
}
