import { agentDisplayDescription, agentDisplayName } from '../common/agentPresentation';
import { nameCapabilityPrompt } from '../common/capabilityText';
import { XOPC_PAGE_PADDING_X, xopcMoreIcon } from '../common/designTokens';
import { xopcSheetOptions } from '../common/dialogActions';
import {
  XOPC_MOTION_MICRO_MS,
  xopcClickEffect,
  xopcMotionDuration,
} from '../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatAttachment, XopcChatAgent } from '../model/chat';
import { XopcPersonalAgentRecord } from '../model/personalAgent';
import { loadCapabilities, XopcCapabilityItem, XopcCapabilityPage } from '../repository/capabilitiesRepository';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { CAPABILITY_CARD_CORNER, CAPABILITY_CARD_GAP, CAPABILITY_CARD_HEIGHT, CAPABILITY_CARD_PADDING,
  XopcCapabilityCardText } from './CapabilityCard';
import { XopcCapabilityLogo } from './CapabilityLogo';
import { capabilityDrawerHeight, XopcCapabilityPanelView } from './CapabilityPanelView';
import { XopcDeviceConnectionsView } from './DeviceConnectionsView';
import {
  XopcEmptyHint,
  XopcErrorState,
  XopcInlineBanner,
  XopcListSkeleton,
  XopcPageHeader,
  XopcPageSearchField,
} from './MobileComponents';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';

const categories: string[] = ['plugins', 'skills', 'connections', 'devices', 'agents', 'channels'];
const groups: string[] = ['attention', 'assistant', 'expert', 'connected', 'installed', 'configured', 'disabled', 'available'];

@ComponentV2
export struct XopcCapabilitiesView {
  @Param personal: XopcPersonalAgentRecord | null = null;
  @Param initialCategory: string = '';
  @Event onExit: () => void = (): void => {};
  @Event onOpenAgent: (id: string, personal: boolean) => void = (_id: string, _personal: boolean): void => {};
  @Event onPersonalChanged: () => void = (): void => {};
  @Event onSetupChat: (prompt: string, agentSetup: boolean) => void = (_prompt: string, _agentSetup: boolean): void => {};
  @Event onDeviceChat: (id: string) => void = (_id: string): void => {};
  @Event onDeviceFile: (attachment: XopcChatAttachment) => Promise<void> = async (_attachment: XopcChatAttachment): Promise<void> => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Local category: string = 'plugins';
  @Local query: string = '';
  @Local loading: boolean = false;
  @Local failed: boolean = false;
  @Local catalog?: XopcCapabilityPage;
  @Local detail?: XopcCapabilityItem;
  @Local detailOpen: boolean = false;
  @Local detailExpanded: boolean = false;
  @Local hoveredItemId: string = '';
  @Local searchOpen: boolean = false;
  private pendingChatPrompt: string = '';
  private scroller: Scroller = new Scroller();
  private active: boolean = false;
  private generation: number = 0;

  @Computed get hasSearchButton(): boolean {
    return this.category !== 'devices' && this.category !== 'skills';
  }

  aboutToAppear(): void {
    this.active = true;
    const requested = this.initialCategory && categories.includes(this.initialCategory) ? this.initialCategory : '';
    this.category = requested || 'plugins';
    void this.load();
  }

  aboutToDisappear(): void {
    this.active = false;
    this.generation++;
    this.loading = false;
  }

  private async load(refresh: boolean = false): Promise<void> {
    if (!this.active || this.category === 'devices' || this.loading || (!refresh && (this.catalog !== undefined || this.failed))) return;
    const generation = this.generation;
    const targetCategory = this.category;
    this.loading = true;
    this.failed = false;
    try {
      const result = await loadCapabilities(targetCategory);
      if (generation === this.generation && this.category === targetCategory) this.catalog = result;
    } catch (_) {
      if (generation === this.generation && this.category === targetCategory) this.failed = true;
    } finally {
      if (generation === this.generation && this.category === targetCategory) this.loading = false;
    }
  }

  private closeSearch(): void {
    if (this.searchOpen) this.getUIContext().getFocusController().clearFocus();
    this.searchOpen = false;
    if (this.query) this.updateQuery('');
  }

  private toggleSearch(): void {
    if (this.searchOpen) this.closeSearch();
    else this.searchOpen = true;
  }

  private updateQuery(value: string): void {
    if (this.query === value) return;
    this.query = value;
    this.scroller.scrollTo({ xOffset: 0, yOffset: 0 });
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

  private matches(): XopcCapabilityItem[] {
    if (!this.catalog) return [];
    let rows = this.catalog.items;
    const personal = this.personal;
    if (this.category === 'agents') {
      rows = rows.map((item: XopcCapabilityItem): XopcCapabilityItem => {
        const agent: XopcChatAgent = { id: item.id, name: item.name, description: item.description, avatar: item.avatar };
        return { id: item.id, name: this.getLabel(agentDisplayName(agent)),
          description: this.getLabel(agentDisplayDescription(agent)), group: item.group, avatar: item.avatar, iconUrl: item.iconUrl };
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
    return this.matches().filter((item: XopcCapabilityItem): boolean => item.group === group);
  }

  @Builder
  icon(item: XopcCapabilityItem) {
    if (this.category === 'agents') {
      XopcPersonalAgentAvatar({ agentId: item.id, extent: 48, compact: true, activePage: false,
        appearance: this.personal?.agentId === item.id ? this.personal?.appearance ?? 'loopi' : 'configured',
        revision: this.personal?.agentId === item.id ? this.personal?.revision ?? 0 : 0,
        avatarReference: item.avatar ?? '', fallbackLabel: item.name })
    } else {
      XopcCapabilityLogo({ category: this.category, iconUrl: item.iconUrl ?? '', label: item.name })
    }
  }

  private showDetail(item: XopcCapabilityItem): void {
    this.getUIContext().getFocusController().clearFocus();
    this.detail = item;
    this.detailExpanded = false;
    this.detailOpen = true;
  }

  @Builder
  private itemContent(item: XopcCapabilityItem) {
    this.icon(item)
    XopcCapabilityCardText({ title: item.name, description: item.description ?? '' }).layoutWeight(1)
  }

  @Builder
  itemRow(item: XopcCapabilityItem) {
    Row() {
      Button({ type: ButtonType.Normal }) {
        Row({ space: CAPABILITY_CARD_GAP }) {
          this.itemContent(item)
          if (this.category === 'connections' && (item.group === 'available' || item.group === 'attention')) {
            Text($r('app.string.capability_connect')).fontSize(14).fontColor(this.colors.chat.action)
          } else if (this.category !== 'agents') {
            SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.tertiary])
          }
        }.width('100%').constraintSize({ minHeight: CAPABILITY_CARD_HEIGHT }).padding(CAPABILITY_CARD_PADDING)
      }.layoutWeight(1).padding(0)
        .backgroundColor(this.hoveredItemId === item.id && (this.category !== 'agents' || item.group !== 'disabled')
          ? this.colors.hoverOverlay : Color.Transparent)
        .animation({ duration: xopcMotionDuration(XOPC_MOTION_MICRO_MS, this.layout.reduceMotion), curve: Curve.EaseOut })
        .id('capability-row-' + item.id)
        .borderRadius(this.colors.corner(CAPABILITY_CARD_CORNER)).clipShape(this.colors.cornerClip(CAPABILITY_CARD_CORNER))
        .hoverEffect(HoverEffect.None).stateEffect(true).clickEffect(xopcClickEffect())
        .onHover((hovering: boolean): void => {
          if (hovering) this.hoveredItemId = item.id;
          else if (this.hoveredItemId === item.id) this.hoveredItemId = '';
        })
        .enabled(this.category !== 'agents' || item.group !== 'disabled')
        .onClick((): void => {
          if (this.category === 'agents') {
            this.getUIContext().getFocusController().clearFocus();
            this.onOpenAgent(item.id, item.id === this.personal?.agentId);
          } else this.showDetail(item);
        })
      if (this.category === 'agents') {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph(xopcMoreIcon()).fontSize(20).fontColor([this.colors.secondary])
        }.width(44).height(44).padding(0).margin({ right: 8 }).backgroundColor(Color.Transparent)
          .id('capability-settings-' + item.id)
          .accessibilityText(this.getLabel($r('app.string.settings')) + ' · ' + item.name)
          .clickEffect(xopcClickEffect())
          .stateEffect(true).onClick((): void => {
            this.showDetail(item);
          })
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
          void this.load(true);
          if (this.detail?.id && this.detail.id === this.personal?.agentId) this.onPersonalChanged();
        },
        onUseInChat: (prompt: string): void => {
          this.pendingChatPrompt = this.detail ? nameCapabilityPrompt(prompt, this.detail.id, this.detail.name) : prompt;
          this.detailOpen = false;
        } })
    }
  }

  @Builder
  header() {
    XopcPageHeader({
      heading: this.title(this.category),
      showStaticTitle: true,
      backVisible: true,
      backId: 'capability-back',
      onBack: (): void => { if (this.hasSearchButton && this.searchOpen) this.closeSearch(); else this.onExit(); },
      searchId: this.hasSearchButton ? 'capability-open-search' : '',
      searchOpen: this.searchOpen,
      onSearch: (): void => { this.toggleSearch(); },
      secondaryActionLabel: this.category === 'skills' ? $r('app.string.cap_native_skill') : '',
      secondaryActionIcon: $r('sys.symbol.square_grid_2x2'),
      secondaryActionId: 'cap-native-open-skills',
      secondaryActionTone: 'accent',
      onSecondaryAction: (): void => { this.openSkillMarket(); },
      actionLabel: this.category === 'skills' || this.category === 'agents' || this.category === 'connections' ? this.setupLabel() : '',
      actionIcon: $r('sys.symbol.plus'),
      actionId: this.category === 'connections' ? 'capability-add-mcp' : 'capability-chat-setup-' + this.category,
      actionTone: 'accent',
      onAction: (): void => { this.startSetup(); },
    })
  }

  build() {
    Column() {
      this.header()
      if (this.category === 'skills' || (this.hasSearchButton && this.searchOpen)) {
        Column() {
          XopcPageSearchField({
            searchId: 'capability-search',
            text: this.query,
            placeholder: this.category === 'skills' ? $r('app.string.capability_search_installed_skills')
              : $r('app.string.capability_search', this.getLabel(this.title(this.category))),
            autoFocus: this.hasSearchButton,
            onChange: (value: string): void => { this.updateQuery(value); },
            onSubmit: (): void => { this.getUIContext().getFocusController().clearFocus(); },
          })
        }.width('100%').padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X, bottom: 8 })
      }
      Column() {
        if (this.category === 'devices') {
          Column() {
            XopcDeviceConnectionsView({ laneActive: true,
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
          this.catalogList()
        }
      }.id('capability-catalog-' + this.category).width('100%').layoutWeight(1)
        .padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X })
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
      .bindSheet($$this.detailOpen, this.detailSheet, xopcSheetOptions('large', {
        height: capabilityDrawerHeight(this.detailExpanded),
        backgroundColor: this.colors.surface,
        onDisappear: (): void => {
          const prompt = this.pendingChatPrompt;
          this.pendingChatPrompt = '';
          if (prompt) this.onSetupChat(prompt, false);
        },
      }))
  }

  @Builder
  catalogList() {
    Refresh({ refreshing: this.loading && this.catalog !== undefined }) {
      List({ space: 10, scroller: this.scroller }) {
        if (!this.failed && !this.catalog) { ListItem() { XopcListSkeleton() }.id('capability-loading') }
        if (this.failed && !this.catalog) {
          ListItem() {
            XopcErrorState({ error: 'LOAD_FAILED', context: 'collection',
              actionLabel: $r('app.string.capability_retry'),
              onAction: (): void => { void this.load(true); } })
          }
        } else if (this.failed || this.catalog?.incomplete) {
          ListItem() {
            XopcInlineBanner({
              message: this.failed ? $r('app.string.capability_load_failed') : $r('app.string.capability_partial'),
              actionLabel: $r('app.string.capability_retry'),
              busy: this.loading,
              onAction: (): void => { void this.load(true); },
            })
          }
        }
        if (this.catalog && !this.loading && !this.failed && !this.matches().length) {
          ListItem() {
            XopcEmptyHint({
              message: this.query.trim() ? $r('app.string.capability_no_matches') : $r('app.string.capability_empty'),
              actionLabel: this.query ? $r('app.string.capability_clear') : '',
              centered: true,
              onAction: (): void => { this.updateQuery(''); },
            }).id('capability-empty')
          }
        }
        ForEach(groups, (group: string) => {
          if (this.rows(group).length) {
            ListItem() {
              Text(this.groupTitle(group)).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary)
                .padding({ left: 4, top: 14, bottom: 2 })
            }
            ForEach(this.rows(group), (item: XopcCapabilityItem) => {
              ListItem() { this.itemRow(item) }
            }, (item: XopcCapabilityItem): string => item.id + ':' + item.name + ':' + (item.description ?? '')
              + ':' + (item.avatar ?? '') + ':' + (item.iconUrl ?? '').slice(-64))
          }
        }, (group: string): string => group)
      }.width('100%').height('100%').scrollBar(BarState.Off).margin({ top: 4 })
    }.width('100%').layoutWeight(1).pullToRefresh(!this.loading).onRefreshing((): void => { void this.load(true); })
  }
}
