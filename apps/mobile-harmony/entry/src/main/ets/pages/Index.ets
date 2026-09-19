import { connectionModel, XopcConnectionViewModel } from '../viewmodel/connectionViewModel';
import { XopcGatewayProfilesView } from '../view/GatewayProfilesView';
import { XopcHomeView } from '../view/HomeView';
import { scanBarcode, scanCore } from '@kit.ScanKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { readMobilePairingInvitation } from '../common/protocol';
import { XopcSettingsView } from '../view/SettingsView';
import { layoutState } from '../service/layoutState';

@Entry
@ComponentV2
struct XopcIndex {
  @Local invitation: string = '';
  @Local connection: XopcConnectionViewModel = connectionModel;
  @Local showSettings: boolean = false;
  @Local manualEntry: boolean = false;
  @Local showHelp: boolean = false;
  @Local scanning: boolean = false;
  @Local contentHeight: number = 0;
  private invitationEditor: TextAreaController = new TextAreaController();

  aboutToAppear(): void { this.connection.restore(); }
  @Monitor('connection.adding')
  onAddingGateway(): void {
    if (this.connection.adding) { this.invitation = ''; this.manualEntry = false; this.showHelp = false; this.showSettings = false; }
  }
  onBackPress(): boolean {
    if (this.showSettings) { this.showSettings = false; return true; }
    if (this.connection.managing) { this.connection.closeGateways(); return true; }
    if (this.connection.adding) { if (!this.connection.busy) this.connection.cancel(); return true; }
    if (!this.connection.connected && !this.connection.busy && (this.manualEntry || this.showHelp)) {
      this.closeSecondary(); return true;
    }
    return layoutState.dismissChatOverlay?.() ?? false;
  }

  private closeSecondary(): void {
    this.invitationEditor.stopEditing(); this.manualEntry = false; this.showHelp = false; this.connection.errorMessage = '';
  }

  private errorText(): Resource {
    const error = this.connection.errorMessage;
    if (error.includes('EXPIRED')) return $r('app.string.pair_error_expired');
    if (error.includes('REJECTED')) return $r('app.string.pair_error_rejected');
    if (error.includes('IDENTITY') || error.includes('SIGNATURE')) return $r('app.string.pair_error_identity');
    if (error.includes('INVITATION') || error.includes('INVALID_URL') || error.includes('INVALID_ORIGIN')) return $r('app.string.pair_error_link');
    if (error.includes('SCAN') || error.includes('PERMISSION')) return $r('app.string.pair_error_camera');
    return $r('app.string.pair_error_retry');
  }

  private async scan(): Promise<void> {
    if (this.scanning || this.connection.busy) return;
    if (!canIUse('SystemCapability.Multimedia.Scan.ScanBarcode')) { this.connection.errorMessage = 'SCAN_UNAVAILABLE'; return; }
    this.scanning = true; this.connection.errorMessage = ''; this.invitationEditor.stopEditing();
    try {
      const context = this.getUIContext().getHostContext();
      if (!context) return;
      const options: scanBarcode.ScanOptions = { scanTypes: [scanCore.ScanType.QR_CODE], enableMultiMode: false, enableAlbum: true };
      const result = await new Promise<scanBarcode.ScanResult>((resolve, reject): void => {
        scanBarcode.startScanForResult(context, options, (error: BusinessError, value: scanBarcode.ScanResult): void => {
          if (error) reject(error); else resolve(value);
        });
      });
      readMobilePairingInvitation(result.originalValue, Date.now());
      this.invitation = result.originalValue;
      // Pairing credentials must not appear in logs or toasts.
      await this.connection.connect(this.invitation);
    } catch (error) {
      if ((error as BusinessError).code !== 1000500002) this.connection.errorMessage = (error as Error).message;
    } finally { this.scanning = false; }
  }

  @Builder
  connectionHeader() {
    Row({ space: 10 }) {
      if (this.manualEntry || this.showHelp || this.connection.adding) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([$r('app.color.foreground')])
        }.id('pairing-back').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .enabled(!this.connection.busy).accessibilityText($r('app.string.back')).onClick((): void => {
            if (this.manualEntry || this.showHelp) this.closeSecondary(); else this.connection.cancel();
          })
      } else {
        Image($r('app.media.brand_logo')).width(32).height(32).objectFit(ImageFit.Contain).accessibilityText('xopc')
        Text('xopc').fontSize(22).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground'))
      }
      Blank().layoutWeight(1)
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.gearshape')).fontSize(22).fontColor([$r('app.color.secondary')])
      }.id('open-settings').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.settings')).enabled(!this.connection.busy && !this.scanning)
        .onClick((): void => { this.invitationEditor.stopEditing(); this.showSettings = true; })
    }.width('100%').height(56).padding({ left: 24, right: 16 })
  }

  @Builder
  connectionIntro() {
    Column({ space: 16 }) {
      Text(this.connection.busy ? (this.connection.confirmationCode ? $r('app.string.pair_waiting') : $r('app.string.pair_connecting'))
        : this.showHelp ? $r('app.string.pair_help_title') : this.manualEntry ? $r('app.string.pair_manual_title') : $r('app.string.pair_title'))
        .id('connect-title').fontSize(32).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground')).width('100%')
      Text(this.connection.busy ? (this.connection.confirmationCode ? $r('app.string.pair_approve_hint') : $r('app.string.pair_connecting_hint'))
        : this.showHelp ? $r('app.string.pair_help_steps') : this.manualEntry ? $r('app.string.pair_manual_hint') : $r('app.string.pair_hint'))
        .fontSize(16).lineHeight(26).fontColor($r('app.color.secondary')).width('100%')
      if (this.connection.confirmationCode) {
        Column({ space: 12 }) {
          Text(this.connection.confirmationCode).id('pairing-confirmation-code').fontSize(40).fontWeight(FontWeight.Medium)
            .letterSpacing(6).fontColor($r('app.color.foreground'))
          Text($r('app.string.pair_compare')).fontSize(13).lineHeight(20).fontColor($r('app.color.secondary')).textAlign(TextAlign.Center)
        }.width('100%').padding(24).margin({ top: 16 }).backgroundColor($r('app.color.panel'))
          .border({ radius: 20, width: 0.5, color: $r('app.color.border_subtle') })
      }
      if (this.manualEntry && !this.connection.busy) {
        TextArea({ text: this.invitation, placeholder: $r('app.string.invitation_hint'), controller: this.invitationEditor })
          .id('pairing-link').width('100%').height(112).fontSize(15).padding(16)
          .backgroundColor($r('app.color.panel')).fontColor($r('app.color.foreground')).placeholderColor($r('app.color.tertiary'))
          .border({ radius: 16, width: 1, color: $r('app.color.border_subtle') })
          .onChange((text: string): void => { this.invitation = text; this.connection.errorMessage = ''; })
      }
      if (this.connection.errorMessage) {
        Text(this.errorText()).id('pairing-error').fontSize(14).lineHeight(22).width('100%')
          .fontColor($r('app.color.danger')).padding({ top: 8 })
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 40, bottom: 32 })
  }

  @Builder
  connectionActions() {
    Column({ space: 8 }) {
      if (this.connection.busy) {
        Button($r('app.string.cancel')).id('pairing-cancel').height(48).width('100%')
          .backgroundColor($r('app.color.input')).fontColor($r('app.color.secondary')).onClick((): void => { this.connection.cancel(); })
      } else if (this.showHelp) {
        Button($r('app.string.pair_ready')).height(52).width('100%').fontSize(16)
          .backgroundColor($r('app.color.accent')).fontColor(Color.White).onClick((): void => { this.closeSecondary(); })
      } else if (this.manualEntry) {
        Button($r('app.string.connect')).id('pairing-connect').height(52).width('100%').fontSize(16)
          .backgroundColor($r('app.color.accent')).fontColor(Color.White).enabled(this.invitation.trim().length > 0)
          .onClick((): void => { this.invitationEditor.stopEditing(); this.connection.connect(this.invitation); })
      } else {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 10 }) {
            SymbolGlyph($r('sys.symbol.qrcode')).fontSize(22).fontColor([Color.White])
            Text($r('app.string.pair_scan')).fontSize(16).fontWeight(FontWeight.Medium).fontColor(Color.White)
          }.justifyContent(FlexAlign.Center).width('100%')
        }.id('pairing-scan').height(52).width('100%').borderRadius(16).backgroundColor($r('app.color.accent'))
          .enabled(!this.scanning).accessibilityText($r('app.string.pair_scan')).onClick((): void => { this.scan(); })
        Button($r('app.string.pair_manual')).id('pairing-manual').height(48).width('100%').fontSize(15)
          .backgroundColor(Color.Transparent).fontColor($r('app.color.secondary')).enabled(!this.scanning)
          .onClick((): void => { this.manualEntry = true; this.connection.errorMessage = ''; })
        Button($r('app.string.pair_help')).id('pairing-help').height(44).width('100%').fontSize(14)
          .backgroundColor(Color.Transparent).fontColor($r('app.color.tertiary')).enabled(!this.scanning)
          .onClick((): void => { this.showHelp = true; this.connection.errorMessage = ''; })
      }
      Text($r('app.string.pair_requirement')).fontSize(12).fontColor($r('app.color.tertiary')).textAlign(TextAlign.Center)
        .width('100%').margin({ top: 20 })
    }.width('100%').padding({ bottom: 24 })
  }

  build() {
    Column() {
    if (this.connection.managing) {
      XopcGatewayProfilesView()
    } else if (this.showSettings) {
      Column() {
        Button($r('app.string.back')).id('settings-back').onClick((): void => { this.showSettings = false; })
        Column() { XopcSettingsView() }.layoutWeight(1).width('100%')
      }.height('100%').width('100%')
    } else if (this.connection.connected && !this.connection.adding) {
      XopcHomeView({ onDisconnected: (): void => { this.connection.connected = false; this.invitation = ''; } })
    } else {
      this.connectionHeader()
      Scroll() {
        Column() {
          this.connectionIntro()
          this.connectionActions()
        }.width('100%').constraintSize({ minHeight: this.contentHeight }).justifyContent(FlexAlign.SpaceBetween)
          .padding({ left: 24, right: 24 })
      }.width('100%').layoutWeight(1).scrollBar(BarState.Off)
        .onAreaChange((_previous: Area, current: Area): void => { this.contentHeight = Number(current.height); })
    }
    }.width('100%').height('100%').backgroundColor($r('app.color.surface'))
  }
}
