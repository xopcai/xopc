import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { connectionModel, XopcConnectionViewModel, XopcGatewayProbeState } from '../viewmodel/connectionViewModel';
import { XopcProfile } from '../model/gateway';

@ComponentV2
export struct XopcGatewayProfilesView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local connection: XopcConnectionViewModel = connectionModel;
  @Local editingId: string = '';
  @Local editedName: string = '';
  @Local expandedId: string = '';

  private origin(profile: XopcProfile): string {
    return (profile.routes.find((route): boolean => route.id === profile.activeRouteId)?.url ?? '').replace('https://', '');
  }

  private statusText(state: XopcGatewayProbeState | undefined): Resource {
    if (!state || state.phase === 'checking') return $r('app.string.gateways_checking');
    if (state.phase === 'online') return $r('app.string.gateways_online');
    if (state.phase === 'degraded') return $r('app.string.gateways_degraded');
    return $r('app.string.gateways_offline');
  }

  private probeError(error: string): Resource {
    if (error === 'DEVICE_AUTH_DENIED' || error === 'DEVICE_CREDENTIALS_MISSING' || error === 'HTTP_401' || error === 'HTTP_403')
      return $r('app.string.gateways_probe_auth');
    if (error === 'GATEWAY_IDENTITY_MISMATCH') return $r('app.string.gateways_probe_identity');
    return $r('app.string.gateways_probe_network');
  }

  private async remove(profile: XopcProfile): Promise<void> {
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: $r('app.string.gateways_remove'), message: $r('app.string.gateways_remove_hint'),
        buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
          { text: $r('app.string.confirm'), color: this.colors.danger }]
      });
      if (result.index === 1) await this.connection.remove(profile.gatewayId);
    } catch (_) { /* Dismissing the dialog leaves the profile intact. */ }
  }

  build() {
    Column() {
      Row({ space: 8 }) {
        Text($r('app.string.gateways_title')).fontSize(24).fontWeight(FontWeight.Bold)
          .fontColor(this.colors.foreground).layoutWeight(1)
        Button() { SymbolGlyph($r('sys.symbol.arrow_clockwise')).fontSize(21).fontColor([this.colors.accent]) }
          .id('gateways-refresh').width(44).height(44).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.gateways_check_all')).onClick((): void => { void this.connection.probeAll(); })
        Button() { SymbolGlyph($r('sys.symbol.plus')).fontSize(22).fontColor([this.colors.accent]) }
          .id('gateways-add').width(44).height(44).backgroundColor(Color.Transparent).enabled(!this.connection.busy)
          .accessibilityText($r('app.string.gateways_add')).onClick((): void => { this.connection.addGateway(); })
      }.width('100%').padding({ left: 8, right: 16, top: 12, bottom: 12 })
      List({ space: 12 }) {
        ListItem() {
          Column({ space: 5 }) {
            Text($r('app.string.gateways_heading')).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            Text($r('app.string.gateways_hint')).fontSize(13).lineHeight(20).fontColor(this.colors.secondary)
          }.alignItems(HorizontalAlign.Start).width('100%').padding({ bottom: 8 })
        }
        ForEach(this.connection.profiles, (profile: XopcProfile) => {
          ListItem() {
            Column({ space: 10 }) {
              Button({ type: ButtonType.Normal }) {
                Row({ space: 12 }) {
                  Column() { SymbolGlyph($r('sys.symbol.link')).fontSize(22).fontColor([this.colors.accent]) }
                    .width(44).height(44).justifyContent(FlexAlign.Center).backgroundColor(this.colors.accentSoft).borderRadius(14)
                  Column({ space: 4 }) {
                    Text(profile.name).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                    Text(this.origin(profile)).fontSize(12).fontColor(this.colors.secondary)
                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                  if (profile.gatewayId === this.connection.activeGatewayId) {
                    Text($r('app.string.gateways_current')).fontSize(11).fontColor(this.colors.accent)
                      .padding({ left: 7, right: 7, top: 3, bottom: 3 }).backgroundColor(this.colors.accentSoft).borderRadius(7)
                  }
                  SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(14).fontColor([this.colors.tertiary])
                }.width('100%').constraintSize({ minHeight: 56 })
              }.id('gateway-select-' + profile.gatewayId).width('100%').padding(0).backgroundColor(Color.Transparent)
                .accessibilitySelected(profile.gatewayId === this.connection.activeGatewayId)
                .onClick((): void => { this.expandedId = this.expandedId === profile.gatewayId ? '' : profile.gatewayId; })
              Row({ space: 7 }) {
                Text('●').fontSize(10).fontColor(this.connection.probeState(profile.gatewayId)?.phase === 'online'
                  ? this.colors.accent : this.connection.probeState(profile.gatewayId)?.phase === 'offline'
                    ? this.colors.danger : this.colors.secondary)
                Text(this.statusText(this.connection.probeState(profile.gatewayId))).fontSize(13).fontColor(this.colors.secondary)
                if (this.connection.probeState(profile.gatewayId)?.result) {
                  Text(`${this.connection.probeState(profile.gatewayId)?.result?.latencyMs} ms`)
                    .fontSize(12).fontColor(this.colors.tertiary)
                }
              }.width('100%')
              if (this.expandedId === profile.gatewayId) {
              if (this.connection.probeState(profile.gatewayId)?.phase === 'offline') {
                Text(this.probeError(this.connection.probeState(profile.gatewayId)?.error ?? ''))
                  .fontSize(13).lineHeight(19).fontColor(this.colors.danger).width('100%')
              } else if (this.connection.probeState(profile.gatewayId)?.result) {
                Text(this.connection.probeState(profile.gatewayId)?.result?.routeUrl ?? '')
                  .fontSize(12).fontColor(this.colors.secondary).maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                Row({ space: 4 }) {
                  Text($r('app.string.gateways_checked_at')).fontSize(12).fontColor(this.colors.tertiary)
                  Text(new Date(this.connection.probeState(profile.gatewayId)?.result?.checkedAt ?? 0).toLocaleString())
                    .fontSize(12).fontColor(this.colors.tertiary)
                }.width('100%')
              }
              if (profile.gatewayId !== this.connection.activeGatewayId) {
                Button($r('app.string.gateways_switch')).id('gateway-switch-' + profile.gatewayId)
                  .width('100%').height(46).fontSize(15).fontColor(Color.White).backgroundColor(this.colors.accent)
                  .enabled(!this.connection.busy && (this.connection.probeState(profile.gatewayId)?.phase === 'online'
                    || this.connection.probeState(profile.gatewayId)?.phase === 'degraded'))
                  .onClick((): void => { void this.connection.activate(profile.gatewayId); })
              }
              Button($r('app.string.gateways_check')).id('gateway-check-' + profile.gatewayId)
                .width('100%').height(44).fontSize(14).fontColor(this.colors.accent).backgroundColor(this.colors.accentSoft)
                .enabled(this.connection.probeState(profile.gatewayId)?.phase !== 'checking' && !this.connection.busy)
                .onClick((): void => { void this.connection.probeOne(profile.gatewayId); })
              if (this.editingId === profile.gatewayId) {
                TextInput({ text: this.editedName, placeholder: $r('app.string.gateways_name') })
                  .id('gateway-name').height(44).maxLength(80).fontColor(this.colors.foreground).backgroundColor(this.colors.input)
                  .onChange((text: string): void => { this.editedName = text; })
                Row({ space: 8 }) {
                  Button($r('app.string.cancel')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
                    .enabled(!this.connection.busy).onClick((): void => { this.editingId = ''; })
                  Button($r('app.string.save')).id('gateway-rename-save').height(44).backgroundColor(this.colors.accent)
                    .enabled(!this.connection.busy && !!this.editedName.trim()).onClick(async (): Promise<void> => {
                      await this.connection.rename(profile.gatewayId, this.editedName);
                      if (!this.connection.errorMessage) this.editingId = '';
                    })
                }.width('100%').justifyContent(FlexAlign.End)
              } else {
                Row({ space: 8 }) {
                  Button($r('app.string.gateways_rename')).height(44).fontSize(13).backgroundColor(Color.Transparent)
                    .fontColor(this.colors.secondary).enabled(!this.connection.busy)
                    .onClick((): void => { this.editingId = profile.gatewayId; this.editedName = profile.name; })
                  Blank().layoutWeight(1)
                  Button($r('app.string.gateways_remove')).height(44).fontSize(13).backgroundColor(Color.Transparent)
                    .fontColor(this.colors.danger).enabled(!this.connection.busy).onClick((): void => { this.remove(profile); })
                }.width('100%')
              }
              }
            }.width('100%').padding(16).borderRadius(18)
              .backgroundColor(profile.gatewayId === this.connection.activeGatewayId ? this.colors.accentSoft : this.colors.panel)
          }
        }, (profile: XopcProfile): string => profile.gatewayId + ':' + profile.name)
        if (!this.connection.profiles.length) {
          ListItem() {
            Column({ space: 10 }) {
              Text($r('app.string.gateways_empty')).fontSize(15).fontColor(this.colors.secondary)
              Button($r('app.string.gateways_add')).height(44).fontColor(Color.White).backgroundColor(this.colors.accent)
                .onClick((): void => { this.connection.addGateway(); })
            }.width('100%').padding(20).backgroundColor(this.colors.panel).borderRadius(18)
          }
        }
        if (this.connection.busy) {
          ListItem() { Text($r('app.string.gateways_working')).fontColor(this.colors.secondary).padding(12) }
        }
        if (this.connection.errorMessage) {
          ListItem() { Text($r('app.string.gateways_failed')).id('gateways-error').fontColor(this.colors.danger).padding(12) }
        }
      }.id('gateways-list').width('100%').layoutWeight(1).padding({ left: 20, right: 20, bottom: 24 }).scrollBar(BarState.Off)
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
  }
}
