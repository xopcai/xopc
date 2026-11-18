import { common } from '@kit.AbilityKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { markdownLink } from '../common/markdown';
import { gatewaySession } from '../service/gatewaySession';
import { appSettings } from '../service/settings';
import { XopcHttpError } from '../service/transport';
import { XopcCapabilityLogo } from './CapabilityLogo';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { XopcListSkeleton } from './MobileComponents';

interface CapabilityChoice { id: string; label: string; }
interface CapabilityFieldVisibility { field: string; value: string; }
interface CapabilityField {
  id: string; label: string; type: string; value?: string; hint?: string; options?: CapabilityChoice[]; advanced?: boolean;
  visibleWhen?: CapabilityFieldVisibility;
}
interface CapabilityAction { id: string; label: string; confirmation?: string; inlineReview?: boolean; advanced?: boolean; }
interface CapabilitySearchResult { id: string; name: string; summary?: string; source: string; iconUrl?: string; action?: CapabilityAction; }
interface CapabilityPanelPayload {
  fields?: CapabilityField[]; actions?: CapabilityAction[]; message?: string; details?: string;
  authorizationUrl?: string; qrUrl?: string; flow?: string; revision?: number;
  pollAction?: string; results?: CapabilitySearchResult[]; chatPrompt?: string;
}
interface CapabilityPanelEnvelope { ok: boolean; payload?: CapabilityPanelPayload; error?: string; }
interface CapabilityPanelCommand { action: string; values: Record<string, string>; flow?: string; revision?: number; }

@ComponentV2
export struct XopcCapabilityPanelView {
  @Param category: string = '';
  @Param itemId: string = '';
  @Param itemName: string = '';
  @Param description: string = '';
  @Param iconUrl: string = '';
  @Param avatarReference: string = '';
  @Param appearance: string = 'configured';
  @Param avatarRevision: number = 0;
  @Event onClose: () => void = (): void => {};
  @Event onChanged: () => void = (): void => {};
  @Event onUseInChat: (prompt: string) => void = (_prompt: string): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local panel?: CapabilityPanelPayload;
  @Local values: Map<string, string> = new Map<string, string>();
  @Local busy: boolean = false;
  @Local errorMessage: string = '';
  @Local advanced: boolean = false;
  @Local detailsOpen: boolean = false;
  @Local newGroup: string = '';
  private generation: number = 0;
  private alive: boolean = false;
  private pollTimer: number = -1;
  private deadline: number = 0;
  private openWhenReady: boolean = false;

  aboutToAppear(): void { this.alive = true; void this.request(); }
  aboutToDisappear(): void {
    this.alive = false;
    ++this.generation;
    this.clearPoll();
    this.values.clear();
  }

  private t(zh: string, en: string): string { return appSettings.effectiveLanguage().startsWith('zh') ? zh : en; }

  private set(id: string, value: string): void {
    const updated = new Map<string, string>(this.values);
    updated.set(id, value);
    this.values = updated;
  }

  private clearPoll(): void {
    if (this.pollTimer !== -1) clearTimeout(this.pollTimer);
    this.pollTimer = -1;
  }

  private schedulePoll(): void {
    this.clearPoll();
    const action = this.panel?.pollAction;
    if (!action || !this.alive) return;
    if (Date.now() >= this.deadline) {
      this.errorMessage = this.t('等待时间过长，可以刷新状态或重新开始。', 'This is taking longer than expected. Refresh or start again.');
      return;
    }
    this.pollTimer = setTimeout((): void => { void this.request(action, true); }, Math.min(4000, this.deadline - Date.now()));
  }

  private async request(action: string = '', polling: boolean = false): Promise<void> {
    if (this.busy || !this.alive) return;
    this.clearPoll();
    const generation = ++this.generation;
    const previous = this.panel?.pollAction;
    const flow = this.panel?.flow;
    const canRecover = this.category === 'connections' && this.itemId.startsWith('conversation:') && flow &&
      (action === 'approve' || action === 'token' || action === 'advance');
    if (!polling) {
      this.busy = true;
      this.errorMessage = '';
      if (action.startsWith('authorize') || action.startsWith('status:') || action.startsWith('status-server:')) {
        this.openWhenReady = true;
      }
    }
    try {
      const url = '/api/capabilities/mobile-actions/panel/' + this.category + '?id=' + encodeURIComponent(this.itemId)
        + '&locale=' + encodeURIComponent(appSettings.effectiveLanguage());
      const values: Record<string, string> = {};
      if (!polling) this.values.forEach((value: string, id: string): void => { values[id] = value; });
      const command: CapabilityPanelCommand = { action, values, flow: this.panel?.flow, revision: this.panel?.revision };
      const raw = await gatewaySession.request(url, action ? 'POST' : 'GET', action ? JSON.stringify(command) : '');
      const result = JSON.parse(raw) as CapabilityPanelEnvelope;
      if (!result.ok || !result.payload) throw new Error(result.error ?? 'CAPABILITY_UNAVAILABLE');
      if (generation !== this.generation) return;
      this.panel = result.payload;
      const next = new Map<string, string>();
      for (const field of result.payload.fields ?? []) {
        next.set(field.id, (polling ? this.values.get(field.id) : undefined) ?? (field.type === 'secret' ? '' : field.value ?? ''));
      }
      this.values = next;
      if (!polling) this.newGroup = '';
      this.errorMessage = '';
      if (!polling || previous !== result.payload.pollAction) this.deadline = Date.now() + 300000;
      if (this.openWhenReady && result.payload.authorizationUrl) {
        this.openWhenReady = false;
        void this.authorize(result.payload.authorizationUrl);
      }
      if ((!polling && action && action !== 'search') || (polling && previous && !result.payload.pollAction)) this.onChanged();
    } catch (error) {
      if (!polling && generation === this.generation) {
        if (canRecover && (!(error instanceof XopcHttpError) || error.status >= 500)) {
          this.panel = { flow, pollAction: 'check', message: this.t('正在查询连接结果…', 'Checking the connection result…') };
          this.values = new Map<string, string>();
          this.deadline = Date.now() + 300000;
          return;
        }
        this.errorMessage = this.t('暂时无法完成，请重试。', 'Could not complete this action. Try again.');
        if (error instanceof XopcHttpError) {
          try {
            const detail = JSON.parse(error.body) as CapabilityPanelEnvelope;
            if (typeof detail.error === 'string') this.errorMessage = detail.error;
          } catch (_) {}
        }
      }
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.schedulePoll();
      }
    }
  }

  private async perform(action: CapabilityAction): Promise<void> {
    if (this.busy) return;
    if (action.confirmation && !action.inlineReview) {
      try {
        const result = await this.getUIContext().getPromptAction().showDialog({
          title: action.label, message: action.confirmation,
          buttons: [{ text: this.t('取消', 'Cancel'), color: this.colors.secondary },
            { text: this.t('确认', 'Confirm'), color: this.colors.accent }]
        });
        if (result.index !== 1) return;
      } catch (_) { return; }
    }
    this.getUIContext().getFocusController().clearFocus();
    await this.request(action.id);
  }

  private async authorize(raw: string): Promise<void> {
    const url = raw.startsWith('https://') ? markdownLink(raw) : '';
    if (!url || !raw.startsWith('https://')) return;
    try { await (this.getUIContext().getHostContext() as common.UIAbilityContext).openLink(url, { appLinkingOnly: false }); }
    catch (_) { this.errorMessage = this.t('无法打开授权页面，请重试。', 'Could not open sign-in. Try again.'); }
  }

  private selectedOption(field: CapabilityField): number {
    return Math.max(0, (field.options ?? []).findIndex((option: CapabilityChoice): boolean => option.id === this.values.get(field.id)));
  }

  @Builder
  field(field: CapabilityField) {
    Column({ space: 6 }) {
      if (field.type === 'toggle') {
        Row({ space: 12 }) {
          Text(field.label).layoutWeight(1).fontColor(this.colors.foreground)
          Toggle({ type: ToggleType.Switch, isOn: this.values.get(field.id) === 'true' })
            .accessibilityText(field.label).enabled(!this.busy)
            .onChange((enabled: boolean): void => { this.set(field.id, String(enabled)); })
        }.width('100%').padding(12).backgroundColor(this.colors.input).borderRadius(this.colors.corner(14))
      } else {
        Text(field.label).fontSize(14).fontColor(this.colors.foreground)
        if (field.type === 'list') {
          this.groupList(field)
        } else if (field.type === 'multiline') {
          TextArea({ text: this.values.get(field.id) ?? '', placeholder: field.hint ?? '' })
            .id('capability-field-' + field.id).width('100%').height(96).maxLength(2000)
            .backgroundColor(this.colors.input).fontColor(this.colors.foreground).enabled(!this.busy).borderRadius(this.colors.corner(14))
            .onChange((value: string): void => { this.set(field.id, value); })
        } else if (field.type === 'select') {
          Select((field.options ?? []).map((option: CapabilityChoice): SelectOption => ({ value: option.label })))
            .selected(this.selectedOption(field)).value(field.options?.[this.selectedOption(field)]?.label ?? '')
            .id('capability-field-' + field.id).width('100%').backgroundColor(this.colors.input).fontColor(this.colors.foreground)
            .optionBgColor(this.colors.panel).optionFontColor(this.colors.foreground).enabled(!this.busy)
            .onSelect((index: number): void => { this.set(field.id, field.options?.[index]?.id ?? ''); })
        } else {
          TextInput({ text: this.values.get(field.id) ?? '', placeholder: field.hint ?? '' })
            .id('capability-field-' + field.id).width('100%').height(46).maxLength(8192)
            .type(field.type === 'secret' ? InputType.Password : InputType.Normal)
            .enterKeyType(field.id === 'query' ? EnterKeyType.Search : EnterKeyType.Done)
            .backgroundColor(this.colors.input).fontColor(this.colors.foreground).enabled(!this.busy).borderRadius(this.colors.corner(14))
            .onSubmit((): void => {
              if (field.id === 'query') {
                this.getUIContext().getFocusController().clearFocus();
                void this.request('search');
              }
            })
            .onChange((value: string): void => { this.set(field.id, value); })
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  private groupIds(id: string): string[] {
    return Array.from(new Set<string>((this.values.get(id) ?? '').split('\n').filter((value: string): boolean => value.trim().length > 0)));
  }

  private addGroup(id: string): void {
    const value = this.newGroup.trim();
    if (!value || /[,\r\n]/.test(value)) return;
    const groups = this.groupIds(id);
    if (!groups.includes(value)) this.set(id, groups.concat([value]).join('\n'));
    this.newGroup = '';
  }

  @Builder
  groupList(field: CapabilityField) {
    Column({ space: 6 }) {
      ForEach(this.groupIds(field.id), (group: string) => {
        Row({ space: 8 }) {
          Text(group).fontSize(14).fontColor(this.colors.foreground).layoutWeight(1)
          Button(this.t('移除', 'Remove')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.chat.action)
            .accessibilityText(this.t('移除 ', 'Remove ') + group)
            .onClick((): void => { this.set(field.id, this.groupIds(field.id).filter((item: string): boolean => item !== group).join('\n')); })
        }.width('100%')
      }, (group: string): string => group)
      Row({ space: 8 }) {
        TextInput({ text: this.newGroup, placeholder: field.hint ?? '' }).layoutWeight(1).height(44).maxLength(160)
          .enabled(!this.busy).onChange((value: string): void => { this.newGroup = value; })
          .onSubmit((): void => { this.addGroup(field.id); })
        Button(this.t('添加群聊', 'Add group')).height(44).enabled(!this.busy && this.newGroup.trim().length > 0)
          .backgroundColor(this.colors.accentSoft).fontColor(this.colors.chat.action).onClick((): void => { this.addGroup(field.id); })
      }.width('100%')
    }.width('100%').id('capability-field-' + field.id).padding(8).backgroundColor(this.colors.input)
      .borderRadius(this.colors.corner(14))
  }

  private fields(advanced: boolean): CapabilityField[] {
    return (this.panel?.fields ?? []).filter((field: CapabilityField): boolean => (field.advanced === true) === advanced &&
      (!field.visibleWhen || this.values.get(field.visibleWhen.field) === field.visibleWhen.value));
  }

  private actions(advanced: boolean): CapabilityAction[] {
    return (this.panel?.actions ?? []).filter((action: CapabilityAction): boolean => (action.advanced === true) === advanced);
  }

  @Builder
  actionButton(action: CapabilityAction, primary: boolean) {
    Button(action.label).id('capability-panel-' + action.id).width('100%').height(46)
      .backgroundColor(primary ? this.colors.accent : Color.Transparent)
      .fontColor(primary ? this.colors.onAccent : this.colors.chat.action).enabled(!this.busy)
      .onClick((): void => { void this.perform(action); })
  }

  @Builder
  resultRow(result: CapabilitySearchResult) {
    Row({ space: 12 }) {
      XopcCapabilityLogo({ category: 'skills', iconUrl: result.iconUrl ?? '', label: result.name, extent: 40 })
      Column({ space: 4 }) {
        Text(result.name).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (result.summary) Text(result.summary).fontSize(13).fontColor(this.colors.secondary)
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(result.source).fontSize(12).fontColor(this.colors.secondary)
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      if (result.action) {
        Button(result.action.label).id('capability-panel-' + result.action.id).height(44)
          .backgroundColor(this.colors.accentSoft).fontColor(this.colors.chat.action).enabled(!this.busy)
          .onClick((): void => { if (result.action) void this.perform(result.action); })
      } else {
        Text(this.t('已安装', 'Installed')).fontSize(13).fontColor(this.colors.secondary)
      }
    }.width('100%').padding(14).backgroundColor(this.colors.panel).borderRadius(this.colors.corner(16))
  }

  @Builder
  panelHeader() {
    Row({ space: 10 }) {
      if (this.category === 'agents') {
        XopcPersonalAgentAvatar({ agentId: this.itemId, extent: 44, compact: true, activePage: false,
          appearance: this.appearance, revision: this.avatarRevision,
          avatarReference: this.avatarReference, fallbackLabel: this.itemName })
      } else {
        XopcCapabilityLogo({ category: this.category, iconUrl: this.iconUrl, extent: 44,
          label: this.itemId === 'marketplace:search' || this.itemId === 'mcp:setup' ? '' : this.itemName })
      }
      Text(this.itemName).fontSize(20).fontWeight(FontWeight.Bold)
        .fontColor(this.colors.foreground).layoutWeight(1).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.xmark')).fontSize(18).fontColor([this.colors.foreground])
      }.id('capability-panel-close').width(44).height(44).padding(0).backgroundColor(this.colors.input)
        .accessibilityText($r('app.string.close')).onClick(this.onClose)
    }.width('100%').padding({ left: 20, right: 20, top: 10, bottom: 14 })
  }

  private readyPrompt(): string {
    if (this.panel?.pollAction || this.errorMessage || !this.panel?.chatPrompt) return '';
    const changed = (this.panel.fields ?? []).some((field: CapabilityField): boolean =>
      (this.values.get(field.id) ?? '') !== (field.type === 'secret' ? '' : field.value ?? ''));
    return changed ? '' : this.panel.chatPrompt;
  }

  private primaryAction(): CapabilityAction | undefined {
    if (this.readyPrompt() || this.panel?.authorizationUrl || this.panel?.pollAction) return undefined;
    return this.actions(false)[0];
  }

  @Builder
  private panelFooter() {
    if (this.readyPrompt() || this.primaryAction() || this.panel?.authorizationUrl) {
      Column() {
        if (this.readyPrompt()) {
          Button(this.itemId.startsWith('conversation:') ? this.t('返回对话', 'Back to chat') : this.t('通过对话使用', 'Use in chat'))
            .id('capability-use-in-chat').width('100%').height(48).fontSize(16)
            .backgroundColor(this.colors.accent).fontColor(this.colors.onAccent).enabled(!this.busy)
            .onClick((): void => {
              const prompt = this.readyPrompt();
              if (!prompt) return;
              if (this.itemId.startsWith('conversation:')) this.onClose();
              else this.onUseInChat(prompt);
            })
        } else if (this.panel?.authorizationUrl) {
          Button(this.t('继续授权', 'Continue sign-in')).width('100%').height(48)
            .backgroundColor(this.colors.accent).fontColor(this.colors.onAccent).enabled(!this.busy)
            .onClick((): void => { void this.authorize(this.panel?.authorizationUrl ?? ''); })
        } else if (this.primaryAction()) {
          this.actionButton(this.primaryAction()!, true)
        }
      }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: 16 }).backgroundColor(this.colors.surface)
    }
  }

  @Builder
  panelBody() {
    Scroll() {
      Column({ space: 14 }) {
        if (this.panel?.message || this.readyPrompt() || this.panel?.pollAction) {
          Row({ space: 10 }) {
            if (this.panel?.pollAction) {
              LoadingProgress().width(20).height(20).color(this.colors.accent)
            } else if (this.readyPrompt()) {
              SymbolGlyph($r('sys.symbol.checkmark_circle')).fontSize(20).fontColor([this.colors.success])
            }
            Text(this.panel?.message || this.t('可在对话中使用', 'Ready to use in chat')).fontSize(14)
              .fontColor(this.colors.foreground).layoutWeight(1)
          }.id('capability-panel-status').width('100%').padding(14)
            .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(14))
        } else if (this.panel && this.description && this.category !== 'agents') {
          Text(this.description).fontSize(14).fontColor(this.colors.secondary).width('100%')
        }
        if (this.busy && this.panel) LoadingProgress().width(22).height(22).color(this.colors.accent)
        if (!this.panel && !this.errorMessage) { XopcListSkeleton() }
        if (this.errorMessage) {
          Text(this.errorMessage).fontSize(14).fontColor(this.colors.danger).width('100%')
          if (!this.panel) Button(this.t('重试', 'Retry')).enabled(!this.busy).onClick((): void => { void this.request(); })
          if (this.panel?.pollAction) Button(this.t('刷新状态', 'Refresh status')).enabled(!this.busy)
            .onClick((): void => { if (this.panel?.pollAction) void this.request(this.panel.pollAction); })
        }
        if (this.panel?.qrUrl) {
          Row() {
            QRCode(this.panel!.qrUrl!).width(176).height(176).color('#111318').backgroundColor(Color.White)
          }.padding(12).backgroundColor(Color.White).borderRadius(16).alignSelf(ItemAlign.Center)
        }
        if (this.panel?.details) {
          Column({ space: 6 }) {
            Button(this.detailsOpen ? this.t('收起详情', 'Hide details') : this.t('查看详情', 'View details'))
              .id('capability-panel-review-details').height(44).backgroundColor(Color.Transparent)
              .fontColor(this.colors.chat.action).onClick((): void => { this.detailsOpen = !this.detailsOpen; })
            if (this.detailsOpen) Text(this.panel?.details).fontSize(13).fontColor(this.colors.secondary).width('100%')
          }.width('100%').padding({ left: 12, right: 12, bottom: this.detailsOpen ? 12 : 0 })
            .alignItems(HorizontalAlign.Start).backgroundColor(this.colors.panel).borderRadius(this.colors.corner(14))
        }
        if (this.fields(false).length) {
          Column({ space: 14 }) {
            ForEach(this.fields(false), (entry: CapabilityField) => { this.field(entry) },
              (entry: CapabilityField): string => entry.id)
          }.width('100%').padding(14).backgroundColor(this.colors.panel).borderRadius(this.colors.corner(16))
        }
        ForEach(this.actions(false).filter((action: CapabilityAction): boolean => action.id !== this.primaryAction()?.id),
          (action: CapabilityAction) => { this.actionButton(action, false) }, (action: CapabilityAction): string => action.id)
        ForEach(this.panel?.results ?? [], (entry: CapabilitySearchResult) => { this.resultRow(entry) },
          (entry: CapabilitySearchResult): string => entry.id)
        if (this.fields(true).length || this.actions(true).length) {
          Column({ space: 10 }) {
            Button(this.t('更多选项', 'More options'))
              .id('capability-panel-more').height(44).backgroundColor(Color.Transparent).fontColor(this.colors.chat.action)
              .accessibilitySelected(this.advanced).onClick((): void => { this.advanced = !this.advanced; })
            if (this.advanced) {
              ForEach(this.fields(true), (field: CapabilityField) => { this.field(field) }, (field: CapabilityField): string => field.id)
              ForEach(this.actions(true), (action: CapabilityAction) => { this.actionButton(action, false) },
                (action: CapabilityAction): string => action.id)
            }
          }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 12, right: 12 })
            .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(14))
        }
      }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 20, right: 20, top: 4, bottom: 12 })
    }.width('100%').layoutWeight(1).align(Alignment.Top).scrollBar(BarState.Auto)
  }

  build() {
    Column() {
      this.panelHeader()
      this.panelBody()
      this.panelFooter()
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
  }
}
