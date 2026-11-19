import { layoutState, XopcLayoutState } from '../service/layoutState';
import { appSettings } from '../service/settings';
import { SEGMENTED_PAGE_TAP_SLOP_VP } from './SegmentedTabs';
import { agentDisplayDescription, agentDisplayName } from '../common/agentPresentation';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatAttachment, XopcChatAgent } from '../model/chat';
import { XopcPersonalAgentRecord } from '../model/personalAgent';
import { loadCapabilities, XopcCapabilityItem, XopcCapabilityPage } from '../repository/capabilitiesRepository';
import { XopcListSkeleton, XopcPageTitleMenu, XopcPageTitleOption } from './MobileComponents';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { capabilityDrawerHeight, XopcCapabilityPanelView } from './CapabilityPanelView';
import { XopcCapabilityLogo } from './CapabilityLogo';
import { CAPABILITY_CARD_CORNER, CAPABILITY_CARD_GAP, CAPABILITY_CARD_HEIGHT, CAPABILITY_CARD_PADDING,
  XopcCapabilityCardText } from './CapabilityCard';
import { XopcDeviceConnectionsView } from './DeviceConnectionsView';

const categories: string[] = ['plugins', 'skills', 'connections', 'devices', 'agents', 'channels'];
const groups: string[] = ['attention', 'assistant', 'expert', 'connected', 'installed', 'configured', 'disabled', 'available'];

@ObservedV2
class XopcCapabilityTabState {
  readonly key: string;
  readonly scroller: Scroller = new Scroller();
  @Trace query: string = '';
  @Trace loading: boolean = false;
  @Trace failed: boolean = false;
  @Trace catalog?: XopcCapabilityPage;

  constructor(key: string) {
    this.key = key;
  }
}

@ComponentV2
export struct XopcCapabilitiesView {
  @Param personal: XopcPersonalAgentRecord | null = null;
  @Event onExit: () => void = (): void => {};
  @Event onOpenAgent: (id: string, personal: boolean) => void = (_id: string, _personal: boolean): void => {};
  @Event onPersonalChanged: () => void = (): void => {};
  @Event onSetupChat: (prompt: string, agentSetup: boolean) => void = (_prompt: string, _agentSetup: boolean): void => {};
  @Event onDeviceChat: (id: string) => void = (_id: string): void => {};
  @Event onDeviceFile: (attachment: XopcChatAttachment) => Promise<void> = async (_attachment: XopcChatAttachment): Promise<void> => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Local category: string = 'plugins';
  @Local detail?: XopcCapabilityItem;
  @Local detailOpen: boolean = false;
  @Local detailExpanded: boolean = false;
  @Local hoveredItemId: string = '';
  @Local clearHovered: boolean = false;
  private pendingChatPrompt: string = '';
  private tabs: XopcCapabilityTabState[] = categories.map((key: string): XopcCapabilityTabState => new XopcCapabilityTabState(key));
  private swiper: SwiperController = new SwiperController();
  private active: boolean = false;
  private generation: number = 0;

  @Computed get activeTab(): XopcCapabilityTabState {
    return this.tabs[Math.max(0, categories.indexOf(this.category))];
  }

  aboutToAppear(): void {
    this.active = true;
    this.category = appSettings.pageSelection('capabilities', categories, 'plugins');
    this.loadNearby(Math.max(0, categories.indexOf(this.category)));
  }

  aboutToDisappear(): void {
    this.active = false;
    this.generation++;
    this.tabs.forEach((tab: XopcCapabilityTabState): void => { tab.loading = false; });
  }

  private async load(tab: XopcCapabilityTabState, refresh: boolean = false): Promise<void> {
    if (!this.active || tab.key === 'devices' || tab.loading || (!refresh && (tab.catalog !== undefined || tab.failed))) return;
    const generation = this.generation;
    tab.loading = true;
    tab.failed = false;
    try {
      const result = await loadCapabilities(tab.key);
      if (generation === this.generation) tab.catalog = result;
    } catch (_) {
      if (generation === this.generation) tab.failed = true;
    } finally {
      if (generation === this.generation) tab.loading = false;
    }
  }

  private loadNearby(index: number): void {
    void this.load(this.tabs[index]);
    if (index > 0) void this.load(this.tabs[index - 1]);
    if (index + 1 < this.tabs.length) void this.load(this.tabs[index + 1]);
  }

  private select(category: string): void {
    const target = categories.indexOf(category);
    if (target < 0 || this.detailOpen) return;
    const distance = Math.abs(target - categories.indexOf(this.category));
    this.swiper.changeIndex(target, !this.layout.reduceMotion && distance === 1);
  }

  private commitPage(index: number): void {
    const next = categories[index];
    if (!next || next === this.category) return;
    this.getUIContext().getFocusController().clearFocus();
    this.hoveredItemId = '';
    this.clearHovered = false;
    this.category = next;
    appSettings.rememberPageSelection('capabilities', next);
    this.loadNearby(index);
  }

  private updateQuery(tab: XopcCapabilityTabState, value: string): void {
    if (tab.query === value) return;
    tab.query = value;
    tab.scroller.scrollTo({ xOffset: 0, yOffset: 0 });
  }

  private title(category: string): Resource {
    if (category === 'skills') return $r('app.string.capability_skills');
    if (category === 'connections') return $r('app.string.capability_connections');
    if (category === 'devices') return $r('app.string.device_connection_devices');
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

  private openSkillMarket(): void {
    this.getUIContext().getFocusController().clearFocus();
    this.detail = { id: 'marketplace:search', name: this.getLabel($r('app.string.cap_native_skill')), group: 'available' };
    this.detailExpanded = false;
    this.detailOpen = true;
  }

  private setupLabel(): Resource {
    if (this.category === 'agents') return $r('app.string.capability_create_agent');
    if (this.category === 'skills') return $r('app.string.capability_create_skill');
    return $r('app.string.cap_native_mcp');
  }

  private startSetup(): void {
    if (this.category === 'connections') {
      this.showDetail({ id: 'mcp:setup', name: this.getLabel(this.setupLabel()), group: 'available' });
      return;
    }
    this.getUIContext().getFocusController().clearFocus();
    const prompt = this.category === 'agents' ? $r('app.string.capability_agent_setup_prompt')
      : $r('app.string.capability_skill_setup_prompt');
    this.onSetupChat(this.getLabel(prompt), this.category === 'agents');
  }

  private matches(tab: XopcCapabilityTabState): XopcCapabilityItem[] {
    if (!tab.catalog) return [];
    let rows = tab.catalog.items;
    const personal = this.personal;
    if (tab.key === 'agents') {
      rows = rows.map((item: XopcCapabilityItem): XopcCapabilityItem => {
        const agent: XopcChatAgent = { id: item.id, name: item.name, description: item.description, avatar: item.avatar };
        return { id: item.id, name: this.getLabel(agentDisplayName(agent)),
          description: this.getLabel(agentDisplayDescription(agent)), group: item.group, avatar: item.avatar, iconUrl: item.iconUrl };
      });
    }
    if (tab.key === 'agents' && personal?.state === 'ready') {
      const own: XopcCapabilityItem = { id: personal.agentId, name: personal.displayName,
        description: this.getLabel($r('app.string.capability_personal_description')), group: 'assistant' };
      rows = [own].concat(rows.filter((item: XopcCapabilityItem): boolean => item.id !== own.id));
    }
    const query = tab.query.trim().toLowerCase();
    return rows.filter((item: XopcCapabilityItem): boolean =>
      [item.name, item.id, item.description ?? ''].some((value: string): boolean => value.toLowerCase().includes(query)));
  }

  private rows(tab: XopcCapabilityTabState, group: string): XopcCapabilityItem[] {
    return this.matches(tab).filter((item: XopcCapabilityItem): boolean => item.group === group);
  }

  private categoryOptions(): XopcPageTitleOption[] {
    return categories.map((key: string): XopcPageTitleOption => ({
      key, label: this.title(key), id: 'capability-category-' + key
    }));
  }

  @Builder
  icon(item: XopcCapabilityItem, kind: string) {
    if (kind === 'agents') {
      XopcPersonalAgentAvatar({ agentId: item.id, extent: 48, compact: true, activePage: false,
        appearance: this.personal?.agentId === item.id ? this.personal?.appearance ?? 'loopi' : 'configured',
        revision: this.personal?.agentId === item.id ? this.personal?.revision ?? 0 : 0,
        avatarReference: item.avatar ?? '', fallbackLabel: item.name })
    } else {
      XopcCapabilityLogo({ category: kind, iconUrl: item.iconUrl ?? '', label: item.name })
    }
  }

  private showDetail(item: XopcCapabilityItem): void {
    this.getUIContext().getFocusController().clearFocus();
    this.detail = item;
    this.detailExpanded = false;
    this.detailOpen = true;
  }

  @Builder
  private itemContent(item: XopcCapabilityItem, kind: string) {
    this.icon(item, kind)
    XopcCapabilityCardText({ title: item.name, description: item.description ?? '' }).layoutWeight(1)
  }

  @Builder
  itemRow(item: XopcCapabilityItem, kind: string) {
    Row() {
      Button({ type: ButtonType.Normal }) {
        Row({ space: CAPABILITY_CARD_GAP }) {
          this.itemContent(item, kind)
          if (kind === 'connections' && (item.group === 'available' || item.group === 'attention')) {
            Text($r('app.string.capability_connect')).fontSize(14).fontColor(this.colors.chat.action)
          } else if (kind !== 'agents') {
            SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.tertiary])
          }
        }.width('100%').constraintSize({ minHeight: CAPABILITY_CARD_HEIGHT }).padding(CAPABILITY_CARD_PADDING)
      }.layoutWeight(1).padding(0)
        .backgroundColor(this.hoveredItemId === item.id && (kind !== 'agents' || item.group !== 'disabled')
          ? this.colors.hoverOverlay : Color.Transparent)
        .animation({ duration: this.layout.reduceMotion ? 0 : 120, curve: Curve.EaseOut })
        .id('capability-row-' + item.id)
        .borderRadius(this.colors.corner(CAPABILITY_CARD_CORNER)).clipShape(this.colors.cornerClip(CAPABILITY_CARD_CORNER))
        .hoverEffect(HoverEffect.None).stateEffect(true)
        .onHover((hovering: boolean): void => {
          if (hovering) this.hoveredItemId = item.id;
          else if (this.hoveredItemId === item.id) this.hoveredItemId = '';
        })
        .enabled(kind !== 'agents' || item.group !== 'disabled')
        .onClick((): void => {
          if (kind !== this.category) return;
          if (kind === 'agents') {
            this.getUIContext().getFocusController().clearFocus();
            this.onOpenAgent(item.id, item.id === this.personal?.agentId);
          } else this.showDetail(item);
        }, SEGMENTED_PAGE_TAP_SLOP_VP)
      if (kind === 'agents') {
        Button({ type: ButtonType.Circle }) {
          Text('⋯').fontSize(22).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary)
        }.width(44).height(44).padding(0).margin({ right: 8 }).backgroundColor(Color.Transparent)
          .id('capability-settings-' + item.id)
          .accessibilityText(this.getLabel($r('app.string.settings')) + ' · ' + item.name)
          .stateEffect(true).onClick((): void => {
            if (kind === this.category) this.showDetail(item);
          }, SEGMENTED_PAGE_TAP_SLOP_VP)
      }
    }.width('100%').backgroundColor(this.colors.panel).borderRadius(this.colors.corner(CAPABILITY_CARD_CORNER))
      .clipShape(this.colors.cornerClip(CAPABILITY_CARD_CORNER))
  }

  @Builder
  detailSheet() {
    if (this.detail) {
      XopcCapabilityPanelView({ category: this.category, itemId: this.detail.targetId && this.category !== 'connections'
        ? this.detail.targetId : this.detail.id, itemName: this.detail.name, description: this.detail.description ?? '',
        iconUrl: this.detail.iconUrl ?? '', avatarReference: this.detail.avatar ?? '',
        appearance: this.detail.id === this.personal?.agentId ? this.personal?.appearance ?? 'loopi' : 'configured',
        avatarRevision: this.detail.id === this.personal?.agentId ? this.personal?.revision ?? 0 : 0,
        onClose: (): void => { this.detailOpen = false; },
        onExpandedChange: (expanded: boolean): void => { this.detailExpanded = expanded; },
        onChanged: (): void => {
          void this.load(this.activeTab, true);
          if (this.detail?.id && this.detail.id === this.personal?.agentId) this.onPersonalChanged();
        },
        onUseInChat: (prompt: string): void => {
          this.pendingChatPrompt = prompt;
          this.detailOpen = false;
        } })
    }
  }

  @Builder
  header() {
    Stack({ alignContent: Alignment.Center }) {
      Row({ space: 8 }) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.arrow_left')).fontSize(20).fontColor([this.colors.foreground])
        }.id('capability-back').width(44).height(44).padding(0).backgroundColor(this.colors.panel)
          .accessibilityText($r('app.string.back')).onClick((): void => { this.onExit(); })
        Blank().layoutWeight(1)
        if (this.category === 'skills') {
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(21).fontColor([this.colors.chat.action])
          }.id('cap-native-open-skills').width(44).height(44).padding(0).backgroundColor(this.colors.accentSoft)
            .accessibilityText($r('app.string.cap_native_skill')).onClick((): void => { this.openSkillMarket(); })
        } else if (this.category === 'plugins') {
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(21).fontColor([this.colors.chat.action])
          }.id('cap-native-open-plugins').width(44).height(44).padding(0).backgroundColor(this.colors.accentSoft)
            .accessibilityText($r('app.string.capability_search_plugins'))
            .onClick((): void => { this.getUIContext().getFocusController().requestFocus('capability-search'); })
        }
        if (this.category === 'skills' || this.category === 'agents' || this.category === 'connections') {
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.plus')).fontSize(21).fontColor([this.colors.chat.action])
          }.id(this.category === 'connections' ? 'capability-add-mcp' : 'capability-chat-setup-' + this.category)
            .width(44).height(44).padding(0).backgroundColor(this.colors.accentSoft)
            .accessibilityText(this.setupLabel()).onClick((): void => { this.startSetup(); })
        }
      }.width('100%').height(44)
      XopcPageTitleMenu({ heading: this.title(this.category), options: this.categoryOptions(), selected: this.category,
        menuId: 'capability-page-menu', onSelect: (key: string): void => { this.select(key); } })
        .constraintSize({ maxWidth: '48%' })
    }.width('100%').padding({ top: 8, bottom: 8 })
  }

  build() {
    Column() {
      this.header()
      Swiper(this.swiper) {
        ForEach(this.tabs, (tab: XopcCapabilityTabState) => {
          Column() {
            if (tab.key === 'devices') {
              Column() {
                XopcDeviceConnectionsView({ laneActive: this.category === 'devices',
                  onUseChat: (id: string): void => { this.onDeviceChat(id); },
                  onShareFile: (attachment: XopcChatAttachment): Promise<void> => this.onDeviceFile(attachment),
                  onLocalTool: (tool: string): void => {
                    const prompt = tool === 'mobile.contacts.pick' ? $r('app.string.device_connection_contact_prompt')
                      : tool === 'mobile.calendar.query_events' ? $r('app.string.device_connection_calendar_prompt')
                      : $r('app.string.device_connection_location_prompt');
                    this.onSetupChat(this.getLabel(prompt), false);
                  } })
              }.layoutWeight(1).width('100%')
            } else {
              this.catalogList(tab)
            }
          }.width('100%').height('100%').accessibilityLevel(tab.key === this.category ? 'auto' : 'no-hide-descendants')
        }, (tab: XopcCapabilityTabState): string => tab.key)
      }.id('capability-pager').index(Math.max(0, categories.indexOf(this.category))).loop(false).indicator(false).cachedCount(4)
        .duration(this.layout.reduceMotion ? 0 : 230).disableSwipe(this.detailOpen)
        .onChange((index: number): void => { this.commitPage(index); })
        .width('100%').layoutWeight(1)
      if (this.category !== 'devices') {
        this.searchField()
      }
    }.width('100%').height('100%').padding({ left: 18, right: 18 }).backgroundColor(this.colors.surface)
      .bindSheet($$this.detailOpen, this.detailSheet, { height: capabilityDrawerHeight(this.detailExpanded), dragBar: true,
        showClose: false, backgroundColor: this.colors.surface, onDisappear: (): void => {
          const prompt = this.pendingChatPrompt;
          this.pendingChatPrompt = '';
          if (prompt) this.onSetupChat(prompt, false);
        } })
  }

  @Builder
  catalogList(tab: XopcCapabilityTabState) {
    List({ space: 10, scroller: tab.scroller }) {
      if (!tab.failed && !tab.catalog) { ListItem() { XopcListSkeleton() }.id('capability-loading') }
      if (tab.failed || tab.catalog?.incomplete) {
        ListItem() {
          Row() {
            Text(tab.failed ? $r('app.string.capability_load_failed') : $r('app.string.capability_partial'))
              .fontSize(14).fontColor(this.colors.secondary).layoutWeight(1)
            Button($r('app.string.capability_retry')).height(44).backgroundColor(this.colors.accentSoft)
              .fontColor(this.colors.chat.action).enabled(!tab.loading).onClick((): void => { void this.load(tab, true); })
          }.width('100%').padding({ left: 14, right: 12, top: 8, bottom: 8 })
            .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(16))
        }
      }
      if (tab.catalog && !tab.loading && !tab.failed && !this.matches(tab).length) {
        ListItem() {
          Column({ space: 10 }) {
            SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(24).fontColor([this.colors.secondary])
            Text(tab.query.trim() ? $r('app.string.capability_no_matches') : $r('app.string.capability_empty'))
              .fontSize(16).fontColor(this.colors.foreground)
            if (tab.query) Button($r('app.string.capability_clear')).height(44).backgroundColor(this.colors.accentSoft)
              .fontColor(this.colors.chat.action).onClick((): void => { this.updateQuery(tab, ''); })
          }.id('capability-empty').width('100%').padding({ top: 56 })
        }
      }
      ForEach(groups, (group: string) => {
        if (this.rows(tab, group).length) {
          ListItem() {
            Text(this.groupTitle(group)).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary)
              .padding({ left: 4, top: 14, bottom: 2 })
          }
          ForEach(this.rows(tab, group), (item: XopcCapabilityItem) => {
            ListItem() { this.itemRow(item, tab.key) }
          }, (item: XopcCapabilityItem): string => item.id + ':' + item.name + ':' + (item.description ?? '')
            + ':' + (item.avatar ?? '') + ':' + (item.iconUrl ?? '').slice(-64))
        }
      }, (group: string): string => group)
    }.width('100%').layoutWeight(1).scrollBar(BarState.Off).margin({ top: 4 })
  }

  @Builder
  searchField() {
    Row({ space: 8 }) {
      SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(19).fontColor([this.colors.secondary])
      TextInput({ text: this.activeTab.query, placeholder: this.category === 'skills' ? $r('app.string.capability_search_installed_skills')
        : $r('app.string.capability_search', this.getLabel(this.title(this.category))) })
        .id('capability-search').layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent)
        .fontColor(this.colors.foreground).placeholderColor(this.colors.tertiary)
        .maxLength(160).enterKeyType(EnterKeyType.Search)
        .onChange((value: string): void => { this.updateQuery(this.activeTab, value); })
        .onSubmit((): void => { this.getUIContext().getFocusController().clearFocus(); })
      if (this.activeTab.query) Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.xmark')).fontSize(17).fontColor([this.colors.secondary])
      }.id('capability-search-clear').width(44).height(44).padding(0)
        .backgroundColor(this.clearHovered ? this.colors.hoverOverlay : Color.Transparent)
        .hoverEffect(HoverEffect.None).stateEffect(true)
        .onHover((hovering: boolean): void => { this.clearHovered = hovering; })
        .accessibilityText($r('app.string.capability_clear')).onClick((): void => { this.updateQuery(this.activeTab, ''); })
    }.width('100%').padding({ left: 16, right: 6 })
      .backgroundColor(this.colors.input).borderRadius(this.colors.corner(24))
      .margin({ top: 14, bottom: 10 })
  }
}
