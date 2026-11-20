import { layoutState, XopcLayoutState } from '../service/layoutState';
import { appSettings } from '../service/settings';
import { SEGMENTED_PAGE_TAP_SLOP_VP, XopcSegmentedTabs } from './SegmentedTabs';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcMobileRoute } from '../model/home';
import { XopcUnderstandingItem, XopcUnderstandingProfile, XopcUnderstandingRule, XopcWorkMemoryItem } from '../model/userUnderstanding';
import { XopcUserUnderstandingViewModel } from '../viewmodel/userUnderstandingViewModel';
import { XopcBrandLoading, XopcListSkeleton, XopcPageHeader, XopcPageSearchField, XopcPaginationFooter, XopcSectionLabel } from './MobileComponents';
import { userErrorMessage } from '../common/userError';
import { XopcLoopi } from './Loopi';

@ComponentV2
export struct XopcAboutYouView {
  @Param initialId: string = '';
  @Local colors: XopcThemeColors = appThemeColors;
  @Local model: XopcUserUnderstandingViewModel = new XopcUserUnderstandingViewModel();
  @Local section: number = 0;
  @Local layout: XopcLayoutState = layoutState;
  private pager: SwiperController = new SwiperController();
  private sections: string[] = ['overview', 'understanding', 'work'];
  @Local expandedWorkId: string = '';
  @Local pageVisible: boolean = false;
  @Local searchOpen: boolean = false;
  @Local editProfileOpen: boolean = false;
  @Local editingStatement: boolean = false;
  @Local sourcesOpen: boolean = false;
  @Local callName: string = '';
  @Local role: string = '';
  @Local pronouns: string = '';
  @Local timezone: string = '';
  @Local locale: string = '';
  @Local customPronouns: boolean = false;
  @Local statement: string = '';
  @Event onExit: () => void = (): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};

  aboutToAppear(): void { void this.loadInitial(); }
  aboutToDisappear(): void { this.model.dispose(); }

  private async loadInitial(): Promise<void> {
    if (this.initialId) {
      this.section = 1;
      void this.model.refresh();
      await this.model.open(this.initialId);
      return;
    }
    const key = appSettings.pageSelection('privacy-memory', this.sections, 'overview');
    this.section = Math.max(0, this.sections.indexOf(key));
    if (this.section === 2) void this.model.loadWork();
    await this.model.refresh();
    if (this.section === 1 && !this.model.items.length && !this.model.loadingMore) await this.model.load('all');
  }

  private openProfileEditor(): void {
    const profile = this.model.summary?.profile;
    if (!profile) return;
    this.callName = profile.callName;
    this.role = profile.role;
    this.pronouns = profile.pronouns;
    this.timezone = profile.timezone;
    this.locale = profile.locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    this.customPronouns = this.pronouns !== '' && !this.pronounValues().includes(this.pronouns);
    this.editProfileOpen = true;
  }

  private pronounValues(): string[] {
    return ['', this.text($r('app.string.about_you_pronouns_they')),
      this.text($r('app.string.about_you_pronouns_she')), this.text($r('app.string.about_you_pronouns_he'))];
  }

  private pronounOptions(): SelectOption[] {
    const options: SelectOption[] = [];
    const values: string[] = this.pronounValues();
    values.forEach((item: string, index: number): void => {
      options.push({ value: index === 0 ? this.text($r('app.string.about_you_not_set')) : item });
    });
    options.push({ value: this.text($r('app.string.about_you_custom')) });
    return options;
  }

  private pronounIndex(): number {
    if (this.customPronouns) return this.pronounValues().length;
    const index: number = this.pronounValues().indexOf(this.pronouns);
    return index < 0 ? 0 : index;
  }

  private pronounLabel(): string {
    if (this.customPronouns) return this.text($r('app.string.about_you_custom'));
    return this.pronouns || this.text($r('app.string.about_you_not_set'));
  }

  private timezoneValues(): string[] {
    const values: string[] = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore',
      'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'];
    if (this.timezone && !values.includes(this.timezone)) values.unshift(this.timezone);
    return values;
  }

  private timezoneOptions(): SelectOption[] {
    const options: SelectOption[] = [];
    this.timezoneValues().forEach((item: string): void => { options.push({ value: item }); });
    return options;
  }

  private timezoneIndex(): number {
    const index: number = this.timezoneValues().indexOf(this.timezone);
    return index < 0 ? 0 : index;
  }

  private localeOptions(): SelectOption[] {
    return [{ value: this.text($r('app.string.about_you_language_zh')) },
      { value: this.text($r('app.string.about_you_language_en')) }];
  }

  private localeLabel(): ResourceStr {
    return this.locale === 'zh' ? $r('app.string.about_you_language_zh') : $r('app.string.about_you_language_en');
  }

  private emptyTitle(): ResourceStr {
    if (this.model.query.trim()) return $r('app.string.about_you_empty_search_title');
    if (this.model.filter === 'explicit') return $r('app.string.about_you_empty_explicit_title');
    if (this.model.filter === 'learned') return $r('app.string.about_you_empty_learned_title');
    if (this.model.filter === 'review') return $r('app.string.about_you_empty_review_title');
    return $r('app.string.about_you_empty_all_title');
  }

  private async saveProfile(): Promise<void> {
    const profile: XopcUnderstandingProfile = {
      callName: this.callName, role: this.role, pronouns: this.pronouns,
      timezone: this.timezone, locale: this.locale
    };
    await this.model.saveProfile(profile);
    if (!this.model.error) this.editProfileOpen = false;
  }

  private openItem(item: XopcUnderstandingItem): void {
    this.statement = item.statement;
    this.editingStatement = false;
    this.sourcesOpen = false;
    this.model.open(item.id);
  }

  private async saveStatement(): Promise<void> {
    const value = this.statement.trim();
    if (!value) return;
    await this.model.saveStatement(value);
    if (!this.model.error) this.editingStatement = false;
  }

  private confirmDelete(): void {
    this.getUIContext().showAlertDialog({
      title: $r('app.string.about_you_delete_title'),
      message: $r('app.string.about_you_delete_help'),
      primaryButton: { value: $r('app.string.cancel'), action: (): void => {} },
      secondaryButton: { value: $r('app.string.delete'), action: (): void => { this.model.removeSelected(); } }
    });
  }

  private sourceLabel(item: XopcUnderstandingItem): Resource {
    if (['candidate', 'needs_review', 'conflicted'].includes(item.status)) return $r('app.string.about_you_needs_review');
    if (item.authority === 'user_explicit') return $r('app.string.about_you_explicit');
    if (item.authority === 'system_inferred') return $r('app.string.about_you_system_inference');
    if (item.authority === 'external_untrusted') return $r('app.string.about_you_connected');
    return $r('app.string.about_you_learned');
  }

  private scopeLabel(scope: string): Resource {
    if (scope === 'global') return $r('app.string.about_you_scope_global');
    if (scope === 'agent') return $r('app.string.about_you_scope_agent');
    if (scope === 'project') return $r('app.string.about_you_scope_project');
    if (scope === 'workspace') return $r('app.string.about_you_scope_workspace');
    if (scope === 'session') return $r('app.string.about_you_scope_session');
    return $r('app.string.about_you_scope_other');
  }

  private sourceText(item: XopcUnderstandingItem): string {
    if (!item.sources.length) return this.text(this.sourceLabel(item));
    return item.sources.map((source): string => source.label ?? this.text($r('app.string.about_you_system_inference'))).join(' · ');
  }

  private text(resource: Resource): string {
    return this.getUIContext().getHostContext()?.resourceManager.getStringSync(resource.id) ?? '';
  }

  private openConversation(item?: XopcUnderstandingItem): void {
    this.onNavigate({
      page: 'understanding-chat',
      itemId: item?.id ?? '',
      prompt: this.text(item ? $r('app.string.about_you_chat_item_prompt') : $r('app.string.about_you_chat_general_prompt')),
      title: item?.statement ?? '',
      version: item?.recordedAt.toString() ?? ''
    });
  }

  private closeSearch(): void {
    if (this.searchOpen) this.getUIContext().getFocusController().clearFocus();
    this.searchOpen = false;
    if (this.model.query) this.model.search('');
  }

  private selectSection(key: string): void {
    const section = this.sections.indexOf(key);
    if (section < 0 || section === this.section) return;
    this.pager.changeIndex(section, !this.layout.reduceMotion && Math.abs(this.section - section) === 1);
  }

  private commitSection(section: number): void {
    const key = this.sections[section];
    if (!key || section === this.section) return;
    this.closeSearch();
    this.section = section;
    appSettings.rememberPageSelection('privacy-memory', key);
    if (section === 1 && !this.model.items.length) void this.model.load('all');
    if (section === 2) void this.model.loadWork();
  }

  @Builder
  private mainHeader() {
    XopcPageHeader({
      heading: this.section === 0 ? $r('app.string.about_you_overview') : this.section === 1
        ? $r('app.string.about_you_understanding') : $r('app.string.about_you_work_memory'),
      titleOptions: [
        { key: 'overview', label: $r('app.string.about_you_overview'), id: 'about-you-tab-overview' },
        { key: 'understanding', label: $r('app.string.about_you_understanding'), id: 'about-you-tab-understanding' },
        { key: 'work', label: $r('app.string.about_you_work_memory'), id: 'about-you-tab-work' }
      ],
      selectedTitle: this.sections[this.section], titleMenuId: 'about-you-menu',
      onSelectTitle: (key: string): void => { this.selectSection(key); },
      backVisible: true, onBack: (): void => { if (this.searchOpen) this.closeSearch(); else this.onExit(); },
      searchId: this.section === 1 ? 'about-you-search-open' : '', searchOpen: this.searchOpen,
      onSearch: (): void => { if (this.searchOpen) this.closeSearch(); else this.searchOpen = true; }
    })
  }

  @Builder
  private cardTitle(title: ResourceStr) {
    Text(title).fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
  }

  private memoryWritePolicy(): Resource {
    switch (this.model.summary?.settings?.sensitiveWritePolicy) {
      case 'allow': return $r('app.string.about_you_memory_allowed');
      case 'deny': return $r('app.string.about_you_memory_denied');
      case 'confirm': return $r('app.string.about_you_memory_confirm');
      default: return $r('app.string.about_you_not_set');
    }
  }

  @Builder
  private summaryValue(label: Resource, detail: ResourceStr) {
    Row({ space: 16 }) {
      Text(label).fontSize(14).fontColor(this.colors.foreground).layoutWeight(1)
      Text(detail).fontSize(13).fontColor(this.colors.secondary).textAlign(TextAlign.End)
    }.width('100%').padding({ top: 6, bottom: 6 })
  }

  @Builder
  private overview() {
    Column() {
      Column({ space: 10 }) {
        Row() {
          XopcLoopi({ extent: 40, activePage: this.pageVisible && !this.editProfileOpen && !this.searchOpen,
            mood: this.model.error ? 'care' : this.model.loading || this.model.saving ? 'work' : 'listen' })
            .id('about-you-loopi')
          Text($r('app.string.about_you_basics')).fontSize(14).fontColor(this.colors.secondary).layoutWeight(1)
          Button($r('app.string.edit')).height(44).enabled(!!this.model.summary).fontSize(13).fontColor(this.colors.accent).backgroundColor(Color.Transparent)
            .onClick((): void => { this.openProfileEditor(); })
        }.width('100%')
        Text(this.model.summary?.profile.callName || this.model.summary?.suggestedCallName || $r('app.string.personal_default_name'))
          .fontSize(18).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
        if (this.model.summary?.profile.role) {
          Text(this.model.summary?.profile.role ?? '').fontSize(13).fontColor(this.colors.secondary).width('100%')
        }
        if (this.model.summary?.profile.timezone) {
          Text($r('app.string.about_you_timezone')).fontSize(12).fontColor(this.colors.secondary).width('100%')
          Text(this.model.summary?.profile.timezone ?? '').fontSize(14).fontColor(this.colors.foreground).width('100%')
        }
      }.width('100%').padding(16).borderRadius(this.colors.corner(18)).backgroundColor(this.colors.panel).margin({ top: 14 })

      Button({ type: ButtonType.Normal }) {
        Row({ space: 12 }) {
          SymbolGlyph($r('sys.symbol.doc_text')).fontSize(20).fontColor([this.colors.accent])
          Text($r('app.string.about_you_work_memory')).fontSize(16).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground).layoutWeight(1)
          if (this.model.summary) {
            Text((this.model.summary?.counts.workMemory ?? 0).toString()).fontSize(14)
              .fontColor(this.colors.secondary)
          }
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.tertiary])
        }.width('100%').padding(16)
      }.id('about-you-work-memory').width('100%').padding(0).margin({ top: 12 })
        .borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16)).backgroundColor(this.colors.panel)
        .onClick((): void => { this.selectSection('work'); })

      XopcSectionLabel({ heading: $r('app.string.about_you_recent') })
      if ((this.model.summary?.recent.length ?? 0) > 0) {
        ForEach(this.model.summary?.recent.slice(0, 3) ?? [], (item: XopcUnderstandingItem) => {
          this.understandingRow(item)
        }, (item: XopcUnderstandingItem): string => item.id)
      } else {
        Text($r('app.string.about_you_empty_all_title')).fontSize(15).lineHeight(23)
          .fontColor(this.colors.secondary).width('100%').padding(16)
          .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(16))
      }
      Button($r('app.string.about_you_view_all')).width('100%').height(48)
        .fontSize(15).fontColor(this.colors.accent).backgroundColor(Color.Transparent)
        .onClick((): void => { this.selectSection('understanding'); })
      if (this.model.summary?.primaryFocus?.title) {
        Column({ space: 10 }) {
          this.cardTitle($r('app.string.about_you_focus'))
          Text(this.model.summary?.primaryFocus?.title ?? '').fontSize(16).lineHeight(24)
            .fontColor(this.colors.foreground).width('100%')
          if (this.model.summary?.primaryFocus?.desiredOutcome) {
            Text(this.model.summary?.primaryFocus?.desiredOutcome ?? '').fontSize(14).lineHeight(21)
              .fontColor(this.colors.secondary).width('100%')
          }
        }.width('100%').padding(18).borderRadius(this.colors.corner(18)).backgroundColor(this.colors.panel).margin({ top: 12 })
      }
      if ((this.model.summary?.rules.length ?? 0) > 0) {
        XopcSectionLabel({ heading: $r('app.string.about_you_rules') })
        Column() {
          ForEach(this.model.summary?.rules ?? [], (rule: XopcUnderstandingRule) => {
            Row({ space: 10 }) {
              SymbolGlyph($r('sys.symbol.info_circle')).fontSize(18).fontColor([this.colors.accent])
              Text(rule.statement).fontSize(15).lineHeight(21).fontColor(this.colors.foreground).layoutWeight(1)
            }.width('100%').padding({ top: 10, bottom: 10 })
          }, (rule: XopcUnderstandingRule): string => rule.id)
        }.width('100%').padding({ left: 18, right: 18 }).borderRadius(this.colors.corner(18)).backgroundColor(this.colors.panel)
      }
      if (this.model.summary?.settings) {
        XopcSectionLabel({ heading: $r('app.string.about_you_memory_settings') })
        Column() {
          this.summaryValue($r('app.string.about_you_memory_enabled'), this.model.summary?.settings?.memoryEnabled
            ? $r('app.string.about_you_memory_on') : $r('app.string.about_you_memory_off'))
          this.summaryValue($r('app.string.about_you_memory_references'), this.model.summary?.settings?.showMemoryReferences
            ? $r('app.string.about_you_memory_on') : $r('app.string.about_you_memory_off'))
          this.summaryValue($r('app.string.about_you_memory_sensitive'), this.memoryWritePolicy())
        }.width('100%').padding(16).borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
      }
    }.width('100%').padding({ left: 20, right: 20, bottom: 32 }).alignItems(HorizontalAlign.Start)
  }

  private workKind(kind: string): Resource {
    switch (kind) {
      case 'decision': return $r('app.string.work_memory_decision');
      case 'task_lesson': return $r('app.string.work_memory_lesson');
      case 'work_thread': return $r('app.string.work_memory_thread');
      case 'project_fact':
      case 'workspace_fact': return $r('app.string.work_memory_fact');
      case 'commitment': return $r('app.string.work_memory_commitment');
      case 'open_question': return $r('app.string.work_memory_question');
      default: return $r('app.string.work_memory_record');
    }
  }

  @Builder
  private workRow(item: XopcWorkMemoryItem) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 8 }) {
        Row({ space: 8 }) {
          Text(this.workKind(item.kind)).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
          Text(this.scopeLabel(item.scope.type)).fontSize(12).fontColor(this.colors.secondary).layoutWeight(1)
          SymbolGlyph(this.expandedWorkId === item.id ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
            .fontSize(14).fontColor([this.colors.tertiary])
        }.width('100%')
        Text(item.content).fontSize(15).lineHeight(23).fontColor(this.colors.foreground)
          .width('100%').textAlign(TextAlign.Start)
          .maxLines(this.expandedWorkId === item.id ? undefined : 3).textOverflow({ overflow: TextOverflow.Ellipsis })
        Row({ space: 8 }) {
          Text(new Date(item.updatedAt).toLocaleDateString()).fontSize(12).fontColor(this.colors.secondary)
          if (item.status !== 'active') {
            Text(item.status === 'stale' ? $r('app.string.work_memory_stale') : $r('app.string.about_you_needs_review'))
              .fontSize(12).fontColor(this.colors.secondary)
          }
        }
      }.width('100%').alignItems(HorizontalAlign.Start).padding(16)
    }.id('work-memory-' + item.id).width('100%').padding(0).borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16))
      .backgroundColor(this.colors.panel)
      .onClick((): void => { this.expandedWorkId = this.expandedWorkId === item.id ? '' : item.id; })
  }

  @Builder
  private workMemory() {
    Refresh({ refreshing: this.model.workLoading && this.model.workItems.length > 0 && !this.model.workCursor }) {
      List({ space: 10 }) {
        if (this.model.workLoading && !this.model.workItems.length) {
          ListItem() { XopcListSkeleton() }
        } else if (this.model.workError) {
          ListItem() {
            Row({ space: 8 }) {
              Text($r('app.string.work_memory_load_error')).fontSize(14).fontColor(this.colors.secondary).layoutWeight(1)
              Button($r('app.string.refresh')).height(44).onClick((): void => { void this.model.loadWork(); })
            }.width('100%')
          }
        } else if (!this.model.workItems.length) {
          ListItem() {
            Text($r('app.string.work_memory_empty')).fontSize(15).fontColor(this.colors.secondary).width('100%')
              .textAlign(TextAlign.Start).padding(16).borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
          }
        }
        ForEach(this.model.workItems, (item: XopcWorkMemoryItem) => {
          ListItem() { this.workRow(item) }
        }, (item: XopcWorkMemoryItem): string => item.id)
        if (this.model.workCursor && !this.model.workError) {
          ListItem() {
            XopcPaginationFooter({ loadingPage: this.model.workLoading,
              onLoad: (): void => { void this.model.loadWork(this.model.workCursor); } })
          }
        }
      }.id('work-memory-list').width('100%').height('100%')
        .padding({ left: 20, right: 20, top: 8, bottom: 24 }).scrollBar(BarState.Off)
    }.layoutWeight(1).width('100%').onRefreshing((): void => { void this.model.loadWork(); })
  }

  @Builder
  private understandingRow(item: XopcUnderstandingItem) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        Column({ space: 5 }) {
          Text(item.statement).fontSize(16).lineHeight(24).fontColor(this.colors.foreground).maxLines(3)
            .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Text(this.sourceLabel(item))
            .fontSize(12).fontColor(item.status === 'needs_review' || item.status === 'conflicted' ? this.colors.accent : this.colors.secondary).width('100%')
          if (this.model.query.trim()) {
            Text(this.sourceText(item)).fontSize(12).fontColor(this.colors.tertiary).maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(16).fontColor([this.colors.tertiary])
      }.width('100%').padding(16)
    }.width('100%').padding(0).borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16)).backgroundColor(this.colors.panel).margin({ bottom: 8 })
      .onClick((): void => { this.openItem(item); }, SEGMENTED_PAGE_TAP_SLOP_VP)
  }

  @Builder
  private understandingFilters() {
    Column() {
      XopcSegmentedTabs({ options: [
        { key: 'all', label: $r('app.string.about_you_all') },
        { key: 'explicit', label: $r('app.string.about_you_explicit') },
        { key: 'learned', label: $r('app.string.about_you_learned') },
        { key: 'review', label: $r('app.string.about_you_review') }
      ], selectedKey: this.model.filter, swipeToSelect: true,
        onSelect: (key: string): void => { void this.model.load(key); } })
    }.width('100%').padding({ left: 20, right: 20 })
  }

  @Builder
  private understandingConversationAction() {
    Column() {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 9 }) {
          SymbolGlyph($r('sys.symbol.ellipsis_bubble')).fontSize(18).fontColor([this.colors.accent])
          Text($r('app.string.about_you_chat_modify')).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
          Blank().layoutWeight(1)
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.accent])
        }.width('100%').height('100%').padding({ left: 14, right: 12 })
      }.id('about-you-chat-modify').width('100%').height(48).padding(0)
        .borderRadius(this.colors.corner(24)).clipShape(this.colors.cornerClip(24)).backgroundColor(this.colors.accentSoft)
        .onClick((): void => { this.openConversation(); })
    }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: 16 })
      .backgroundColor(this.colors.surface)
  }

  @Builder
  private understandingList() {
    Column() {
      if (this.model.loadingMore && !this.model.items.length) { XopcListSkeleton() }
      else if (!this.model.items.length) {
        Column({ space: 10 }) {
          Row({ space: 8 }) {
            SymbolGlyph($r('sys.symbol.ellipsis_bubble')).fontSize(20).fontColor([this.colors.accent])
            Text(this.emptyTitle()).fontSize(16).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.foreground).layoutWeight(1)
          }.width('100%')
        }.width('100%').padding(18).borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
      } else {
        ForEach(this.model.items, (item: XopcUnderstandingItem) => { this.understandingRow(item) },
          (item: XopcUnderstandingItem): string => item.id)
        if (this.model.nextCursor) {
          XopcPaginationFooter({ loadingPage: this.model.loadingMore, failedPage: !!this.model.error,
            onLoad: (): void => { void this.model.loadMore(); } })
        }
      }
    }.width('100%').padding({ left: 20, right: 20, top: 16, bottom: 32 }).alignItems(HorizontalAlign.Start)
  }

  @Builder
  private detail(item: XopcUnderstandingItem) {
    Column() {
      XopcPageHeader({ backVisible: true, onBack: (): void => { this.model.close(); } })
      Scroll() {
        Column({ space: 12 }) {
          Column({ space: 12 }) {
            Text($r('app.string.about_you_statement')).fontSize(13).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.secondary).width('100%')
            if (this.editingStatement) {
              Text($r('app.string.about_you_edit_help')).fontSize(13).lineHeight(19)
                .fontColor(this.colors.secondary).width('100%')
              TextArea({ text: this.statement }).fontSize(17).lineHeight(25).fontColor(this.colors.foreground)
                .height(220).padding(14).borderRadius(this.colors.corner(14)).backgroundColor(this.colors.input)
                .caretColor(this.colors.accent).barState(BarState.Auto)
                .onChange((value: string): void => { this.statement = value; })
            } else {
              Text(item.statement).fontSize(19).lineHeight(28).fontWeight(FontWeight.Medium)
                .fontColor(this.colors.foreground).width('100%')
            }
          }.width('100%').padding(20).borderRadius(this.colors.corner(18)).backgroundColor(this.colors.panel)

          Column({ space: 16 }) {
            Text(this.sourceLabel(item)).fontSize(14).fontColor(this.colors.secondary).width('100%')
            Button($r('app.string.about_you_metadata')).fontSize(15).height(44).width('100%')
              .fontColor(this.colors.accent).backgroundColor(Color.Transparent)
              .accessibilityText($r('app.string.about_you_metadata'))
              .onClick((): void => { this.sourcesOpen = !this.sourcesOpen; })
            if (this.sourcesOpen) {
              this.detailRow($r('app.string.about_you_source'), this.sourceText(item))
              this.detailRow($r('app.string.about_you_scope'), this.text(this.scopeLabel(item.scope.type)))
            }
          }.width('100%').padding(20).borderRadius(this.colors.corner(18)).backgroundColor(this.colors.panel)
        }.width('100%').constraintSize({ minHeight: '100%' })
          .padding({ left: 20, right: 20, top: 4, bottom: 16 }).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
      if (this.editingStatement) {
        Row({ space: 10 }) {
          Button($r('app.string.cancel')).layoutWeight(1).height(48).borderRadius(this.colors.corner(24)).clipShape(this.colors.cornerClip(24))
            .backgroundColor(this.colors.input).fontColor(this.colors.foreground)
            .onClick((): void => { this.statement = item.statement; this.editingStatement = false; })
          Button($r('app.string.save')).layoutWeight(1).height(48).borderRadius(this.colors.corner(24)).clipShape(this.colors.cornerClip(24))
            .backgroundColor(this.colors.accent).fontColor(this.colors.onAccent)
            .enabled(!this.model.saving && !!this.statement.trim()).onClick((): void => { this.saveStatement(); })
        }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: 20 })
      } else {
        Column({ space: 8 }) {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 8 }) {
              SymbolGlyph($r('sys.symbol.ellipsis_bubble')).fontSize(18).fontColor([this.colors.accent])
              Text($r('app.string.about_you_chat_modify')).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
            }.width('100%').height('100%').justifyContent(FlexAlign.Center)
          }.id('about-you-detail-chat').width('100%').height(48).padding(0).borderRadius(this.colors.corner(24)).clipShape(this.colors.cornerClip(24))
            .backgroundColor(this.colors.accentSoft).onClick((): void => { this.openConversation(item); })
          Row({ space: 10 }) {
            Button($r('app.string.edit')).layoutWeight(1).height(48).borderRadius(this.colors.corner(24)).clipShape(this.colors.cornerClip(24))
              .backgroundColor(this.colors.foreground).fontColor(this.colors.surface)
              .onClick((): void => { this.editingStatement = true; })
            Button($r('app.string.delete')).layoutWeight(1).height(48).borderRadius(this.colors.corner(24)).clipShape(this.colors.cornerClip(24))
              .backgroundColor(this.colors.panel).fontColor(this.colors.danger)
              .enabled(!this.model.saving).onClick((): void => { this.confirmDelete(); })
          }.width('100%')
        }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: 20 })
      }
    }.width('100%').height('100%')
  }

  @Builder
  private detailRow(label: ResourceStr, value: string) {
    Column({ space: 4 }) {
      Text(label).fontSize(12).fontColor(this.colors.secondary).width('100%')
      Text(value).fontSize(15).fontColor(this.colors.foreground).width('100%')
    }.width('100%')
  }

  @Builder
  private profileFieldLabel(label: ResourceStr) {
    Text(label).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
  }

  @Builder
  private profileEditor() {
    Column({ space: 16 }) {
      Text($r('app.string.about_you_edit_profile')).fontSize(21).fontWeight(FontWeight.Bold)
        .fontColor(this.colors.foreground).width('100%')
      Scroll() {
        Column({ space: 16 }) {
          Column({ space: 7 }) {
            this.profileFieldLabel($r('app.string.about_you_call_name'))
            TextInput({ text: this.callName, placeholder: $r('app.string.about_you_call_name_placeholder') })
              .height(48).backgroundColor(this.colors.input).borderRadius(this.colors.corner(14))
              .onChange((input: string): void => { this.callName = input; })
          }.width('100%')
          Column({ space: 7 }) {
            this.profileFieldLabel($r('app.string.about_you_role'))
            TextInput({ text: this.role, placeholder: $r('app.string.about_you_role_placeholder') })
              .height(48).backgroundColor(this.colors.input).borderRadius(this.colors.corner(14))
              .onChange((input: string): void => { this.role = input; })
          }.width('100%')
          Column({ space: 7 }) {
            this.profileFieldLabel($r('app.string.about_you_pronouns'))
            Select(this.pronounOptions()).selected(this.pronounIndex()).value(this.pronounLabel())
              .width('100%').height(48).backgroundColor(this.colors.input).borderRadius(this.colors.corner(14))
              .fontColor(this.colors.foreground).selectedOptionBgColor(this.colors.accentSoft)
              .selectedOptionFontColor(this.colors.foreground).optionBgColor(this.colors.panel)
              .optionFontColor(this.colors.foreground)
              .onSelect((index: number, _selected?: string): void => {
                const values: string[] = this.pronounValues();
                this.customPronouns = index === values.length;
                if (!this.customPronouns) this.pronouns = values[index] ?? '';
              })
            if (this.customPronouns) {
              TextInput({ text: this.pronouns, placeholder: $r('app.string.about_you_pronouns_custom_placeholder') })
                .height(48).backgroundColor(this.colors.input).borderRadius(this.colors.corner(14))
                .onChange((input: string): void => { this.pronouns = input; })
            }
          }.width('100%')
          Column({ space: 7 }) {
            this.profileFieldLabel($r('app.string.about_you_timezone'))
            Select(this.timezoneOptions()).selected(this.timezoneIndex())
              .value(this.timezone || 'Asia/Shanghai').width('100%').height(48)
              .backgroundColor(this.colors.input).borderRadius(this.colors.corner(14)).fontColor(this.colors.foreground)
              .selectedOptionBgColor(this.colors.accentSoft).selectedOptionFontColor(this.colors.foreground)
              .optionBgColor(this.colors.panel).optionFontColor(this.colors.foreground)
              .onSelect((index: number, _selected?: string): void => {
                this.timezone = this.timezoneValues()[index] ?? 'Asia/Shanghai';
              })
          }.width('100%')
          Column({ space: 7 }) {
            this.profileFieldLabel($r('app.string.about_you_locale'))
            Select(this.localeOptions()).selected(this.locale === 'zh' ? 0 : 1).value(this.localeLabel())
              .width('100%').height(48).backgroundColor(this.colors.input).borderRadius(this.colors.corner(14))
              .fontColor(this.colors.foreground).selectedOptionBgColor(this.colors.accentSoft)
              .selectedOptionFontColor(this.colors.foreground).optionBgColor(this.colors.panel)
              .optionFontColor(this.colors.foreground)
              .onSelect((index: number, _selected?: string): void => { this.locale = index === 0 ? 'zh' : 'en'; })
          }.width('100%')
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ bottom: 8 })
      }.layoutWeight(1).width('100%').scrollBar(BarState.Auto)
      Row({ space: 10 }) {
        Button($r('app.string.cancel')).layoutWeight(1).height(48).backgroundColor(this.colors.input).fontColor(this.colors.foreground)
          .onClick((): void => { this.editProfileOpen = false; })
        Button($r('app.string.save')).layoutWeight(1).height(48).backgroundColor(this.colors.accent).fontColor(this.colors.onAccent)
          .enabled(!this.model.saving).onClick((): void => { this.saveProfile(); })
      }.width('100%')
    }.width('100%').height('100%').padding({ left: 20, right: 20, top: 12, bottom: 24 }).backgroundColor(this.colors.panel)
  }

  @Builder
  private sectionPage(section: string) {
    Column() {
      if (section !== 'work' && this.model.error) {
        Row({ space: 8 }) {
          Text(userErrorMessage(this.model.error, 'collection')).fontSize(13)
            .fontColor(this.colors.secondary).layoutWeight(1)
          Button($r('app.string.refresh')).height(44).onClick((): void => {
            if (section === 'overview') void this.model.refresh();
            else void this.model.load(this.model.filter);
          })
        }.width('100%').padding({ left: 20, right: 20 })
      }
      if (section === 'understanding') {
        this.understandingFilters()
        if (this.model.loading) {
          Column() { XopcListSkeleton() }.layoutWeight(1).width('100%').padding({ left: 20, right: 20, top: 8 })
        } else {
          Scroll() {
            this.understandingList()
          }.layoutWeight(1).width('100%').align(Alignment.TopStart).scrollBar(BarState.Off)
        }
        this.understandingConversationAction()
      } else if (section === 'work') {
        this.workMemory()
      } else if (this.model.loading && !this.model.summary) {
        Column() { XopcListSkeleton() }.width('100%').padding({ left: 20, right: 20 })
      } else if (this.model.summary) {
        Scroll() {
          this.overview()
        }.id('privacy-memory-overview').layoutWeight(1).width('100%').align(Alignment.TopStart).scrollBar(BarState.Off)
      }
    }.width('100%').height('100%')
      .accessibilityLevel(section === this.sections[this.section] ? 'auto' : 'no-hide-descendants')
  }

  build() {
    NavDestination() {
      if (this.model.selected) { this.detail(this.model.selected) }
      else if (this.model.openingId) { XopcBrandLoading() }
      else {
        Column() {
          this.mainHeader()
          if (this.section === 1 && this.searchOpen) {
            XopcPageSearchField({ text: this.model.query, placeholder: $r('app.string.about_you_search_placeholder'),
              searchId: 'about-you-search', onChange: (query: string): void => { this.model.search(query); },
              onSubmit: (): void => { this.getUIContext().getFocusController().clearFocus(); } })
              .margin({ left: 20, right: 20, bottom: 8 })
          }
          Swiper(this.pager) {
            ForEach(this.sections, (section: string) => {
              this.sectionPage(section)
            }, (section: string): string => section)
          }.id('about-you-pager').index(this.section).loop(false).indicator(false).cachedCount(2)
            .duration(this.layout.reduceMotion ? 0 : 230).disableSwipe(this.editProfileOpen)
            .onChange((index: number): void => { this.commitSection(index); })
            .width('100%').layoutWeight(1)
        }.width('100%').height('100%')
      }
    }.hideTitleBar(true).backgroundColor(this.colors.surface)
      .onShown((): void => { this.pageVisible = true; })
      .onHidden((): void => { this.pageVisible = false; })
      .onBackPressed((): boolean => {
      if (this.model.selected) { this.model.close(); return true; }
      if (this.model.openingId) { this.model.close(); return true; }
      if (this.searchOpen) { this.closeSearch(); return true; }
      return false;
    }).bindSheet($$this.editProfileOpen, this.profileEditor, { height: SheetSize.LARGE, dragBar: true, backgroundColor: this.colors.panel })
  }
}
