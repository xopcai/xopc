import { xopcSheetOptions } from '../common/dialogActions';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { gatewaySession } from '../service/gatewaySession';
import { XopcHttpError } from '../service/transport';
import { appSettings } from '../service/settings';
import { XopcHubRow, XopcListSkeleton, XopcPageHeader, XopcSectionLabel } from './MobileComponents';

interface XopcGlobalModelChoice {
  ref: string; name: string; provider: string; displayNames?: Record<string, string>;
}
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

  aboutToAppear(): void {
    this.gatewayId = gatewaySession.currentProfile()?.gatewayId ?? '';
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

  private label(key: string, isTask: boolean): Resource {
    switch (key) {
      case 'chat': return $r('app.string.ms_chat');
      case 'background': return $r('app.string.ms_background');
      case 'vision': return isTask ? $r('app.string.ms_visual_task') : $r('app.string.ms_vision');
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
    const choice = this.data?.pools[row.pool]?.find((item: XopcGlobalModelChoice): boolean => item.ref === row.ref);
    return choice ? this.modelName(choice) : row.name ?? $r('app.string.ms_unset');
  }

  private modelName(choice: XopcGlobalModelChoice): string {
    const key = appSettings.effectiveLanguage().startsWith('zh') ? 'zh-CN' : 'en';
    return choice.displayNames?.[key] || choice.name;
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
      (this.modelName(item) + ' ' + item.name + ' ' + item.provider + ' ' + item.ref).toLowerCase().includes(search));
  }

  private sheetHeight(): number | string {
    if (this.sheet === 'fallbacks') {
      const count = this.data?.fallbacks.length ?? 0;
      return count > 3 ? '72%' : 180 + 52 * count;
    }
    const count = this.choices().length;
    if (count > 3) return '72%';
    return 184 + 54 * (count + (this.route?.allowInherit ? 1 : 0));
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
      void this.save({ kind: this.sheet, revision: this.data.revision,
        key: this.route.key, ref: this.selected || null }, '');
    }
  }

  private routeSymbol(key: string): Resource {
    switch (key) {
      case 'chat': return $r('sys.symbol.ellipsis_bubble');
      case 'background': return $r('sys.symbol.clock');
      case 'vision': return $r('sys.symbol.eye');
      case 'image': return $r('sys.symbol.paintbrush');
      case 'transcription': return $r('sys.symbol.mic');
      case 'speech': return $r('sys.symbol.speaker_wave_2');
      case 'conversation': return $r('sys.symbol.waveform');
      case 'video': return $r('sys.symbol.film');
      case 'music': return $r('sys.symbol.music');
      case 'fast': return $r('sys.symbol.bolt');
      case 'reasoning': return $r('sys.symbol.lightbulb');
      case 'coding': return $r('sys.symbol.code');
      case 'review': return $r('sys.symbol.checkmark_circle');
      case 'understanding': return $r('sys.symbol.doc_text');
      default: return $r('sys.symbol.rectangle_stack');
    }
  }

  @Builder
  private row(row: XopcGlobalModelRoute, kind: string) {
    XopcHubRow({ heading: this.label(row.key, kind === 'task'), trailingValue: this.display(row), compact: true,
      symbol: this.routeSymbol(row.key),
      onOpen: (): void => { this.open(kind, row); } })
      .id((kind === 'task' ? 'model-task-' : 'model-setting-') + row.key)
  }

  @Builder
  private settingsList() {
    XopcSectionLabel({ heading: $r('app.string.ms_default') })
    ForEach((this.data?.routing ?? []).filter((row: XopcGlobalModelRoute): boolean => row.key === 'chat'),
      (row: XopcGlobalModelRoute) => { this.row(row, 'model') },
      (row: XopcGlobalModelRoute): string => row.ref ?? 'default')
    XopcHubRow({ heading: $r('app.string.ms_fallbacks'), trailingValue: (this.data?.fallbacks.length ?? 0).toString(), compact: true,
      symbol: $r('sys.symbol.list_bullet'), onOpen: (): void => { this.open('fallbacks'); } }).id('model-settings-fallbacks')
    if (this.data?.tasks.length) {
      XopcSectionLabel({ heading: $r('app.string.ms_tasks') })
      ForEach(this.data?.tasks ?? [], (row: XopcGlobalModelRoute) => { this.row(row, 'task') },
        (row: XopcGlobalModelRoute): string => row.key + ':' + (row.ref ?? '') + ':' + (row.name ?? ''))
    }
    XopcSectionLabel({ heading: $r('app.string.ms_other') })
    ForEach((this.data?.routing ?? []).filter((row: XopcGlobalModelRoute): boolean => ['background', 'vision', 'image'].includes(row.key)),
      (row: XopcGlobalModelRoute) => { this.row(row, 'model') },
      (row: XopcGlobalModelRoute): string => row.key + ':' + (row.ref ?? '') + ':' + (row.name ?? ''))
    if (this.data?.routing.some((row: XopcGlobalModelRoute): boolean =>
      ['transcription', 'speech', 'conversation', 'video', 'music'].includes(row.key))) {
      XopcSectionLabel({ heading: $r('app.string.ms_media') })
      ForEach((this.data?.routing ?? []).filter((row: XopcGlobalModelRoute): boolean =>
        ['transcription', 'speech', 'conversation', 'video', 'music'].includes(row.key)),
        (row: XopcGlobalModelRoute) => { this.row(row, 'model') },
        (row: XopcGlobalModelRoute): string => row.key + ':' + (row.ref ?? '') + ':' + (row.name ?? ''))
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
    }.width('100%').padding(0).backgroundColor(this.selected === ref ? this.colors.accentSoft : this.colors.input)
      .borderRadius(this.colors.corner(12)).clipShape(this.colors.cornerClip(12)).enabled(!this.saving).accessibilitySelected(this.selected === ref)
      .onClick((): void => { this.selected = ref; })
  }

  @Builder
  private sheetBody() {
    Column({ space: 8 }) {
      Text(this.sheet === 'fallbacks' ? $r('app.string.ms_fallbacks')
        : this.sheet === 'add' ? $r('app.string.ms_add_fallback') : this.label(this.route?.key ?? '', this.sheet === 'task'))
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
                Text((index + 1).toString() + '. ' + this.modelName(choice)).fontSize(14).fontColor(this.colors.foreground).layoutWeight(1)
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
        if (this.choices().length > 3) {
          TextInput({ text: this.query, placeholder: $r('app.string.ms_search') }).id('model-settings-search')
            .width('100%').height(46).backgroundColor(this.colors.input).onChange((query: string): void => { this.query = query; })
        }
        Scroll() {
          Column({ space: 4 }) {
            if (this.route?.allowInherit) { this.option($r('app.string.ms_inherit'), '', '') }
            ForEach(this.matching(), (choice: XopcGlobalModelChoice) => { this.option(this.modelName(choice), choice.provider, choice.ref) },
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
        heading: $r('app.string.ms_title'), backVisible: true,
        onBack: (): void => { if (!this.saving) this.onExit(); }
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
          if (this.data) { this.settingsList() }
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 16, right: 16, bottom: 20 })
      }.layoutWeight(1).width('100%').align(Alignment.Top)
    }.id('model-settings').width('100%').height('100%').backgroundColor(this.colors.surface)
      .bindSheet($$this.showingSheet, this.sheetBody, xopcSheetOptions('medium', {
        height: this.sheetHeight(),
        shouldDismiss: (action: SheetDismiss): void => { if (!this.saving) action.dismiss(); },
      }))
    }.hideTitleBar(true).onBackPressed((): boolean => this.saving)
  }
}
