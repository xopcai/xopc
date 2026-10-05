import { common } from '@kit.AbilityKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcConnectionAccount, XopcConnectionNeed } from '../model/connectionWait';
import { XopcConnectionWaitViewModel } from '../viewmodel/connectionWaitViewModel';

@ComponentV2
export struct XopcChatConnectionWait {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param model: XopcConnectionWaitViewModel = new XopcConnectionWaitViewModel();
  @Local detailOpen: boolean = false;
  @Local browserError: boolean = false;

  private supported(need: XopcConnectionNeed): boolean {
    return need.authorizationMode === 'browser';
  }

  private async connect(need: XopcConnectionNeed): Promise<void> {
    if (!this.supported(need)) { this.detailOpen = true; return; }
    const url = await this.model.act('connect', need.key);
    if (!url) return;
    if (!url.startsWith('https://')) { this.browserError = true; return; }
    try {
      await (this.getUIContext().getHostContext() as common.UIAbilityContext).openLink(url, { appLinkingOnly: false });
      this.browserError = false;
      this.detailOpen = false;
    } catch (_error) { this.browserError = true; }
  }

  private primary(need: XopcConnectionNeed): void {
    if (this.model.snapshot?.wait?.phase === 'review_scope') { this.detailOpen = true; return; }
    if (need.phase === 'authorizing') { void this.model.act('check'); return; }
    if ((need.phase === 'connect' || need.phase === 'reconnect') && this.supported(need)) { void this.connect(need); return; }
    this.detailOpen = true;
  }

  private primaryLabel(need: XopcConnectionNeed): Resource {
    if (this.model.snapshot?.wait?.phase === 'review_scope') return $r('app.string.connection_wait_confirm');
    if (need.phase === 'authorizing') return $r('app.string.connection_wait_check');
    if (need.phase === 'connect' || need.phase === 'reconnect') {
      return this.supported(need) ? $r('app.string.connection_wait_connect') : $r('app.string.connection_wait_details');
    }
    return $r('app.string.connection_wait_details');
  }

  @Builder
  private detailSheet() {
    Column() {
      Row() {
        Text($r('app.string.connection_wait_title')).fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).layoutWeight(1)
        Button($r('app.string.chat_close')).height(40).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
          .onClick((): void => { this.detailOpen = false; })
      }.width('100%').padding({ left: 20, right: 12, top: 16, bottom: 12 })
      Scroll() {
        Column({ space: 16 }) {
          Text($r('app.string.connection_wait_intro')).fontSize(14).fontColor(this.colors.secondary).width('100%')
          if (this.model.snapshot?.wait) {
            Text(this.model.snapshot.wait.summary).fontSize(16).fontColor(this.colors.foreground).width('100%')
              .padding(14).borderRadius(14).backgroundColor(this.colors.grouped)
            if (this.model.snapshot.wait.timeRange) {
              Text(this.model.snapshot.wait.timeRange.expression + ' · ' + this.model.snapshot.wait.timeRange.timezone)
                .fontSize(13).fontColor(this.colors.secondary).width('100%')
            }
            if (this.model.snapshot.wait.phase === 'review_scope') {
              Text($r('app.string.connection_wait_scope_hint')).fontSize(13).fontColor(this.colors.secondary).width('100%')
            }
            ForEach(this.model.snapshot.wait.needs, (need: XopcConnectionNeed) => {
              Column({ space: 10 }) {
                Text(need.label).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
                Text(need.capabilities.join(' · ')).fontSize(13).fontColor(this.colors.secondary).width('100%')
                if (need.reason) { Text(need.reason).fontSize(13).fontColor(this.colors.secondary).width('100%') }
                if (need.capabilityError) { Text($r('app.string.connection_wait_tool_error')).fontSize(13).fontColor(this.colors.danger).width('100%') }
                if (!this.supported(need)) {
                  Text($r('app.string.connection_wait_desktop')).fontSize(13).fontColor(this.colors.secondary).width('100%')
                } else if (need.phase === 'ready') {
                  Text($r('app.string.connection_wait_ready')).fontSize(13).fontColor(this.colors.accent).width('100%')
                } else if (need.phase === 'connect' || need.phase === 'reconnect') {
                  Button($r('app.string.connection_wait_connect')).height(44).width('100%').enabled(!this.model.busy)
                    .backgroundColor(this.colors.accent).onClick((): void => { void this.connect(need); })
                } else if (need.phase === 'authorizing') {
                  Button($r('app.string.connection_wait_check')).height(44).width('100%').enabled(!this.model.busy)
                    .backgroundColor(this.colors.accent).onClick((): void => { void this.model.act('check'); })
                }
                if (this.supported(need) && need.accounts.length > 0) {
                  Text($r('app.string.connection_wait_account')).fontSize(13).fontColor(this.colors.secondary).width('100%')
                  ForEach(need.accounts, (account: XopcConnectionAccount) => {
                    Button((need.accountId === account.id ? '✓  ' : '') + account.label).height(44).width('100%')
                      .enabled(!this.model.busy).fontColor(this.colors.foreground).backgroundColor(this.colors.input)
                      .onClick((): void => { void this.model.act('select_account', need.key, account.id); })
                  }, (account: XopcConnectionAccount): string => account.id)
                }
              }.width('100%').alignItems(HorizontalAlign.Start).padding(14).borderRadius(14).backgroundColor(this.colors.grouped)
            }, (need: XopcConnectionNeed): string => need.key)
            if (this.model.snapshot.wait.phase === 'review_scope') {
              Button($r('app.string.connection_wait_confirm')).height(48).width('100%').enabled(!this.model.busy)
                .backgroundColor(this.colors.accent).onClick((): void => { void this.model.act('confirm_scope'); })
            }
          }
          if (this.browserError) { Text($r('app.string.connection_wait_browser_error')).fontSize(13).fontColor(this.colors.danger).width('100%') }
          if (this.model.error) { Text(this.model.error).fontSize(13).fontColor(this.colors.danger).width('100%') }
          Row({ space: 12 }) {
            Button($r('app.string.connection_wait_skip')).height(44).layoutWeight(1).enabled(!this.model.busy)
              .fontColor(this.colors.foreground).backgroundColor(this.colors.input)
              .onClick((): void => { void this.model.act('skip'); this.detailOpen = false; })
            Button($r('app.string.connection_wait_cancel')).height(44).layoutWeight(1).enabled(!this.model.busy)
              .fontColor(this.colors.danger).backgroundColor(this.colors.input)
              .onClick((): void => { void this.model.act('cancel'); this.detailOpen = false; })
          }.width('100%')
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 20, right: 20, bottom: 28 })
      }.layoutWeight(1).width('100%')
    }.height('100%').width('100%').backgroundColor(this.colors.panel)
  }

  build() {
    Column() {
      if (this.model.snapshot?.wait && this.model.snapshot.wait.phase !== 'ready') {
        Row({ space: 8 }) {
          Button() {
            Column({ space: 2 }) {
              Text(this.model.snapshot.wait.phase === 'queued' ? $r('app.string.connection_wait_resuming') : $r('app.string.connection_wait_title'))
                .fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
              Text(this.model.snapshot.wait.summary).fontSize(12).fontColor(this.colors.secondary).maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
            }.alignItems(HorizontalAlign.Start)
          }.layoutWeight(1).padding(0).backgroundColor(Color.Transparent).onClick((): void => { this.detailOpen = true; })
          if (this.model.snapshot.wait.phase !== 'queued' && this.model.snapshot.wait.needs.length > 0) {
            Button(this.primaryLabel(this.model.snapshot.wait.needs[0])).height(38).enabled(!this.model.busy)
              .fontSize(13).backgroundColor(this.colors.accent)
              .onClick((): void => { this.primary(this.model.snapshot!.wait!.needs[0]); })
          }
        }.width('100%').padding(12).borderRadius(14).backgroundColor(this.colors.grouped)
        if (this.model.error) { Text(this.model.error).fontSize(12).fontColor(this.colors.danger).width('100%') }
      }
    }.width('calc(100% - 24vp)').margin({ bottom: this.model.snapshot?.wait ? 8 : 0 })
      .bindSheet($$this.detailOpen, this.detailSheet, { height: '78%', dragBar: true, showClose: false,
        backgroundColor: this.colors.panel })
  }
}
