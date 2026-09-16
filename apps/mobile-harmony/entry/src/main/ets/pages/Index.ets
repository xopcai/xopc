import { XopcConnectionViewModel } from '../viewmodel/connectionViewModel';
import { XopcHomeView } from '../view/HomeView';
import { scanBarcode, scanCore } from '@kit.ScanKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { invitationPayload } from '../common/protocol';
import { XopcSettingsView } from '../view/SettingsView';

@Entry
@ComponentV2
struct XopcIndex {
  @Local invitation: string = '';
  @Local connection: XopcConnectionViewModel = new XopcConnectionViewModel();
  @Local showSettings: boolean = false;

  aboutToAppear(): void { this.connection.restore(); }

  private async scan(): Promise<void> {
    if (!canIUse('SystemCapability.Multimedia.Scan.ScanBarcode')) { this.connection.errorMessage = 'SCAN_UNAVAILABLE'; return; }
    try {
      const context = this.getUIContext().getHostContext();
      if (!context) return;
      const options: scanBarcode.ScanOptions = { scanTypes: [scanCore.ScanType.QR_CODE], enableMultiMode: false, enableAlbum: true };
      const result = await new Promise<scanBarcode.ScanResult>((resolve, reject): void => {
        scanBarcode.startScanForResult(context, options, (error: BusinessError, value: scanBarcode.ScanResult): void => {
          if (error) reject(error); else resolve(value);
        });
      });
      invitationPayload(result.originalValue);
      this.invitation = result.originalValue;
      // Pairing credentials must not appear in logs or toasts.
      await this.connection.connect(this.invitation);
    } catch (error) {
      if ((error as BusinessError).code !== 1000500002) this.connection.errorMessage = (error as Error).message;
    }
  }

  build() {
    if (this.showSettings) {
      Column() {
        Button($r('app.string.back')).id('settings-back').onClick((): void => { this.showSettings = false; })
        Column() { XopcSettingsView() }.layoutWeight(1).width('100%')
      }.height('100%').width('100%')
    } else if (this.connection.connected) {
      XopcHomeView({ onDisconnected: (): void => { this.connection.connected = false; this.invitation = ''; } })
    } else {
    Column({ space: 24 }) {
      Text('xopc')
        .fontSize(40)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.accent'))
      Text($r('app.string.connect_title'))
        .id('connect-title')
        .fontSize(24)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.foreground'))
      Text($r('app.string.connect_help'))
        .fontSize(16)
        .fontColor($r('app.color.secondary'))
        .textAlign(TextAlign.Center)
      TextArea({ text: this.invitation, placeholder: $r('app.string.invitation_hint') })
        .id('pairing-link')
        .height(120)
        .onChange((text: string): void => { this.invitation = text; })
      Button($r('app.string.scan')).enabled(!this.connection.busy).onClick((): void => { this.scan(); })
      if (this.connection.connected) {
        Text(this.connection.gatewayName)
          .fontColor($r('app.color.foreground'))
      } else {
        Button($r('app.string.connect'))
          .id('pairing-connect')
          .height(48)
          .width('100%')
          .enabled(!this.connection.busy && this.invitation.trim().length > 0)
          .onClick((): void => { this.connection.connect(this.invitation); })
      }
      if (this.connection.confirmationCode) {
        Text(this.connection.confirmationCode)
          .fontSize(32)
          .fontColor($r('app.color.foreground'))
      }
      if (this.connection.busy) {
        Button($r('app.string.cancel'))
          .onClick((): void => { this.connection.cancel(); })
      }
      if (this.connection.errorMessage) {
        Text(this.connection.errorMessage)
          .id('pairing-error')
          .fontColor($r('app.color.danger'))
      }
      Button($r('app.string.settings')).id('open-settings').enabled(!this.connection.busy).onClick((): void => { this.showSettings = true; })
    }
    .padding(24)
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .backgroundColor($r('app.color.surface'))
    }
  }
}
