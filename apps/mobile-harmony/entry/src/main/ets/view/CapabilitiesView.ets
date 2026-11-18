import { appSettings } from '../service/settings';
import { SEGMENTED_PAGE_TAP_SLOP_VP } from './SegmentedTabs';
import { agentDisplayDescription, agentDisplayName } from '../common/agentPresentation';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatAgent } from '../model/chat';
import { XopcPersonalAgentRecord } from '../model/personalAgent';
import { loadCapabilities, XopcCapabilityItem, XopcCapabilityPage } from '../repository/capabilitiesRepository';
import { XopcListSkeleton, XopcPageTitleMenu, XopcPageTitleOption } from './MobileComponents';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { XopcCapabilityPanelView } from './CapabilityPanelView';
import { XopcCapabilityLogo } from './CapabilityLogo';

const categories: string[] = ['plugins', 'skills', 'connections', 'agents', 'channels'];
const groups: string[] = ['attention', 'assistant', 'expert', 'connected', 'installed', 'configured', 'disabled', 'available'];

@ComponentV2
export struct XopcCapabilitiesView {
  @Param personal: XopcPersonalAgentRecord | null = null;
  @Event onExit: () => void = (): void => {};
  @Event onOpenAgent: (id: string, personal: boolean) => void = (_id: string, _personal: boolean): void => {};
  @Event onPersonalChanged: () => void = (): void => {};
  @Event onSetupChat: (prompt: string, agentSetup: boolean) => void = (_prompt: string, _agentSetup: boolean): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local category: string = 'plugins';
  @Local query: string = '';
  @Local loading: boolean = true;
  @Local failed: boolean = false;
  @Local catalog?: XopcCapabilityPage;
  @Local detail?: XopcCapabilityItem;
  @Local detailOpen: boolean = false;
  private pendingChatPrompt: string = '';
  private pages: Map<string, XopcCapabilityPage> = new Map<string, XopcCapabilityPage>();
  private scroller: Scroller = new Scroller();
  private generation: number = 0;

  aboutToAppear(): void {
    this.category = appSettings.pageSelection('capabilities', categories, 'plugins');
    void this.load();
  }
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
    appSettings.rememberPageSelection('capabilities', category);
    this.catalog = this.pages.get(category);
    this.scroller.scrollTo({ xOffset: 0, yOffset: 0 });
    void this.load();
  }

  private swipeCategory(event: GestureEvent): void {
    if (this.detailOpen || Math.abs(event.offsetX) < 40
      || Math.abs(event.offsetX) < Math.abs(event.offsetY) * 1.25) return;
    const next = categories[categories.indexOf(this.category) + (event.offsetX < 0 ? 1 : -1)];
    if (next) this.select(next);
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

  private openSkillMarket(): void {
    this.getUIContext().getFocusController().clearFocus();
    this.detail = { id: 'marketplace:search', name: this.getLabel($r('app.string.cap_native_skill')), group: 'available' };
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

  @Computed get matches(): XopcCapabilityItem[] {
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
    return this.matches.filter((item: XopcCapabilityItem): boolean => item.group === group);
  }

  private categoryOptions(): XopcPageTitleOption[] {
    return categories.map((key: string): XopcPageTitleOption => ({
      key, label: this.title(key), id: 'capability-category-' + key
    }));
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
    this.detailOpen = true;
  }

  @Builder
  private itemContent(item: XopcCapabilityItem) {
    this.icon(item)
    Column({ space: 4 }) {
      Text(item.name).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      if (item.description) Text(item.description).fontSize(13).lineHeight(18).fontColor(this.colors.secondary)
        .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
  }

  @Builder
  itemRow(item: XopcCapabilityItem) {
    Row() {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 14 }) {
          this.itemContent(item)
          if (this.category === 'connections' && (item.group === 'available' || item.group === 'attention')) {
            Text($r('app.string.capability_connect')).fontSize(14).fontColor(this.colors.chat.action)
          } else if (this.category !== 'agents') {
            SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.tertiary])
          }
        }.width('100%').constraintSize({ minHeight: 76 }).padding({ left: 14, right: 14, top: 12, bottom: 12 })
      }.layoutWeight(1).padding(0).backgroundColor(Color.Transparent).id('capability-row-' + item.id)
        .enabled(this.category !== 'agents' || item.group !== 'disabled')
        .onClick((): void => {
          if (this.category === 'agents') {
            this.getUIContext().getFocusController().clearFocus();
            this.onOpenAgent(item.id, item.id === this.personal?.agentId);
          } else this.showDetail(item);
        }, SEGMENTED_PAGE_TAP_SLOP_VP)
      if (this.category === 'agents') {
        Button({ type: ButtonType.Circle }) {
          Text('⋯').fontSize(22).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary)
        }.width(44).height(44).padding(0).margin({ right: 8 }).backgroundColor(Color.Transparent)
          .id('capability-settings-' + item.id)
          .accessibilityText(this.getLabel($r('app.string.settings')) + ' · ' + item.name)
          .onClick((): void => { this.showDetail(item); }, SEGMENTED_PAGE_TAP_SLOP_VP)
      }
    }.width('100%').backgroundColor(this.colors.panel).borderRadius(this.colors.corner(18))
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
        onChanged: (): void => {
          void this.load();
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
      XopcPageTitleMenu({ heading: this.title(this.category), selected: this.category,
        options: this.categoryOptions(), menuId: 'capability-title',
        onSelect: (key: string): void => { this.select(key); } }).constraintSize({ maxWidth: '48%' })
    }.width('100%').padding({ top: 8, bottom: 8 })
  }

  build() {
    Column() {
      this.header()
      Column() {
        this.catalogList()
      }.width('100%').layoutWeight(1)
        .priorityGesture(PanGesture({ direction: PanDirection.Horizontal, distance: 8 })
          .onActionEnd((event: GestureEvent): void => { this.swipeCategory(event); }))
      this.searchField()
    }.width('100%').height('100%').padding({ left: 18, right: 18 }).backgroundColor(this.colors.surface)
      .bindSheet($$this.detailOpen, this.detailSheet, { height: '88%', dragBar: true,
        showClose: false, backgroundColor: this.colors.surface, onDisappear: (): void => {
          const prompt = this.pendingChatPrompt;
          this.pendingChatPrompt = '';
          if (prompt) this.onSetupChat(prompt, false);
        } })
  }

  @Builder
  catalogList() {
    List({ space: 10, scroller: this.scroller }) {
      if (this.loading && !this.catalog) { ListItem() { XopcListSkeleton() } }
      if (this.failed || this.catalog?.incomplete) {
        ListItem() {
          Row() {
            Text(this.failed ? $r('app.string.capability_load_failed') : $r('app.string.capability_partial'))
              .fontSize(14).fontColor(this.colors.secondary).layoutWeight(1)
            Button($r('app.string.capability_retry')).height(44).backgroundColor(this.colors.accentSoft)
              .fontColor(this.colors.chat.action).enabled(!this.loading).onClick((): void => { void this.load(); })
          }.width('100%').padding({ left: 14, right: 12, top: 8, bottom: 8 })
            .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(16))
        }
      }
      if (!this.loading && !this.failed && !this.matches.length) {
        ListItem() {
          Column({ space: 10 }) {
            SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(24).fontColor([this.colors.secondary])
            Text(this.query.trim() ? $r('app.string.capability_no_matches') : $r('app.string.capability_empty'))
              .fontSize(16).fontColor(this.colors.foreground)
            if (this.query) Button($r('app.string.capability_clear')).height(44).backgroundColor(this.colors.accentSoft)
              .fontColor(this.colors.chat.action).onClick((): void => { this.query = ''; })
          }.id('capability-empty').width('100%').padding({ top: 56 })
        }
      }
      ForEach(groups, (group: string) => {
        if (this.rows(group).length) {
          ListItem() {
            Text(this.groupTitle(group)).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary)
              .padding({ left: 4, top: 14, bottom: 2 })
          }
          ForEach(this.rows(group), (item: XopcCapabilityItem) => {
            ListItem() { this.itemRow(item) }
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
      TextInput({ text: this.query, placeholder: this.category === 'skills' ? $r('app.string.capability_search_installed_skills')
        : $r('app.string.capability_search', this.getLabel(this.title(this.category))) })
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
      .backgroundColor(this.colors.input).borderRadius(this.colors.corner(24))
      .margin({ top: 14, bottom: 10 })
  }
}
