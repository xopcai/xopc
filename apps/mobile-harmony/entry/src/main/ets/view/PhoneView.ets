import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { phonePoint, XopcPhonePoint } from '../common/phoneInteraction';
import { XopcPhoneViewModel } from '../viewmodel/phoneViewModel';

@ComponentV2
export struct XopcPhoneView {
  @Param phone: XopcPhoneViewModel = new XopcPhoneViewModel();
  @Event onReturn: () => void = (): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local textDraft: string = '';
  @Local showText: boolean = false;
  @Local areaWidth: number = 1;
  @Local areaHeight: number = 1;
  private controller: XComponentController = new XComponentController();
  private startPoint?: XopcPhonePoint;
  private textSessionId: string = '';
  private startTime: number = 0;
  private touchId: number = -1;
  @Computed get renderWidth(): number { return Math.min(this.areaWidth, this.areaHeight * this.phone.imageWidth / this.phone.imageHeight); }
  @Computed get renderHeight(): number { return Math.min(this.areaHeight, this.areaWidth * this.phone.imageHeight / this.phone.imageWidth); }
  @Computed get statusText(): Resource {
    if (this.phone.busy) return $r('app.string.phone_handoff');
    if (this.phone.state?.ownControl) return $r('app.string.phone_human');
    if (this.phone.state?.report.controlOwner === 'human') return $r('app.string.phone_other_human');
    if (this.phone.state?.report.status === 'needs_user') return $r('app.string.phone_needs_user');
    if (this.phone.state?.report.status === 'paused') return $r('app.string.phone_paused');
    if (this.phone.state?.report.status === 'running') return $r('app.string.phone_running');
    if (this.phone.state?.report.status === 'completed') return $r('app.string.phone_completed');
    return $r('app.string.phone_ready');
  }
  @Computed get canControl(): boolean {
    return this.phone.summary?.access === 'control' && this.phone.state?.report.mode === 'control'
      && (this.phone.state?.report.controlOwner !== 'human' || this.phone.state?.ownControl === true);
  }
  private lastControlEpoch: number = 0;
  @Monitor('phone.state', 'phone.geometry')
  onControlChange(): void {
    const epoch = this.phone.state?.report.controlEpoch ?? 0;
    if (epoch !== this.lastControlEpoch || !this.phone.state?.ownControl) {
      this.phone.cancel(); this.touchId = -1; this.startPoint = undefined; this.phone.touching = false;
      this.textDraft = ''; this.showText = false; this.lastControlEpoch = epoch;
    }
  }
  private touch(event: TouchEvent): void {
    if (!this.phone.state?.ownControl || this.phone.busy) return;
    event.stopPropagation();
    if (event.type === TouchType.Cancel) { this.phone.cancel(); this.startPoint = undefined; this.touchId = -1; this.phone.touching = false; return; }
    const touch = event.changedTouches[0]; if (!touch) return;
    const point = phonePoint(this.areaWidth, this.areaHeight, this.phone.imageWidth, this.phone.imageHeight, touch.x, touch.y);
    if (event.type === TouchType.Down) {
      if (this.touchId !== -1) return;
      if (!point) return;
      this.touchId = touch.id; this.startPoint = point; this.startTime = Date.now(); this.phone.touching = true;
    } else if (touch.id !== this.touchId) return;
    if (!point) { this.phone.cancel(); this.startPoint = undefined; this.touchId = -1; this.phone.touching = false; return; }
    if (this.phone.phase === 'playing') {
      this.phone.pointer(event.type === TouchType.Down ? 'down' : event.type === TouchType.Up ? 'up' : 'move', point.x, point.y);
    } else if (event.type === TouchType.Up && this.phone.snapshotReady() && this.startPoint) {
      const start = this.startPoint; const duration = Math.min(3000, Math.max(100, Date.now() - this.startTime));
      const distance = Math.abs(point.x - start.x) + Math.abs(point.y - start.y);
      if (distance > 25) void this.phone.command('input', { type: 'swipe', start: [start.x, start.y], end: [point.x, point.y], durationMs: duration });
      else void this.phone.command('input', { type: duration >= 500 ? 'longPress' : 'tap', point: [point.x, point.y], durationMs: duration });
    }
    if (event.type === TouchType.Up) { this.startPoint = undefined; this.touchId = -1; this.phone.touching = false; }
  }
  private async stopTask(): Promise<void> {
    const sessionId = this.phone.state?.report.sessionId;
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({ message: $r('app.string.phone_stop_confirm'),
        buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary }, { text: $r('app.string.phone_stop'), color: this.colors.danger }] });
      if (result.index === 1 && sessionId === this.phone.state?.report.sessionId) await this.phone.command('cancel');
    } catch (_) {}
  }
  private openText(): void {
    this.textDraft = '';
    this.textSessionId = this.phone.state?.report.sessionId ?? '';
    this.showText = true;
  }
  private async sendText(): Promise<void> {
    if (!this.textDraft.trim() || this.phone.busy || !this.phone.state?.ownControl
      || this.textSessionId !== this.phone.state.report.sessionId) return;
    await this.phone.command('input', { type: 'typeText', text: this.textDraft });
    if (!this.phone.error) { this.showText = false; this.textDraft = ''; }
  }
  @Builder
  textSheet() {
    Column({ space: 20 }) {
      Text($r('app.string.phone_text')).fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
        .width('100%')
      TextInput({ text: this.textDraft, placeholder: $r('app.string.phone_text_placeholder') })
        .id('phone-text-input').height(52).backgroundColor(this.colors.input).fontColor(this.colors.foreground)
        .onChange((text: string): void => { this.textDraft = text; })
      if (this.phone.error) {
        Text($r('app.string.phone_action_failed')).fontSize(14).fontColor(this.colors.danger)
      }
      Button($r('app.string.phone_send')).id('phone-text-send').width('100%').height(48)
        .backgroundColor(this.colors.accent).fontColor(Color.White)
        .enabled(!this.phone.busy && !!this.textDraft.trim() && this.phone.state?.ownControl === true)
        .onClick((): void => { void this.sendText(); })
    }.width('100%').padding(24)
  }
  @Builder
  moreMenu() {
    Menu() {
      if (this.phone.state?.ownControl) {
        MenuItem({ content: $r('app.string.phone_back') }).id('phone-menu-back').enabled(!this.phone.busy)
          .onClick((): void => { void this.phone.command('input', { type: 'back' }); })
        MenuItem({ content: $r('app.string.phone_text') }).id('phone-menu-text')
          .enabled(!this.phone.busy && this.phone.state?.textInput !== 'manual')
          .onClick((): void => { this.openText(); })
        MenuItem({ content: $r('app.string.phone_release') }).id('phone-menu-release').enabled(!this.phone.busy)
          .onClick((): void => { void this.phone.command('release'); })
      } else if (this.canControl && !this.phone.state?.report.reconnectRequired) {
        MenuItem({ content: this.phone.state?.report.status === 'paused' ? $r('app.string.phone_continue') : $r('app.string.phone_pause') })
          .id('phone-menu-pause').enabled(!this.phone.busy)
          .onClick((): void => { void this.phone.command(this.phone.state?.report.status === 'paused' ? 'handback' : 'pause'); })
      }
      MenuItem({ content: $r('app.string.phone_retry') }).id('phone-menu-reconnect')
        .enabled(!this.phone.busy && this.phone.summary?.access !== 'none')
        .onClick((): void => { this.phone.retry(); })
      if (this.canControl) {
        MenuItem({ content: $r('app.string.phone_stop') }).id('phone-menu-stop').contentFontColor(this.colors.danger)
          .enabled(!this.phone.busy).onClick((): void => { void this.stopTask(); })
      }
    }
  }
  @Builder
  phoneFrame() {
    Stack({ alignContent: Alignment.Center }) {
      XComponent({ id: 'phone-video', type: XComponentType.SURFACE, controller: this.controller })
        .width(this.renderWidth).height(this.renderHeight)
        .onLoad((): void => { this.phone.surface(this.controller.getXComponentSurfaceId()); })
        .opacity(this.phone.phase === 'playing' ? 1 : 0)
        .hitTestBehavior(HitTestMode.None)
      if (this.phone.phase === 'fallback' && this.phone.snapshot) {
        Image(this.phone.snapshot).objectFit(ImageFit.Contain).width('100%').height('100%').backgroundColor(this.colors.panel).hitTestBehavior(HitTestMode.None)
      } else if (this.phone.phase !== 'playing') {
        Column({ space: 16 }) {
          if (this.phone.summary?.access === 'none') {
            Text($r('app.string.phone_permission_required')).fontSize(16).fontColor(this.colors.foreground).textAlign(TextAlign.Center)
          } else if (this.phone.state?.report.reconnectRequired) {
            Text($r('app.string.phone_restore_hint')).fontSize(16).fontColor(this.colors.foreground).textAlign(TextAlign.Center)
          } else if (this.phone.phase === 'failed' || this.phone.phase === 'blocked') {
            Text(this.phone.error === 'PHONE_APP_DENIED' ? $r('app.string.phone_app_denied') : $r('app.string.phone_connection_failed'))
              .fontSize(16).fontColor(this.colors.foreground).textAlign(TextAlign.Center)
            Button($r('app.string.phone_retry')).onClick((): void => { this.phone.retry(); })
          } else {
            Column().width('70%').height(28).borderRadius(8).backgroundColor(this.colors.input)
            Column().width('90%').height(180).borderRadius(16).backgroundColor(this.colors.input)
            Text($r('app.string.phone_connecting')).fontSize(14).fontColor(this.colors.secondary)
          }
        }.padding(24).width('100%').height('100%').justifyContent(FlexAlign.Center).backgroundColor(this.colors.panel)
      }
    }.width('100%').layoutWeight(1).clip(true).backgroundColor(this.colors.panel).borderRadius(16)
      .onAreaChange((_previous: Area, current: Area): void => { this.areaWidth = Number(current.width); this.areaHeight = Number(current.height); })
      .onTouch((event: TouchEvent): void => { this.touch(event); })
  }
  build() {
    Column({ space: 12 }) {
      Row({ space: 12 }) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([this.colors.foreground])
        }.width(44).height(44).backgroundColor(Color.Transparent).accessibilityText($r('app.string.phone_return'))
          .onClick((): void => { this.onReturn(); })
        Column({ space: 3 }) {
          Text(this.phone.summary?.deviceName ?? '').fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          if (this.phone.state) {
            Text(this.statusText).fontSize(12).fontColor(this.colors.secondary).maxLines(1)
          }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.ellipsis_circle')).fontSize(23).fontColor([this.colors.foreground])
        }.id('phone-more').width(44).height(44).backgroundColor(this.colors.input)
          .accessibilityText($r('app.string.phone_more')).bindMenu(this.moreMenu)
      }.width('100%')
      this.phoneFrame()
      if (this.phone.phase === 'fallback') {
        Text($r('app.string.phone_snapshot_mode')).fontSize(12).fontColor(this.colors.secondary)
      }
      if (this.phone.error && this.phone.phase !== 'fallback' && this.phone.phase !== 'failed' && this.phone.phase !== 'blocked') {
        Text($r('app.string.phone_action_failed')).fontSize(14).fontColor(this.colors.danger)
      }
      if (this.canControl) {
        Button(this.phone.state?.ownControl ? $r('app.string.phone_handback') : $r('app.string.phone_takeover'))
          .id('phone-control').width('100%').height(52).borderRadius(26).fontSize(17).fontWeight(FontWeight.Medium)
          .fontColor(this.phone.state?.ownControl ? this.colors.foreground : Color.White)
          .backgroundColor(this.phone.state?.ownControl ? this.colors.input : this.colors.accent)
          .enabled(!this.phone.busy && (this.phone.state?.ownControl || this.phone.state?.report.reconnectRequired || this.phone.phase === 'playing' || this.phone.phase === 'fallback' && this.phone.snapshotReady()))
          .onClick((): void => { this.textDraft = ''; this.showText = false; void this.phone.command(this.phone.state?.ownControl ? 'handback' : 'takeover'); })
      } else if (this.phone.summary?.access === 'view') {
        Text($r('app.string.phone_view_only')).fontSize(14).fontColor(this.colors.secondary)
      }
    }.width('100%').height('100%').padding({ left: 16, right: 16, bottom: 16 }).backgroundColor(this.colors.surface)
      .bindSheet($$this.showText, this.textSheet, { height: 300, dragBar: true, showClose: true,
        backgroundColor: this.colors.panel, onDisappear: (): void => { this.textDraft = ''; } })
      .onDisAppear((): void => { this.showText = false; this.textDraft = ''; this.phone.cancel(); })
  }
}
