import { agentDisplayDescription, agentDisplayName } from '../common/agentPresentation';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatAgent } from '../model/chat';
import { XopcPersonalAgentRecord } from '../model/personalAgent';
import { loadCapabilities, XopcCapabilityItem, XopcCapabilityPage } from '../repository/capabilitiesRepository';
import { XopcListSkeleton } from './MobileComponents';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { XopcCapabilitySetupView } from './CapabilitySetupView';
import { common } from '@kit.AbilityKit';
import { gatewaySession } from '../service/gatewaySession';
import { XopcRoute } from '../model/gateway';

const categories: string[] = ['plugins', 'skills', 'connections', 'agents', 'channels'];
const groups: string[] = ['attention', 'assistant', 'expert', 'connected', 'installed', 'configured', 'disabled', 'available'];

@ComponentV2
export struct XopcCapabilitiesView {
  @Param personal: XopcPersonalAgentRecord | null = null;
  @Event onExit: () => void = (): void => {};
  @Event onOpenAgent: (id: string, personal: boolean) => void = (_id: string, _personal: boolean): void => {};
  @Event onOpenDraft: (prompt: string) => void = (_prompt: string): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local category: string = 'plugins';
  @Local query: string = '';
  @Local loading: boolean = true;
  @Local failed: boolean = false;
  @Local catalog?: XopcCapabilityPage;
  @Local detail?: XopcCapabilityItem;
  @Local detailOpen: boolean = false;
  @Local setupMode: string = '';
  private pages: Map<string, XopcCapabilityPage> = new Map<string, XopcCapabilityPage>();
  private scroller: Scroller = new Scroller();
  private generation: number = 0;

  aboutToAppear(): void { void this.load(); }
  aboutToDisappear(): void { this.generation++; }

  private async load(): Promise<void> {
    const revision = ++this.generation;
    const requested = this.category;
    this.loading = true; this.failed = false;
    try {
      const result = await loadCapabilities(requested);
      if (revision !== this.generation) return;
      this.catalog = result;
      this.pages.set(requested, result);
    } catch (_) {
      if (revision === this.generation) this.failed = true;
    } finally { if (revision === this.generation) this.loading = false; }
  }

  private select(category: string): void {
    if (this.category === category) return;
    this.getUIContext().getFocusController().clearFocus();
    this.query = '';
    this.category = category;
    this.catalog = this.pages.get(category);
    this.scroller.scrollTo({ xOffset: 0, yOffset: 0 });
    void this.load();
  }

  private title(category: string): Resource {
    if (category === 'skills') return $r('app.string.capability_skills');
    if (category === 'connections') return $r('app.string.capability_connections');
    if (category === 'agents') return $r('app.string.capability_agents');
    if (category === 'channels') return $r('app.string.capability_channels');
    return $r('app.string.capability_plugins');
  }

  private groupTitle(group: string): Resource {
    if (group === 'assistant') return $r('app.string.capability_my_assistants');
    if (group === 'expert') return $r('app.string.capability_experts');
    if (group === 'connected') return $r('app.string.capability_connected');
    if (group === 'installed') return $r('app.string.capability_installed');
    if (group === 'configured') return $r('app.string.capability_configured');
    if (group === 'attention') return $r('app.string.capability_attention');
    if (group === 'disabled') return $r('app.string.capability_disabled');
    return $r('app.string.capability_available');
  }

  private getLabel(value: ResourceStr): string {
    if (typeof value === 'string') return value;
    return this.getUIContext().getHostContext()?.resourceManager.getStringSync(value.id) ?? '';
  }

  private discover(): void {
    const manager = this.getUIContext().getHostContext()?.resourceManager;
    const title = this.getLabel(this.title(this.category));
    const query = this.query.trim();
    const prompt = query
      ? manager?.getStringSync($r('app.string.capability_find_query_prompt').id, title, JSON.stringify(query))
      : manager?.getStringSync($r('app.string.capability_find_prompt').id, title);
    if (!prompt) return;
    this.getUIContext().getFocusController().clearFocus();
    this.onOpenDraft(prompt);
  }

  private promptTemplate(): Resource {
    if (this.category === 'skills') return $r('app.string.capability_skill_prompt');
    if (this.category === 'connections') return $r('app.string.capability_connection_prompt');
    if (this.category === 'agents') return $r('app.string.capability_agent_prompt');
    if (this.category === 'channels') return $r('app.string.capability_channel_prompt');
    return $r('app.string.capability_plugin_prompt');
  }

  private askAbout(item: XopcCapabilityItem): void {
    const prompt = this.getUIContext().getHostContext()?.resourceManager
      .getStringSync(this.promptTemplate().id, JSON.stringify(item.id));
    if (prompt) { this.detailOpen = false; this.onOpenDraft(prompt); }
  }

  private channelIssue(code: string): Resource {
    if (code === 'telegram.missing_credential') return $r('app.string.capability_channel_telegram');
    if (code === 'weixin.missing_account') return $r('app.string.capability_channel_weixin');
    if (code === 'feishu.missing_credentials') return $r('app.string.capability_channel_feishu');
    return $r('app.string.capability_channel_config');
  }

  private administrationURL(item: XopcCapabilityItem): string {
    if (this.category !== 'channels') return '';
    const profile = gatewaySession.currentProfile();
    const origin = profile?.routes.find((route: XopcRoute): boolean => route.id === profile.activeRouteId)?.url ?? '';
    if (!origin.startsWith('https://')) return '';
    const base = origin.split(/[?#]/)[0].replace(/\/$/, '');
    const id = encodeURIComponent(item.targetId ?? item.id);
    return base + '/#/capabilities/channels/' + id;
  }

  private async openAdministration(item: XopcCapabilityItem): Promise<void> {
    const url = this.administrationURL(item);
    if (!url) return;
    try {
      await (this.getUIContext().getHostContext() as common.UIAbilityContext).openLink(url, { appLinkingOnly: false });
    } catch (_) {
      this.getUIContext().getPromptAction().showToast({ message: $r('app.string.capability_web_open_failed') });
    }
  }

  private symbol(): Resource {
    if (this.category === 'skills') return $r('sys.symbol.checkmark_circle');
    if (this.category === 'connections') return $r('sys.symbol.link');
    if (this.category === 'channels') return $r('sys.symbol.ellipsis_bubble');
    return $r('sys.symbol.square_grid_2x2');
  }

  @Computed get matches(): XopcCapabilityItem[] {
    let rows = this.catalog?.items ?? [];
    const personal = this.personal;
    if (this.category === 'agents') {
      rows = rows.map((item: XopcCapabilityItem): XopcCapabilityItem => {
        const agent: XopcChatAgent = { id: item.id, name: item.name, description: item.description, avatar: item.avatar };
        return { id: item.id, name: this.getLabel(agentDisplayName(agent)),
          description: this.getLabel(agentDisplayDescription(agent)), group: item.group, avatar: item.avatar };
      });
    }
    if (this.category === 'agents' && personal?.state === 'ready') {
      const own: XopcCapabilityItem = { id: personal.agentId, name: personal.displayName,
        description: this.getLabel($r('app.string.capability_personal_description')), group: 'assistant' };
      rows = [own].concat(rows.filter((item: XopcCapabilityItem): boolean => item.id !== own.id));
    }
    const query = this.query.trim().toLowerCase();
    return rows.filter((item: XopcCapabilityItem): boolean =>
      [item.name, item.id, item.description ?? ''].some((value: string): boolean => value.toLowerCase().includes(query)));
  }

  private rows(group: string): XopcCapabilityItem[] {
    return this.matches.filter((item: XopcCapabilityItem): boolean => item.group === group);
  }

  @Builder
  categoryMenu() {
    Menu() {
      ForEach(categories, (key: string) => {
        MenuItem({ content: this.title(key) }).id('capability-category-' + key).selected(this.category === key)
          .onClick((): void => { this.select(key); })
      }, (key: string): string => key)
    }
  }

  @Builder
  icon(item: XopcCapabilityItem) {
    if (this.category === 'agents') {
      XopcPersonalAgentAvatar({ agentId: item.id, extent: 44, compact: true, activePage: false,
        appearance: this.personal?.agentId === item.id ? this.personal?.appearance ?? 'loopi' : 'configured',
        revision: this.personal?.agentId === item.id ? this.personal?.revision ?? 0 : 0,
        avatarReference: item.avatar ?? '', fallbackLabel: item.name })
    } else {
      Column() {
        SymbolGlyph(this.symbol()).fontSize(22).fontColor([this.colors.accent])
      }.width(44).height(44).justifyContent(FlexAlign.Center).borderRadius(this.colors.corner(12)).backgroundColor(this.colors.accentSoft)
    }
  }

  @Builder
  itemRow(item: XopcCapabilityItem) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        this.icon(item)
        Column({ space: 4 }) {
          Text(item.name).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          if (item.description) Text(item.description).fontSize(13).fontColor(this.colors.secondary)
            .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(16).fontColor([this.colors.tertiary])
      }.width('100%').constraintSize({ minHeight: 62 }).padding({ left: 12, right: 12 })
    }.width('100%').padding(0).backgroundColor(this.colors.light ? this.colors.panel : Color.Transparent)
      .border(this.colors.panelStroke).borderRadius(this.colors.corner(16)).id('capability-row-' + item.id)
      .onClick((): void => {
        this.getUIContext().getFocusController().clearFocus();
        this.setupMode = ''; this.detail = item; this.detailOpen = true;
      })
  }

  @Builder
  detailSheet() {
    if (this.setupMode) {
      XopcCapabilitySetupView({ mode: this.setupMode, itemId: this.detail?.targetId ?? this.detail?.id ?? '',
        itemName: this.detail?.name ?? '', initialQuery: this.query, onChanged: (): void => { void this.load(); } })
    } else if (this.detail) {
      Scroll() {
        Column({ space: 14 }) {
          this.icon(this.detail)
          Text(this.detail.name).fontSize(22).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
          Text(this.groupTitle(this.detail.group)).fontSize(14).fontColor(this.colors.secondary)
          if (this.detail.description) Text(this.detail.description).fontSize(16).fontColor(this.colors.foreground)
          if (this.detail.version) Text($r('app.string.capability_version_label', this.detail.version))
            .fontSize(14).fontColor(this.colors.secondary)
          if (this.detail.issue) Text(this.channelIssue(this.detail.issue))
            .fontSize(14).fontColor(this.colors.secondary).width('100%')
            .padding(12).backgroundColor(this.colors.grouped).borderRadius(this.colors.corner(12))
          if (this.category === 'agents' && this.detail.group !== 'disabled') {
            Button($r('app.string.capability_start_chat')).height(48).width('100%').id('capability-start-chat')
              .backgroundColor(this.colors.accent).fontColor(this.colors.onAccent)
              .onClick((): void => {
                const id = this.detail?.id ?? '';
                this.detailOpen = false;
                if (id) this.onOpenAgent(id, id === this.personal?.agentId);
              })
          }
          if (this.detail.id !== this.personal?.agentId) {
            Button($r('app.string.capability_open_chat')).height(48).width('100%').id('capability-open-chat')
              .backgroundColor(this.category === 'agents' && this.detail.group !== 'disabled' ? this.colors.grouped : this.colors.accent)
              .fontColor(this.category === 'agents' && this.detail.group !== 'disabled' ? this.colors.foreground : this.colors.onAccent)
              .onClick((): void => { if (this.detail) this.askAbout(this.detail); })
          }
          if (this.category === 'plugins' && this.detail.group !== 'available') {
            Button($r('app.string.cap_native_plugin')).height(48).width('100%').id('cap-native-open-plugin')
              .backgroundColor(this.colors.grouped).fontColor(this.colors.foreground)
              .onClick((): void => { this.setupMode = 'plugin'; })
          }
          if (this.category === 'agents' && this.detail.id !== this.personal?.agentId && this.detail.group !== 'disabled') {
            Button($r('app.string.cap_native_edit_agent')).height(48).width('100%').id('cap-native-open-agent')
              .backgroundColor(this.colors.grouped).fontColor(this.colors.foreground)
              .onClick((): void => { this.setupMode = 'agent'; })
          }
          if (this.administrationURL(this.detail)) {
            Button($r('app.string.capability_web_manage')).height(44).width('100%').id('capability-web-manage')
              .backgroundColor(this.colors.grouped).fontColor(this.colors.foreground)
              .onClick((): void => { if (this.detail) void this.openAdministration(this.detail); })
          }
        }.width('100%').padding(24).alignItems(HorizontalAlign.Start)
      }.width('100%').scrollBar(BarState.Off)
    }
  }

  build() {
    Column() {
      Row() {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(20).fontColor([this.colors.foreground])
        }.id('capability-back').width(44).height(44).padding(0)
          .backgroundColor(this.colors.light ? this.colors.panel : this.colors.input).border(this.colors.panelStroke)
          .accessibilityText($r('app.string.back')).onClick((): void => { this.onExit(); })
        Row() {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 6 }) {
              Text(this.title(this.category)).fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
              SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(14).fontColor([this.colors.secondary])
            }
          }.id('capability-category').height(48).padding({ left: 10, right: 10 }).backgroundColor(Color.Transparent)
            .bindMenu(this.categoryMenu)
        }.layoutWeight(1).justifyContent(FlexAlign.Center)
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.arrow_clockwise')).fontSize(18).fontColor([this.colors.secondary])
        }.id('capability-refresh').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.capability_retry')).enabled(!this.loading)
          .onClick((): void => { void this.load(); })
      }.width('100%').padding({ top: 8, bottom: 8 })
      List({ space: 6, scroller: this.scroller }) {
        ListItem() {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 8 }) {
              SymbolGlyph($r('sys.symbol.ellipsis_bubble')).fontSize(18).fontColor([this.colors.chat.action])
              Text($r('app.string.capability_discover')).fontSize(15).fontWeight(FontWeight.Medium)
                .fontColor(this.colors.chat.action)
            }.justifyContent(FlexAlign.Center).width('100%')
          }.id('capability-discover').width('100%').height(48).backgroundColor(this.colors.grouped)
            .borderRadius(this.colors.corner(16)).onClick((): void => { this.discover(); })
        }
        if (this.category === 'skills' || this.category === 'connections') {
          ListItem() {
            Button(this.category === 'skills' ? $r('app.string.cap_native_skill') : $r('app.string.cap_native_mcp'))
              .id('cap-native-open-' + this.category).width('100%').height(48).backgroundColor(this.colors.accentSoft)
              .fontColor(this.colors.chat.action).borderRadius(this.colors.corner(16)).onClick((): void => {
                this.getUIContext().getFocusController().clearFocus();
                this.detail = undefined; this.setupMode = this.category === 'skills' ? 'skills' : 'mcp'; this.detailOpen = true;
              })
          }
        }
        if (this.category === 'agents') {
          ListItem() {
            Button($r('app.string.cap_native_create_agent')).id('cap-native-create-agent').width('100%').height(48)
              .backgroundColor(this.colors.accentSoft).fontColor(this.colors.chat.action).borderRadius(this.colors.corner(16))
              .onClick((): void => {
                this.getUIContext().getFocusController().clearFocus();
                this.onOpenDraft(this.getLabel($r('app.string.cap_native_create_agent_prompt')));
              })
          }
        }
        if (this.loading && !this.catalog) { ListItem() { XopcListSkeleton() } }
        if (this.failed || this.catalog?.incomplete) {
          ListItem() {
            Row() {
              Text(this.failed ? $r('app.string.capability_load_failed') : $r('app.string.capability_partial'))
                .fontSize(14).fontColor(this.colors.secondary).layoutWeight(1)
              Button($r('app.string.capability_retry')).height(44).onClick((): void => { void this.load(); })
            }.width('100%')
          }
        }
        if (!this.loading && !this.failed && !this.matches.length) {
          ListItem() {
            Column({ space: 10 }) {
              SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(24).fontColor([this.colors.secondary])
              Text(this.query.trim() ? $r('app.string.capability_no_matches') : $r('app.string.capability_empty'))
                .fontSize(16).fontColor(this.colors.foreground)
              if (this.query) Button($r('app.string.capability_clear')).height(44).onClick((): void => { this.query = ''; })
            }.id('capability-empty').width('100%').padding({ top: 56 })
          }
        }
        ForEach(groups, (group: string) => {
          if (this.rows(group).length) {
            ListItem() {
              Text(this.groupTitle(group)).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary)
                .padding({ left: 4, top: 10, bottom: 4 })
            }
            ForEach(this.rows(group), (item: XopcCapabilityItem) => {
              ListItem() { this.itemRow(item) }
            }, (item: XopcCapabilityItem): string => item.id + ':' + item.name + ':' + (item.description ?? ''))
          }
        }, (group: string): string => group)
      }.width('100%').layoutWeight(1).scrollBar(BarState.Off)
      Row({ space: 8 }) {
        SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(19).fontColor([this.colors.secondary])
        TextInput({ text: this.query, placeholder: $r('app.string.capability_search', this.getLabel(this.title(this.category))) })
          .id('capability-search').layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent)
          .fontColor(this.colors.foreground).placeholderColor(this.colors.tertiary)
          .maxLength(160).enterKeyType(EnterKeyType.Search)
          .onChange((value: string): void => { this.query = value; this.scroller.scrollTo({ xOffset: 0, yOffset: 0 }); })
          .onSubmit((): void => { this.getUIContext().getFocusController().clearFocus(); })
        if (this.query) Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(17).fontColor([this.colors.secondary])
        }.id('capability-search-clear').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.capability_clear')).onClick((): void => { this.query = ''; })
      }.width('100%').padding({ left: 16, right: 6 })
        .backgroundColor(this.colors.light ? this.colors.panel : this.colors.input).border(this.colors.controlStroke).borderRadius(this.colors.corner(24))
        .margin({ top: 8, bottom: 8 })
    }.width('100%').height('100%').padding({ left: 16, right: 16 }).backgroundColor(this.colors.surface)
      .bindSheet($$this.detailOpen, this.detailSheet, { height: this.setupMode ? '78%' : '60%', dragBar: true,
        showClose: true, backgroundColor: this.colors.panel })
  }
}
