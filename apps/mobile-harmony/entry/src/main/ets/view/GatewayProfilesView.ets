import { connectionModel, XopcConnectionViewModel } from '../viewmodel/connectionViewModel';
import { XopcProfile } from '../model/gateway';

@ComponentV2
export struct XopcGatewayProfilesView {
  @Local connection: XopcConnectionViewModel = connectionModel;
  @Local editingId: string = '';
  @Local editedName: string = '';

  private origin(profile: XopcProfile): string {
    return (profile.routes.find((route): boolean => route.id === profile.activeRouteId)?.url ?? '').replace('https://', '');
  }

  private async remove(profile: XopcProfile): Promise<void> {
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: $r('app.string.gateways_remove'), message: $r('app.string.gateways_remove_hint'),
        buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') },
          { text: $r('app.string.confirm'), color: $r('app.color.danger') }]
      });
      if (result.index === 1) await this.connection.remove(profile.gatewayId);
    } catch (_) { /* Dismissing the dialog leaves the profile intact. */ }
  }

  build() {
    Column() {
      Row({ space: 8 }) {
        Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([$r('app.color.foreground')]) }
          .id('gateways-back').width(44).height(44).backgroundColor(Color.Transparent).enabled(!this.connection.busy)
          .accessibilityText($r('app.string.back')).onClick((): void => { this.connection.closeGateways(); })
        Text($r('app.string.gateways_title')).fontSize(24).fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.foreground')).layoutWeight(1)
        Button() { SymbolGlyph($r('sys.symbol.plus')).fontSize(22).fontColor([$r('app.color.accent')]) }
          .id('gateways-add').width(44).height(44).backgroundColor(Color.Transparent).enabled(!this.connection.busy)
          .accessibilityText($r('app.string.gateways_add')).onClick((): void => { this.connection.addGateway(); })
      }.width('100%').padding({ left: 8, right: 16, top: 12, bottom: 12 })
      List({ space: 12 }) {
        ListItem() {
          Text($r('app.string.gateways_hint')).fontSize(14).lineHeight(21).fontColor($r('app.color.secondary')).padding({ bottom: 8 })
        }
        ForEach(this.connection.profiles, (profile: XopcProfile) => {
          ListItem() {
            Column({ space: 8 }) {
              Button({ type: ButtonType.Normal }) {
                Row({ space: 12 }) {
                  SymbolGlyph($r('sys.symbol.link')).fontSize(22).fontColor([$r('app.color.secondary')])
                  Column({ space: 4 }) {
                    Text(profile.name).fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground'))
                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                    Text(this.origin(profile)).fontSize(12).fontColor($r('app.color.secondary'))
                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                  if (profile.gatewayId === this.connection.activeGatewayId) {
                    SymbolGlyph($r('sys.symbol.checkmark')).fontSize(20).fontColor([$r('app.color.accent')])
                  }
                }.width('100%').constraintSize({ minHeight: 56 })
              }.id('gateway-select-' + profile.gatewayId).width('100%').padding(0).backgroundColor(Color.Transparent)
                .enabled(!this.connection.busy).accessibilitySelected(profile.gatewayId === this.connection.activeGatewayId)
                .onClick((): void => { this.connection.activate(profile.gatewayId); })
              if (this.editingId === profile.gatewayId) {
                TextInput({ text: this.editedName, placeholder: $r('app.string.gateways_name') })
                  .id('gateway-name').height(44).maxLength(80).fontColor($r('app.color.foreground')).backgroundColor($r('app.color.input'))
                  .onChange((text: string): void => { this.editedName = text; })
                Row({ space: 8 }) {
                  Button($r('app.string.cancel')).height(44).backgroundColor(Color.Transparent).fontColor($r('app.color.secondary'))
                    .enabled(!this.connection.busy).onClick((): void => { this.editingId = ''; })
                  Button($r('app.string.save')).id('gateway-rename-save').height(44).backgroundColor($r('app.color.accent'))
                    .enabled(!this.connection.busy && !!this.editedName.trim()).onClick(async (): Promise<void> => {
                      await this.connection.rename(profile.gatewayId, this.editedName);
                      if (!this.connection.errorMessage) this.editingId = '';
                    })
                }.width('100%').justifyContent(FlexAlign.End)
              } else {
                Row({ space: 8 }) {
                  Button($r('app.string.gateways_rename')).height(44).fontSize(13).backgroundColor(Color.Transparent)
                    .fontColor($r('app.color.secondary')).enabled(!this.connection.busy)
                    .onClick((): void => { this.editingId = profile.gatewayId; this.editedName = profile.name; })
                  Blank().layoutWeight(1)
                  Button($r('app.string.gateways_remove')).height(44).fontSize(13).backgroundColor(Color.Transparent)
                    .fontColor($r('app.color.danger')).enabled(!this.connection.busy).onClick((): void => { this.remove(profile); })
                }.width('100%')
              }
            }.width('100%').padding(16).borderRadius(18).backgroundColor($r('app.color.panel'))
              .border({ width: 0.5, color: $r('app.color.border_subtle') })
          }
        }, (profile: XopcProfile): string => profile.gatewayId + ':' + profile.name)
        if (!this.connection.profiles.length) {
          ListItem() { Text($r('app.string.gateways_empty')).fontSize(15).fontColor($r('app.color.secondary')).padding(20) }
        }
        if (this.connection.busy) {
          ListItem() { Text($r('app.string.gateways_working')).fontColor($r('app.color.secondary')).padding(12) }
        }
        if (this.connection.errorMessage) {
          ListItem() { Text($r('app.string.gateways_failed')).id('gateways-error').fontColor($r('app.color.danger')).padding(12) }
        }
      }.id('gateways-list').width('100%').layoutWeight(1).padding({ left: 20, right: 20, bottom: 24 }).scrollBar(BarState.Off)
    }.width('100%').height('100%').backgroundColor($r('app.color.surface'))
  }
}
