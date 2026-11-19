import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatAttachment } from '../model/chat';
import { loadDeviceConnections, openDeviceConnectionChat, XopcConnectedDevice, XopcConnectionFolder,
  XopcDeviceConnections } from '../repository/deviceConnectionsRepository';
import { gatewaySession } from '../service/gatewaySession';
import { pickChatAttachment } from '../service/chatAttachmentPicker';
import { pickChatPhoto } from '../service/chatPhotoPicker';
import { connectionModel } from '../viewmodel/connectionViewModel';
import { XopcListSkeleton } from './MobileComponents';
import { CAPABILITY_CARD_CORNER, CAPABILITY_CARD_GAP, CAPABILITY_CARD_HEIGHT, CAPABILITY_CARD_PADDING,
  XopcCapabilityCardText } from './CapabilityCard';
import { XopcCapabilityLogo } from './CapabilityLogo';

interface XopcConnectionToolLabel { key: string; title: Resource; description: Resource; icon: Resource; }
interface XopcConnectionPresetLabel { key: string; title: Resource; icon: Resource; }
const presets: XopcConnectionPresetLabel[] = [
  { key: 'desktop', title: $r('app.string.device_connection_desktop'), icon: $r('sys.symbol.desktop') },
  { key: 'documents', title: $r('app.string.device_connection_documents'), icon: $r('sys.symbol.doc_text') },
  { key: 'downloads', title: $r('app.string.device_connection_downloads'), icon: $r('sys.symbol.arrow_down_to_line') }
];
const tools: XopcConnectionToolLabel[] = [
  { key: 'mobile.file.pick', title: $r('app.string.device_connection_files'), description: $r('app.string.device_connection_pick_file'), icon: $r('sys.symbol.folder') },
  { key: 'mobile.media.pick', title: $r('app.string.device_connection_photos'), description: $r('app.string.device_connection_pick_photo'), icon: $r('sys.symbol.picture') },
  { key: 'mobile.contacts.pick', title: $r('app.string.device_connection_contacts'), description: $r('app.string.device_connection_pick_contact'), icon: $r('sys.symbol.contacts_book') },
  { key: 'mobile.calendar.query_events', title: $r('app.string.device_connection_calendar'), description: $r('app.string.device_connection_calendar_scope'), icon: $r('sys.symbol.calendar') },
  { key: 'mobile.device.get_location', title: $r('app.string.device_connection_location'), description: $r('app.string.device_connection_once'), icon: $r('sys.symbol.position') }
];

@ComponentV2
export struct XopcDeviceConnectionsView {
  @Param laneActive: boolean = true;
  @Event onUseChat: (id: string) => void = (_id: string): void => {};
  @Event onShareFile: (attachment: XopcChatAttachment) => Promise<void> = async (_attachment: XopcChatAttachment): Promise<void> => {};
  @Event onLocalTool: (tool: string) => void = (_tool: string): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local catalog?: XopcDeviceConnections;
  @Local selectedKey: string = '';
  @Local loadFailed: boolean = false;
  @Local actionFailed: boolean = false;
  @Local actionBusy: boolean = false;
  private timer: number = -1;
  private epoch: number = 0;

  @Computed get currentDevice(): XopcConnectedDevice | undefined {
    return this.catalog?.devices.find((device: XopcConnectedDevice): boolean => device.id === this.catalog?.currentDeviceId);
  }

  @Computed get computerRows(): XopcConnectedDevice[] {
    return this.catalog?.devices.filter((device: XopcConnectedDevice): boolean => device.kind === 'desktop') ?? [];
  }

  @Computed get selectedDevice(): XopcConnectedDevice | undefined {
    return this.computerRows.find((device: XopcConnectedDevice): boolean => device.id === this.selectedKey);
  }

  @Computed get localTools(): XopcConnectionToolLabel[] {
    return tools.filter((tool: XopcConnectionToolLabel): boolean => this.currentDevice?.tools.includes(tool.key) === true);
  }

  aboutToAppear(): void { this.refreshLane(); }
  aboutToDisappear(): void { clearTimeout(this.timer); this.epoch++; }

  @Monitor('laneActive')
  refreshLane(): void {
    clearTimeout(this.timer);
    const epoch = ++this.epoch;
    this.actionBusy = false;
    if (this.laneActive) void this.load(epoch);
  }

  private async load(epoch: number): Promise<void> {
    try {
      const catalog = await loadDeviceConnections();
      if (epoch !== this.epoch) return;
      this.catalog = catalog;
      this.loadFailed = false;
    } catch (_error) {
      if (epoch === this.epoch) this.loadFailed = true;
    } finally {
      if (epoch === this.epoch && this.laneActive) this.timer = setTimeout((): void => { void this.load(epoch); }, 5000);
    }
  }

  private status(device?: XopcConnectedDevice): Resource {
    return device?.availability === 'offline' ? $r('app.string.device_connection_offline') : $r('app.string.device_connection_online');
  }

  private folderStatus(kind: string): Resource {
    return this.selectedDevice?.folders.some((folder: XopcConnectionFolder): boolean => folder.kind === kind)
      ? $r('app.string.device_connection_readonly') : $r('app.string.device_connection_on_computer');
  }

  private async useTool(tool: string): Promise<void> {
    if (tool !== 'mobile.file.pick' && tool !== 'mobile.media.pick') { this.onLocalTool(tool); return; }
    const context = this.getUIContext().getHostContext();
    if (!context || this.actionBusy) return;
    const epoch = this.epoch;
    const revision = gatewaySession.connectionRevision();
    this.actionBusy = true;
    this.actionFailed = false;
    try {
      const attachment = tool === 'mobile.file.pick' ? await pickChatAttachment(context, []) : await pickChatPhoto(context, [], false);
      gatewaySession.assertConnection(revision);
      if (attachment && epoch === this.epoch) await this.onShareFile(attachment);
    } catch (_error) {
      if (epoch === this.epoch) this.actionFailed = true;
    } finally { if (epoch === this.epoch) this.actionBusy = false; }
  }

  private async useComputer(): Promise<void> {
    const endpointId = this.selectedDevice?.endpointId;
    if (!endpointId || this.actionBusy || this.loadFailed) return;
    const epoch = this.epoch;
    this.actionBusy = true;
    this.actionFailed = false;
    try {
      const id = await openDeviceConnectionChat(endpointId);
      if (epoch === this.epoch) this.onUseChat(id);
    } catch (_error) {
      if (epoch === this.epoch) this.actionFailed = true;
    } finally { if (epoch === this.epoch) this.actionBusy = false; }
  }

  @Builder
  cardContent(title: ResourceStr, description: ResourceStr, icon: Resource, actionable: boolean) {
    Row({ space: CAPABILITY_CARD_GAP }) {
      XopcCapabilityLogo({ symbol: icon })
      XopcCapabilityCardText({ title, description }).layoutWeight(1)
      if (actionable) {
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.tertiary]).accessibilityLevel('no')
      }
    }.width('100%').alignItems(VerticalAlign.Center).constraintSize({ minHeight: CAPABILITY_CARD_HEIGHT })
      .padding(CAPABILITY_CARD_PADDING)
  }

  @Builder
  card(title: ResourceStr, description: ResourceStr, icon: Resource, onActivate?: () => void) {
    Column() {
      if (onActivate) {
        Button({ type: ButtonType.Normal }) {
          this.cardContent(title, description, icon, true)
        }.width('100%').padding(0).backgroundColor(Color.Transparent).stateEffect(true)
          .onClick((): void => { if (onActivate) onActivate(); })
      } else {
        this.cardContent(title, description, icon, false)
      }
    }.width('100%').backgroundColor(this.colors.panel).borderRadius(this.colors.corner(CAPABILITY_CARD_CORNER))
      .clipShape(this.colors.cornerClip(CAPABILITY_CARD_CORNER))
  }

  @Builder
  mainList() {
    if (this.currentDevice) {
      Text($r('app.string.device_connection_current')).fontSize(13).fontColor(this.colors.secondary)
      Column({ space: 10 }) {
        this.card(this.currentDevice.name, $r('app.string.device_connection_this_phone'), $r('sys.symbol.phone'))
        ForEach(this.localTools, (tool: XopcConnectionToolLabel): void => {
          this.card(tool.title, tool.description, tool.icon, (): void => { void this.useTool(tool.key); })
        }, (tool: XopcConnectionToolLabel): string => tool.key)
      }.width('100%')
    }
    Row() {
      Text($r('app.string.device_connection_computers')).fontSize(13).fontColor(this.colors.secondary).layoutWeight(1)
      Button($r('app.string.device_connection_pair')).height(44).fontSize(13)
        .fontColor(this.colors.chat.action).backgroundColor(Color.Transparent).onClick((): void => { connectionModel.openGateways(); })
    }.width('100%')
    Column({ space: 10 }) {
      if (!this.computerRows.length) {
        Text($r('app.string.device_connection_pair_help')).fontSize(13).fontColor(this.colors.secondary).padding(12)
      }
      ForEach(this.computerRows, (device: XopcConnectedDevice): void => {
        this.card(device.name, this.status(device), $r('sys.symbol.computer'),
          (): void => { this.selectedKey = device.id; this.actionFailed = false; })
      }, (device: XopcConnectedDevice): string => device.id + ':' + device.availability)
    }.width('100%')
  }

  @Builder
  computerDetail() {
    Button($r('app.string.device_connection_return')).height(44).fontSize(13)
      .backgroundColor(this.colors.accentSoft).fontColor(this.colors.chat.action)
      .onClick((): void => { this.selectedKey = ''; this.actionFailed = false; })
    this.card(this.selectedDevice?.name ?? '', this.status(this.selectedDevice), $r('sys.symbol.computer'))
    if (this.selectedDevice?.availability === 'offline') {
      Text($r('app.string.device_connection_offline_help')).fontSize(14).fontColor(this.colors.secondary).padding(12)
        .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(12))
    } else {
      Text($r('app.string.device_connection_local_files')).fontSize(13).fontColor(this.colors.secondary)
      Column({ space: 10 }) {
        ForEach(presets, (preset: XopcConnectionPresetLabel): void => {
          this.card(preset.title, this.folderStatus(preset.key), preset.icon)
        }, (preset: XopcConnectionPresetLabel): string => preset.key)
        ForEach(this.selectedDevice?.folders.filter((folder: XopcConnectionFolder): boolean => folder.kind === 'custom') ?? [],
          (folder: XopcConnectionFolder): void => {
            this.card(folder.label, $r('app.string.device_connection_readonly'), $r('sys.symbol.folder'))
          }, (folder: XopcConnectionFolder): string => folder.id)
      }.width('100%')
      if (this.selectedDevice?.platform === 'darwin' || this.selectedDevice?.platform === 'win32') {
        Text($r('app.string.device_connection_computer_control')).fontSize(13).fontColor(this.colors.secondary)
        this.card($r('app.string.device_connection_operate_window'), $r('app.string.device_connection_on_computer'), $r('sys.symbol.mouse'))
      }
      Button($r('app.string.device_connection_use_chat')).width('100%').height(48)
        .backgroundColor(this.colors.chat.action).fontColor(this.colors.chat.onAction)
        .enabled(!this.actionBusy && !this.loadFailed && !!this.selectedDevice?.endpointId && (this.selectedDevice?.folders.length ?? 0) > 0)
        .id('device-use-in-chat').onClick((): void => { void this.useComputer(); })
    }
  }

  build() {
    Scroll() {
      Column({ space: 12 }) {
        if (this.loadFailed || this.actionFailed) {
          Text($r('app.string.device_connection_failed')).fontSize(13).fontColor(this.colors.secondary)
          Button($r('app.string.capability_retry')).height(44).backgroundColor(this.colors.accentSoft)
            .fontColor(this.colors.chat.action).onClick((): void => { this.actionFailed = false; this.refreshLane(); })
        }
        if (!this.catalog && !this.loadFailed) {
          XopcListSkeleton()
        } else if (this.selectedDevice) {
          this.computerDetail()
        } else if (this.catalog) {
          this.mainList()
        }
      }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 12, bottom: 16 })
    }.width('100%').height('100%').align(Alignment.TopStart)
  }
}
