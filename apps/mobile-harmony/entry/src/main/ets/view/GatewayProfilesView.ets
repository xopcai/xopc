import { xopcConfirmDialog } from '../common/dialogActions';
import { xopcClickEffect, xopcRevealTransition } from '../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcProfile } from '../model/gateway';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { connectionModel, XopcConnectionViewModel, XopcGatewayProbeState } from '../viewmodel/connectionViewModel';
import { XopcPageHeader } from './MobileComponents';

@ComponentV2
export struct XopcGatewayProfilesView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Local connection: XopcConnectionViewModel = connectionModel;
  @Local editingId: string = '';
  @Local editedName: string = '';
  @Local expandedId: string = '';

  private origin(profile: XopcProfile): string {
    return this.preferredRoute(profile).replace('https://', '');
  }

  private preferredRoute(profile: XopcProfile): string {
    return profile.routes.find((route): boolean => route.id === profile.activeRouteId)?.url ?? '';
  }

  private statusText(state: XopcGatewayProbeState | undefined): Resource {
    if (!state || state.phase === 'checking') return $r('app.string.gateways_checking');
    if (state.phase === 'online') return $r('app.string.gateways_online');
    if (state.phase === 'degraded') return $r('app.string.gateways_degraded');
    return $r('app.string.gateways_offline');
  }

  private statusColor(state: XopcGatewayProbeState | undefined): Resource {
    if (state?.phase === 'online') return this.colors.success;
    if (state?.phase === 'degraded') return this.colors.attentionForeground;
    if (state?.phase === 'offline') return this.colors.danger;
    return this.colors.secondary;
  }

  private canSwitch(gatewayId: string): boolean {
    const phase = this.connection.probeState(gatewayId)?.phase;
    return !this.connection.busy && (phase === 'online' || phase === 'degraded');
  }

  private probeError(error: string): Resource {
    if (error === 'DEVICE_AUTH_DENIED' || error === 'DEVICE_CREDENTIALS_MISSING' || error === 'HTTP_401' || error === 'HTTP_403')
      return $r('app.string.gateways_probe_auth');
    if (error === 'GATEWAY_IDENTITY_MISMATCH') return $r('app.string.gateways_probe_identity');
    return $r('app.string.gateways_probe_network');
  }

  private async remove(profile: XopcProfile): Promise<void> {
    const confirmed = await xopcConfirmDialog(this.getUIContext(), {
      title: $r('app.string.gateways_remove'),
      message: $r('app.string.gateways_remove_hint'),
      confirmLabel: $r('app.string.gateways_remove'),
      destructive: true,
    });
    if (confirmed) await this.connection.remove(profile.gatewayId);
  }

  @Builder
  header() {
    XopcPageHeader({
      heading: $r('app.string.gateways_title'),
      showStaticTitle: true,
      backVisible: true,
      backId: 'gateways-back',
      backEnabled: !this.connection.busy,
      onBack: (): void => { this.connection.closeGateways(); },
      actionLabel: $r('app.string.gateways_add'),
      actionIcon: $r('sys.symbol.plus'),
      actionId: 'gateways-add',
      actionTone: 'accent',
      actionEnabled: !this.connection.busy,
      onAction: (): void => { this.connection.addGateway(); },
    })
  }

  @Builder
  summary(profile: XopcProfile) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 12 }) {
        Row({ space: 12 }) {
          Column() {
            SymbolGlyph($r('sys.symbol.link')).fontSize(20).fontColor([this.colors.accent])
          }.width(38).height(38).justifyContent(FlexAlign.Center)
            .backgroundColor(this.colors.accentSoft).borderRadius(this.colors.corner(12))
            .accessibilityLevel('no-hide-descendants')
          Column({ space: 3 }) {
            Text(profile.name).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(this.origin(profile)).fontSize(13).fontColor(this.colors.secondary)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text($r('app.string.gateways_server_version',
              this.connection.probeState(profile.gatewayId)?.result?.version || '—'))
              .id('gateway-version-' + profile.gatewayId).fontSize(12).fontColor(this.colors.secondary)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          SymbolGlyph(this.expandedId === profile.gatewayId ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
            .fontSize(14).fontColor([this.colors.tertiary]).accessibilityLevel('no')
        }.width('100%')
        Row({ space: 8 }) {
          Row().width(7).height(7).borderRadius(4)
            .backgroundColor(this.statusColor(this.connection.probeState(profile.gatewayId)))
          Text(this.statusText(this.connection.probeState(profile.gatewayId))).id('gateway-status-' + profile.gatewayId)
            .fontSize(13).fontColor(this.statusColor(this.connection.probeState(profile.gatewayId)))
            .layoutWeight(1).maxLines(2)
          if (profile.gatewayId === this.connection.activeGatewayId) {
            Text($r('app.string.gateways_current')).fontSize(11).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.accent).padding({ left: 8, right: 8, top: 3, bottom: 3 })
              .backgroundColor(this.colors.accentSoft).borderRadius(this.colors.corner(10)).maxLines(1)
          }
        }.width('100%').constraintSize({ minHeight: 24 })
      }.width('100%').padding(14)
    }.id('gateway-select-' + profile.gatewayId).width('100%').padding(0).backgroundColor(Color.Transparent)
      .borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16))
      .clickEffect(xopcClickEffect())
      .accessibilitySelected(profile.gatewayId === this.connection.activeGatewayId)
      .onClick((): void => {
        this.expandedId = this.expandedId === profile.gatewayId ? '' : profile.gatewayId;
        this.editingId = '';
      })
  }

  @Builder
  detailValue(label: Resource, content: string) {
    Row({ space: 10 }) {
      Text(label).fontSize(12).fontColor(this.colors.secondary)
      Text(content).fontSize(12).fontColor(this.colors.foreground).textAlign(TextAlign.End)
        .layoutWeight(1).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
    }.width('100%')
  }

  @Builder
  details(profile: XopcProfile) {
    Column({ space: 8 }) {
      if (this.connection.probeState(profile.gatewayId)?.phase === 'offline') {
        Text(this.probeError(this.connection.probeState(profile.gatewayId)?.error ?? ''))
          .fontSize(13).lineHeight(19).fontColor(this.colors.danger).width('100%')
          .padding(12).backgroundColor(this.colors.input).borderRadius(this.colors.corner(12))
      } else if (this.connection.probeState(profile.gatewayId)?.result) {
        Column({ space: 6 }) {
          this.detailValue($r('app.string.gateways_latency'),
            (this.connection.probeState(profile.gatewayId)?.result?.latencyMs ?? 0).toString() + ' ms')
          this.detailValue($r('app.string.gateways_checked_at'),
            new Date(this.connection.probeState(profile.gatewayId)?.result?.checkedAt ?? 0).toLocaleString())
          if (this.connection.probeState(profile.gatewayId)?.result?.routeUrl !== this.preferredRoute(profile)) {
            this.detailValue($r('app.string.gateways_route'),
              this.connection.probeState(profile.gatewayId)?.result?.routeUrl ?? '')
          }
        }.width('100%').padding(12).backgroundColor(this.colors.input).borderRadius(this.colors.corner(12))
      }
      Row({ space: 8 }) {
        if (profile.gatewayId !== this.connection.activeGatewayId) {
          Button($r('app.string.gateways_switch')).id('gateway-switch-' + profile.gatewayId)
            .layoutWeight(1).height(44).fontSize(14).fontColor(this.colors.onAccent)
            .backgroundColor(this.colors.accent).enabled(this.canSwitch(profile.gatewayId))
            .onClick((): void => { void this.connection.activate(profile.gatewayId); })
        }
        Button($r('app.string.gateways_check')).id('gateway-check-' + profile.gatewayId)
          .layoutWeight(1).height(44).fontSize(14).fontColor(this.colors.accent).backgroundColor(this.colors.accentSoft)
          .enabled(this.connection.probeState(profile.gatewayId)?.phase !== 'checking' && !this.connection.busy)
          .onClick((): void => { void this.connection.probeOne(profile.gatewayId); })
      }.width('100%')
      if (this.editingId === profile.gatewayId) {
        TextInput({ text: this.editedName, placeholder: $r('app.string.gateways_name') })
          .id('gateway-name').height(44).maxLength(80).fontColor(this.colors.foreground).backgroundColor(this.colors.input)
          .onChange((text: string): void => { this.editedName = text; })
        Row({ space: 8 }) {
          Button($r('app.string.cancel')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
            .enabled(!this.connection.busy).onClick((): void => { this.editingId = ''; })
          Button($r('app.string.save')).id('gateway-rename-save').height(44).backgroundColor(this.colors.accent)
            .fontColor(this.colors.onAccent).enabled(!this.connection.busy && !!this.editedName.trim())
            .onClick(async (): Promise<void> => {
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
            .fontColor(this.colors.danger).enabled(!this.connection.busy)
            .onClick((): void => { void this.remove(profile); })
        }.width('100%')
      }
    }.width('100%').padding({ left: 14, right: 14, bottom: 6 })
      .transition(xopcRevealTransition(TransitionEdge.TOP, this.layout.reduceMotion))
  }

  build() {
    Column() {
      this.header()
      List({ space: 12 }) {
        ForEach(this.connection.profiles, (profile: XopcProfile) => {
          ListItem() {
            Column() {
              this.summary(profile)
              if (this.expandedId === profile.gatewayId) {
                this.details(profile)
              }
            }.width('100%').borderRadius(this.colors.corner(18)).backgroundColor(this.colors.panel).clip(true)
          }
        }, (profile: XopcProfile): string => profile.gatewayId + ':' + profile.name)
        if (!this.connection.profiles.length) {
          ListItem() {
            Column({ space: 12 }) {
              SymbolGlyph($r('sys.symbol.link')).fontSize(24).fontColor([this.colors.accent])
              Text($r('app.string.gateways_empty')).fontSize(15).fontColor(this.colors.secondary)
                .textAlign(TextAlign.Center)
              Button($r('app.string.gateways_add')).height(44).fontColor(this.colors.onAccent)
                .backgroundColor(this.colors.accent).enabled(!this.connection.busy)
                .onClick((): void => { this.connection.addGateway(); })
            }.width('100%').padding(20).backgroundColor(this.colors.panel).borderRadius(this.colors.corner(18))
          }
        }
        if (this.connection.busy) {
          ListItem() { Text($r('app.string.gateways_working')).fontColor(this.colors.secondary).padding(12) }
        }
        if (this.connection.errorMessage) {
          ListItem() { Text($r('app.string.gateways_failed')).id('gateways-error').fontColor(this.colors.danger).padding(12) }
        }
      }.id('gateways-list').width('100%').layoutWeight(1)
        .padding({ left: 16, right: 16, top: 8, bottom: 24 }).scrollBar(BarState.Off)
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
  }
}
