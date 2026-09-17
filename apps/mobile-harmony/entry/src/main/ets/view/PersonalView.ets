import { XopcMobileRoute } from '../model/home';
import { gatewaySession } from '../service/gatewaySession';
import { pushNotifications, XopcPushNotifications } from '../service/pushNotifications';
import { XopcPersonalViewModel } from '../viewmodel/homeViewModel';
import { XopcPageHeader, XopcHubRow, XopcSectionLabel } from './MobileComponents';

@ComponentV2
export struct XopcPersonalView {
  @Local model: XopcPersonalViewModel = new XopcPersonalViewModel();
  @Local push: XopcPushNotifications = pushNotifications;
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};

  aboutToAppear(): void { this.model.refresh(); }
  aboutToDisappear(): void { this.model.dispose(); }

  private initials(): string {
    const name = this.model.name.trim();
    return name ? Array.from(name).slice(0, 2).join('').toUpperCase() : 'X';
  }

  build() {
    Column() {
      XopcPageHeader({ heading: $r('app.string.personal'), actionLabel: $r('app.string.settings'),
        actionIcon: $r('sys.symbol.gearshape'), onAction: (): void => { this.onNavigate({ page: 'settings', itemId: '' }); } })
      Scroll() {
        Column() {
          Row({ space: 16 }) {
            Text(this.initials()).fontSize(22).fontWeight(FontWeight.Bold).fontColor($r('app.color.accent'))
              .width(64).height(64).textAlign(TextAlign.Center).borderRadius(32).backgroundColor($r('app.color.accent_soft'))
            Column({ space: 5 }) {
              Text(this.model.name || $r('app.string.personal_default_name')).fontSize(21).fontWeight(FontWeight.Bold)
                .fontColor($r('app.color.foreground')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(this.model.role || $r('app.string.personal_profile_hint')).fontSize(13).lineHeight(19)
                .fontColor($r('app.color.secondary')).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
              Row({ space: 7 }) {
                Column().width(7).height(7).borderRadius(4).backgroundColor($r('app.color.accent'))
                Text($r('app.string.workspace_connected')).fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.accent'))
              }.constraintSize({ minHeight: 28 }).padding({ left: 10, right: 10 }).borderRadius(14).backgroundColor($r('app.color.accent_soft'))
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          }.width('100%').padding(20).borderRadius(22).backgroundColor($r('app.color.panel'))
            .border({ width: 0.5, color: $r('app.color.border_subtle') })

          XopcSectionLabel({ heading: $r('app.string.device_status') })
          Column() {
            XopcHubRow({ heading: $r('app.string.connection'), summary: gatewaySession.currentProfile()?.name ?? '',
              symbol: $r('sys.symbol.link'), onOpen: (): void => { this.onNavigate({ page: 'settings', itemId: 'connection' }); } })
            XopcHubRow({ heading: $r('app.string.notifications'),
              summary: this.push.enabled ? $r('app.string.status_on') : $r('app.string.status_off'),
              symbol: $r('sys.symbol.bell'), onOpen: (): void => { this.onNavigate({ page: 'settings', itemId: 'notifications' }); } })
          }.width('100%').padding({ left: 16, right: 16 }).borderRadius(18).backgroundColor($r('app.color.panel'))
            .border({ width: 0.5, color: $r('app.color.border_subtle') })

          XopcSectionLabel({ heading: $r('app.string.preferences') })
          XopcHubRow({ heading: $r('app.string.settings'), summary: $r('app.string.personal_settings_hint'),
            symbol: $r('sys.symbol.gearshape'), onOpen: (): void => { this.onNavigate({ page: 'settings', itemId: '' }); } })
          if (this.model.error) {
            Text($r('app.string.personal_profile_unavailable')).fontSize(12).fontColor($r('app.color.tertiary')).margin({ top: 12 })
          }
        }.width('100%').padding({ left: 20, right: 20, bottom: 28 }).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').align(Alignment.Top).scrollBar(BarState.Off)
    }.width('100%').height('100%').backgroundColor($r('app.color.surface'))
  }
}
