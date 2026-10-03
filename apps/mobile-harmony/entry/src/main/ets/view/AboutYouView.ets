import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcMobileRoute } from '../model/home';
import { XopcUnderstandingItem, XopcUnderstandingProfile, XopcUnderstandingRule } from '../model/userUnderstanding';
import { XopcUserUnderstandingViewModel } from '../viewmodel/userUnderstandingViewModel';
import { XopcBrandLoading, XopcListSkeleton, XopcSectionLabel } from './MobileComponents';
import { userErrorMessage } from '../common/userError';
import { XopcLoopi } from './Loopi';

@ComponentV2
export struct XopcAboutYouView {
  @Param initialId: string = '';
  @Local colors: XopcThemeColors = appThemeColors;
  @Local model: XopcUserUnderstandingViewModel = new XopcUserUnderstandingViewModel();
  @Local section: number = 0;
  @Local pageVisible: boolean = false;
  @Local searchOpen: boolean = false;
  @Local editProfileOpen: boolean = false;
  @Local editingStatement: boolean = false;
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
    await this.model.refresh();
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

  private emptyHelp(): ResourceStr {
    if (this.model.query.trim()) return $r('app.string.about_you_empty_search_help');
    if (this.model.filter === 'explicit') return $r('app.string.about_you_empty_explicit_help');
    if (this.model.filter === 'learned') return $r('app.string.about_you_empty_learned_help');
    if (this.model.filter === 'review') return $r('app.string.about_you_empty_review_help');
    return $r('app.string.about_you_empty_all_help');
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

  private sourceText(item: XopcUnderstandingItem): string {
    if (!item.sources.length) return this.text($r('app.string.about_you_system_inference'));
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
    this.searchOpen = false;
    if (this.model.query) this.model.search('');
  }

  @Builder
  private header(title: ResourceStr, back: () => void) {
    Row({ space: 8 }) {
      Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(21).fontColor([this.colors.foreground]) }
        .width(44).height(44).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.back')).onClick((): void => { back(); })
      Text(title).fontSize(21).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).layoutWeight(1)
    }.width('100%').height(60).padding({ left: 8, right: 20 })
  }

  @Builder
  private mainHeader() {
    Row({ space: 8 }) {
      Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(21).fontColor([this.colors.foreground]) }
        .width(44).height(44).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.back')).onClick((): void => {
          if (this.searchOpen) this.closeSearch();
          else this.onExit();
        })
      if (this.searchOpen && this.section === 1) {
        Search({ value: this.model.query, placeholder: $r('app.string.about_you_search_placeholder') })
          .id('about-you-search').layoutWeight(1).height(44).padding({ left: 4, right: 4 })
          .fontColor(this.colors.foreground).placeholderColor(this.colors.tertiary)
          .backgroundColor(this.colors.input).borderRadius(14)
          .onChange((query: string): void => { this.model.search(query); })
          .onSubmit((query: string): void => { this.model.search(query); })
        Button() { SymbolGlyph($r('sys.symbol.xmark')).fontSize(18).fontColor([this.colors.secondary]) }
          .id('about-you-search-close').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.close')).onClick((): void => { this.closeSearch(); })
      } else {
        Text($r('app.string.about_you')).fontSize(21).fontWeight(FontWeight.Bold)
          .fontColor(this.colors.foreground).layoutWeight(1)
        if (this.section === 1) {
          Button() { SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(21).fontColor([this.colors.foreground]) }
            .id('about-you-search-open').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
            .accessibilityText($r('app.string.search')).onClick((): void => { this.searchOpen = true; })
        }
      }
    }.width('100%').height(60).padding({ left: 8, right: 8 })
  }

  @Builder
  private cardTitle(title: ResourceStr) {
    Text(title).fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
  }

  @Builder
  private overview() {
    Column() {
      Text($r('app.string.about_you_subtitle')).fontSize(14).lineHeight(20).fontColor(this.colors.secondary).width('100%')
      Column({ space: 10 }) {
        Row() {
          this.cardTitle($r('app.string.about_you_basics'))
          Button($r('app.string.edit')).fontSize(13).fontColor(this.colors.accent).backgroundColor(Color.Transparent)
            .onClick((): void => { this.openProfileEditor(); })
        }.width('100%')
        Text(this.model.summary?.profile.callName || this.model.summary?.suggestedCallName || $r('app.string.personal_default_name'))
          .fontSize(18).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
        if (this.model.summary?.profile.role) {
          Text(this.model.summary?.profile.role ?? '').fontSize(13).fontColor(this.colors.secondary).width('100%')
        }
      }.width('100%').padding(18).borderRadius(18).backgroundColor(this.colors.panel).margin({ top: 18 })

      Column({ space: 10 }) {
        this.cardTitle($r('app.string.about_you_focus'))
        Text(this.model.summary?.primaryFocus?.title ?? $r('app.string.about_you_no_focus'))
          .fontSize(16).lineHeight(23).fontColor(this.colors.foreground).width('100%')
        if (this.model.summary?.primaryFocus?.desiredOutcome) {
          Text(this.model.summary?.primaryFocus?.desiredOutcome ?? '').fontSize(13).lineHeight(19)
            .fontColor(this.colors.secondary).width('100%')
        }
      }.width('100%').padding(18).borderRadius(18).backgroundColor(this.colors.panel).margin({ top: 12 })

      Column({ space: 14 }) {
        this.cardTitle($r('app.string.about_you_understanding'))
        Row() {
          this.countCell(this.model.summary?.counts.explicit ?? 0, $r('app.string.about_you_explicit'), false)
          this.countCell(this.model.summary?.counts.learned ?? 0, $r('app.string.about_you_learned'), false)
          this.countCell(this.model.summary?.counts.review ?? 0, $r('app.string.about_you_needs_review'), true)
        }.width('100%')
      }.width('100%').padding(18).borderRadius(18).backgroundColor(this.colors.panel).margin({ top: 12 })
        .onClick((): void => { this.section = 1; this.model.load('all'); })

      if ((this.model.summary?.recent.length ?? 0) > 0) {
        XopcSectionLabel({ heading: $r('app.string.about_you_recent') })
        ForEach(this.model.summary?.recent ?? [], (item: XopcUnderstandingItem) => {
          this.understandingRow(item)
        }, (item: XopcUnderstandingItem): string => item.id)
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
        }.width('100%').padding({ left: 18, right: 18 }).borderRadius(18).backgroundColor(this.colors.panel)
      }

      Column({ space: 8 }) {
        Row() {
          this.cardTitle($r('app.string.about_you_work_memory'))
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(16).fontColor([this.colors.tertiary])
        }.width('100%')
        Text($r('app.string.about_you_work_memory_count', this.model.summary?.counts.workMemory ?? 0))
          .fontSize(18).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
        Text($r('app.string.about_you_work_memory_help')).fontSize(13).lineHeight(19).fontColor(this.colors.secondary).width('100%')
      }.width('100%').padding(18).borderRadius(18).backgroundColor(this.colors.panel).margin({ top: 20 })
        .onClick((): void => { this.onNavigate({ page: 'notes', itemId: '' }); })
    }.width('100%').padding({ left: 20, right: 20, bottom: 32 }).alignItems(HorizontalAlign.Start)
  }

  @Builder
  private countCell(value: number, label: ResourceStr, accent: boolean) {
    Column({ space: 4 }) {
      Text(value.toString()).fontSize(25).fontWeight(FontWeight.Bold).fontColor(accent && value > 0 ? this.colors.accent : this.colors.foreground)
      Text(label).fontSize(11).fontColor(this.colors.secondary).maxLines(2)
    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
  }

  @Builder
  private filterButton(value: string, label: ResourceStr) {
    Button(label).fontSize(13).fontColor(this.model.filter === value ? this.colors.accent : this.colors.secondary)
      .height(36).padding({ left: 14, right: 14 }).borderRadius(18)
      .backgroundColor(this.model.filter === value ? this.colors.accentSoft : this.colors.panel)
      .onClick((): void => { this.model.load(value); })
  }

  @Builder
  private understandingRow(item: XopcUnderstandingItem) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        Column({ space: 5 }) {
          Text(item.statement).fontSize(15).lineHeight(21).fontColor(this.colors.foreground).maxLines(3)
            .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Text(item.status === 'needs_review' || item.status === 'conflicted' ? $r('app.string.about_you_needs_review') :
            item.authority === 'user_explicit' ? $r('app.string.about_you_explicit') : $r('app.string.about_you_learned'))
            .fontSize(12).fontColor(item.status === 'needs_review' || item.status === 'conflicted' ? this.colors.accent : this.colors.secondary).width('100%')
          if (this.model.query.trim()) {
            Text(this.sourceText(item)).fontSize(12).fontColor(this.colors.tertiary).maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(16).fontColor([this.colors.tertiary])
      }.width('100%').padding(16)
    }.width('100%').padding(0).borderRadius(16).backgroundColor(this.colors.panel).margin({ bottom: 8 })
      .onClick((): void => { this.openItem(item); })
  }

  @Builder
  private understandingFilters() {
    Scroll() {
      Row({ space: 8 }) {
        this.filterButton('all', $r('app.string.about_you_all'))
        this.filterButton('explicit', $r('app.string.about_you_explicit'))
        this.filterButton('learned', $r('app.string.about_you_learned'))
        this.filterButton('review', $r('app.string.about_you_review'))
      }
    }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%')
      .padding({ left: 20, right: 20 })
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
        .borderRadius(24).backgroundColor(this.colors.accentSoft)
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
          Text(this.emptyHelp()).fontSize(13).lineHeight(20).fontColor(this.colors.secondary).width('100%')
          if (!this.model.query.trim()) {
            Text($r('app.string.about_you_empty_action_hint')).fontSize(12).lineHeight(18)
              .fontColor(this.colors.accent).width('100%')
          }
        }.width('100%').padding(18).borderRadius(16).backgroundColor(this.colors.panel)
      } else {
        ForEach(this.model.items, (item: XopcUnderstandingItem) => { this.understandingRow(item) },
          (item: XopcUnderstandingItem): string => item.id)
        if (this.model.nextCursor) {
          Button($r('app.string.load_more')).fontColor(this.colors.accent).backgroundColor(Color.Transparent)
            .onClick((): void => { this.model.loadMore(); })
        }
      }
    }.width('100%').padding({ left: 20, right: 20, top: 16, bottom: 32 }).alignItems(HorizontalAlign.Start)
  }

  @Builder
  private detail(item: XopcUnderstandingItem) {
    Column() {
      this.header($r('app.string.about_you_details'), (): void => { this.model.close(); })
      Scroll() {
        Column({ space: 12 }) {
          Column({ space: 12 }) {
            Text($r('app.string.about_you_statement')).fontSize(13).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.secondary).width('100%')
            if (this.editingStatement) {
              Text($r('app.string.about_you_edit_help')).fontSize(13).lineHeight(19)
                .fontColor(this.colors.secondary).width('100%')
              TextArea({ text: this.statement }).fontSize(17).lineHeight(25).fontColor(this.colors.foreground)
                .height(220).padding(14).borderRadius(14).backgroundColor(this.colors.input)
                .caretColor(this.colors.accent).barState(BarState.Auto)
                .onChange((value: string): void => { this.statement = value; })
            } else {
              Text(item.statement).fontSize(19).lineHeight(28).fontWeight(FontWeight.Medium)
                .fontColor(this.colors.foreground).width('100%')
            }
          }.width('100%').padding(20).borderRadius(18).backgroundColor(this.colors.panel)

          Column({ space: 16 }) {
            Text($r('app.string.about_you_metadata')).fontSize(13).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.secondary).width('100%')
            this.detailRow($r('app.string.about_you_source'), this.sourceText(item))
            this.detailRow($r('app.string.about_you_scope'), item.scope.type)
            this.detailRow($r('app.string.about_you_confidence'), Math.round(item.confidence * 100).toString() + '%')
          }.width('100%').padding(20).borderRadius(18).backgroundColor(this.colors.panel)
        }.width('100%').constraintSize({ minHeight: '100%' })
          .padding({ left: 20, right: 20, top: 4, bottom: 16 }).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
      if (this.editingStatement) {
        Row({ space: 10 }) {
          Button($r('app.string.cancel')).layoutWeight(1).height(48).borderRadius(24)
            .backgroundColor(this.colors.input).fontColor(this.colors.foreground)
            .onClick((): void => { this.statement = item.statement; this.editingStatement = false; })
          Button($r('app.string.save')).layoutWeight(1).height(48).borderRadius(24)
            .backgroundColor(this.colors.accent).fontColor(Color.White)
            .enabled(!this.model.saving && !!this.statement.trim()).onClick((): void => { this.saveStatement(); })
        }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: 20 })
      } else {
        Column({ space: 8 }) {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 8 }) {
              SymbolGlyph($r('sys.symbol.ellipsis_bubble')).fontSize(18).fontColor([this.colors.accent])
              Text($r('app.string.about_you_chat_modify')).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
            }.width('100%').height('100%').justifyContent(FlexAlign.Center)
          }.id('about-you-detail-chat').width('100%').height(48).padding(0).borderRadius(24)
            .backgroundColor(this.colors.accentSoft).onClick((): void => { this.openConversation(item); })
          Row({ space: 10 }) {
            Button($r('app.string.edit')).layoutWeight(1).height(48).borderRadius(24)
              .backgroundColor(this.colors.foreground).fontColor(this.colors.surface)
              .onClick((): void => { this.editingStatement = true; })
            Button($r('app.string.delete')).layoutWeight(1).height(48).borderRadius(24)
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
  private profileFieldLabel(label: ResourceStr, help: ResourceStr = '') {
    Column({ space: 2 }) {
      Text(label).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
      if (help !== '') {
        Text(help).fontSize(12).lineHeight(17).fontColor(this.colors.tertiary).width('100%')
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  private profileEditor() {
    Column({ space: 16 }) {
      Column({ space: 5 }) {
        Text($r('app.string.about_you_edit_profile')).fontSize(21).fontWeight(FontWeight.Bold)
          .fontColor(this.colors.foreground).width('100%')
        Text($r('app.string.about_you_edit_profile_help')).fontSize(13).lineHeight(19)
          .fontColor(this.colors.secondary).width('100%')
      }.width('100%').alignItems(HorizontalAlign.Start)
      Scroll() {
        Column({ space: 16 }) {
          Column({ space: 7 }) {
            this.profileFieldLabel($r('app.string.about_you_call_name'))
            TextInput({ text: this.callName, placeholder: $r('app.string.about_you_call_name_placeholder') })
              .height(48).backgroundColor(this.colors.input).borderRadius(14)
              .onChange((input: string): void => { this.callName = input; })
          }.width('100%')
          Column({ space: 7 }) {
            this.profileFieldLabel($r('app.string.about_you_role'), $r('app.string.about_you_role_help'))
            TextInput({ text: this.role, placeholder: $r('app.string.about_you_role_placeholder') })
              .height(48).backgroundColor(this.colors.input).borderRadius(14)
              .onChange((input: string): void => { this.role = input; })
          }.width('100%')
          Column({ space: 7 }) {
            this.profileFieldLabel($r('app.string.about_you_pronouns'))
            Select(this.pronounOptions()).selected(this.pronounIndex()).value(this.pronounLabel())
              .width('100%').height(48).backgroundColor(this.colors.input).borderRadius(14)
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
                .height(48).backgroundColor(this.colors.input).borderRadius(14)
                .onChange((input: string): void => { this.pronouns = input; })
            }
          }.width('100%')
          Column({ space: 7 }) {
            this.profileFieldLabel($r('app.string.about_you_timezone'), $r('app.string.about_you_timezone_help'))
            Select(this.timezoneOptions()).selected(this.timezoneIndex())
              .value(this.timezone || 'Asia/Shanghai').width('100%').height(48)
              .backgroundColor(this.colors.input).borderRadius(14).fontColor(this.colors.foreground)
              .selectedOptionBgColor(this.colors.accentSoft).selectedOptionFontColor(this.colors.foreground)
              .optionBgColor(this.colors.panel).optionFontColor(this.colors.foreground)
              .onSelect((index: number, _selected?: string): void => {
                this.timezone = this.timezoneValues()[index] ?? 'Asia/Shanghai';
              })
          }.width('100%')
          Column({ space: 7 }) {
            this.profileFieldLabel($r('app.string.about_you_locale'), $r('app.string.about_you_locale_help'))
            Select(this.localeOptions()).selected(this.locale === 'zh' ? 0 : 1).value(this.localeLabel())
              .width('100%').height(48).backgroundColor(this.colors.input).borderRadius(14)
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
        Button($r('app.string.save')).layoutWeight(1).height(48).backgroundColor(this.colors.accent).fontColor(Color.White)
          .enabled(!this.model.saving).onClick((): void => { this.saveProfile(); })
      }.width('100%')
    }.width('100%').height('100%').padding({ left: 20, right: 20, top: 12, bottom: 24 }).backgroundColor(this.colors.panel)
  }

  build() {
    NavDestination() {
      if (this.model.selected) { this.detail(this.model.selected) }
      else if (this.model.openingId) { XopcBrandLoading() }
      else {
        Column() {
          this.mainHeader()
          XopcLoopi({ extent: 64, activePage: this.pageVisible && !this.editProfileOpen && !this.searchOpen,
            mood: this.model.error ? 'care' : this.model.loading || this.model.saving ? 'work' : 'listen' })
            .id('about-you-loopi').margin({ bottom: 8 })
          Row() {
            Button($r('app.string.about_you_overview')).layoutWeight(1).height(36).fontSize(13)
              .fontColor(this.section === 0 ? this.colors.foreground : this.colors.secondary)
              .backgroundColor(this.section === 0 ? this.colors.panel : Color.Transparent)
              .onClick((): void => { this.closeSearch(); this.section = 0; })
            Button($r('app.string.about_you_understanding')).layoutWeight(1).height(36).fontSize(13)
              .fontColor(this.section === 1 ? this.colors.foreground : this.colors.secondary)
              .backgroundColor(this.section === 1 ? this.colors.panel : Color.Transparent)
              .onClick((): void => { this.section = 1; if (!this.model.items.length) this.model.load('all'); })
          }.width('calc(100% - 40vp)').padding(3).borderRadius(20).backgroundColor(this.colors.grouped).margin({ bottom: 14 })
          if (this.model.error) { Text(userErrorMessage(this.model.error, 'collection')).fontSize(12)
            .fontColor(this.colors.secondary).padding({ left: 20, right: 20, bottom: 8 }) }
          if (this.section === 1) {
            Column() {
              this.understandingFilters()
              if (this.model.loading) {
                Column() { XopcListSkeleton() }.layoutWeight(1).width('100%').padding({ left: 20, right: 20, top: 8 })
              } else {
                Scroll() {
                  this.understandingList()
                }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
              }
              this.understandingConversationAction()
            }.layoutWeight(1).width('100%').alignItems(HorizontalAlign.Start)
          } else if (this.model.loading) {
            Column() { XopcListSkeleton() }.width('100%').padding({ left: 20, right: 20 })
          } else {
            Scroll() {
              this.overview()
            }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
          }
        }.width('100%').height('100%')
      }
    }.hideTitleBar(true).backgroundColor(this.colors.surface)
      .onShown((): void => { this.pageVisible = true; })
      .onHidden((): void => { this.pageVisible = false; })
      .onBackPressed((): boolean => {
      if (this.model.selected) { this.model.close(); return true; }
      if (this.model.openingId) { this.model.close(); return true; }
      return false;
    }).bindSheet($$this.editProfileOpen, this.profileEditor, { height: SheetSize.LARGE, dragBar: true, backgroundColor: this.colors.panel })
  }
}
