import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { gatewaySession } from '../service/gatewaySession';
import { XopcHttpError } from '../service/transport';
import { XopcHubRow, XopcListSkeleton, XopcPageHeader, XopcSectionLabel } from './MobileComponents';

interface XopcGlobalModelChoice { ref: string; name: string; provider: string; }
interface XopcGlobalModelRoute {
  key: string; pool: string; ref: string | null; name: string | null; inherited?: boolean; allowInherit?: boolean;
}
interface XopcGlobalModelSettings {
  revision: string;
  routing: XopcGlobalModelRoute[];
  tasks: XopcGlobalModelRoute[];
  fallbacks: XopcGlobalModelChoice[];
  pools: Record<string, XopcGlobalModelChoice[]>;
}
interface XopcGlobalModelResponse { payload: XopcGlobalModelSettings; }
interface XopcGlobalModelChange { kind: string; revision: string; key?: string; ref?: string | null; refs?: string[]; }

const path: string = '/api/mobile/model-settings';

@ComponentV2
export struct XopcModelSettingsView {
  @Event onExit: () => void = (): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local data: XopcGlobalModelSettings | undefined = undefined;
  @Local page: string = 'defaults';
  @Local showMedia: boolean = false;
  @Local showingSheet: boolean = false;
  @Local sheet: string = '';
  @Local route: XopcGlobalModelRoute | undefined = undefined;
  @Local query: string = '';
  @Local selected: string = '';
  @Local loading: boolean = true;
  @Local saving: boolean = false;
  @Local error: number = 0;
  @Local sheetError: boolean = false;
  private gatewayId: string = '';
  @Local gatewayName: string = '';

  aboutToAppear(): void {
    this.gatewayId = gatewaySession.currentProfile()?.gatewayId ?? '';
    this.gatewayName = gatewaySession.currentProfile()?.name ?? '';
    void this.load();
  }

  private async request(change?: XopcGlobalModelChange): Promise<XopcGlobalModelSettings> {
    if (!this.gatewayId || this.gatewayId !== gatewaySession.currentProfile()?.gatewayId) throw new Error('GATEWAY_CHANGED');
    const result = await gatewaySession.request(path, change ? 'PATCH' : 'GET', change ? JSON.stringify(change) : '');
    return (JSON.parse(result) as XopcGlobalModelResponse).payload;
  }

  private async load(preserveMessage: boolean = false): Promise<void> {
    this.loading = true;
    if (!preserveMessage) this.error = 0;
    try { this.data = await this.request(); }
    catch (error) { this.error = error instanceof XopcHttpError && error.status === 404 ? 404 : 500; }
    finally { this.loading = false; }
  }

  private async save(change: XopcGlobalModelChange, next: string): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.sheetError = false;
    try {
      this.data = await this.request(change);
      this.error = 0;
      if (next) this.sheet = next;
      else this.showingSheet = false;
    } catch (error) {
      if (error instanceof XopcHttpError && error.status === 409) {
        this.showingSheet = false;
        this.data = undefined;
        this.error = 409;
        await this.load(true);
      } else this.sheetError = true;
    } finally { this.saving = false; }
  }

  private label(key: string): Resource {
    switch (key) {
      case 'chat': return $r('app.string.ms_chat');
      case 'background': return $r('app.string.ms_background');
      case 'vision': return this.page === 'tasks' ? $r('app.string.ms_visual_task') : $r('app.string.ms_vision');
      case 'image': return $r('app.string.ms_image');
      case 'transcription': return $r('app.string.ms_transcription');
      case 'speech': return $r('app.string.ms_speech');
      case 'conversation': return $r('app.string.ms_conversation');
      case 'video': return $r('app.string.ms_video');
      case 'music': return $r('app.string.ms_music');
      case 'fast': return $r('app.string.ms_fast');
      case 'reasoning': return $r('app.string.ms_reasoning');
      case 'coding': return $r('app.string.ms_coding');
      case 'review': return $r('app.string.ms_review');
      case 'understanding': return $r('app.string.ms_understanding');
      default: return $r('app.string.ms_title');
    }
  }

  private display(row: XopcGlobalModelRoute): ResourceStr {
    if (row.inherited) return $r('app.string.ms_inherit');
    if (!this.data?.pools[row.pool]?.length && row.key !== 'chat') return $r('app.string.ms_not_connected');
    return row.name ?? $r('app.string.ms_unset');
  }

  private open(sheet: string, route?: XopcGlobalModelRoute): void {
    this.sheet = sheet;
    this.route = route;
    this.query = '';
    this.selected = route?.ref ?? '';
    this.sheetError = false;
    this.showingSheet = true;
  }

  private choices(): XopcGlobalModelChoice[] {
    const pool = this.sheet === 'add' ? 'chat' : this.route?.pool ?? '';
    const options = this.data?.pools[pool] ?? [];
    if (this.sheet !== 'add') return options;
    const primary = this.data?.routing.find((item: XopcGlobalModelRoute): boolean => item.key === 'chat')?.ref;
    return options.filter((item: XopcGlobalModelChoice): boolean =>
      item.ref !== primary && !this.data?.fallbacks.some((current: XopcGlobalModelChoice): boolean => current.ref === item.ref));
  }

  private matching(): XopcGlobalModelChoice[] {
    const search = this.query.trim().toLowerCase();
    return this.choices().filter((item: XopcGlobalModelChoice): boolean =>
      (item.name + ' ' + item.provider + ' ' + item.ref).toLowerCase().includes(search));
  }

  private saveFallbacks(refs: string[]): void {
    if (this.data) void this.save({ kind: 'fallbacks', revision: this.data.revision, refs }, 'fallbacks');
  }

  private moveFallback(index: number): void {
    if (index < 1 || !this.data) return;
    const refs = this.data.fallbacks.map((item: XopcGlobalModelChoice): string => item.ref);
    const moved = refs.splice(index, 1)[0];
    refs.splice(index - 1, 0, moved);
    this.saveFallbacks(refs);
  }

  private removeFallback(ref: string): void {
    if (!this.data) return;
    this.saveFallbacks(this.data.fallbacks.filter((item: XopcGlobalModelChoice): boolean => item.ref !== ref)
      .map((item: XopcGlobalModelChoice): string => item.ref));
  }

  private confirm(): void {
    if (!this.data) return;
    if (this.sheet === 'add') {
      this.saveFallbacks(this.data.fallbacks.map((item: XopcGlobalModelChoice): string => item.ref).concat([this.selected]));
    } else if (this.route) {
      void this.save({ kind: this.page === 'tasks' ? 'task' : 'model', revision: this.data.revision,
        key: this.route.key, ref: this.selected || null }, '');
    }
  }

  @Builder
  private row(row: XopcGlobalModelRoute) {
    XopcHubRow({ heading: this.label(row.key), summary: this.display(row), compact: true,
      symbol: $r('sys.symbol.slider_horizontal_2'), onOpen: (): void => { this.open('model', row); } })
      .id('model-setting-' + row.key)
  }

  @Builder
  private primary(row: XopcGlobalModelRoute) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        SymbolGlyph($r('sys.symbol.ellipsis_bubble')).fontSize(21).fontColor([this.colors.accent])
        Column({ space: 4 }) {
          Text($r('app.string.ms_chat')).fontSize(13).fontColor(this.colors.secondary)
          Text(this.display(row)).fontSize(18).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        Text($r('app.string.ms_change')).fontSize(13).fontColor(this.colors.accent)
      }.width('100%').constraintSize({ minHeight: 72 }).padding(12)
    }.id('model-setting-chat').width('100%').padding(0).backgroundColor(this.colors.accentSoft)
      .borderRadius(this.colors.corner(16)).margin({ bottom: 8 }).onClick((): void => { this.open('model', row); })
  }

  @Builder
  private settingsList(data: XopcGlobalModelSettings) {
    if (this.page === 'tasks') {
      Text($r('app.string.ms_task_help')).fontSize(13).fontColor(this.colors.secondary).width('100%').margin({ bottom: 12 })
      ForEach(data.tasks, (row: XopcGlobalModelRoute) => { this.row(row) },
        (row: XopcGlobalModelRoute): string => 'task-' + row.key + ':' + (row.name ?? ''))
    } else {
      Text(this.gatewayName).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
      Text($r('app.string.ms_scope')).fontSize(13).fontColor(this.colors.secondary).width('100%').margin({ top: 4 })
      XopcSectionLabel({ heading: $r('app.string.ms_default') })
      ForEach(data.routing.filter((row: XopcGlobalModelRoute): boolean => row.key === 'chat'),
        (row: XopcGlobalModelRoute) => { this.primary(row) },
        (row: XopcGlobalModelRoute): string => row.ref ?? 'default')
      XopcHubRow({ heading: $r('app.string.ms_fallbacks'), summary: data.fallbacks.length.toString(), compact: true,
        symbol: $r('sys.symbol.list_bullet'), onOpen: (): void => { this.open('fallbacks'); } }).id('model-settings-fallbacks')
      XopcHubRow({ heading: $r('app.string.ms_tasks'), compact: true,
        symbol: $r('sys.symbol.slider_horizontal_2'), onOpen: (): void => { this.page = 'tasks'; } })
      XopcSectionLabel({ heading: $r('app.string.ms_other') })
      ForEach(data.routing.filter((row: XopcGlobalModelRoute): boolean => ['background', 'vision', 'image'].includes(row.key)),
        (row: XopcGlobalModelRoute) => { this.row(row) },
        (row: XopcGlobalModelRoute): string => row.key + ':' + (row.name ?? ''))
      XopcHubRow({ heading: $r('app.string.ms_media'), compact: true, showChevron: !this.showMedia,
        symbol: $r('sys.symbol.play_circle'), onOpen: (): void => { this.showMedia = !this.showMedia; } })
      if (this.showMedia) {
        ForEach(data.routing.filter((row: XopcGlobalModelRoute): boolean => ['transcription', 'speech', 'conversation', 'video', 'music'].includes(row.key)),
          (row: XopcGlobalModelRoute) => { this.row(row) },
          (row: XopcGlobalModelRoute): string => row.key + ':' + (row.name ?? ''))
      }
    }
  }

  @Builder
  private option(name: ResourceStr, provider: string, ref: string) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 8 }) {
        Column({ space: 3 }) {
          Text(name).fontSize(15).fontColor(this.colors.foreground)
          if (provider) { Text(provider).fontSize(12).fontColor(this.colors.secondary) }
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        if (this.selected === ref) {
          SymbolGlyph($r('sys.symbol.checkmark')).fontSize(16).fontColor([this.colors.accent])
        }
      }.width('100%').constraintSize({ minHeight: 50 }).padding({ left: 12, right: 12 })
    }.width('100%').padding(0).backgroundColor(this.selected === ref ? this.colors.accentSoft : Color.Transparent)
      .borderRadius(this.colors.corner(12)).enabled(!this.saving).accessibilitySelected(this.selected === ref)
      .onClick((): void => { this.selected = ref; })
  }

  @Builder
  private sheetBody() {
    Column({ space: 8 }) {
      Text(this.sheet === 'fallbacks' ? $r('app.string.ms_fallbacks')
        : this.sheet === 'add' ? $r('app.string.ms_add_fallback') : this.label(this.route?.key ?? ''))
        .fontSize(19).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
      if (this.sheetError) {
        Text($r('app.string.ms_save_error')).fontSize(13).fontColor(this.colors.danger).width('100%')
      }
      if (this.sheet === 'fallbacks') {
        Text($r('app.string.ms_fallback_help')).fontSize(13).fontColor(this.colors.secondary).width('100%')
        Scroll() {
          Column() {
            ForEach(this.data?.fallbacks ?? [], (choice: XopcGlobalModelChoice, index: number) => {
              Row({ space: 8 }) {
                Text((index + 1).toString() + '. ' + choice.name).fontSize(14).fontColor(this.colors.foreground).layoutWeight(1)
                Button($r('app.string.ms_move_up')).height(44).enabled(index > 0 && !this.saving)
                  .onClick((): void => { this.moveFallback(index); })
                Button($r('app.string.ms_remove')).height(44).enabled(!this.saving)
                  .onClick((): void => { this.removeFallback(choice.ref); })
              }.width('100%')
            }, (choice: XopcGlobalModelChoice, index: number): string => choice.ref + ':' + index)
          }.width('100%')
        }.layoutWeight(1).width('100%')
        Button($r('app.string.ms_add_fallback')).width('100%').height(48).enabled(!this.saving)
          .onClick((): void => { this.open('add'); })
      } else {
        if (this.choices().length) {
          TextInput({ text: this.query, placeholder: $r('app.string.ms_search') }).id('model-settings-search')
            .width('100%').height(46).backgroundColor(this.colors.input).onChange((query: string): void => { this.query = query; })
        }
        Scroll() {
          Column() {
            if (this.route?.allowInherit) { this.option($r('app.string.ms_inherit'), '', '') }
            ForEach(this.matching(), (choice: XopcGlobalModelChoice) => { this.option(choice.name, choice.provider, choice.ref) },
              (choice: XopcGlobalModelChoice): string => choice.ref)
            if (!this.matching().length) {
              Text(this.choices().length ? $r('app.string.ms_no_match') : $r('app.string.ms_connect'))
                .fontSize(13).fontColor(this.colors.secondary).width('100%').padding(12)
            }
          }.width('100%')
        }.layoutWeight(1).width('100%')
        if (this.choices().length || this.route?.allowInherit) {
          Button(this.sheet === 'add' ? $r('app.string.ms_add_fallback') : $r('app.string.ms_confirm'))
            .id('model-settings-confirm').width('100%').height(48)
            .enabled(!this.saving && this.selected !== (this.route?.ref ?? ''))
            .onClick((): void => { this.confirm(); })
        }
      }
      if (this.saving) { LoadingProgress().width(24).height(24) }
    }.width('100%').height('100%').padding({ left: 18, right: 18, top: 20, bottom: 24 })
  }

  build() {
    NavDestination() {
    Column() {
      XopcPageHeader({
        heading: this.page === 'tasks' ? $r('app.string.ms_tasks') : $r('app.string.ms_title'),
        titleOptions: [
          { key: 'defaults', label: $r('app.string.ms_title'), id: 'model-page-default' },
          { key: 'tasks', label: $r('app.string.ms_tasks'), id: 'model-page-tasks' }
        ],
        selectedTitle: this.page, titleMenuId: 'model-settings-menu',
        onSelectTitle: (page: string): void => { this.page = page; }, backVisible: true,
        onBack: (): void => { if (this.page === 'tasks') this.page = 'defaults'; else this.onExit(); }
      })
      Scroll() {
        Column() {
          if (this.loading) { XopcListSkeleton() }
          if (this.error) {
            Text(this.error === 404 ? $r('app.string.ms_update_gateway') :
              this.error === 409 ? $r('app.string.ms_conflict') : $r('app.string.ms_load_error'))
              .fontSize(14).fontColor(this.colors.secondary).width('100%').margin({ bottom: 8 })
            if (!this.loading && !this.data) { Button($r('app.string.retry')).onClick((): void => { void this.load(); }) }
          }
          if (this.data) { this.settingsList(this.data) }
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 16, right: 16, bottom: 20 })
      }.layoutWeight(1).width('100%').align(Alignment.Top)
    }.id('model-settings').width('100%').height('100%').backgroundColor(this.colors.surface)
      .bindSheet($$this.showingSheet, this.sheetBody, { height: '72%', dragBar: true, backgroundColor: this.colors.panel,
        shouldDismiss: (action: SheetDismiss): void => { if (!this.saving) action.dismiss(); } })
    }.hideTitleBar(true).onBackPressed((): boolean => {
      if (this.saving) return true;
      if (this.page === 'tasks') { this.page = 'defaults'; return true; }
      return false;
    })
  }
}
